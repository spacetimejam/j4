import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const projectDir = mkdtempSync(join(tmpdir(), 'proj-'));
process.env.PROJECT_DIR = projectDir;
process.env.DB_PATH = ':memory:';
process.env.PORTAL_USERS_FILE = '/nonexistent-portal-users.json';
process.env.ALLOWED_EMAILS = 'owner@test.com,other@test.com';
process.env.COOKIE_SECRET = 'testsecret';
const { safeUploadName, saveUpload } = await import('../src/upload.js');
const { createApp } = await import('../src/server.js');
const { makeCookie } = await import('../src/auth.js');
const { getDb, newId } = await import('../src/db.js');

test('names are reduced to a safe basename with an allowed final extension', () => {
  assert.equal(safeUploadName('My CV (2026).pdf'), 'My CV -2026-.pdf');
  assert.equal(safeUploadName('../../etc/cv.docx'), 'cv.docx');
  assert.equal(safeUploadName('C:\\Users\\a\\cv.PDF'), 'cv.PDF');
  assert.equal(safeUploadName('%%%.pdf'), 'upload.pdf');
  assert.equal(safeUploadName('.pdf'), 'upload.pdf');
  assert.equal(safeUploadName('cv.pdf.exe'), null);
  assert.equal(safeUploadName('cv'), null);
  assert.equal(safeUploadName(''), null);
});

test('a very long name is cut to a safe length, keeping the extension', () => {
  const name = safeUploadName('a'.repeat(400) + '.docx');
  assert.equal(name, 'a'.repeat(120) + '.docx');
  // The clash suffix and the extension still fit well inside a 255-byte name.
  assert.ok(Buffer.byteLength(name) < 200);
  assert.ok(saveUpload(projectDir, 'b'.repeat(400) + '.pdf', Buffer.from('x')).endsWith('b'.repeat(120) + '.pdf'));
});

test('saveUpload writes into core/source and suffixes clashes', () => {
  const a = saveUpload(projectDir, 'cv.pdf', Buffer.from('one'));
  const b = saveUpload(projectDir, 'cv.pdf', Buffer.from('two'));
  const c = saveUpload(projectDir, 'cv.pdf', Buffer.from('three'));
  assert.deepEqual([a, b, c], ['core/source/cv.pdf', 'core/source/cv-2.pdf', 'core/source/cv-3.pdf']);
  assert.equal(readFileSync(join(projectDir, b), 'utf8'), 'two');
});

test('saveUpload refuses a core/source that leads outside the project', () => {
  const other = mkdtempSync(join(tmpdir(), 'proj-'));
  const outside = mkdtempSync(join(tmpdir(), 'outside-'));
  mkdirSync(join(other, 'core'));
  symlinkSync(outside, join(other, 'core', 'source'));
  assert.throws(() => saveUpload(other, 'cv.pdf', Buffer.from('x')), e => e.code === 'outside');
  assert.equal(existsSync(join(outside, 'cv.pdf')), false);
});

const server = createApp({ send: async () => {} }).listen(0);
const base = `http://localhost:${server.address().port}`;
test.after(() => server.close());
const cookieFor = e => `jskit=${makeCookie(e)}`;
function mk(kind, email = 'owner@test.com') {
  const id = newId();
  getDb().prepare('insert into sessions (id, user_email, title, kind) values (?, ?, ?, ?)').run(id, email, 't', kind);
  return id;
}
const upload = (id, name, body, email = 'owner@test.com') => fetch(`${base}/api/sessions/${id}/upload`, {
  method: 'POST',
  headers: { cookie: cookieFor(email), 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent(name) },
  body,
});

test('upload route saves to the setup session owner project', async () => {
  const r = await upload(mk('setup'), 'Résumé.pdf', Buffer.from('%PDF'));
  assert.equal(r.status, 200);
  const { path } = await r.json();
  assert.equal(path, 'core/source/R-sum-.pdf');
  assert.equal(readFileSync(join(projectDir, path), 'utf8'), '%PDF');
});

test('upload route refusals', async () => {
  assert.equal((await upload(mk('application'), 'cv.pdf', Buffer.from('x'))).status, 409);
  assert.equal((await upload(mk('setup', 'other@test.com'), 'cv.pdf', Buffer.from('x'))).status, 404);
  assert.equal((await upload(mk('setup'), 'cv.exe', Buffer.from('x'))).status, 415);
  assert.equal((await upload(mk('setup'), 'cv.pdf', Buffer.alloc(0))).status, 400);
  assert.equal((await upload(mk('setup'), 'big.pdf', Buffer.alloc(15 * 1024 * 1024 + 1))).status, 413);
});

test('upload route 404s for a valid cookie whose email has left the registry', async () => {
  // ALLOWED_EMAILS is only owner@test.com and other@test.com, so getUser()
  // returns null for this email even though makeCookie signs it happily and
  // getOwnSession finds the session by user_email alone (it does not consult
  // the registry). This is the getUser guard's own test, not getOwnSession's:
  // the session is inserted directly under the missing user's email so
  // ownership matches and the 404 can only come from the registry check.
  const r = await upload(mk('setup', 'ghost@test.com'), 'cv.pdf', Buffer.from('x'), 'ghost@test.com');
  assert.equal(r.status, 404);
});
