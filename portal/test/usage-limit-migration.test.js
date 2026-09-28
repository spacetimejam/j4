import test from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// A real file, so a jobs table in its old shape exists before getDb() runs.
const dbPath = join(mkdtempSync(join(tmpdir(), 'limitmig-')), 'portal.db');
process.env.DB_PATH = dbPath;
const seed = new Database(dbPath);
seed.exec(`
  create table jobs (
    id text primary key,
    session_id text not null,
    prompt text not null,
    status text not null default 'queued',
    error text,
    created_at text not null default (datetime('now'))
  );
  insert into jobs (id, session_id, prompt, status, error) values ('j1', 's1', 'p', 'failed', 'boom');
`);
seed.close();

const { getDb } = await import('../src/db.js');

test('usage-limit columns are added to an existing jobs table, leaving rows intact', () => {
  const cols = getDb().prepare('pragma table_info(jobs)').all().map(c => c.name);
  for (const c of ['failure_kind', 'resets_at', 'resets_at_exact', 'limit_type']) assert.ok(cols.includes(c), c);
  const row = getDb().prepare("select * from jobs where id = 'j1'").get();
  assert.equal(row.error, 'boom');
  assert.equal(row.failure_kind, null);
});
