import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const projectDir = mkdtempSync(join(tmpdir(), 'proj-'));
process.env.PROJECT_DIR = projectDir;
process.env.DB_PATH = ':memory:';
process.env.PORTAL_USERS_FILE = '/nonexistent-portal-users.json';
process.env.ALLOWED_EMAILS = 'owner@test.com';
process.env.COOKIE_SECRET = 'testsecret';
const { createApp } = await import('../src/server.js');
const { makeCookie } = await import('../src/auth.js');
const { getDb } = await import('../src/db.js');
const { setupPending } = await import('../src/setup-session.js');

const server = createApp({ send: async () => {} }).listen(0);
const base = `http://localhost:${server.address().port}`;
const cookie = `jskit=${makeCookie('owner@test.com')}`;
test.after(() => server.close());
const post = path => fetch(base + path, { method: 'POST', headers: { cookie } });
const get = path => fetch(base + path, { headers: { cookie } });

test('setup is pending exactly while SETUP.md exists', () => {
  assert.equal(setupPending(projectDir), false);
  writeFileSync(join(projectDir, 'SETUP.md'), '# Setup incomplete');
  assert.equal(setupPending(projectDir), true);
  assert.equal(setupPending(undefined), false);
});

test('GET /api/setup reports pending and no session yet', async () => {
  assert.deepEqual(await (await get('/api/setup')).json(), { pending: true, sessionId: null, canChangeDesign: false });
});

test('start creates one setup session and queues one opening turn, however often called', async () => {
  const a = await (await post('/api/setup/start')).json();
  const b = await (await post('/api/setup/start')).json();
  assert.equal(a.id, b.id);
  const db = getDb();
  const s = db.prepare('select * from sessions where id = ?').get(a.id);
  assert.equal(s.kind, 'setup');
  assert.equal(s.title, 'Getting started');
  assert.equal(s.status, 'working');
  assert.equal(db.prepare('select count(*) c from jobs where session_id = ?').get(a.id).c, 1);
  assert.equal(db.prepare('select count(*) c from messages where session_id = ?').get(a.id).c, 0);
  assert.deepEqual(await (await get('/api/setup')).json(), { pending: true, sessionId: a.id, canChangeDesign: false });
});

test('once SETUP.md is gone, start is refused but the session still takes replies', async () => {
  const { sessionId } = await (await get('/api/setup')).json();
  rmSync(join(projectDir, 'SETUP.md'));
  assert.equal((await post('/api/setup/start')).status, 409);
  assert.deepEqual(await (await get('/api/setup')).json(), { pending: false, sessionId, canChangeDesign: false });
  const r = await fetch(`${base}/api/sessions/${sessionId}/reply`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ body: 'thanks' }),
  });
  assert.equal(r.status, 200);
});

test('the sessions list carries kind', async () => {
  const list = await (await get('/api/sessions')).json();
  assert.equal(list.find(s => s.title === 'Getting started').kind, 'setup');
});
