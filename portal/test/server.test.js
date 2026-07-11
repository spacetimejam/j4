import test from 'node:test';
import assert from 'node:assert';
process.env.DB_PATH = ':memory:';
process.env.ALLOWED_EMAILS = 'owner@test.com,operator@test.com';
process.env.COOKIE_SECRET = 'testsecret';
process.env.PORTAL_TITLE = 'Test Portal';
const { createApp } = await import('../src/server.js');
const { makeCookie } = await import('../src/auth.js');
const { getDb } = await import('../src/db.js');

let sentEmails = [];
const app = createApp({ send: async e => sentEmails.push(e) });
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const ownerCookie = `jskit=${makeCookie('owner@test.com')}`;

test('meta endpoint returns the configured title', async () => {
  const r = await fetch(`${base}/api/meta`);
  assert.deepEqual(await r.json(), { title: 'Test Portal' });
});

test('login always returns ok and emails link only for allowlisted', async () => {
  sentEmails = [];
  let r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@test.com' }) });
  assert.equal((await r.json()).ok, true);
  r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'evil@test.com' }) });
  assert.equal((await r.json()).ok, true);
  assert.equal(sentEmails.length, 1);
  assert.match(sentEmails[0].text, /\/auth\//);
  assert.equal(sentEmails[0].subject, 'Your Test Portal login link');
});

test('unauthenticated API is rejected', async () => {
  const r = await fetch(`${base}/api/sessions`);
  assert.equal(r.status, 401);
});

test('create session enqueues job and lists it', async () => {
  const r = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ jd: 'Senior Designer at Acme\nFull JD text' }),
  });
  const { id } = await r.json();
  assert.ok(id);
  assert.equal(getDb().prepare("select count(*) c from jobs where status='queued'").get().c, 1);
  const list = await (await fetch(`${base}/api/sessions`, { headers: { cookie: ownerCookie } })).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'Senior Designer at Acme');
  const detail = await (await fetch(`${base}/api/sessions/${id}`, { headers: { cookie: ownerCookie } })).json();
  assert.equal(detail.messages[0].role, 'user');
  assert.deepEqual(detail.files, []);
});

test('link-only submission gets a fetch prompt and URL title', async () => {
  const r = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ jd: 'https://example.com/jobs/senior-designer' }),
  });
  const { id } = await r.json();
  const session = getDb().prepare('select * from sessions where id = ?').get(id);
  assert.equal(session.title, 'example.com/jobs/senior-designer');
  const job = getDb().prepare('select * from jobs where session_id = ?').get(id);
  assert.match(job.prompt, /Fetch the job description/);
  assert.match(job.prompt, /https:\/\/example\.com\/jobs\/senior-designer/);
});

test('deliverable files are listed and downloadable, with bounds checks', async () => {
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const p = join(tmpdir(), 'cv-tailored-dl-test.md');
  writeFileSync(p, 'CV body');
  const r = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ jd: 'Role with files' }),
  });
  const { id } = await r.json();
  getDb().prepare('update sessions set files = ? where id = ?').run(JSON.stringify([p]), id);
  const detail = await (await fetch(`${base}/api/sessions/${id}`, { headers: { cookie: ownerCookie } })).json();
  assert.deepEqual(detail.files, [{ idx: 0, name: 'cv-tailored-dl-test.md' }]);
  const dl = await fetch(`${base}/api/sessions/${id}/files/0`, { headers: { cookie: ownerCookie } });
  assert.equal(dl.status, 200);
  assert.equal(await dl.text(), 'CV body');
  const bad = await fetch(`${base}/api/sessions/${id}/files/1`, { headers: { cookie: ownerCookie } });
  assert.equal(bad.status, 404);
  const noauth = await fetch(`${base}/api/sessions/${id}/files/0`);
  assert.equal(noauth.status, 401);
});

test.after(() => server.close());
