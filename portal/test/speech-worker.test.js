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
