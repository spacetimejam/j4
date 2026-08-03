import test from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dbPath = join(mkdtempSync(join(tmpdir(), 'msgidmig-')), 'portal.db');
process.env.DB_PATH = dbPath;

// Seed a database in the shape it had before this feature: documents exists
// (from the earlier migration) but has no message_id column. Include sessions
// and messages so the backfill has something to match against.
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
  create table messages (
    id text primary key,
    session_id text not null references sessions(id),
    role text not null,
    body text not null,
    created_at text not null default (datetime('now'))
  );
  create table documents (
    id text primary key,
    session_id text not null references sessions(id),
    path text not null,
    delivered_at text not null default (datetime('now'))
  );
  create unique index if not exists documents_session_path
    on documents (session_id, path);
  create table meta (key text primary key, value text);
  insert into meta (key, value) values ('documents_backfill_done', '2026-07-21 00:00:00');
`);
// Session with a Claude message and a document delivered at the same time
seed.prepare(`insert into sessions (id, user_email, title)
  values ('s1', 'a@b.c', 'Role one')`).run();
seed.prepare(`insert into messages (id, session_id, role, body, created_at)
  values ('msg1', 's1', 'claude', 'Here are your docs.', '2026-07-20 12:00:00')`).run();
seed.prepare(`insert into documents (id, session_id, path, delivered_at)
  values ('doc1', 's1', '/tmp/cv.pdf', '2026-07-20 12:00:00')`).run();
// A second document delivered later, with a second Claude message
seed.prepare(`insert into messages (id, session_id, role, body, created_at)
  values ('msg2', 's1', 'claude', 'Updated pack.', '2026-07-21 10:00:00')`).run();
seed.prepare(`insert into documents (id, session_id, path, delivered_at)
  values ('doc2', 's1', '/tmp/letter.pdf', '2026-07-21 10:00:00')`).run();
// A document with no matching Claude message (delivered before any message)
seed.prepare(`insert into sessions (id, user_email, title)
  values ('s2', 'a@b.c', 'Role two')`).run();
seed.prepare(`insert into documents (id, session_id, path, delivered_at)
  values ('doc3', 's2', '/tmp/orphan.pdf', '2026-07-19 08:00:00')`).run();
seed.close();

const { getDb } = await import('../src/db.js');

test('backfill sets message_id on documents with a matching Claude message', () => {
  const db = getDb();
  const doc1 = db.prepare("select message_id from documents where id = 'doc1'").get();
  assert.equal(doc1.message_id, 'msg1');
  const doc2 = db.prepare("select message_id from documents where id = 'doc2'").get();
  assert.equal(doc2.message_id, 'msg2');
});

test('a document with no matching Claude message keeps message_id null', () => {
  const doc3 = getDb().prepare("select message_id from documents where id = 'doc3'").get();
  assert.equal(doc3.message_id, null);
});

test('backfill does not rerun after a message_id is cleared', async () => {
  const db = getDb();
  db.prepare("update documents set message_id = null where id = 'doc1'").run();
  db.close();
  const again = await import(`../src/db.js?rerun=${Date.now()}`);
  const doc1 = again.getDb().prepare("select message_id from documents where id = 'doc1'").get();
  assert.equal(doc1.message_id, null);
});
