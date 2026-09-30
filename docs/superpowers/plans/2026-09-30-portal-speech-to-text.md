# Portal Speech to Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A microphone button on the portal's two text boxes that records up to ten minutes, has the portal turn the recording into text with an open model, and puts the text in the box; optional, and asked about during own-computer setup.

**Architecture:** The browser records with `MediaRecorder`, converts the recording to 16 kHz 16-bit mono PCM itself, and posts it to `POST /api/transcribe`. The portal hands each clip to a short-lived child process (`speech-worker.js`) that runs the Parakeet model through `sherpa-onnx-node`, one clip at a time, and returns the text. A setup script downloads the model and flips `SPEECH_TO_TEXT=on`; the page shows no mic unless `/api/meta` says speech is ready.

**Tech Stack:** Node 18+, Express 5, node:test, `sherpa-onnx-node` 1.13.8 (optional dependency), Parakeet TDT 0.6b v3 int8 and Silero VAD (ONNX), browser `MediaRecorder` and Web Audio, bash 3.2.

**Spec:** `docs/superpowers/specs/2026-09-30-portal-speech-to-text-design.md`. Read it before starting; this plan argues from it.

## Global Constraints

- Work in `~/j4dev` on the existing branch `speech-to-text`. Never edit `~/j4` (the live portal runs from it) and never use port 8710 (the live portal listens there). Scratch servers use `127.0.0.1:59717`.
- Setup scripts stay bash 3.2 compatible: no associative arrays, no `readarray`, no `sed -i`, no `${var,,}`, no GNU-only flags. This host runs bash 5.2, so check by reading, not by "the tests passed".
- Setup tests never write the real registry or the real `.env`: always set `PORTAL_REGISTRY` and `JAWBS_ENV_FILE`. They never download the model: always set `JAWBS_SPEECH_URL_BASE` to a `file://` fixture folder.
- The audio is never written to disk and never logged, on the server or in the browser.
- `sherpa-onnx-node` is pinned to exactly `1.13.8` in `optionalDependencies`.
- Model files and checksums, exactly:
  - `sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2`, SHA-256 `5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf`
  - `silero_vad.onnx`, SHA-256 `9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6`
  - Both from `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models`
- Recording limit: 600 seconds. Request body limit: 20 MB. Packing window: 25 seconds. Queue: one running, at most three waiting.
- Everything the page puts into `innerHTML` for this feature is a fixed string from `dictate.js`. No server text, no transcript and no error message from a response goes into `innerHTML`. The transcript goes into `textarea.value` only. (`express.static` serves the portal with no CSP.)
- User-facing copy is British English, names no vendor or model, and is copied from this plan word for word.
- Docs use no em or en dashes as sentence punctuation.
- Commit after each task. End commit messages with the attribution lines your session specifies.
- Verification commands: `cd portal && npm test` and `bash setup/test/run-tests.sh` (prints `Passed: N  Failed: N`).

## Review Focus

Failure modes the spec implies that are most likely to bite a person, most likely first. Each has a test in the task named.

1. **Moving to another conversation while a clip is being transcribed.** The text must not land in the other conversation's reply box. Pinned by the browser check in Task 7 (case 3).
2. **The worker dying before it has read the audio.** A multi-megabyte write to a dead process raises EPIPE; the portal must answer with an error, not crash. Pinned in Task 2 (`a worker that dies without reading its input`).
3. **A body that is not PCM.** JSON, an odd number of bytes or nothing at all must get 400, and the transcriber must not be called. Pinned in Task 3.
4. **A half-finished or damaged install.** An interrupted download, a model folder with files missing, or a `.env` with no final newline or a commented-out `SPEECH_TO_TEXT` line must all end in a correct install and a correct `.env`. Pinned in Task 5.
5. **A tap too short to hold any audio.** The button must come back to "Speak your answer" with a message, not sit on "Transcribing" for ever. Pinned by the browser check in Task 7 (case 4).

## File Structure

| File | Responsibility |
|---|---|
| `portal/src/speech-worker.js` (new) | One clip in, text out. Pure helpers `packWindows`, `pcmToFloat`; `main` runs only when executed. The only file that loads `sherpa-onnx-node`. |
| `portal/src/speech.js` (new) | Whether speech is ready; the one-at-a-time queue; spawning the worker. No config import, no native code. |
| `portal/src/config.js` | `speech`, `speechDir`. |
| `portal/src/preflight.js` | Warn when on but not ready. |
| `portal/src/server.js` | `/api/transcribe`, `speech` in `/api/meta`. |
| `portal/public/dictate.js` (new) | Pure copy and formatting helpers, plus the recorder and the button. |
| `portal/public/app.js` | Attach the button, leave on navigation, keep the reply draft across the poll. |
| `portal/public/style.css` | Button, timer and notice styles. |
| `setup/lib.sh` | `ask_menu --required`, `print_speech_question`, `sha256_of`, `set_env_line`, `{{SPEECH}}`. |
| `setup/setup.sh` | Ask, validate and record `SPEECH`. |
| `setup/SETUP.md.tmpl` | `- Speech: {{SPEECH}}`. |
| `setup/jawbs-speech.sh` (new) | Download, verify, unpack, switch on or off. |
| `setup/jawbs-local.sh` | Call `jawbs-speech.sh` when `Speech: yes`. |
| Tests | `portal/test/speech-worker.test.js`, `speech.test.js`, `speech-route.test.js`, `dictate.test.js` (new); additions to `preflight.test.js`, `local.test.js`, `setup/test/run-tests.sh`. |
| Docs | `docs/portal.md`, `portal/.env.example`, `CLAUDE.md`. |

---

### Task 1: The worker

**Files:**
- Modify: `portal/package.json`, `portal/package-lock.json`
- Create: `portal/src/speech-worker.js`
- Test: `portal/test/speech-worker.test.js`

**Interfaces:**
- Produces: `node portal/src/speech-worker.js <speechDir>` reads 16 kHz mono 16-bit little-endian PCM on stdin and prints one line `{"text":"..."}` on stdout, exit 0. Any failure: message on stderr, exit 1. `<speechDir>` holds `parakeet/{encoder.int8.onnx,decoder.int8.onnx,joiner.int8.onnx,tokens.txt}` and `silero_vad.onnx`.
- Produces: `packWindows(lengths: number[], max?: number): number[][]`, `pcmToFloat(buffer: Buffer): Float32Array`, `SAMPLE_RATE = 16000`, `WINDOW_SECONDS = 25`.

- [ ] **Step 1: Add the dependency**

```bash
cd ~/j4dev/portal && npm install --save-optional --save-exact sherpa-onnx-node@1.13.8
```

Expected: `package.json` gains

```json
  "optionalDependencies": {
    "sherpa-onnx-node": "1.13.8"
  }
```

and `node -e "require('sherpa-onnx-node'); console.log('ok')"` prints `ok`.

- [ ] **Step 2: Write the failing tests**

Create `portal/test/speech-worker.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packWindows, pcmToFloat, SAMPLE_RATE, WINDOW_SECONDS } from '../src/speech-worker.js';

const MAX = WINDOW_SECONDS * SAMPLE_RATE;
const sec = n => n * SAMPLE_RATE;

test('packWindows fills each window up to the limit and keeps the order', () => {
  assert.deepEqual(packWindows([sec(10), sec(10), sec(10), sec(4)]), [[0, 1], [2, 3]]);
  assert.deepEqual(packWindows([sec(25)]), [[0]]);
  assert.deepEqual(packWindows([sec(20), sec(5), sec(1)]), [[0, 1], [2]]);
});

test('packWindows drops nothing and never goes over the limit', () => {
  const lengths = [3, 19, 7, 12, 20, 1, 1, 18, 6, 9, 14, 2].map(sec);
  const windows = packWindows(lengths);
  assert.deepEqual(windows.flat(), lengths.map((_, i) => i));
  for (const w of windows) {
    assert.ok(w.reduce((n, i) => n + lengths[i], 0) <= MAX, `window ${w} is over the limit`);
  }
});

test('packWindows gives an over-long piece a window of its own', () => {
  assert.deepEqual(packWindows([sec(5), sec(40), sec(5)]), [[0], [1], [2]]);
});

test('packWindows of nothing is nothing', () => {
  assert.deepEqual(packWindows([]), []);
});

test('pcmToFloat reads little-endian 16-bit samples and ignores a stray last byte', () => {
  const buf = Buffer.alloc(7);
  buf.writeInt16LE(0, 0);
  buf.writeInt16LE(16384, 2);
  buf.writeInt16LE(-32768, 4);
  assert.deepEqual(Array.from(pcmToFloat(buf)), [0, 0.5, -1]);
});

// Runs only where the model has been installed (setup/jawbs-speech.sh), so a
// fresh clone and CI skip it. The sample ships inside the model download.
const WORKER = fileURLToPath(new URL('../src/speech-worker.js', import.meta.url));
const dir = fileURLToPath(new URL('../data/speech', import.meta.url));
const wav = join(dir, 'parakeet', 'test_wavs', 'en.wav');

test('the installed model transcribes its own sample', { skip: existsSync(wav) ? false : 'speech model not installed' }, () => {
  // The sample is 24 kHz mono 16-bit with a plain 44-byte header; the worker
  // takes 16 kHz, so resample 3:2 with linear interpolation.
  const src = readFileSync(wav).subarray(44);
  const n = Math.floor((src.length / 2) / 1.5);
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const pos = i * 1.5;
    const a = Math.floor(pos);
    const b = Math.min(a + 1, src.length / 2 - 1);
    const v = src.readInt16LE(a * 2) * (1 - (pos - a)) + src.readInt16LE(b * 2) * (pos - a);
    pcm.writeInt16LE(Math.round(v), i * 2);
  }
  const r = spawnSync(process.execPath, [WORKER, dir], { input: pcm, encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(JSON.parse(r.stdout.trim().split('\n').pop()).text, /what you can do for your country/i);
});

test('the worker exits 1 with a message when the model folder is missing', { skip: existsSync(wav) ? false : 'speech model not installed' }, () => {
  const r = spawnSync(process.execPath, [WORKER, '/nonexistent-speech-dir'], { input: Buffer.alloc(32000), encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 1);
  assert.ok(r.stderr.trim().length > 0);
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `cd ~/j4dev/portal && node --test test/speech-worker.test.js`
Expected: FAIL, `Cannot find module '.../src/speech-worker.js'`.

- [ ] **Step 4: Write the worker**

Create `portal/src/speech-worker.js`:

```js
// Turns one recording into text, then exits. speech.js starts one of these
// per clip: PCM (16 kHz mono, 16-bit little-endian) on stdin, the model folder
// as the one argument, a single JSON line on stdout. A process of its own
// because decoding is a synchronous native call that would freeze the portal
// for as long as it runs, and because exiting hands the memory back.
import { availableParallelism } from 'node:os';
import { join } from 'node:path';

export const SAMPLE_RATE = 16000;
export const WINDOW_SECONDS = 25;
const VAD_WINDOW = 512;

// Groups neighbouring pieces of speech into windows of at most `max` samples,
// returning the piece indexes in each window. Fed one short fragment per pause,
// the model's word errors more than doubled (2.1% to 5.0% in the timing test),
// so pieces are packed together. A piece longer than `max` gets a window of its
// own rather than being cut mid-word.
export function packWindows(lengths, max = WINDOW_SECONDS * SAMPLE_RATE) {
  const windows = [];
  let current = [];
  let total = 0;
  lengths.forEach((length, i) => {
    if (current.length && total + length > max) {
      windows.push(current);
      current = [];
      total = 0;
    }
    current.push(i);
    total += length;
  });
  if (current.length) windows.push(current);
  return windows;
}

export function pcmToFloat(buffer) {
  const out = new Float32Array(buffer.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = buffer.readInt16LE(i * 2) / 32768;
  return out;
}

async function main(dir) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const samples = pcmToFloat(Buffer.concat(chunks));
  // Imported here, not at the top, so the pure helpers above can be tested on
  // a machine where the optional dependency did not install.
  const { default: sherpa } = await import('sherpa-onnx-node');
  const model = join(dir, 'parakeet');
  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(model, 'encoder.int8.onnx'),
        decoder: join(model, 'decoder.int8.onnx'),
        joiner: join(model, 'joiner.int8.onnx'),
      },
      tokens: join(model, 'tokens.txt'),
      modelType: 'nemo_transducer',
      numThreads: Math.min(4, availableParallelism()),
      provider: 'cpu',
      debug: 0,
    },
  });
  const vad = new sherpa.Vad({
    sileroVad: {
      model: join(dir, 'silero_vad.onnx'),
      threshold: 0.5, minSpeechDuration: 0.25, minSilenceDuration: 0.4,
      maxSpeechDuration: 20, windowSize: VAD_WINDOW,
    },
    sampleRate: SAMPLE_RATE, numThreads: 1, debug: false,
  }, 60);
  const pieces = [];
  const drain = () => {
    while (!vad.isEmpty()) {
      pieces.push(Float32Array.from(vad.front().samples));
      vad.pop();
    }
  };
  for (let i = 0; i + VAD_WINDOW <= samples.length; i += VAD_WINDOW) {
    vad.acceptWaveform(samples.subarray(i, i + VAD_WINDOW));
    drain();
  }
  vad.flush();
  drain();
  const parts = [];
  for (const group of packWindows(pieces.map(p => p.length))) {
    const joined = new Float32Array(group.reduce((n, i) => n + pieces[i].length, 0));
    let offset = 0;
    for (const i of group) { joined.set(pieces[i], offset); offset += pieces[i].length; }
    const stream = recognizer.createStream();
    stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: joined });
    recognizer.decode(stream);
    const text = recognizer.getResult(stream).text.trim();
    if (text) parts.push(text);
  }
  process.stdout.write(JSON.stringify({ text: parts.join(' ') }) + '\n');
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv[2]).catch(err => { console.error(err?.stack || String(err)); process.exit(1); });
}
```

This exact code was run on 2026-09-30 against the real model: a browser recording gave the right text, two seconds of silence and empty input both gave `{"text":""}`, and a missing model folder gave exit 1.

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd ~/j4dev/portal && node --test test/speech-worker.test.js`
Expected: 5 pass, 2 skipped (`speech model not installed`). The two skipped tests run for real at the end of Task 5.

- [ ] **Step 6: Run the whole portal suite**

Run: `cd ~/j4dev/portal && npm test 2>&1 | tail -8`
Expected: `fail 0`.

- [ ] **Step 7: Commit**

```bash
cd ~/j4dev && git add portal/package.json portal/package-lock.json portal/src/speech-worker.js portal/test/speech-worker.test.js
git commit -m "Portal: speech worker that turns one recording into text"
```

---

### Task 2: Readiness and the queue

**Files:**
- Create: `portal/src/speech.js`
- Test: `portal/test/speech.test.js`

**Interfaces:**
- Consumes: the worker's command line and output from Task 1.
- Produces:
  - `SPEECH_FILES: string[]` (paths relative to the speech folder)
  - `MAX_AUDIO_BYTES = 20 * 1024 * 1024`
  - `speechReady(cfg: {speech: boolean, speechDir: string}, deps?: {exists, library}): boolean`
  - `createTranscriber({ dir, command?, args?, timeoutMs?, maxWaiting? }): (pcm: Buffer) => Promise<string>`. Rejections carry `err.code`: `'busy'`, `'timeout'` or `'failed'`.

- [ ] **Step 1: Write the failing tests**

Create `portal/test/speech.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { speechReady, createTranscriber, SPEECH_FILES, MAX_AUDIO_BYTES } from '../src/speech.js';

const work = mkdtempSync(join(tmpdir(), 'speech-'));
// A stand-in worker: `node -e <script> <args...>`, so no model is needed.
const stub = (script, extra = {}, ...args) =>
  createTranscriber({ dir: '/unused', command: process.execPath, args: ['-e', script, ...args], ...extra });

const COUNT = `let n = 0; process.stdin.on('data', d => { n += d.length; }).on('end', () => console.log(JSON.stringify({ text: 'bytes ' + n })));`;

test('speechReady needs the switch, the library and every model file', () => {
  const cfg = { speech: true, speechDir: '/m' };
  const yes = () => true;
  assert.equal(speechReady(cfg, { exists: yes, library: yes }), true);
  assert.equal(speechReady({ ...cfg, speech: false }, { exists: yes, library: yes }), false);
  assert.equal(speechReady(cfg, { exists: yes, library: () => false }), false);
  for (const f of SPEECH_FILES) {
    assert.equal(speechReady(cfg, { exists: p => p !== join('/m', f), library: yes }), false, f);
  }
});

test('the body limit holds ten minutes of audio', () => {
  assert.ok(MAX_AUDIO_BYTES >= 600 * 16000 * 2);
});

test('transcribe sends the audio to the worker and returns its text', async () => {
  assert.equal(await stub(COUNT)(Buffer.alloc(64000)), 'bytes 64000');
});

test('an empty text is a valid answer', async () => {
  assert.equal(await stub(`process.stdin.resume().on('end', () => console.log('{"text":""}'));`)(Buffer.alloc(2)), '');
});

test('clips run one at a time, in order', async () => {
  const log = join(work, 'order.log');
  const script = `const fs = require('fs'); const log = process.argv[1];
    process.stdin.resume().on('end', () => { fs.appendFileSync(log, 'start\\n');
      setTimeout(() => { fs.appendFileSync(log, 'end\\n'); console.log('{"text":"x"}'); }, 150); });`;
  const transcribe = stub(script, {}, log);
  await Promise.all([transcribe(Buffer.alloc(2)), transcribe(Buffer.alloc(2)), transcribe(Buffer.alloc(2))]);
  assert.equal(readFileSync(log, 'utf8'), 'start\nend\nstart\nend\nstart\nend\n');
});

test('one runs and three wait; the next is refused as busy', async () => {
  const slow = `process.stdin.resume().on('end', () => setTimeout(() => console.log('{"text":"x"}'), 200));`;
  const transcribe = stub(slow);
  const accepted = [1, 2, 3, 4].map(() => transcribe(Buffer.alloc(2)));
  await assert.rejects(transcribe(Buffer.alloc(2)), err => err.code === 'busy');
  assert.deepEqual(await Promise.all(accepted), ['x', 'x', 'x', 'x']);
  // The queue has drained, so there is room again.
  assert.equal(await transcribe(Buffer.alloc(2)), 'x');
});

test('a worker that hangs is killed and reported as a timeout', async () => {
  const transcribe = stub(`setInterval(() => {}, 1000);`, { timeoutMs: 300 });
  await assert.rejects(transcribe(Buffer.alloc(2)), err => err.code === 'timeout');
});

test('a worker that exits non-zero is reported as failed, with its reason', async () => {
  const transcribe = stub(`console.error('no model here'); process.exit(3);`);
  await assert.rejects(transcribe(Buffer.alloc(2)), err => err.code === 'failed' && /no model here/.test(err.message));
});

test('a worker that dies without reading its input is reported as failed', async () => {
  // 8 MB will not fit in the pipe, so the write hits a dead process (EPIPE).
  const transcribe = stub(`process.exit(1);`);
  await assert.rejects(transcribe(Buffer.alloc(8 * 1024 * 1024)), err => err.code === 'failed');
  // The portal process is still standing and the queue still works.
  assert.equal(await stub(COUNT)(Buffer.alloc(2)), 'bytes 2');
});

test('a worker that prints rubbish is reported as failed', async () => {
  const transcribe = stub(`process.stdin.resume().on('end', () => console.log('not json'));`);
  await assert.rejects(transcribe(Buffer.alloc(2)), err => err.code === 'failed');
});

test('a command that cannot be started is reported as failed', async () => {
  const transcribe = createTranscriber({ dir: '/unused', command: '/nonexistent-binary', args: [] });
  await assert.rejects(transcribe(Buffer.alloc(2)), err => err.code === 'failed');
});

test('a failure does not block the clips behind it', async () => {
  const script = `const bad = process.argv[1] === 'bad';
    process.stdin.resume().on('end', () => { if (bad) process.exit(1); console.log('{"text":"fine"}'); });`;
  await assert.rejects(stub(script, {}, 'bad')(Buffer.alloc(2)), err => err.code === 'failed');
  assert.equal(await stub(script, {}, 'good')(Buffer.alloc(2)), 'fine');
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd ~/j4dev/portal && node --test test/speech.test.js`
Expected: FAIL, `Cannot find module '.../src/speech.js'`.

- [ ] **Step 3: Write the module**

Create `portal/src/speech.js`:

```js
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Speech to text: whether it is available, and the queue that feeds clips to
// the worker. Spec: docs/superpowers/specs/2026-09-30-portal-speech-to-text-design.md

// What setup/jawbs-speech.sh leaves in the speech folder.
export const SPEECH_FILES = [
  'parakeet/encoder.int8.onnx',
  'parakeet/decoder.int8.onnx',
  'parakeet/joiner.int8.onnx',
  'parakeet/tokens.txt',
  'silero_vad.onnx',
];

// Ten minutes of 16 kHz 16-bit mono is 19.2 MB.
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const WORKER = fileURLToPath(new URL('./speech-worker.js', import.meta.url));
const require = createRequire(import.meta.url);

// The library is an optional dependency, so it may not be there. Resolved, not
// loaded: loading it pulls native code into the portal process for nothing.
function libraryInstalled() {
  try {
    require.resolve('sherpa-onnx-node');
    return true;
  } catch {
    return false;
  }
}

export function speechReady(cfg, { exists = existsSync, library = libraryInstalled } = {}) {
  return Boolean(cfg.speech) && library() && SPEECH_FILES.every(f => exists(join(cfg.speechDir, f)));
}

const fail = (code, message) => Object.assign(new Error(message), { code });

function runWorker(command, args, pcm, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let errText = '';
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, fail('timeout', 'the speech worker took too long and was stopped'));
    }, timeoutMs);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { errText = (errText + d).slice(-2000); });
    child.on('error', err => finish(reject, fail('failed', `the speech worker could not start: ${err.message}`)));
    child.on('close', code => {
      if (code !== 0) return finish(reject, fail('failed', `the speech worker exited ${code}: ${errText.trim()}`));
      try {
        // The last line, in case the native library ever prints above it.
        const text = JSON.parse(out.trim().split('\n').pop()).text;
        if (typeof text !== 'string') throw new Error('no text');
        finish(resolve, text);
      } catch {
        finish(reject, fail('failed', 'the speech worker gave no result'));
      }
    });
    // A worker that dies early closes its end of the pipe while we are still
    // writing. Without a listener that EPIPE is an unhandled error event and
    // takes the portal down; the close handler above reports the failure.
    child.stdin.on('error', () => {});
    child.stdin.end(pcm);
  });
}

// Returns transcribe(pcm). One clip runs at a time, because each takes every
// core and about 1 GB; up to maxWaiting wait their turn and the next is
// refused as busy rather than left hanging.
export function createTranscriber({
  dir, command = process.execPath, args = [WORKER, dir], timeoutMs = 5 * 60 * 1000, maxWaiting = 3,
} = {}) {
  let active = false;
  const waiting = [];
  const pump = () => {
    if (active || !waiting.length) return;
    active = true;
    const job = waiting.shift();
    runWorker(command, args, job.pcm, timeoutMs)
      .then(job.resolve, job.reject)
      .finally(() => { active = false; pump(); });
  };
  return function transcribe(pcm) {
    return new Promise((resolve, reject) => {
      if (active && waiting.length >= maxWaiting) {
        return reject(fail('busy', 'too many recordings are waiting'));
      }
      waiting.push({ pcm, resolve, reject });
      pump();
    });
  };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd ~/j4dev/portal && node --test test/speech.test.js`
Expected: 12 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
cd ~/j4dev && git add portal/src/speech.js portal/test/speech.test.js
git commit -m "Portal: speech readiness check and a one-at-a-time transcription queue"
```

---

### Task 3: Config, preflight and the route

**Files:**
- Modify: `portal/src/config.js`, `portal/src/preflight.js`, `portal/src/server.js`
- Test: `portal/test/speech-route.test.js` (new), `portal/test/preflight.test.js`, `portal/test/local.test.js`

**Interfaces:**
- Consumes: `speechReady`, `createTranscriber`, `MAX_AUDIO_BYTES` from Task 2.
- Produces:
  - `config.speech: boolean`, `config.speechDir: string`
  - `createApp({ send, quit, speech?, transcribe? })`: `speech` defaults to `speechReady(config)`; `transcribe` is `(pcm: Buffer) => Promise<string>` for tests.
  - `GET /api/meta` includes `speech: true` when ready, and no `speech` key otherwise.
  - `POST /api/transcribe`: raw PCM in, `{ text }` out. 404 not ready, 400 bad body, 413 too large, 503 busy (`{ error: 'busy' }`), 500 anything else (`{ error: 'transcription failed' }`), 401 signed out.

- [ ] **Step 1: Write the failing route tests**

Create `portal/test/speech-route.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
process.env.PROJECT_DIR = mkdtempSync(join(tmpdir(), 'proj-'));
process.env.DB_PATH = ':memory:';
process.env.PORTAL_USERS_FILE = '/nonexistent-portal-users.json';
process.env.ALLOWED_EMAILS = 'owner@test.com';
process.env.COOKIE_SECRET = 'testsecret';
process.env.PORTAL_TITLE = 'Test Portal';
const { createApp } = await import('../src/server.js');
const { makeCookie } = await import('../src/auth.js');
const { MAX_AUDIO_BYTES } = await import('../src/speech.js');

let calls = [];
let answer = async () => 'hello there';
const on = createApp({ send: async () => {}, speech: true, transcribe: pcm => { calls.push(pcm.length); return answer(pcm); } }).listen(0);
const off = createApp({ send: async () => {}, speech: false }).listen(0);
test.after(() => { on.close(); off.close(); });
const url = (server, path) => `http://localhost:${server.address().port}${path}`;
const cookie = `jskit=${makeCookie('owner@test.com')}`;
const post = (server, body, headers = {}) => fetch(url(server, '/api/transcribe'), {
  method: 'POST', headers: { cookie, 'content-type': 'application/octet-stream', ...headers }, body,
});

test('meta says speech only when it is ready', async () => {
  assert.deepEqual(await (await fetch(url(on, '/api/meta'))).json(), { title: 'Test Portal', speech: true });
  assert.deepEqual(await (await fetch(url(off, '/api/meta'))).json(), { title: 'Test Portal' });
});

test('transcribe returns the text for the audio it was sent', async () => {
  calls = [];
  const r = await post(on, Buffer.alloc(64000));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { text: 'hello there' });
  assert.deepEqual(calls, [64000]);
});

test('silence is a 200 with empty text', async () => {
  answer = async () => '';
  const r = await post(on, Buffer.alloc(32000));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { text: '' });
  answer = async () => 'hello there';
});

test('transcribe needs a sign-in', async () => {
  const r = await fetch(url(on, '/api/transcribe'), { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.alloc(4) });
  assert.equal(r.status, 401);
});

test('transcribe is a 404 when speech is not ready, without reading the audio', async () => {
  assert.equal((await post(off, Buffer.alloc(64000))).status, 404);
});

test('a body that is not PCM is refused and never reaches the transcriber', async () => {
  calls = [];
  assert.equal((await post(on, Buffer.alloc(0))).status, 400, 'empty');
  assert.equal((await post(on, Buffer.alloc(3))).status, 400, 'odd length');
  assert.equal((await post(on, JSON.stringify({ audio: 'x' }), { 'content-type': 'application/json' })).status, 400, 'json');
  assert.deepEqual(calls, []);
});

test('a body over the limit is a 413', async () => {
  calls = [];
  assert.equal((await post(on, Buffer.alloc(MAX_AUDIO_BYTES + 2))).status, 413);
  assert.deepEqual(calls, []);
});

test('a full queue is a 503 the page can recognise', async () => {
  answer = async () => { throw Object.assign(new Error('too many'), { code: 'busy' }); };
  const r = await post(on, Buffer.alloc(4));
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: 'busy' });
  answer = async () => 'hello there';
});

test('a failed transcription is a 500 that does not leak the reason', async () => {
  answer = async () => { throw Object.assign(new Error('the speech worker exited 1: /home/someone/secret/path'), { code: 'failed' }); };
  const r = await post(on, Buffer.alloc(4));
  assert.equal(r.status, 500);
  assert.deepEqual(await r.json(), { error: 'transcription failed' });
  answer = async () => 'hello there';
});
```

- [ ] **Step 2: Add the failing preflight tests**

Append to `portal/test/preflight.test.js`:

```js
test('speech on but not installed warns and does not stop the portal', () => {
  const issues = checkConfig(
    valid({ speech: true, speechDir: '/portal/data/speech' }), { ...ok, speechIsReady: () => false });
  assert.deepEqual(errors(issues), []);
  assert.equal(warns(issues).length, 1);
  assert.match(warns(issues)[0].message, /SPEECH_TO_TEXT/);
  assert.match(warns(issues)[0].message, /\/portal\/data\/speech/);
  assert.match(warns(issues)[0].message, /jawbs-speech\.sh/);
});

test('speech that is ready, or off, says nothing', () => {
  assert.deepEqual(checkConfig(valid({ speech: true, speechDir: '/m' }), { ...ok, speechIsReady: () => true }), []);
  assert.deepEqual(checkConfig(valid({ speech: false, speechDir: '/m' }), { ...ok, speechIsReady: () => false }), []);
});
```

- [ ] **Step 3: Add the failing local-mode test**

In `portal/test/local.test.js`, the `call` helper sends JSON. Add this test after `'a POST from a foreign Origin is refused; no Origin or our own is fine'`:

```js
test('transcribe is covered by the same Host and Origin guard', async () => {
  // Refused by the guard before the route is reached, so speech being off in
  // this test app does not matter: a 404 here would mean the guard was skipped.
  assert.equal((await call('/api/transcribe', { method: 'POST', origin: 'https://evil.example', body: { a: 1 } })).status, 403);
  assert.equal((await call('/api/transcribe', { method: 'POST', host: 'evil.example:' + port, body: { a: 1 } })).status, 403);
  assert.equal((await call('/api/transcribe', { method: 'POST', body: { a: 1 } })).status, 404);
});
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `cd ~/j4dev/portal && node --test test/speech-route.test.js test/preflight.test.js test/local.test.js 2>&1 | tail -30`
Expected: the new tests FAIL (404 for every `/api/transcribe` call where 200, 400, 401, 413, 503 or 500 is expected; `meta` has no `speech`; the preflight warning is missing). The local-mode test's first two assertions already pass and its third passes too: that is fine, it pins behaviour that must not change.

- [ ] **Step 5: Add the config**

In `portal/src/config.js`, after the `subscriptions` line add:

```js
  // Speech to text: a mic on the text boxes, transcribed here by an open model.
  // Off unless setup/jawbs-speech.sh has downloaded the model and said so.
  speech: (process.env.SPEECH_TO_TEXT || '').trim().toLowerCase() === 'on',
  speechDir: process.env.SPEECH_MODEL_DIR || new URL('../data/speech', import.meta.url).pathname,
```

- [ ] **Step 6: Add the preflight warning**

In `portal/src/preflight.js`:

Add to the imports:

```js
import { speechReady } from './speech.js';
```

Change the `checkConfig` signature to:

```js
export function checkConfig(cfg, {
  exists = existsSync, lookupBin = onPath, codexBin = CODEX_BIN, codexSignedIn = codexLoggedIn,
  countUsers = countRegisteredUsers, speechIsReady = speechReady,
} = {}) {
```

Add this section immediately before `// --- Bind ---`:

```js
  // --- Speech ---------------------------------------------------------------
  // A warning, not an error: a missing model file hides the mic and nothing
  // else, and refusing to start would turn that into an outage.
  if (cfg.speech && !speechIsReady(cfg)) {
    warn(`SPEECH_TO_TEXT is on but the speech model is not installed in ${cfg.speechDir}, so the microphone button is hidden. Run setup/jawbs-speech.sh to install it, or set SPEECH_TO_TEXT=off.`);
  }
```

- [ ] **Step 7: Add the route**

In `portal/src/server.js`:

Add to the imports:

```js
import { speechReady, createTranscriber, MAX_AUDIO_BYTES } from './speech.js';
```

Replace the `createApp` opening and the `/api/meta` line:

```js
export function createApp({ send = sendEmail, quit = null, speech = speechReady(config), transcribe = null } = {}) {
  const app = express();
  const local = isLocal();
  // Made once per app so every request shares the one queue.
  const runTranscribe = speech ? (transcribe || createTranscriber({ dir: config.speechDir })) : null;
  // Before static files: a rebinding attack's first request is for index.html.
  if (local) app.use(localHostGuard);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(new URL('../public', import.meta.url).pathname));

  app.get('/api/meta', (req, res) => res.json({
    title: config.portalTitle,
    ...(local ? { local: true, kit: KIT_DIR } : {}),
    ...(speech ? { speech: true } : {}),
  }));
```

Add this route immediately before the `// Local only: the page's Quit Jawbs link.` comment:

```js
  // A recording from the mic button: raw 16 kHz mono 16-bit PCM in, text out.
  // The audio lives in memory for the length of the request and is never
  // written to disk or logged. Readiness is checked before the body parser so
  // a portal without speech does not read 20 MB to say no.
  app.post('/api/transcribe', requireAuth,
    (req, res, next) => (runTranscribe ? next() : res.status(404).json({ error: 'not found' })),
    express.raw({ type: () => true, limit: MAX_AUDIO_BYTES }),
    async (req, res) => {
      // express.json has already parsed a JSON body into an object, so
      // anything that is not a Buffer here was not sent as audio.
      if (!Buffer.isBuffer(req.body) || !req.body.length || req.body.length % 2) {
        return res.status(400).json({ error: 'expected 16-bit PCM audio' });
      }
      const started = Date.now();
      try {
        const text = await runTranscribe(req.body);
        console.log(`speech: ${Math.round(req.body.length / 32000)}s of audio transcribed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
        res.json({ text });
      } catch (err) {
        if (err.code === 'busy') return res.status(503).json({ error: 'busy' });
        console.error('transcription failed:', err.message);
        res.status(500).json({ error: 'transcription failed' });
      }
    });
```

- [ ] **Step 8: Run the tests to see them pass**

Run: `cd ~/j4dev/portal && npm test 2>&1 | tail -8`
Expected: `fail 0`. In particular `test/server.test.js` still passes its `meta endpoint returns the configured title` test unchanged, and `test/local.test.js` still passes `meta says local`.

- [ ] **Step 9: Commit**

```bash
cd ~/j4dev && git add portal/src/config.js portal/src/preflight.js portal/src/server.js portal/test/speech-route.test.js portal/test/preflight.test.js portal/test/local.test.js
git commit -m "Portal: /api/transcribe, speech in /api/meta, and a preflight warning"
```

---

### Task 4: The setup question

**Files:**
- Modify: `setup/lib.sh`, `setup/setup.sh`, `setup/SETUP.md.tmpl`
- Test: `setup/test/run-tests.sh`

**Interfaces:**
- Produces: `ask_menu --required` (asks again on a bare Return; returns 1 if input ends), `print_speech_question` (prints the wording), the wizard variable `SPEECH` (`yes`, `no`, or `not asked` after normalising), and the line `- Speech: <value>` in each project's `SETUP.md`.

- [ ] **Step 1: Write the failing tests**

In `setup/test/run-tests.sh`, immediately before the line `rm -rf "$MWORK"` (the end of the `# --- JAWBS_MODE ---` section), add:

```bash
# Speech to text is asked only for Jawbs on this computer, and is off unless chosen.
check "local with no speech answer stays off" grep -qx -- "- Speech: no" "$MWORK/l/SETUP.md"
check "terminal mode is not asked about speech" grep -qx -- "- Speech: not asked" "$MWORK/t/SETUP.md"
check "shared mode is not asked about speech" grep -qx -- "- Speech: not asked" "$MWORK/s/SETUP.md"
printf 'SPEECH="yes"\n' | cat "$TEST_DIR/answers-local.env" - > "$MWORK/sp.env"
run_mode "$MWORK/sp.env" "$MWORK/sp" || fail "a speech choice exited non-zero"
check "SETUP.md records the speech choice" grep -qx -- "- Speech: yes" "$MWORK/sp/SETUP.md"
printf 'SPEECH="yes"\n' | cat "$TEST_DIR/answers-terminal.env" - > "$MWORK/spt.env"
run_mode "$MWORK/spt.env" "$MWORK/spt" || fail "a speech answer in terminal mode exited non-zero"
check "a speech answer outside local mode is not acted on" grep -qx -- "- Speech: not asked" "$MWORK/spt/SETUP.md"
printf 'SPEECH="maybe"\n' | cat "$TEST_DIR/answers-local.env" - > "$MWORK/spbad.env"
if run_mode "$MWORK/spbad.env" "$MWORK/spb"; then fail "an unknown SPEECH should stop setup"; else pass; fi
check "no placeholder is left in SETUP.md" sh -c "! grep -q '{{SPEECH}}' '$MWORK/l/SETUP.md'"

# The question has no default: a bare Return or a wrong number asks again.
PICK="$(printf '\n7\n2\n' | { ask_menu --quiet --required PICKED "" yes no >/dev/null; echo "$PICKED"; })"
check "a required menu waits for a real choice" test "$PICK" = "no"
ASKED="$(printf '\n7\n1\n' | { ask_menu --quiet --required PICKED "" yes no; } | grep -c "Please enter a number")"
check "a required menu says so each time it asks again" test "$ASKED" = "2"
if ask_menu --quiet --required PICKED "" yes no </dev/null >/dev/null 2>&1; then
  fail "a required menu with no input should fail rather than loop or pick"
else
  pass
fi
PICK="$(printf '\n' | { ask_menu --quiet PICKED "" yes no >/dev/null; echo "$PICKED"; })"
check "an ordinary menu still takes option 1 on Return" test "$PICK" = "yes"

# The wording says why it helps, that it is free, and what it costs.
SQ="$(print_speech_question)"
for phrase in "talk to Jawbs as well as type" "far easier to say out loud than to type" \
    "free of charge" "nothing to pay" "never leaves it" "about 490 MB" "640 MB of disk space" \
    "about 1 GB of memory" "you can switch it on later"; do
  if printf '%s\n' "$SQ" | grep -q "$phrase"; then pass; else fail "speech question should say: $phrase"; fi
done
```

`ask_menu` and `print_speech_question` are available here because the test file sources `lib.sh` near its top.

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd ~/j4dev && bash setup/test/run-tests.sh 2>&1 | tail -25`
Expected: FAIL lines for each new check (`print_speech_question: command not found` among them) and a non-zero `Failed:` count.

- [ ] **Step 3: Give `ask_menu` a required mode**

In `setup/lib.sh`, replace the opening of `ask_menu` down to and including its `while` loop:

```bash
ask_menu() {
  quiet=no
  required=no
  while :; do
    case "${1:-}" in
      --quiet) quiet=yes; shift ;;
      --required) required=yes; shift ;;
      *) break ;;
    esac
  done
  var="$1"
  prompt="$2"
  shift 2
  if [ "$quiet" = "no" ]; then
    echo "$prompt"
    i=1
    for opt in "$@"; do
      echo "  $i) $opt"
      i=$((i + 1))
    done
  fi
  choice=""
  while :; do
    if [ "$required" = "yes" ]; then
      # No default: a bare Return asks again. If the input has run out there is
      # nobody to ask, so fail rather than spin; the caller picks what that means.
      read -r -p "Choose a number: " choice || return 1
    else
      read -r -p "Choose a number [1]: " choice
      [ -z "$choice" ] && choice=1
    fi
    case "$choice" in
      ''|*[!0-9]*) ;;
      *) [ "$choice" -ge 1 ] && [ "$choice" -le $# ] && break ;;
    esac
    echo "Please enter a number between 1 and $#."
  done
```

Leave the rest of the function (the loop that assigns the chosen option) as it is. Update the comment above the function, if it lists the flags, to mention `--required`.

- [ ] **Step 4: Add the question's wording**

In `setup/lib.sh`, add after `ask_menu`:

```bash
# print_speech_question
# The "talk to Jawbs" question, asked only for Jawbs on this computer. Kept
# here as one function so the tests can read the wording.
print_speech_question() {
  echo "Would you like to talk to Jawbs as well as type?"
  echo
  echo "  Jawbs does its best work when you give it long answers with plenty of"
  echo "  detail, and those are far easier to say out loud than to type. With this"
  echo "  on, each text box gets a microphone button. You talk, and your words"
  echo "  appear in the box for you to check before sending."
  echo
  echo "  It is free of charge. There is no subscription and nothing to pay. Your"
  echo "  voice is turned into text on this computer and never leaves it."
  echo
  echo "  What it costs: a one-off download of about 490 MB, which takes about"
  echo "  640 MB of disk space. While it turns your speech into text, usually under"
  echo "  a minute, your computer works hard and uses about 1 GB of memory. The"
  echo "  rest of the time it uses nothing."
  echo
  echo "  1) Yes, set it up"
  echo "  2) No thanks (you can switch it on later)"
  echo
}
```

- [ ] **Step 5: Substitute `{{SPEECH}}`**

In `setup/lib.sh`, in `substitute_all`:

- In the comment's token list, change `WRITER, KIT_DIR.` to `WRITER, SPEECH, KIT_DIR.`
- After the `writer_esc=` line add:

```bash
  speech_esc="$(sed_escape "${SPEECH:-not asked}")"
```

- After the `-e "s/{{WRITER}}/$writer_esc/g" \` line add:

```bash
        -e "s/{{SPEECH}}/$speech_esc/g" \
```

In `setup/SETUP.md.tmpl`, after the line `- Writer: {{WRITER}}` add:

```
- Speech: {{SPEECH}}
```

- [ ] **Step 6: Ask and validate in the wizard**

In `setup/setup.sh`, in the `browser)` branch, replace

```bash
      ask_menu --quiet WRITER "" both claude-only chatgpt-only ;;
```

with

```bash
      ask_menu --quiet WRITER "" both claude-only chatgpt-only
      echo
      print_speech_question
      ask_menu --quiet --required SPEECH "" yes no || SPEECH="no" ;;
```

Then, immediately after the block that normalises `WRITER` (it ends with `WRITER="detect"` and `fi`), add:

```bash
# Talking to Jawbs: asked only for Jawbs on this computer, and off unless the
# person said yes. jawbs-local.sh acts on the answer recorded in SETUP.md.
SPEECH="${SPEECH:-}"
case "$SPEECH" in
  yes|no|'') ;;
  *) echo "Unknown SPEECH: $SPEECH (expected yes or no)" >&2; exit 1 ;;
esac
if [ "$JAWBS_MODE" != "local" ]; then
  SPEECH="not asked"
elif [ -z "$SPEECH" ]; then
  SPEECH="no"
fi
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `cd ~/j4dev && bash setup/test/run-tests.sh 2>&1 | tail -5`
Expected: `Passed: N  Failed: 0`, with N 20 higher than before this task.

- [ ] **Step 8: Check bash 3.2 compatibility by reading**

Read the lines added to `setup/lib.sh` and `setup/setup.sh` and confirm: no `[[ ]]` pattern features beyond what the file already uses, no arrays, no `${var,,}`, no `read -a`, no `local -n`. `case "${1:-}"`, `read -r -p`, `$((i + 1))` and `printf` are all fine in 3.2.

- [ ] **Step 9: Commit**

```bash
cd ~/j4dev && git add setup/lib.sh setup/setup.sh setup/SETUP.md.tmpl setup/test/run-tests.sh
git commit -m "Setup: ask whether to talk to Jawbs, with the benefit and the costs"
```

---

### Task 5: The install script

**Files:**
- Create: `setup/jawbs-speech.sh`
- Modify: `setup/lib.sh`, `setup/jawbs-local.sh`
- Test: `setup/test/run-tests.sh`

**Interfaces:**
- Consumes: `- Speech: yes` in `SETUP.md` from Task 4; the folder layout `SPEECH_FILES` from Task 2.
- Produces:
  - `setup/jawbs-speech.sh [on|off]`: exit 0 when speech is switched as asked, non-zero otherwise.
  - `sha256_of <file>` and `set_env_line <file> <key> <value>` in `setup/lib.sh`.
  - Hooks: `JAWBS_ENV_FILE`, `JAWBS_SPEECH_DIR`, `JAWBS_SPEECH_URL_BASE`, `JAWBS_SPEECH_SHA_MODEL`, `JAWBS_SPEECH_SHA_VAD`, `JAWBS_SPEECH_LIB_OK` (`yes` or `no`).

- [ ] **Step 1: Write the failing tests**

In `setup/test/run-tests.sh`, immediately before the line `# --- Summary ---...`, add:

```bash
# --- jawbs-speech.sh ----------------------------------------------------------
SWORK="$(mktemp -d)"
SP_NAME="sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8"
mkdir -p "$SWORK/dl" "$SWORK/src/$SP_NAME"
for f in encoder.int8.onnx decoder.int8.onnx joiner.int8.onnx tokens.txt; do
  echo "fixture $f" > "$SWORK/src/$SP_NAME/$f"
done
(cd "$SWORK/src" && tar -cjf "$SWORK/dl/$SP_NAME.tar.bz2" "$SP_NAME")
echo "fixture vad" > "$SWORK/dl/silero_vad.onnx"
SP_SHA_MODEL="$(sha256_of "$SWORK/dl/$SP_NAME.tar.bz2")"
SP_SHA_VAD="$(sha256_of "$SWORK/dl/silero_vad.onnx")"
check "sha256_of gives a 64-character digest" test "${#SP_SHA_MODEL}" = "64"
# run_speech <env-file> <speech-dir> [on|off]; output lands in <env-file>.out.
# RS_SHA_MODEL and RS_LIB override the checksum and the library check.
run_speech() {
  rs_env="$1"; rs_dir="$2"; shift 2
  JAWBS_ENV_FILE="$rs_env" JAWBS_SPEECH_DIR="$rs_dir" JAWBS_SPEECH_URL_BASE="file://$SWORK/dl" \
  JAWBS_SPEECH_SHA_MODEL="${RS_SHA_MODEL:-$SP_SHA_MODEL}" JAWBS_SPEECH_SHA_VAD="$SP_SHA_VAD" \
  JAWBS_SPEECH_LIB_OK="${RS_LIB:-yes}" \
    bash "$SETUP_DIR/jawbs-speech.sh" "$@" >"$rs_env.out" 2>&1
}
speech_installed() { # speech_installed <speech-dir>
  test -f "$1/silero_vad.onnx" && test -f "$1/parakeet/encoder.int8.onnx" \
    && test -f "$1/parakeet/decoder.int8.onnx" && test -f "$1/parakeet/joiner.int8.onnx" \
    && test -f "$1/parakeet/tokens.txt"
}

# set_env_line: replace, append, leave comments alone, cope with no final newline.
printf 'PORT=1\nSPEECH_TO_TEXT=off\nNAME=x\n' > "$SWORK/e1"
set_env_line "$SWORK/e1" SPEECH_TO_TEXT on
check "set_env_line replaces the line in place" test "$(cat "$SWORK/e1")" = "$(printf 'PORT=1\nSPEECH_TO_TEXT=on\nNAME=x')"
printf 'PORT=1' > "$SWORK/e2"
set_env_line "$SWORK/e2" SPEECH_TO_TEXT on
check "set_env_line appends after a file with no final newline" test "$(cat "$SWORK/e2")" = "$(printf 'PORT=1\nSPEECH_TO_TEXT=on')"
printf '#SPEECH_TO_TEXT=on\nPORT=1\n' > "$SWORK/e3"
set_env_line "$SWORK/e3" SPEECH_TO_TEXT on
check "set_env_line leaves a commented line alone" test "$(cat "$SWORK/e3")" = "$(printf '#SPEECH_TO_TEXT=on\nPORT=1\nSPEECH_TO_TEXT=on')"
printf 'SPEECH_TO_TEXT=off\nSPEECH_TO_TEXT=off\n' > "$SWORK/e4"
set_env_line "$SWORK/e4" SPEECH_TO_TEXT on
check "set_env_line leaves one line where there were two" test "$(cat "$SWORK/e4")" = "SPEECH_TO_TEXT=on"
printf 'SECRET=s\n' > "$SWORK/e5"; chmod 600 "$SWORK/e5"
set_env_line "$SWORK/e5" SPEECH_TO_TEXT on
check "set_env_line keeps the file's permissions" test "$(ls -l "$SWORK/e5" | cut -c1-10)" = "-rw-------"
check "set_env_line leaves no temporary file" test "$(ls "$SWORK" | grep -c '^e5\.')" = "0"

# Switching on: downloads, checks, unpacks, and sets the one line.
printf 'PORT=1\n' > "$SWORK/env1"
run_speech "$SWORK/env1" "$SWORK/sp1" || fail "jawbs-speech.sh exited non-zero on a good install"
check "the model is installed" speech_installed "$SWORK/sp1"
check "speech is switched on" grep -qx 'SPEECH_TO_TEXT=on' "$SWORK/env1"
check "other settings are kept" grep -qx 'PORT=1' "$SWORK/env1"
check "no download leftovers remain" test "$(ls "$SWORK/sp1" | grep -c incoming)" = "0"
check "the person is told it is on" grep -q "switched on" "$SWORK/env1.out"

# A second run finds the install and does not download again.
mv "$SWORK/dl" "$SWORK/dl-away"
run_speech "$SWORK/env1" "$SWORK/sp1" || fail "a rerun with the model in place exited non-zero"
check "a rerun says the download is already here" grep -q "already here" "$SWORK/env1.out"
mv "$SWORK/dl-away" "$SWORK/dl"

# Off keeps the download.
run_speech "$SWORK/env1" "$SWORK/sp1" off || fail "switching off exited non-zero"
check "speech is switched off" grep -qx 'SPEECH_TO_TEXT=off' "$SWORK/env1"
check "switching off keeps the model" speech_installed "$SWORK/sp1"

# A download that is not the file expected is thrown away and speech stays off.
printf 'PORT=1\n' > "$SWORK/env2"
if RS_SHA_MODEL="0000000000000000000000000000000000000000000000000000000000000000" run_speech "$SWORK/env2" "$SWORK/sp2"; then
  fail "a wrong checksum should exit non-zero"
else
  pass
fi
check "a wrong checksum installs nothing" test ! -e "$SWORK/sp2/parakeet"
check "a wrong checksum leaves speech off" sh -c "! grep -q 'SPEECH_TO_TEXT=on' '$SWORK/env2'"
check "a wrong checksum leaves no leftovers" test "$(ls "$SWORK/sp2" 2>/dev/null | grep -c incoming)" = "0"
check "a wrong checksum says how to try again" grep -q "To try again" "$SWORK/env2.out"

# A half-finished install (an interrupted earlier run) is completed, not trusted.
mkdir -p "$SWORK/sp3/parakeet" "$SWORK/sp3/incoming.999"
echo "partial" > "$SWORK/sp3/parakeet/tokens.txt"
echo "partial" > "$SWORK/sp3/incoming.999/$SP_NAME.tar.bz2"
printf 'PORT=1\n' > "$SWORK/env3"
run_speech "$SWORK/env3" "$SWORK/sp3" || fail "completing a half-finished install exited non-zero"
check "a half-finished install is completed" speech_installed "$SWORK/sp3"
check "the old partial file is replaced" grep -q "fixture tokens.txt" "$SWORK/sp3/parakeet/tokens.txt"
check "the interrupted download is cleared away" test ! -e "$SWORK/sp3/incoming.999"

# No speech program on this computer: nothing is downloaded.
printf 'PORT=1\n' > "$SWORK/env4"
if RS_LIB=no run_speech "$SWORK/env4" "$SWORK/sp4"; then fail "a missing speech program should exit non-zero"; else pass; fi
check "a missing speech program downloads nothing" test ! -e "$SWORK/sp4"
check "a missing speech program is explained" grep -q "not available on this computer" "$SWORK/env4.out"

# No settings file: Jawbs is not set up yet.
if run_speech "$SWORK/no-such-env" "$SWORK/sp5"; then fail "a missing settings file should exit non-zero"; else pass; fi
check "a missing settings file downloads nothing" test ! -e "$SWORK/sp5"

# jawbs-local.sh switches speech on when the wizard's answer was yes, and a
# failure there never stops the rest of setup.
printf 'SPEECH="yes"\n' | cat "$TEST_DIR/answers-local.env" - > "$SWORK/yes.env"
PORTAL_REGISTRY="$SWORK/users.json" JAWBS_SKIP_LOCAL=yes \
  bash "$SETUP_DIR/setup.sh" --answers "$SWORK/yes.env" --target "$SWORK/proj" --skip-deps >/dev/null 2>&1
mkdir -p "$SWORK/fakebin" "$SWORK/home"
printf '#!/bin/sh\n[ "$1 $2" = "login status" ] && exit 0\nexit 1\n' > "$SWORK/fakebin/codex"
printf '#!/bin/sh\nexit 0\n' > "$SWORK/fakebin/claude"
chmod +x "$SWORK/fakebin/codex" "$SWORK/fakebin/claude"
run_local_speech() { # run_local_speech <env-file> <lib yes|no>
  JAWBS_STATUS_FILE="$1.status" HOME="$SWORK/home" PORTAL_REGISTRY="$SWORK/users.json" JAWBS_ENV_FILE="$1" \
  JAWBS_SKIP_NPM=yes JAWBS_SKIP_LAUNCH=yes JAWBS_PORT_BASE=59700 PATH="$SWORK/fakebin:$PATH" \
  JAWBS_SPEECH_DIR="$1.speech" JAWBS_SPEECH_URL_BASE="file://$SWORK/dl" \
  JAWBS_SPEECH_SHA_MODEL="$SP_SHA_MODEL" JAWBS_SPEECH_SHA_VAD="$SP_SHA_VAD" JAWBS_SPEECH_LIB_OK="$2" \
    bash "$SETUP_DIR/jawbs-local.sh" "$SWORK/proj" >"$1.out" 2>&1
}
run_local_speech "$SWORK/lenv1" yes || fail "jawbs-local.sh with speech exited non-zero"
check "setup with speech chosen switches it on" grep -qx 'SPEECH_TO_TEXT=on' "$SWORK/lenv1"
check "setup with speech chosen installs the model" speech_installed "$SWORK/lenv1.speech"
check "setup with speech chosen still finishes" grep -qx skipped "$SWORK/lenv1.status"
run_local_speech "$SWORK/lenv2" no || fail "jawbs-local.sh exited non-zero when speech could not be set up"
check "a speech failure leaves it off" sh -c "! grep -q 'SPEECH_TO_TEXT=on' '$SWORK/lenv2'"
check "a speech failure does not stop setup" grep -qx skipped "$SWORK/lenv2.status"
check "a speech failure is explained" grep -q "was not switched on" "$SWORK/lenv2.out"
check "a speech failure says how to try again" grep -q "jawbs-speech.sh" "$SWORK/lenv2.out"
# A project that said no is left alone.
awk '/^- Speech: / { print "- Speech: no"; next } { print }' "$SWORK/proj/SETUP.md" > "$SWORK/SETUP.tmp" \
  && mv "$SWORK/SETUP.tmp" "$SWORK/proj/SETUP.md"
run_local_speech "$SWORK/lenv3" yes || fail "jawbs-local.sh without speech exited non-zero"
check "setup with speech declined downloads nothing" test ! -e "$SWORK/lenv3.speech"
check "setup with speech declined leaves the setting out" sh -c "! grep -q 'SPEECH_TO_TEXT' '$SWORK/lenv3'"
rm -rf "$SWORK"
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd ~/j4dev && bash setup/test/run-tests.sh 2>&1 | tail -30`
Expected: FAIL lines from `sha256_of: command not found` onwards and a non-zero `Failed:` count.

- [ ] **Step 3: Add the two helpers**

In `setup/lib.sh`, add after `print_speech_question`:

```bash
# sha256_of <file>
# Prints the file's SHA-256. Linux has sha256sum, macOS has shasum. Returns 1
# when neither exists.
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{ print $1 }'
  else
    return 1
  fi
}

# set_env_line <file> <key> <value>
# Sets KEY=value in a .env file: replaces the KEY= line, or adds one at the
# end. Commented lines are left alone, and a key set twice ends up set once.
# The result is written back over the file with cat rather than mv, so the
# file keeps its permissions (the shared portal's .env holds secrets and is
# often 600), and the temporary copy is made under umask 077 for the same
# reason.
set_env_line() {
  sel_tmp="$1.set.$$"
  (
    umask 077
    awk -v k="$2" -v v="$3" '
      index($0, k "=") == 1 { if (!done) print k "=" v; done = 1; next }
      { print }
      END { if (!done) print k "=" v }
    ' "$1" > "$sel_tmp"
  ) || { rm -f "$sel_tmp"; return 1; }
  cat "$sel_tmp" > "$1" || { rm -f "$sel_tmp"; return 1; }
  rm -f "$sel_tmp"
}
```

- [ ] **Step 4: Write the script**

Create `setup/jawbs-speech.sh` and make it executable (`chmod +x setup/jawbs-speech.sh`):

```bash
#!/usr/bin/env bash
# Switch "talk to Jawbs" on or off for the Jawbs that runs from this copy of
# the kit:
#   setup/jawbs-speech.sh        download the speech model (once) and switch on
#   setup/jawbs-speech.sh off    switch off; the download is kept
# Called by jawbs-local.sh when the wizard's answer was yes, and safe to run by
# hand at any time, on the shared Jawbs too. Exits non-zero when speech could
# not be switched as asked; the caller decides whether that matters.
# Bash 3.2 compatible.
set -u

SETUP_DIR="$(cd "$(dirname "$0")" && pwd)"
KIT_DIR="$(dirname "$SETUP_DIR")"
. "$SETUP_DIR/lib.sh"

ENV_FILE="${JAWBS_ENV_FILE:-$KIT_DIR/portal/.env}"
SPEECH_DIR="${JAWBS_SPEECH_DIR:-$KIT_DIR/portal/data/speech}"
URL_BASE="${JAWBS_SPEECH_URL_BASE:-https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models}"
MODEL_NAME="sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8"
# Pinned so a changed or tampered download is refused rather than run.
SHA_MODEL="${JAWBS_SPEECH_SHA_MODEL:-5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf}"
SHA_VAD="${JAWBS_SPEECH_SHA_VAD:-9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6}"
NODE_BIN="${JAWBS_NODE:-node}"
MODEL_FILES="encoder.int8.onnx decoder.int8.onnx joiner.int8.onnx tokens.txt"
AGAIN="To try again: $SETUP_DIR/jawbs-speech.sh"
RESTART="If Jawbs is open, quit it and open it again for this to take effect."

if [ ! -f "$ENV_FILE" ]; then
  echo "Jawbs has no settings yet ($ENV_FILE), so set Jawbs up first."
  exit 1
fi

if [ "${1:-on}" = "off" ]; then
  if ! set_env_line "$ENV_FILE" SPEECH_TO_TEXT off; then
    echo "Could not change $ENV_FILE."
    exit 1
  fi
  echo "Talking to Jawbs is switched off. The download was kept, so switching it"
  echo "back on is quick: $SETUP_DIR/jawbs-speech.sh"
  echo "$RESTART"
  exit 0
fi

# The speech program is an optional part of the install, so it can be absent.
# JAWBS_SPEECH_LIB_OK lets the tests answer this without it.
lib_ok() {
  case "${JAWBS_SPEECH_LIB_OK:-}" in
    yes) return 0 ;;
    no) return 1 ;;
  esac
  (cd "$KIT_DIR/portal" && "$NODE_BIN" -e "require('sherpa-onnx-node')") >/dev/null 2>&1
}
if ! lib_ok; then
  echo "Talking to Jawbs is not available on this computer: the speech program"
  echo "did not install. Everything else in Jawbs works as normal."
  exit 1
fi

installed() {
  [ -f "$SPEECH_DIR/silero_vad.onnx" ] || return 1
  for mf in $MODEL_FILES; do
    [ -f "$SPEECH_DIR/parakeet/$mf" ] || return 1
  done
  return 0
}

# fetch <name> <sha256>: download into $WORK and check it is the file expected.
fetch() {
  if ! curl -fL --retry 2 --progress-bar -o "$WORK/$1" "$URL_BASE/$1"; then
    echo "The download did not finish. Check the internet connection."
    return 1
  fi
  if [ "$(sha256_of "$WORK/$1")" != "$2" ]; then
    echo "The download of $1 was not the file expected, so it was thrown away."
    return 1
  fi
  return 0
}

if installed; then
  echo "The speech download is already here."
else
  if ! command -v curl >/dev/null 2>&1; then
    echo "The download needs curl, which is not installed."
    echo "$AGAIN"
    exit 1
  fi
  if ! sha256_of "$ENV_FILE" >/dev/null 2>&1; then
    echo "This computer has neither sha256sum nor shasum, so the download could"
    echo "not be checked and was not started."
    exit 1
  fi
  if ! mkdir -p "$SPEECH_DIR"; then
    echo "Could not create $SPEECH_DIR."
    exit 1
  fi
  # Anything an interrupted earlier run left behind.
  rm -rf "$SPEECH_DIR"/incoming.*
  WORK="$SPEECH_DIR/incoming.$$"
  mkdir -p "$WORK"
  trap 'rm -rf "$WORK"' EXIT
  echo "Downloading the speech model (about 490 MB). This can take a few minutes..."
  if ! fetch "$MODEL_NAME.tar.bz2" "$SHA_MODEL" || ! fetch silero_vad.onnx "$SHA_VAD"; then
    echo "$AGAIN"
    exit 1
  fi
  if ! tar -xjf "$WORK/$MODEL_NAME.tar.bz2" -C "$WORK"; then
    echo "The download could not be unpacked. On Linux this needs bzip2:"
    echo "  sudo apt install -y bzip2"
    echo "$AGAIN"
    exit 1
  fi
  # A folder with files missing is a half-finished install: replace it whole.
  rm -rf "$SPEECH_DIR/parakeet"
  if ! mv "$WORK/$MODEL_NAME" "$SPEECH_DIR/parakeet" || ! mv "$WORK/silero_vad.onnx" "$SPEECH_DIR/silero_vad.onnx" || ! installed; then
    echo "The speech model could not be put in place in $SPEECH_DIR."
    echo "$AGAIN"
    exit 1
  fi
fi

if ! set_env_line "$ENV_FILE" SPEECH_TO_TEXT on; then
  echo "The speech model is in place, but $ENV_FILE could not be changed."
  echo "$AGAIN"
  exit 1
fi
echo "Talking to Jawbs is switched on: each text box now has a microphone button."
echo "$RESTART"
echo "To switch it off: $SETUP_DIR/jawbs-speech.sh off"
exit 0
```

- [ ] **Step 5: Call it from `jawbs-local.sh`**

In `setup/jawbs-local.sh`, immediately before the `# 5. Register.` comment, add:

```bash
# 4b. Talking to Jawbs, when the wizard's answer was yes. It comes after the
# settings because it adds a line to them, and it never stops setup: without
# it the person simply types.
if [ "$(answer Speech)" = "yes" ]; then
  if ! JAWBS_ENV_FILE="$ENV_FILE" JAWBS_NODE="$NODE_BIN" bash "$SETUP_DIR/jawbs-speech.sh"; then
    echo "Talking to Jawbs was not switched on. Everything else carries on as normal."
    echo "To try again later: $SETUP_DIR/jawbs-speech.sh"
  fi
fi
```

Update the header comment of `setup/jawbs-local.sh` only if it enumerates the steps; otherwise leave it.

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd ~/j4dev && bash setup/test/run-tests.sh 2>&1 | tail -5`
Expected: `Passed: N  Failed: 0`, with N 37 higher than before this task.

- [ ] **Step 7: Check bash 3.2 compatibility by reading**

Read `setup/jawbs-speech.sh` and the additions to `lib.sh` and `jawbs-local.sh`. Confirm none of: `[[`, arrays, `${var,,}`, `sed -i`, `readarray`, `&>>`, `|&`. `trap ... EXIT`, `${1:-on}`, `$$`, subshell `( umask 077; ... )` and `for mf in $MODEL_FILES` are fine in 3.2.

- [ ] **Step 8: Install the real model into the dev checkout**

This is the real download (about 490 MB), against the real address and the real checksums. It writes only to `portal/data/speech/` (gitignored) and a scratch settings file.

```bash
cd ~/j4dev && printf 'PORT=59717\n' > /tmp/jawbs-speech-dev.env
JAWBS_ENV_FILE=/tmp/jawbs-speech-dev.env bash setup/jawbs-speech.sh
cat /tmp/jawbs-speech-dev.env
ls portal/data/speech portal/data/speech/parakeet
git status --short
```

Expected: `Talking to Jawbs is switched on`; the settings file shows `SPEECH_TO_TEXT=on`; `parakeet/` holds the four model files and `test_wavs/`; `silero_vad.onnx` is beside it; `git status` shows nothing under `portal/data`.

If the checksum is refused, stop and report it: the published file has changed since 2026-09-30 and the pin needs the owner's decision, not a quiet update.

- [ ] **Step 9: Run the worker tests that were skipped in Task 1**

Run: `cd ~/j4dev/portal && node --test test/speech-worker.test.js`
Expected: 7 pass, 0 skipped. `the installed model transcribes its own sample` takes about ten seconds.

- [ ] **Step 10: Commit**

```bash
cd ~/j4dev && git add setup/jawbs-speech.sh setup/lib.sh setup/jawbs-local.sh setup/test/run-tests.sh
git commit -m "Setup: jawbs-speech.sh downloads the speech model and switches it on"
```

---

### Task 6: The page's words and sums

**Files:**
- Create: `portal/public/dictate.js` (pure part only in this task)
- Test: `portal/test/dictate.test.js`

**Interfaces:**
- Produces, all exported from `portal/public/dictate.js`:
  - `MAX_SECONDS = 600`
  - `formatTimer(seconds: number): string` ("03:07")
  - `transcribingLabel(seconds: number): string` ("Transcribing (12s)", "Transcribing (1m 05s)")
  - `recordingNotice(seconds: number): string`
  - `RECORDING_NOTICE`, `LAST_MINUTE_NOTICE`, `FULL_NOTICE`, `ERRORS` (keys `denied`, `no-mic`, `silence`, `busy`, `unreadable`, `failed`)
  - `appendTranscript(existing: string, text: string): string`
  - `floatToPcm16(samples: Float32Array): Int16Array`

- [ ] **Step 1: Write the failing tests**

Create `portal/test/dictate.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert';
const {
  MAX_SECONDS, formatTimer, transcribingLabel, recordingNotice, RECORDING_NOTICE, LAST_MINUTE_NOTICE,
  FULL_NOTICE, ERRORS, appendTranscript, floatToPcm16,
} = await import('../public/dictate.js');

test('the limit is ten minutes', () => {
  assert.equal(MAX_SECONDS, 600);
});

test('formatTimer shows minutes and seconds, two digits each', () => {
  assert.equal(formatTimer(0), '00:00');
  assert.equal(formatTimer(7.9), '00:07');
  assert.equal(formatTimer(59.99), '00:59');
  assert.equal(formatTimer(60), '01:00');
  assert.equal(formatTimer(187), '03:07');
  assert.equal(formatTimer(600), '10:00');
  assert.equal(formatTimer(-3), '00:00');
});

test('transcribingLabel counts the wait so far', () => {
  assert.equal(transcribingLabel(0), 'Transcribing (0s)');
  assert.equal(transcribingLabel(12.4), 'Transcribing (12s)');
  assert.equal(transcribingLabel(59.9), 'Transcribing (59s)');
  assert.equal(transcribingLabel(60), 'Transcribing (1m 00s)');
  assert.equal(transcribingLabel(65), 'Transcribing (1m 05s)');
  assert.equal(transcribingLabel(-1), 'Transcribing (0s)');
});

test('the recording notice encourages detail and names the ten-minute limit', () => {
  assert.equal(recordingNotice(0), RECORDING_NOTICE);
  assert.equal(recordingNotice(539.9), RECORDING_NOTICE);
  assert.match(RECORDING_NOTICE, /the more detail you give, the better Jawbs does/);
  assert.match(RECORDING_NOTICE, /up to ten minutes/);
});

test('the notice changes for the last minute', () => {
  assert.equal(recordingNotice(540), LAST_MINUTE_NOTICE);
  assert.equal(recordingNotice(599), LAST_MINUTE_NOTICE);
  assert.match(LAST_MINUTE_NOTICE, /One minute left/);
  assert.match(FULL_NOTICE, /full ten minutes/);
});

test('every message is plain text with no markup in it', () => {
  for (const s of [RECORDING_NOTICE, LAST_MINUTE_NOTICE, FULL_NOTICE, ...Object.values(ERRORS)]) {
    assert.doesNotMatch(s, /[<>&]/, s);
  }
  assert.deepEqual(Object.keys(ERRORS).sort(), ['busy', 'denied', 'failed', 'no-mic', 'silence', 'unreadable']);
});

test('appendTranscript fills an empty box and adds to a used one after a blank line', () => {
  assert.equal(appendTranscript('', 'Hello.'), 'Hello.');
  assert.equal(appendTranscript('   \n', 'Hello.'), 'Hello.');
  assert.equal(appendTranscript('Typed first', 'Then spoken.'), 'Typed first\n\nThen spoken.');
  assert.equal(appendTranscript('Typed first\n\n\n', 'Then spoken.'), 'Typed first\n\nThen spoken.');
});

test('floatToPcm16 scales to 16-bit and clamps anything out of range', () => {
  assert.deepEqual(Array.from(floatToPcm16(new Float32Array([0, 1, -1, 0.5, -0.5, 2, -2]))),
    [0, 32767, -32768, 16383, -16384, 32767, -32768]);
  assert.equal(floatToPcm16(new Float32Array(0)).length, 0);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd ~/j4dev/portal && node --test test/dictate.test.js`
Expected: FAIL, `Cannot find module '.../public/dictate.js'`.

- [ ] **Step 3: Write the pure part**

Create `portal/public/dictate.js`:

```js
/* Talk instead of typing. The page records, turns the recording into 16 kHz
   PCM itself, posts it to /api/transcribe, and puts the text in the box for
   the person to check before sending. Nothing is sent on their behalf.

   Every string this file puts on the page is a constant defined here. The
   transcript goes into textarea.value only, never into innerHTML: the portal
   is served with no CSP.

   Spec: docs/superpowers/specs/2026-09-30-portal-speech-to-text-design.md */

export const MAX_SECONDS = 600;
const WARN_SECONDS = MAX_SECONDS - 60;
const SAMPLE_RATE = 16000;

const pad = n => String(n).padStart(2, '0');

export function formatTimer(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/* How long the person has waited so far, not an estimate of time left. */
export function transcribingLabel(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return s < 60 ? `Transcribing (${s}s)` : `Transcribing (${Math.floor(s / 60)}m ${pad(s % 60)}s)`;
}

export const RECORDING_NOTICE = 'Recording. Take your time: the more detail you give, the better Jawbs does. You can talk for up to ten minutes. Press the button again when you have finished.';
export const LAST_MINUTE_NOTICE = 'One minute left. Finish your thought and press the button.';
export const FULL_NOTICE = 'That was the full ten minutes, so the recording stopped. Press the mic again to carry on.';

export const recordingNotice = seconds => (seconds >= WARN_SECONDS ? LAST_MINUTE_NOTICE : RECORDING_NOTICE);

export const ERRORS = {
  denied: "Jawbs could not use your microphone. Allow it in your browser's address bar, then press the mic again.",
  'no-mic': 'No microphone was found on this device.',
  silence: 'Jawbs did not catch any speech in that. Press the mic to try again.',
  busy: "Jawbs is busy with someone else's recording. Try again in a minute.",
  unreadable: 'Sorry, that recording could not be read. Press the mic to try again.',
  failed: 'Sorry, that could not be turned into text.',
};

/* Spoken text goes after whatever is already in the box, as a new paragraph. */
export const appendTranscript = (existing, text) =>
  (existing.trim() ? `${existing.replace(/\s+$/, '')}\n\n${text}` : text);

export function floatToPcm16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    out[i] = v < 0 ? v * 32768 : v * 32767;
  }
  return out;
}
```

`ERRORS.denied` and `ERRORS.busy` contain apostrophes, which is why the markup test allows `'` and forbids only `<`, `>` and `&`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd ~/j4dev/portal && node --test test/dictate.test.js`
Expected: 8 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
cd ~/j4dev && git add portal/public/dictate.js portal/test/dictate.test.js
git commit -m "Portal: the dictation button's wording, timers and PCM conversion"
```

---

### Task 7: The button, wired in

**Files:**
- Modify: `portal/public/dictate.js`, `portal/public/app.js`, `portal/public/style.css`
- Test: a throwaway browser check in the session scratch folder (not committed), plus `npm test`

**Interfaces:**
- Consumes: everything Task 6 exports; `POST /api/transcribe` and `speech` in `/api/meta` from Task 3.
- Produces: `attachDictation(textarea: HTMLTextAreaElement, anchor: HTMLElement): void` and `leaveDictation(): void`, exported from `portal/public/dictate.js`.

- [ ] **Step 1: Add the recorder and the button to `dictate.js`**

Append to `portal/public/dictate.js`:

```js
const MIC_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v4"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>';
const RETRY = ' <button type="button" class="linkish dictate-retry">Try again</button>';

/* The recorder's state lives here, not in the DOM: the ten-second poll while a
   session is working rewrites app.innerHTML, and app.js attaches a fresh
   button after every render. Same reasoning as the document panel.

   `run` is bumped whenever the person starts again or leaves the page, and
   every step that waits checks it afterwards, so a late answer from an
   abandoned recording is dropped instead of landing in another conversation. */
const state = { phase: 'idle', page: '', startedAt: 0, waitingSince: 0, error: null, note: '', pcm: null };
let run = 0;
let recorder = null;
let stream = null;
let chunks = [];
let ticker = null;
let ui = null;

const pageKey = () => location.hash;

function supported() {
  return typeof MediaRecorder !== 'undefined' && typeof OfflineAudioContext !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia) && Boolean(window.AudioContext || window.webkitAudioContext);
}

/* Adds the mic button above `anchor` (the Send button) and its notice under
   the text box. Called after every render; does nothing in a browser that
   cannot record. */
export function attachDictation(textarea, anchor) {
  if (!textarea || !anchor || !supported()) return;
  const button = document.createElement('button');
  button.type = 'button';
  anchor.before(button);
  const notice = document.createElement('div');
  notice.className = 'dictate-notice';
  notice.setAttribute('aria-live', 'polite');
  textarea.after(notice);
  ui = { textarea, button, notice, phase: null, time: null, shownNotice: null };
  button.onclick = () => {
    if (state.phase === 'recording') stopRecording(false);
    else if (state.phase === 'idle') startRecording();
  };
  notice.onclick = e => { if (e.target.closest('.dictate-retry')) retry(); };
  paint();
}

/* Called when the person moves to another page. Stops a recording, releases
   the microphone and abandons anything still being transcribed. */
export function leaveDictation() {
  run++;
  if (recorder && recorder.state !== 'inactive') {
    recorder.onstop = null;
    recorder.stop();
  }
  recorder = null;
  chunks = [];
  releaseMic();
  stopTicking();
  Object.assign(state, { phase: 'idle', error: null, note: '', pcm: null });
  ui = null;
}

function releaseMic() {
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
}

function startTicking() {
  if (!ticker) ticker = setInterval(tick, 250);
}

function stopTicking() {
  clearInterval(ticker);
  ticker = null;
}

function tick() {
  if (state.phase === 'recording' && (Date.now() - state.startedAt) / 1000 >= MAX_SECONDS) stopRecording(true);
  paint();
}

function paint() {
  if (!ui || !ui.button.isConnected) return;
  const { button } = ui;
  if (ui.phase !== state.phase) {
    /* Rebuilt only when the phase changes, so a press that lands between two
       ticks is never on an element that has just been replaced. The children
       take no pointer events (style.css) for the same reason. */
    ui.phase = state.phase;
    button.className = `secondary dictate${state.phase === 'recording' ? ' recording' : ''}`;
    button.disabled = state.phase === 'transcribing';
    if (state.phase === 'recording') {
      button.innerHTML = `${STOP_ICON}<span>Stop recording</span><small class="dictate-time"></small>`;
      button.setAttribute('aria-label', 'Stop recording');
    } else if (state.phase === 'transcribing') {
      button.innerHTML = '<small class="dictate-time"></small>';
      button.setAttribute('aria-label', 'Transcribing your recording');
    } else {
      button.innerHTML = `${MIC_ICON}<span>Speak your answer</span>`;
      button.setAttribute('aria-label', 'Speak your answer');
    }
    ui.time = button.querySelector('.dictate-time');
  }
  let notice = '';
  if (state.phase === 'recording') {
    const seconds = (Date.now() - state.startedAt) / 1000;
    ui.time.textContent = formatTimer(seconds);
    ui.time.classList.toggle('warn', seconds >= WARN_SECONDS);
    notice = recordingNotice(seconds);
  } else if (state.phase === 'transcribing') {
    ui.time.textContent = transcribingLabel((Date.now() - state.waitingSince) / 1000);
    notice = state.note;
  } else if (state.error) {
    notice = ERRORS[state.error] + (state.pcm ? RETRY : '');
  } else {
    notice = state.note;
  }
  /* Compared against what was last written, so the live region announces a
     change once rather than four times a second. */
  if (ui.shownNotice !== notice) {
    ui.notice.innerHTML = notice;
    ui.shownNotice = notice;
  }
}

function settle(error) {
  state.phase = 'idle';
  state.error = error;
  stopTicking();
  paint();
}

async function startRecording() {
  const mine = ++run;
  Object.assign(state, { error: null, note: '', pcm: null });
  paint();
  let granted;
  try {
    granted = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    if (mine !== run) return;
    return settle(err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError' ? 'no-mic' : 'denied');
  }
  if (mine !== run) {
    granted.getTracks().forEach(t => t.stop());
    return;
  }
  stream = granted;
  chunks = [];
  const rec = new MediaRecorder(granted);
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => finish(mine, rec.mimeType);
  rec.start(1000);
  recorder = rec;
  Object.assign(state, { phase: 'recording', page: pageKey(), startedAt: Date.now() });
  startTicking();
  paint();
}

function stopRecording(full) {
  if (state.phase !== 'recording' || !recorder) return;
  Object.assign(state, { phase: 'transcribing', waitingSince: Date.now(), note: full ? FULL_NOTICE : '' });
  recorder.stop();
  releaseMic();
  paint();
}

async function finish(mine, mimeType) {
  const blob = new Blob(chunks, { type: mimeType });
  chunks = [];
  recorder = null;
  if (mine !== run) return;
  let pcm;
  try {
    pcm = await toPcm16(blob);
  } catch {
    if (mine === run) settle('unreadable');
    return;
  }
  if (mine !== run) return;
  if (!pcm.length) return settle('silence');
  state.pcm = pcm;
  send(mine);
}

/* The browser decodes its own recording (WebM Opus in Chrome and Firefox, MP4
   AAC in Safari) and resamples it, so the portal needs no audio converter. */
async function toPcm16(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    return floatToPcm16((await offline.startRendering()).getChannelData(0));
  } finally {
    ctx.close();
  }
}

async function send(mine) {
  let r;
  try {
    /* An Int16Array is sent in the machine's byte order, which is
       little-endian on everything a browser runs on, as the portal expects. */
    r = await fetch('/api/transcribe', {
      method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: state.pcm,
    });
  } catch {
    if (mine === run) settle('failed');
    return;
  }
  if (mine !== run) return;
  if (r.status === 503) return settle('busy');
  if (!r.ok) return settle('failed');
  const out = await r.json().catch(() => ({}));
  if (mine !== run) return;
  /* The answer is in, so the recording is no longer needed. Until here it is
     kept so a failure can be retried without speaking it all again. */
  state.pcm = null;
  const text = typeof out.text === 'string' ? out.text.trim() : '';
  if (!text) return settle('silence');
  if (ui?.textarea.isConnected && state.page === pageKey()) {
    const box = ui.textarea;
    box.value = appendTranscript(box.value, text);
    box.focus();
    box.scrollTop = box.scrollHeight;
  }
  settle(null);
}

function retry() {
  if (state.phase !== 'idle' || !state.pcm) return;
  Object.assign(state, { phase: 'transcribing', waitingSince: Date.now(), error: null });
  startTicking();
  paint();
  send(run);
}
```

- [ ] **Step 2: Check the pure tests still pass**

Run: `cd ~/j4dev/portal && node --test test/dictate.test.js`
Expected: 8 pass. This proves the module still imports under Node, where there is no `window`, `document` or `location`: nothing at the top level may touch them.

- [ ] **Step 3: Wire it into `app.js`**

In `portal/public/app.js`:

Add to the imports:

```js
import { attachDictation, leaveDictation } from './dictate.js';
```

After `let LOCAL = false;` add:

```js
let SPEECH = false;
```

In `main`, after `LOCAL = meta.local === true;` add:

```js
    SPEECH = meta.speech === true;
```

Replace `route` with:

```js
function route() {
  closeDocPanel?.();
  // A recording belongs to the page it was started on.
  leaveDictation();
  const id = location.hash.slice(1);
  if (id === 'archived') return renderArchived();
  id ? renderSession(id, true) : renderList();
}
```

In `renderList`, inside `if (!setup.pending) { ... }`, after the `bindSubmit(...)` call and before the closing brace, add:

```js
    if (SPEECH) attachDictation(document.getElementById('jd'), document.getElementById('submit'));
```

Replace the `renderSession` signature, its comment and its first lines down to the `app.innerHTML =` assignment's opening:

```js
let pollTimer;
/* scrollToLatest is set when the reader has just arrived at the chat or has
   just sent a reply, so the newest message and the reply box are in view rather
   than the top of a long thread. The ten-second working poll passes it falsy on
   purpose: re-rendering must not yank the page down while the reader has
   scrolled up to reread. Replacing innerHTML keeps the window scroll offset, so
   a background refresh leaves them where they were.

   keepDraft is set by the poll alone. It carries whatever is in the reply box,
   and the caret, across the re-render: without it the poll silently empties the
   box every ten seconds while Jawbs is working, which would throw away a spoken
   answer. Arriving at a chat or sending a reply starts with an empty box. */
async function renderSession(id, scrollToLatest = false, keepDraft = false) {
  clearInterval(pollTimer);
  const [sRes, dRes] = await Promise.all([api('/sessions/' + id), api(`/sessions/${id}/documents`)]);
  const s = await sRes.json();
  const docs = dRes.ok ? await dRes.json() : [];
  // The person may have moved on while those two requests were in flight; a
  // late render would put this chat on screen under another chat's address.
  if (location.hash.slice(1) !== id) return;
  const old = keepDraft ? document.getElementById('reply') : null;
  const draft = old ? {
    value: old.value, focused: document.activeElement === old,
    start: old.selectionStart, end: old.selectionEnd, scrollTop: old.scrollTop,
  } : null;
  app.innerHTML = `<div class="chat-bar">
```

(The rest of the template literal is unchanged.)

Immediately after the existing `bindSubmit(document.getElementById('reply'), document.getElementById('send'), async () => { ... });` call in `renderSession`, add:

```js
  if (draft) {
    const box = document.getElementById('reply');
    box.value = draft.value;
    box.scrollTop = draft.scrollTop;
    if (draft.focused) {
      box.focus();
      box.setSelectionRange(draft.start, draft.end);
    }
  }
  if (SPEECH) attachDictation(document.getElementById('reply'), document.getElementById('send'));
```

Replace the last line of `renderSession`:

```js
  if (s.status === 'working') pollTimer = setInterval(() => location.hash.slice(1) === id && renderSession(id, false, true), 10000);
```

- [ ] **Step 4: Add the styles**

Append to `portal/public/style.css`:

```css
/* Dictation. One more full-width button above Send, like every other button
   on the page. Its children take no pointer events so a press always lands on
   the button itself, whatever is being repainted inside it. Recording is shown
   by the icon changing and a red outline, not by colour alone. */
button.dictate {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: .5rem;
}
button.dictate > * { pointer-events: none; }
button.dictate.recording { box-shadow: inset 0 0 0 2px var(--red); }
button.dictate.recording svg { color: var(--red); }
button.dictate:disabled { cursor: default; }
.dictate-time {
  font-size: .75rem;
  font-weight: 400;
  color: var(--ink-soft);
  font-variant-numeric: tabular-nums;
}
.dictate-time.warn { color: var(--amber); font-weight: 600; }
.dictate-notice { font-size: .85rem; color: var(--ink-soft); margin-top: 8px; }
.dictate-notice:empty { display: none; }
/* Try again sits in the notice's sentence, so it must not take the full width
   and top margin every other button on the page has. */
.dictate-retry { width: auto; margin: 0 0 0 .25rem; }
```

- [ ] **Step 5: Run the portal suite**

Run: `cd ~/j4dev/portal && npm test 2>&1 | tail -8`
Expected: `fail 0`.

- [ ] **Step 6: Start a scratch portal**

The Playwright MCP cannot run on this machine; drive the cached Chromium from a script. Never use port 8710 and never stop a server with `pkill -f`.

```bash
SCRATCH="<your session scratchpad>/speech-e2e" && mkdir -p "$SCRATCH/proj"
printf '{"solo@test.com":{"name":"Solo","projectDir":"%s/proj","admin":true}}\n' "$SCRATCH" > "$SCRATCH/users.json"
cd ~/j4dev/portal && EXPOSURE=local BIND_HOST=127.0.0.1 PORT=59717 BASE_URL=http://localhost:59717 \
  EMAIL_PROVIDER=log AGENT_RUNNER=cli AGENT_CMD=false SUBSCRIPTIONS=claude-only PORTAL_TITLE=Jawbs \
  PORTAL_USERS_FILE="$SCRATCH/users.json" DB_PATH="$SCRATCH/portal.db" SPEECH_TO_TEXT=on \
  node src/server.js > "$SCRATCH/server.log" 2>&1 &
sleep 2 && curl -s http://localhost:59717/api/meta
```

Expected: `{"title":"Jawbs","local":true,"kit":"/home/spacetimejam/j4dev","speech":true}` and no `SPEECH_TO_TEXT` warning in `server.log`. The project folder has no `SETUP.md`, so the landing page is the list with the new application box, and `AGENT_CMD=false` means nothing can reach Claude.

Then add a conversation that stays `working`, so the ten-second poll runs:

```bash
cd ~/j4dev/portal && curl -s http://localhost:59717/api/sessions > /dev/null && node -e "
const Database = require('better-sqlite3');
const db = new Database(process.argv[1]);
db.prepare(\"insert into sessions (id, user_email, title, status) values ('pollcase', 'solo@test.com', 'Poll case', 'working')\").run();
console.log(db.prepare('select id, status from sessions').all());
" "$SCRATCH/portal.db"
```

Expected: `[ { id: 'pollcase', status: 'working' } ]`.

- [ ] **Step 7: Run the browser check**

Save as `$SCRATCH/check.cjs`:

```js
const { chromium } = require('/home/spacetimejam/shareverified/node_modules/playwright');
const WAV = '/home/spacetimejam/j4dev/portal/data/speech/parakeet/test_wavs/en.wav';
const BASE = 'http://localhost:59717/';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` (${detail})` : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ args: [
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`,
  ] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const btn = () => page.locator('button.dictate');
  const notice = () => page.locator('.dictate-notice');

  // Case 1: the new application box. Record, watch the timer, stop, get text.
  await page.goto(BASE);
  await btn().waitFor();
  check('1 idle button says Speak your answer', /Speak your answer/.test(await btn().innerText()));
  await btn().click();
  await sleep(6000);
  const rec = await btn().innerText();
  check('1 recording shows Stop recording and an mm:ss timer', /Stop recording/.test(rec) && /00:0[4-7]/.test(rec), rec.replace(/\s+/g, ' '));
  check('1 recording notice encourages detail', /the more detail you give, the better Jawbs does/.test(await notice().innerText()));
  check('1 recording button is marked', await btn().evaluate(b => b.classList.contains('recording')));
  await btn().click();
  await sleep(1200);
  const wait = await btn().innerText();
  check('1 waiting shows Transcribing with seconds', /Transcribing \(\d+s\)/.test(wait), wait);
  check('1 button is disabled while transcribing', await btn().isDisabled());
  await page.waitForFunction(() => document.getElementById('jd').value.length > 0, null, { timeout: 90000 });
  const jd = await page.locator('#jd').inputValue();
  check('1 the spoken words land in the box', /country/i.test(jd), jd.slice(0, 80));
  check('1 the button returns to idle', /Speak your answer/.test(await btn().innerText()));
  check('1 nothing was sent', page.url() === BASE);

  // Case 2: a conversation that is working, so the ten-second poll re-renders
  // the page during the recording. The typed draft and the timer must survive.
  await page.goto(BASE + '#pollcase');
  await btn().waitFor();
  await page.locator('#reply').fill('typed first');
  await btn().click();
  await sleep(13000);
  check('2 the typed draft survives the poll', (await page.locator('#reply').inputValue()) === 'typed first');
  const rec2 = await btn().innerText();
  check('2 the timer keeps counting through the poll', /00:1[1-5]/.test(rec2), rec2.replace(/\s+/g, ' '));
  await btn().click();
  await page.waitForFunction(() => document.getElementById('reply').value.length > 'typed first'.length, null, { timeout: 90000 });
  const reply = await page.locator('#reply').inputValue();
  check('2 spoken text is added after the typed text', reply.startsWith('typed first\n\n') && /country/i.test(reply), reply.slice(0, 80));
  await sleep(11000);
  check('2 the transcript survives the next poll', (await page.locator('#reply').inputValue()) === reply);

  // Case 3: leave while the clip is being transcribed. The text must not
  // arrive in the other conversation's box.
  await page.goto(BASE);
  await btn().waitFor();
  await btn().click();
  await sleep(4000);
  await btn().click();
  await page.evaluate(() => { location.hash = 'pollcase'; });
  await page.locator('#reply').waitFor();
  await sleep(15000);
  check('3 an abandoned recording does not land in another conversation', (await page.locator('#reply').inputValue()) === '');
  check('3 the button on the new page is idle', /Speak your answer/.test(await btn().innerText()));

  // Case 4: a tap too short to hold audio must not stick on Transcribing.
  await page.goto(BASE);
  await btn().waitFor();
  await btn().click();
  await page.waitForFunction(() => /Stop recording/.test(document.querySelector('button.dictate').innerText));
  await btn().click();
  await page.waitForFunction(() => /Speak your answer/.test(document.querySelector('button.dictate').innerText), null, { timeout: 30000 })
    .then(() => check('4 a very short tap comes back to idle', true), () => check('4 a very short tap comes back to idle', false));
  const after = (await notice().innerText()).trim();
  const box = await page.locator('#jd').inputValue();
  check('4 a very short tap gives a message or some text, never silence about it', after.length > 0 || box.length > 0, after || box);

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(results.every(Boolean) ? '\nALL PASS' : '\nSOME FAILED');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
```

Run: `node "$SCRATCH/check.cjs"`
Expected: every line `PASS`, then `ALL PASS`. The sample says "Ask not what your country can do for you. Ask what you can do for your country." and the fake microphone loops it.

If a check fails, fix the code, not the check. Report honestly which cases passed.

- [ ] **Step 8: Look at it**

Take screenshots of the three states on the list page and read them, in light and dark:

```js
// $SCRATCH/shots.cjs
const { chromium } = require('/home/spacetimejam/shareverified/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    '--use-file-for-fake-audio-capture=/home/spacetimejam/j4dev/portal/data/speech/parakeet/test_wavs/en.wav'] });
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ colorScheme: scheme, viewport: { width: 420, height: 800 } });
    await page.goto('http://localhost:59717/');
    await page.locator('button.dictate').waitFor();
    await page.screenshot({ path: `${__dirname}/${scheme}-idle.png` });
    await page.locator('button.dictate').click();
    await new Promise(r => setTimeout(r, 3000));
    await page.screenshot({ path: `${__dirname}/${scheme}-recording.png` });
    await page.locator('button.dictate').click();
    await new Promise(r => setTimeout(r, 1500));
    await page.screenshot({ path: `${__dirname}/${scheme}-transcribing.png` });
    await page.close();
  }
  await browser.close();
})();
```

Run: `node "$SCRATCH/shots.cjs"`, then open the six PNGs with the Read tool.
Expected: the mic button sits between the text box and Send at full width; the timer is small and muted beside the icon; the recording state has a red outline and a stop icon; the notice sits under the text box in small muted type; nothing overlaps at 420 px wide; all of it is legible in dark mode.

- [ ] **Step 9: Stop the scratch portal**

```bash
ss -ltnp | grep 59717
kill <the pid shown>
```

Expected: `ss -ltnp | grep 59717` then prints nothing. Confirm the live portal is untouched: `systemctl --user is-active job-search-portal` prints `active`.

- [ ] **Step 10: Commit**

```bash
cd ~/j4dev && git add portal/public/dictate.js portal/public/app.js portal/public/style.css
git commit -m "Portal: a mic button on both text boxes, and the reply draft survives the poll"
```

---

### Task 8: Docs

**Files:**
- Modify: `docs/portal.md`, `portal/.env.example`, `CLAUDE.md`

**Interfaces:**
- Consumes: the names and behaviour from Tasks 1 to 7. Nothing later depends on this task.

- [ ] **Step 1: Confirm the model's licence**

Open `https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3` and read the licence field. The spec expects CC-BY-4.0. If it is CC-BY-4.0, carry on. If it is anything else, stop and tell the owner before writing the docs: the attribution wording below, and possibly the choice of model, depends on it.

- [ ] **Step 2: Add the settings to `.env.example`**

In `portal/.env.example`, immediately before the line `# CLI runner command templates (if AGENT_RUNNER=cli).`, add:

```
# Speech to text: a microphone button on the text boxes. The portal turns the
# recording into text itself with an open model; the audio is never stored and
# goes to no outside service. Switch it on with setup/jawbs-speech.sh, which
# downloads the model (about 490 MB) and sets this line. While a recording is
# being transcribed it uses every core and about 1 GB of memory.
#SPEECH_TO_TEXT=on
# Where the model lives. The default is portal/data/speech.
#SPEECH_MODEL_DIR=
```

- [ ] **Step 3: Add the section to `docs/portal.md`**

In `docs/portal.md`, in the section `## Using Jawbs on your own computer`, after the sentence `The answer is recorded in `SETUP.md` as `Writer:`.` and before `The wizard then runs`, insert a paragraph:

```markdown
It then asks whether you would like to talk to Jawbs as well as type, which is
optional and free of charge (see "Talking to Jawbs" below). That answer is
recorded as `Speech:`.
```

Then add a new section immediately before `## Running on one subscription`:

```markdown
## Talking to Jawbs

Jawbs does its best work with long, detailed answers, and those are easier to
say than to type. With speech switched on, the new application box and the
reply box each get a microphone button. Press it, talk for up to ten minutes,
press it again, and your words appear in the box for you to check and send.
Nothing is sent until you press Send.

It is free of charge and needs no account. The portal turns the recording into
text itself, so on your own computer your voice never leaves the machine, and
on a shared Jawbs it goes only to the computer that runs it. The recording is
held in memory while it is transcribed and is never saved.

What it costs:

- A one-off download of about 490 MB, which takes about 640 MB of disk space
  in `portal/data/speech/`.
- While a recording is being turned into text, every processor core and about
  1 GB of memory. Five minutes of speech took about 25 seconds on a 2017
  four-core desktop. The rest of the time it uses nothing.

Switch it on, or off, at any time:

```bash
setup/jawbs-speech.sh        # download the model once and switch on
setup/jawbs-speech.sh off    # switch off; the download is kept
```

Then quit Jawbs and open it again (on a shared Jawbs, restart the service).
The script checks the download against a pinned checksum and refuses a file
that does not match. If the model is missing while `SPEECH_TO_TEXT=on`, the
portal still starts, says so in its log, and hides the button.

On a shared Jawbs one recording is transcribed at a time. Up to three wait
their turn; after that the page asks the person to try again in a minute.

The button needs a browser that can record (current Chrome, Edge, Firefox and
Safari) and a secure page, which `https://` and `http://localhost` both are.
In a browser that cannot record, the button does not appear.

The model is NVIDIA's Parakeet TDT 0.6b v3, licensed CC-BY-4.0, in the ONNX
build published by the sherpa-onnx project, and runs through the
`sherpa-onnx-node` package (Apache-2.0). Speech is split at pauses with Silero
VAD.
```

- [ ] **Step 4: Add the decision to `CLAUDE.md`**

In `CLAUDE.md`, in `## Layout`, change the `setup/` bullet's parenthesis so it reads:

```markdown
- `setup/`: wizard (`setup.sh` + `lib.sh`, bash 3.2 compatible; `jawbs-local.sh` sets up Jawbs in the browser on the person's own computer; `jawbs-speech.sh` switches speech to text on or off) and its test harness `setup/test/run-tests.sh` (plain bash, prints `Passed: N  Failed: N`). Run after any setup change.
```

At the end of `## Key decisions: don't re-litigate`, add:

```markdown
- **The portal turns speech into text itself.** A mic button on both text boxes records up to ten minutes (`portal/public/dictate.js`), the browser converts the recording to 16 kHz PCM so the portal needs no audio converter, and `POST /api/transcribe` hands it to `speech-worker.js`, which runs Parakeet v3 through `sherpa-onnx-node`. The browser's built-in dictation, extensions and paid services were all ruled out (owner decision, 2026-09-30): the first two send audio to Google or Apple and miss Firefox, the last needs an API key, and the kit runs on subscriptions alone. The worker is a separate process per clip, and that is load-bearing: decoding is a synchronous native call that would freeze the portal for everyone for the 25 seconds it runs, and exiting gives back its 1 GB. `createTranscriber` in `speech.js` runs one clip at a time with three waiting. The worker packs speech into 25-second windows, because one fragment per pause more than doubled the word errors. The audio is never written to disk or logged. It is optional: the wizard asks only in own-computer mode, with no default answer (`ask_menu --required`), records `Speech:` in SETUP.md, and `setup/jawbs-speech.sh` downloads the model against pinned checksums and sets `SPEECH_TO_TEXT=on`; on the shared portal the owner runs the same script. A missing model is a preflight warning and a hidden button, never a refusal to start. The recorder's state lives in the module and the button is re-attached after every render, for the same reason as the document panel, and the poll now carries the reply draft across its re-render, which it used to empty. Only the Linux build and Chromium have been run. Spec: `docs/superpowers/specs/2026-09-30-portal-speech-to-text-design.md`.
```

- [ ] **Step 5: Check the docs rules**

```bash
cd ~/j4dev && grep -nP "[\x{2013}\x{2014}]" docs/portal.md portal/.env.example | tail -5
git diff -U0 CLAUDE.md docs/portal.md portal/.env.example | grep -P "^\+.*[\x{2013}\x{2014}]"
```

Expected: the second command prints nothing (no em or en dashes in the lines this task added). The first may list older lines; leave those alone.

- [ ] **Step 6: Run both suites one last time**

```bash
cd ~/j4dev && bash setup/test/run-tests.sh 2>&1 | tail -2 && cd portal && npm test 2>&1 | tail -8
```

Expected: `Passed: N  Failed: 0` and `fail 0`.

- [ ] **Step 7: Commit**

```bash
cd ~/j4dev && git add docs/portal.md portal/.env.example CLAUDE.md
git commit -m "Docs: talking to Jawbs"
```

---

### Task 9: Switch it on for the shared Jawbs (owner's go-ahead required)

This task changes the live service other people use. Do not start it without the owner saying so in this session, and stop at any step that does not give the expected result.

**Files:** none in the repository.

- [ ] **Step 1: Get the branch onto master and pushed**

This is the owner's call (merge or pull request). Pushes go from `~/j4dev` only, never from `~/j4`.

- [ ] **Step 2: Bring the live checkout up to date**

```bash
cd ~/j4 && git pull --ff-only && cd portal && npm ci --no-audit --no-fund
node -e "require('sherpa-onnx-node'); console.log('speech program ok')"
```

Expected: `speech program ok`. `~/j4` has a modified `CLAUDE.md` in its working tree; if `git pull` refuses because of it, stop and ask the owner rather than stashing or resetting.

- [ ] **Step 3: Download the model and switch on**

```bash
cd ~/j4 && ls -l portal/.env && bash setup/jawbs-speech.sh && ls -l portal/.env && grep -c '^SPEECH_TO_TEXT=on$' portal/.env
```

Expected: `Talking to Jawbs is switched on`, the `.env` permissions identical before and after, and `1`.

- [ ] **Step 4: Restart and check**

```bash
systemctl --user restart job-search-portal && sleep 3 && systemctl --user is-active job-search-portal
journalctl --user -u job-search-portal -n 20 --no-pager | grep -i "speech\|error" || echo "no speech warnings or errors"
curl -s http://localhost:8710/api/meta
```

Expected: `active`, `no speech warnings or errors`, and `/api/meta` includes `"speech":true`. Remember that `Restart=on-failure` does not restart a portal that exits 0, and nothing monitors it, so check `is-active` yourself.

- [ ] **Step 5: Ask the owner to try it**

Ask the owner to open `https://jawbs.duckdns.org`, record a sentence on the new application box without sending it, and confirm the text appears. Then, from a phone, the same. A phone and Safari are the two things no test here has covered, so report what happens on them plainly, including if it fails.
