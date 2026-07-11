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
