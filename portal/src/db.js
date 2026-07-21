import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';

let db;

const SCHEMA = `
create table if not exists users (
  email text primary key,
  name text
);
create table if not exists sessions (
  id text primary key,
  user_email text not null,
  title text not null,
  claude_session_id text,
  status text not null default 'active', -- active | working | awaiting_reply | done | needs_attention
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);
create table if not exists messages (
  id text primary key,
  session_id text not null references sessions(id),
  role text not null, -- 'user' | 'claude' | 'system'
  body text not null,
  created_at text not null default (datetime('now'))
);
create table if not exists tokens (
  token text primary key,
  email text not null,
  expires_at text not null,
  used integer not null default 0
);
create table if not exists jobs (
  id text primary key,
  session_id text not null references sessions(id),
  prompt text not null,
  status text not null default 'queued', -- queued | running | done | failed
  error text,
  created_at text not null default (datetime('now'))
);
create table if not exists documents (
  id text primary key,
  session_id text not null references sessions(id),
  path text not null,
  delivered_at text not null default (datetime('now'))
);
create unique index if not exists documents_session_path
  on documents (session_id, path);
`;

export function getDb() {
  if (!db) {
    db = new Database(config.dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(SCHEMA);
    // guarded migration for databases created before deliverable downloads existed
    const cols = db.prepare('pragma table_info(sessions)').all();
    if (!cols.some(c => c.name === 'files')) {
      db.exec('alter table sessions add column files text'); // JSON array of absolute paths
    }
    if (!cols.some(c => c.name === 'archived')) {
      db.exec('alter table sessions add column archived integer not null default 0');
    }
    // One-time backfill for databases that predate the documents table: the
    // files column holds only the most recent delivery, so this is the whole
    // history we can recover. updated_at is the closest available date, being
    // last activity rather than delivery, and is only ever shown as a caption.
    if (db.prepare('select count(*) c from documents').get().c === 0) {
      const rows = db.prepare("select id, files, updated_at from sessions where files is not null and files != ''").all();
      const insert = db.prepare('insert or ignore into documents (id, session_id, path, delivered_at) values (?, ?, ?, ?)');
      const backfill = db.transaction(() => {
        for (const row of rows) {
          let paths;
          try {
            paths = JSON.parse(row.files);
          } catch {
            continue; // a malformed column must not stop the server starting
          }
          if (!Array.isArray(paths)) continue;
          for (const p of paths) {
            if (typeof p === 'string' && p) insert.run(newId(), row.id, p, row.updated_at);
          }
        }
      });
      backfill();
    }
  }
  return db;
}

export function newId() {
  return randomBytes(16).toString('hex');
}
