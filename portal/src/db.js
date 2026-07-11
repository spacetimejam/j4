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
  }
  return db;
}

export function newId() {
  return randomBytes(16).toString('hex');
}
