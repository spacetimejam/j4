import test from 'node:test';
import assert from 'node:assert';
import { request } from 'node:http';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
process.env.DB_PATH = ':memory:';
process.env.PORTAL_USERS_FILE = '/nonexistent-portal-users.json';
process.env.ALLOWED_EMAILS = 'solo@test.com';
process.env.EXPOSURE = 'local';
process.env.PORTAL_TITLE = 'Jawbs';
const { createApp } = await import('../src/server.js');
const { isLocal } = await import('../src/local.js');

let quitCalls = 0;
const app = createApp({ send: async () => {}, quit: async () => { quitCalls++; } });
const server = app.listen(0, '127.0.0.1');
// listen() with an explicit host resolves the bind asynchronously on this
// platform (unlike the no-host default), so address() is null until the
// server actually starts listening.
await new Promise(resolve => server.once('listening', resolve));
const port = server.address().port;
test.after(() => server.close());

// node:http, not fetch, so the Host header can be set freely.
function call(path, { method = 'GET', host = `localhost:${port}`, origin, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host };
    if (origin) headers.origin = origin;
    if (body) headers['content-type'] = 'application/json';
    const req = request({ host: '127.0.0.1', port, path, method, headers }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

test('isLocal reads EXPOSURE', () => {
  assert.equal(isLocal(), true);
  assert.equal(isLocal({ exposure: 'private' }), false);
  assert.equal(isLocal({ exposure: ' Local ' }), true);
});

test('the one user is signed in without a cookie', async () => {
  const r = await call('/api/me');
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { email: 'solo@test.com' });
});

test('meta says local', async () => {
  // kit lets the launcher tell its own Jawbs from another copy on the same port.
  const kit = realpathSync(fileURLToPath(new URL('../..', import.meta.url)));
  assert.deepEqual(JSON.parse((await call('/api/meta')).body), { title: 'Jawbs', local: true, kit });
});

test('login routes do not exist in local mode', async () => {
  assert.equal((await call('/api/login', { method: 'POST', body: { email: 'solo@test.com' } })).status, 404);
  assert.equal((await call('/auth/abc')).status, 404);
});

test('a foreign Host is refused on API and static routes alike', async () => {
  for (const path of ['/api/me', '/', '/index.html', '/app.js']) {
    assert.equal((await call(path, { host: 'evil.example:' + port })).status, 403, path);
  }
  assert.equal((await call('/api/me', { host: 'localhost' })).status, 403, 'port must match');
});

test('127.0.0.1 is an accepted Host', async () => {
  assert.equal((await call('/api/me', { host: `127.0.0.1:${port}` })).status, 200);
});

test('a POST from a foreign Origin is refused; no Origin or our own is fine', async () => {
  const body = { jd: 'A role' };
  assert.equal((await call('/api/sessions', { method: 'POST', origin: 'https://evil.example', body })).status, 403);
  assert.equal((await call('/api/sessions', { method: 'POST', body })).status, 200);
  assert.equal((await call('/api/sessions', { method: 'POST', origin: `http://localhost:${port}`, body })).status, 200);
});

test('quit calls the injected quit function', async () => {
  const r = await call('/api/quit', { method: 'POST', origin: `http://localhost:${port}` });
  assert.equal(r.status, 200);
  await new Promise(res => setTimeout(res, 20)); // quit runs after the response
  assert.equal(quitCalls, 1);
});
