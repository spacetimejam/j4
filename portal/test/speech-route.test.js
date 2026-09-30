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
const on = createApp({ send: async () => {}, speech: true, transcribe: (pcm, opts) => { calls.push(pcm.length); return answer(pcm, opts); } }).listen(0);
const off = createApp({ send: async () => {}, speech: false }).listen(0);
test.after(() => { on.close(); off.close(); on.closeAllConnections(); off.closeAllConnections(); });
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

test('a client that goes away stops its transcription', async () => {
  let signal;
  answer = (pcm, opts) => new Promise((resolve, reject) => {
    signal = opts?.signal;
    signal?.addEventListener('abort', () => reject(Object.assign(new Error('gone'), { code: 'aborted' })));
  });
  const leaving = new AbortController();
  const pending = fetch(url(on, '/api/transcribe'), {
    method: 'POST', headers: { cookie, 'content-type': 'application/octet-stream' }, body: Buffer.alloc(4), signal: leaving.signal,
  }).catch(() => {});
  try {
    for (let i = 0; i < 100 && !signal; i++) await new Promise(r => setTimeout(r, 10));
    assert.ok(signal, 'the route should hand the transcriber a signal');
    assert.equal(signal.aborted, false);
    leaving.abort();
    await pending;
    for (let i = 0; i < 100 && !signal.aborted; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(signal.aborted, true);
  } finally {
    // Whatever happened, do not leave a request hanging: it would keep the
    // test server, and so the whole run, open for ever.
    leaving.abort();
    answer = async () => 'hello there';
  }
});

test('a finished request does not abort anything', async () => {
  let signal;
  answer = async (pcm, opts) => { signal = opts?.signal; return 'done'; };
  assert.equal((await post(on, Buffer.alloc(4))).status, 200);
  await new Promise(r => setTimeout(r, 50));
  assert.equal(signal?.aborted, false);
  answer = async () => 'hello there';
});
