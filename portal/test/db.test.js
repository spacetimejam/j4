import test from 'node:test';
import assert from 'node:assert';
process.env.DB_PATH = ':memory:';
const { getDb, newId } = await import('../src/db.js');

test('schema tables exist', () => {
  const db = getDb();
  const names = db.prepare("select name from sqlite_master where type='table'").all().map(r => r.name);
  for (const t of ['users', 'sessions', 'messages', 'tokens', 'jobs']) assert.ok(names.includes(t), t);
});

test('newId is 32 hex chars and unique', () => {
  const a = newId(), b = newId();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b);
});

test('sessions table has an archived column defaulting to 0', () => {
  const db = getDb();
  const cols = db.prepare('pragma table_info(sessions)').all();
  const col = cols.find(c => c.name === 'archived');
  assert.ok(col, 'archived column exists');
  db.prepare("insert into sessions (id, user_email, title) values ('arch-col-test', 'a@b.c', 'T')").run();
  assert.equal(db.prepare("select archived from sessions where id = 'arch-col-test'").get().archived, 0);
});

test('documents table exists with a unique session/path index', () => {
  const db = getDb();
  const names = db.prepare("select name from sqlite_master where type='table'").all().map(r => r.name);
  assert.ok(names.includes('documents'), 'documents table exists');
  const cols = db.prepare('pragma table_info(documents)').all().map(c => c.name);
  for (const c of ['id', 'session_id', 'path', 'delivered_at']) assert.ok(cols.includes(c), c);
  const idx = db.prepare("select name from sqlite_master where type='index' and tbl_name='documents'")
    .all().map(r => r.name);
  assert.ok(idx.includes('documents_session_path'));
});

test('documents rows get a default delivered_at and reject duplicate paths', () => {
  const db = getDb();
  db.prepare("insert into sessions (id, user_email, title) values ('doc-col-test', 'a@b.c', 'T')").run();
  db.prepare('insert into documents (id, session_id, path) values (?, ?, ?)')
    .run(newId(), 'doc-col-test', '/tmp/cv.pdf');
  const row = db.prepare("select * from documents where session_id = 'doc-col-test'").get();
  assert.match(row.delivered_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.throws(
    () => db.prepare('insert into documents (id, session_id, path) values (?, ?, ?)')
      .run(newId(), 'doc-col-test', '/tmp/cv.pdf'),
    /UNIQUE/,
  );
});
