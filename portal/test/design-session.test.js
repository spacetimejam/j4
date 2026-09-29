import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
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
const { DESIGN_OPENING_PROMPT, DESIGN_CATEGORY_URL } = await import('../src/design-session.js');

const server = createApp({ send: async () => {} }).listen(0);
const base = `http://localhost:${server.address().port}`;
const cookie = `jskit=${makeCookie('owner@test.com')}`;
test.after(() => server.close());
const post = path => fetch(base + path, { method: 'POST', headers: { cookie } });

const get = path => fetch(base + path, { headers: { cookie } });
const switchScript = join(projectDir, 'render', 'switch-design.sh');
mkdirSync(join(projectDir, 'render'));
writeFileSync(switchScript, '#!/bin/sh\n');

test('design start is refused, plainly, for a project without the design scripts', async () => {
  rmSync(switchScript);
  const r = await post('/api/design/start');
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /does not have/);
  assert.equal((await (await get('/api/setup')).json()).canChangeDesign, false);
  writeFileSync(switchScript, '#!/bin/sh\n');
  assert.equal((await (await get('/api/setup')).json()).canChangeDesign, true);
});

test('design start is refused while setup is pending', async () => {
  writeFileSync(join(projectDir, 'SETUP.md'), '# Setup incomplete');
  const r = await post('/api/design/start');
  assert.equal(r.status, 409);
  rmSync(join(projectDir, 'SETUP.md'));
});

test('design start opens one CV design conversation with one opening turn, however often pressed', async () => {
  const a = await (await post('/api/design/start')).json();
  const b = await (await post('/api/design/start')).json();
  assert.equal(a.id, b.id);
  const db = getDb();
  const s = db.prepare('select * from sessions where id = ?').get(a.id);
  assert.equal(s.kind, 'design');
  assert.equal(s.title, 'CV design');
  assert.equal(s.status, 'working');
  const jobs = db.prepare('select prompt from jobs where session_id = ?').all(a.id);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].prompt, DESIGN_OPENING_PROMPT);
});

test('an archived design conversation is not reopened', async () => {
  const db = getDb();
  const first = (await (await post('/api/design/start')).json()).id;
  db.prepare('update sessions set archived = 1 where id = ?').run(first);
  const second = (await (await post('/api/design/start')).json()).id;
  assert.notEqual(first, second);
});

test('the opening prompt carries the CV templates link', () => {
  assert.ok(DESIGN_OPENING_PROMPT.includes(DESIGN_CATEGORY_URL));
});
