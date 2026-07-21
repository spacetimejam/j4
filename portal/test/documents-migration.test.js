import test from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// A real file on disk, not :memory:, so the database survives being closed and
// reopened. That is the only way to exercise a migration against pre-existing
// data.
const dbPath = join(mkdtempSync(join(tmpdir(), 'docsmig-')), 'portal.db');
process.env.DB_PATH = dbPath;

// Seed a database in the shape it had before this feature: sessions carry a
// files column, and no documents table exists.
const seed = new Database(dbPath);
seed.exec(`
  create table sessions (
    id text primary key,
    user_email text not null,
    title text not null,
    claude_session_id text,
    status text not null default 'active',
    created_at text not null default (datetime('now')),
    updated_at text not null default (datetime('now')),
    files text,
    archived integer not null default 0
  );
`);
seed.prepare(`insert into sessions (id, user_email, title, files, updated_at)
  values ('s1', 'a@b.c', 'Role one', ?, '2026-07-01 09:30:00')`)
  .run(JSON.stringify(['/tmp/cv.pdf', '/tmp/letter.pdf']));
seed.prepare(`insert into sessions (id, user_email, title, files, updated_at)
  values ('s2', 'a@b.c', 'Role two', ?, '2026-07-02 10:00:00')`)
  .run(JSON.stringify([]));
seed.prepare(`insert into sessions (id, user_email, title, updated_at)
  values ('s3', 'a@b.c', 'Role three', '2026-07-03 11:00:00')`)
  .run();
seed.close();

const { getDb } = await import('../src/db.js');

test('backfill copies existing files into documents, dated from updated_at', () => {
  const rows = getDb().prepare('select * from documents order by path').all();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.path), ['/tmp/cv.pdf', '/tmp/letter.pdf']);
  assert.ok(rows.every(r => r.session_id === 's1'));
  assert.ok(rows.every(r => r.delivered_at === '2026-07-01 09:30:00'));
});

test('sessions with no files or a null files column are skipped', () => {
  const other = getDb().prepare("select count(*) c from documents where session_id in ('s2','s3')").get();
  assert.equal(other.c, 0);
});

test('backfill does not rerun and does not resurrect deleted rows', async () => {
  const db = getDb();
  db.prepare('delete from documents').run();
  db.close();
  // The module caches its handle in a private variable, so the only way to make
  // getDb() open the file again is to evaluate a second copy of the module. The
  // query string is what defeats Node's module cache.
  const again = await import(`../src/db.js?rerun=${Date.now()}`);
  const rows = again.getDb().prepare('select path from documents').all();
  // The table being empty is exactly the state a "count(*) === 0" guard cannot
  // tell apart from "never backfilled", so this is the case that distinguishes
  // it from a durable marker: a real backfill-never-ran table would have rows
  // again after reopening; this one must stay empty.
  assert.deepEqual(rows, []);
});
