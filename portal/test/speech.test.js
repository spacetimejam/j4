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

// A clip nobody is waiting for any more (the person left the page, the
// connection dropped, or they pressed Try again) must stop using the machine
// and give up its place in the queue.
const abortError = err => err.code === 'aborted';

test('aborting a running clip kills its worker and lets the next one start', async () => {
  const marker = join(work, 'finished-anyway');
  const slow = `const fs = require('fs'); process.stdin.resume().on('end', () =>
    setTimeout(() => { fs.appendFileSync(process.argv[1], 'x'); console.log('{"text":"late"}'); }, 800));`;
  const transcribe = createTranscriber({ dir: '/unused', command: process.execPath, args: ['-e', slow, marker] });
  const gone = new AbortController();
  const first = transcribe(Buffer.alloc(2), { signal: gone.signal });
  const second = transcribe(Buffer.alloc(2));
  setTimeout(() => gone.abort(), 100);
  const started = Date.now();
  await assert.rejects(first, abortError);
  assert.ok(Date.now() - started < 600, 'the abort should not wait for the worker to finish');
  assert.equal(await second, 'late');
  // Each worker that reaches the end leaves one mark. One mark means the first
  // was killed: left alone it would have finished before the second did.
  assert.equal(readFileSync(marker, 'utf8'), 'x');
});

test('aborting a waiting clip gives up its place without ever starting a worker', async () => {
  const log = join(work, 'starts.log');
  const script = `require('fs').appendFileSync(process.argv[1], 'start\\n');
    process.stdin.resume().on('end', () => setTimeout(() => console.log('{"text":"x"}'), 200));`;
  const transcribe = createTranscriber({ dir: '/unused', command: process.execPath, args: ['-e', script, log], maxWaiting: 1 });
  const gone = new AbortController();
  const first = transcribe(Buffer.alloc(2));
  const second = transcribe(Buffer.alloc(2), { signal: gone.signal });
  gone.abort();
  await assert.rejects(second, abortError);
  // Its place is free again straight away, while the first is still running.
  const third = transcribe(Buffer.alloc(2));
  assert.deepEqual(await Promise.all([first, third]), ['x', 'x']);
  assert.equal(readFileSync(log, 'utf8'), 'start\nstart\n');
});

test('a clip whose listener has already gone is never started', async () => {
  const log = join(work, 'never.log');
  const script = `require('fs').appendFileSync(process.argv[1], 'start\\n'); console.log('{"text":"x"}');`;
  const transcribe = createTranscriber({ dir: '/unused', command: process.execPath, args: ['-e', script, log] });
  await assert.rejects(transcribe(Buffer.alloc(2), { signal: AbortSignal.abort() }), abortError);
  await new Promise(r => setTimeout(r, 150));
  assert.throws(() => readFileSync(log), /ENOENT/);
});
