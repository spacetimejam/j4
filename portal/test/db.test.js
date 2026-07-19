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
