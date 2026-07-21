import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const projectDir = mkdtempSync(join(tmpdir(), 'proj-'));
process.env.PROJECT_DIR = projectDir;
process.env.DB_PATH = ':memory:';
// Point the user registry at a missing file so a real data/users.json on the
// host cannot shadow the ALLOWED_EMAILS fallback these tests rely on.
process.env.PORTAL_USERS_FILE = '/nonexistent-portal-users.json';
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
const operatorCookie = `jskit=${makeCookie('operator@test.com')}`;

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
  const p = join(projectDir, 'cv-tailored-dl-test.md');
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

test('file downloads are confined to the user projectDir', async () => {
  const inside = join(projectDir, 'cv.pdf');
  writeFileSync(inside, 'pdf-bytes');
  const r = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ jd: 'Download test role' }),
  });
  const { id } = await r.json();
  getDb().prepare('update sessions set files = ? where id = ?')
    .run(JSON.stringify([inside, '/etc/passwd']), id);

  const ok = await fetch(`${base}/api/sessions/${id}/files/0`, { headers: { cookie: ownerCookie } });
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), 'pdf-bytes');

  const evil = await fetch(`${base}/api/sessions/${id}/files/1`, { headers: { cookie: ownerCookie } });
  assert.equal(evil.status, 404);
});

test('users see only their own sessions', async () => {
  // owner creates a session
  const r = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ jd: 'Isolation test role' }),
  });
  const { id } = await r.json();

  // operator's list must not contain it
  const list = await (await fetch(`${base}/api/sessions`, { headers: { cookie: operatorCookie } })).json();
  assert.ok(!list.some(s => s.id === id));

  // and direct access, reply, and file download must 404, not 403
  assert.equal((await fetch(`${base}/api/sessions/${id}`, { headers: { cookie: operatorCookie } })).status, 404);
  assert.equal((await fetch(`${base}/api/sessions/${id}/reply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: operatorCookie },
    body: JSON.stringify({ body: 'peek' }),
  })).status, 404);
  assert.equal((await fetch(`${base}/api/sessions/${id}/files/0`, { headers: { cookie: operatorCookie } })).status, 404);

  // the owner still sees it
  assert.equal((await fetch(`${base}/api/sessions/${id}`, { headers: { cookie: ownerCookie } })).status, 200);
});

test('archive hides a session from the list; restore brings it back', async () => {
  const r = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ jd: 'Archive test role' }),
  });
  const { id } = await r.json();

  let a = await fetch(`${base}/api/sessions/${id}/archive`, { method: 'POST', headers: { cookie: ownerCookie } });
  assert.equal(a.status, 200);

  const list = await (await fetch(`${base}/api/sessions`, { headers: { cookie: ownerCookie } })).json();
  assert.ok(!list.some(s => s.id === id));
  const archived = await (await fetch(`${base}/api/sessions?archived=1`, { headers: { cookie: ownerCookie } })).json();
  assert.ok(archived.some(s => s.id === id));
  assert.ok(archived.every(s => s.archived === 1));

  a = await fetch(`${base}/api/sessions/${id}/restore`, { method: 'POST', headers: { cookie: ownerCookie } });
  assert.equal(a.status, 200);
  const back = await (await fetch(`${base}/api/sessions`, { headers: { cookie: ownerCookie } })).json();
  assert.ok(back.some(s => s.id === id));
});

test('users cannot archive or restore each other\'s sessions', async () => {
  const r = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ jd: 'Archive isolation role' }),
  });
  const { id } = await r.json();
  assert.equal((await fetch(`${base}/api/sessions/${id}/archive`, { method: 'POST', headers: { cookie: operatorCookie } })).status, 404);
  assert.equal((await fetch(`${base}/api/sessions/${id}/restore`, { method: 'POST', headers: { cookie: operatorCookie } })).status, 404);
});

async function createArchivedSession(jd) {
  const r = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ jd }),
  });
  const { id } = await r.json();
  await fetch(`${base}/api/sessions/${id}/archive`, { method: 'POST', headers: { cookie: ownerCookie } });
  return id;
}

test('delete refuses non-archived sessions with 409', async () => {
  const r = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ jd: 'Not archived yet' }),
  });
  const { id } = await r.json();
  const d = await fetch(`${base}/api/sessions/${id}`, { method: 'DELETE', headers: { cookie: ownerCookie } });
  assert.equal(d.status, 409);
});

test('delete removes rows, the application folder, and writes DELETED.md', async () => {
  const folder = join(projectDir, 'applications', 'acme-designer');
  mkdirSync(folder, { recursive: true });
  const pdf = join(folder, 'cv.pdf');
  writeFileSync(pdf, 'pdf');
  const id = await createArchivedSession('Designer at Acme');
  getDb().prepare('update sessions set files = ? where id = ?').run(JSON.stringify([pdf]), id);

  const d = await fetch(`${base}/api/sessions/${id}`, { method: 'DELETE', headers: { cookie: ownerCookie } });
  assert.equal(d.status, 200);
  assert.equal(getDb().prepare('select count(*) c from sessions where id = ?').get(id).c, 0);
  assert.equal(getDb().prepare('select count(*) c from messages where session_id = ?').get(id).c, 0);
  assert.equal(getDb().prepare('select count(*) c from jobs where session_id = ?').get(id).c, 0);
  assert.ok(!existsSync(folder));
  const log = readFileSync(join(projectDir, 'applications', 'DELETED.md'), 'utf8');
  assert.match(log, /Designer at Acme/);
  assert.match(log, /applications\/acme-designer\//);
});

test('delete with no files removes rows only and logs none found', async () => {
  const id = await createArchivedSession('No files role');
  const d = await fetch(`${base}/api/sessions/${id}`, { method: 'DELETE', headers: { cookie: ownerCookie } });
  assert.equal(d.status, 200);
  assert.equal(getDb().prepare('select count(*) c from sessions where id = ?').get(id).c, 0);
  const log = readFileSync(join(projectDir, 'applications', 'DELETED.md'), 'utf8');
  assert.match(log, /No files role/);
  assert.match(log, /none found/);
});

test('users cannot delete each other\'s sessions', async () => {
  const id = await createArchivedSession('Delete isolation role');
  assert.equal((await fetch(`${base}/api/sessions/${id}`, { method: 'DELETE', headers: { cookie: operatorCookie } })).status, 404);
});

test('documents list is newest first, owner-scoped, and flags missing files', async () => {
  const present = join(projectDir, 'kept.pdf');
  writeFileSync(present, 'kept-bytes');
  const gone = join(projectDir, 'gone.pdf');
  const r = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ jd: 'Documents list role' }),
  });
  const { id } = await r.json();
  const ins = getDb().prepare('insert into documents (id, session_id, path, delivered_at) values (?, ?, ?, ?)');
  ins.run('doc-old', id, present, '2026-07-01 09:00:00');
  ins.run('doc-new', id, gone, '2026-07-05 09:00:00');

  const docs = await (await fetch(`${base}/api/sessions/${id}/documents`, { headers: { cookie: ownerCookie } })).json();
  assert.deepStrictEqual(docs, [
    { id: 'doc-new', name: 'gone.pdf', delivered_at: '2026-07-05 09:00:00', available: false },
    { id: 'doc-old', name: 'kept.pdf', delivered_at: '2026-07-01 09:00:00', available: true },
  ]);

  assert.equal((await fetch(`${base}/api/sessions/${id}/documents`, { headers: { cookie: operatorCookie } })).status, 404);
  assert.equal((await fetch(`${base}/api/sessions/${id}/documents`)).status, 401);
});

test('a document downloads, and only for its own session and inside projectDir', async () => {
  const inside = join(projectDir, 'pack.pdf');
  writeFileSync(inside, 'pack-bytes');
  const mk = async jd => {
    const r = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ jd }),
    });
    return (await r.json()).id;
  };
  const idA = await mk('Doc download role A');
  const idB = await mk('Doc download role B');
  const ins = getDb().prepare('insert into documents (id, session_id, path) values (?, ?, ?)');
  ins.run('dl-ok', idA, inside);
  ins.run('dl-evil', idA, '/etc/passwd');
  ins.run('dl-other', idB, inside);

  const ok = await fetch(`${base}/api/sessions/${idA}/documents/dl-ok`, { headers: { cookie: ownerCookie } });
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), 'pack-bytes');

  // outside the project directory
  assert.equal((await fetch(`${base}/api/sessions/${idA}/documents/dl-evil`, { headers: { cookie: ownerCookie } })).status, 404);
  // a document id belonging to a different session
  assert.equal((await fetch(`${base}/api/sessions/${idA}/documents/dl-other`, { headers: { cookie: ownerCookie } })).status, 404);
  // an unknown document id
  assert.equal((await fetch(`${base}/api/sessions/${idA}/documents/nope`, { headers: { cookie: ownerCookie } })).status, 404);
  // another user
  assert.equal((await fetch(`${base}/api/sessions/${idA}/documents/dl-ok`, { headers: { cookie: operatorCookie } })).status, 404);
});

test('permanent delete removes the session documents rows', async () => {
  const id = await createArchivedSession('Doc cascade role');
  getDb().prepare('insert into documents (id, session_id, path) values (?, ?, ?)')
    .run('cascade-doc', id, join(projectDir, 'whatever.pdf'));
  const d = await fetch(`${base}/api/sessions/${id}`, { method: 'DELETE', headers: { cookie: ownerCookie } });
  assert.equal(d.status, 200);
  assert.equal(getDb().prepare('select count(*) c from documents where session_id = ?').get(id).c, 0);
});

test('documents delivered in the same second keep insertion order', async () => {
  const r = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ jd: 'Same-second documents role' }),
  });
  const { id } = await r.json();
  const ins = getDb().prepare('insert into documents (id, session_id, path, delivered_at) values (?, ?, ?, ?)');
  ins.run('same-sec-cv', id, join(projectDir, 'cv.pdf'), '2026-07-21 09:00:00');
  ins.run('same-sec-cover', id, join(projectDir, 'cover-letter.pdf'), '2026-07-21 09:00:00');

  const docs = await (await fetch(`${base}/api/sessions/${id}/documents`, { headers: { cookie: ownerCookie } })).json();
  assert.deepStrictEqual(docs.map(d => d.id), ['same-sec-cv', 'same-sec-cover']);
});

test.after(() => server.close());
