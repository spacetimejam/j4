import { readFileSync } from 'node:fs';
import { config } from './config.js';

// The registry is read on every call: it is tiny, and live edits (adding a
// user, revoking one) must take effect without a restart. If the file is
// missing, fall back to the legacy single-user env configuration so old
// installs keep working unchanged.
function loadUsers() {
  let raw;
  try {
    raw = readFileSync(config.usersFile, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return legacyUsers();
    throw err;
  }
  const parsed = JSON.parse(raw);
  const users = {};
  for (const [email, u] of Object.entries(parsed)) {
    if (!u || typeof u.name !== 'string' || typeof u.projectDir !== 'string') {
      throw new Error(`users file: entry for ${email} needs "name" and "projectDir" strings`);
    }
    users[email.trim().toLowerCase()] = { name: u.name, projectDir: u.projectDir, admin: !!u.admin };
  }
  return users;
}

function legacyUsers() {
  const users = {};
  config.allowedEmails.forEach((email, i) => {
    users[email] = { name: config.userName, projectDir: config.projectDir, admin: i === 0 };
  });
  return users;
}

export function getUser(email) {
  return loadUsers()[String(email || '').trim().toLowerCase()] || null;
}

export function allowedEmails() {
  return Object.keys(loadUsers());
}

export function adminEmails() {
  const users = loadUsers();
  const admins = Object.keys(users).filter(e => users[e].admin);
  return admins.length ? admins : Object.keys(users);
}
