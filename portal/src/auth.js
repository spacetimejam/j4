import { createHmac, timingSafeEqual } from 'node:crypto';
import { getDb, newId } from './db.js';
import { config } from './config.js';
import { getUser } from './users.js';

const TOKEN_TTL_MIN = 15;
const COOKIE_TTL_DAYS = 90;

export function issueToken(email) {
  email = String(email || '').trim().toLowerCase();
  if (!getUser(email)) return null;
  const token = newId() + newId();
  getDb().prepare(
    "insert into tokens (token, email, expires_at) values (?, ?, datetime('now', ?))"
  ).run(token, email, `+${TOKEN_TTL_MIN} minutes`);
  return token;
}

export function redeemToken(token) {
  const db = getDb();
  const row = db.prepare(
    "select email from tokens where token = ? and used = 0 and expires_at > datetime('now')"
  ).get(token);
  if (!row) return null;
  db.prepare('update tokens set used = 1 where token = ?').run(token);
  return row.email;
}

function sign(payload) {
  return createHmac('sha256', config.cookieSecret).update(payload).digest('hex');
}

export function makeCookie(email) {
  const expires = Date.now() + COOKIE_TTL_DAYS * 86400_000;
  const payload = `${email}|${expires}`;
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
}

export function verifyCookie(value) {
  const [b64, sig] = String(value || '').split('.');
  if (!b64 || !sig) return null;
  let payload;
  try { payload = Buffer.from(b64, 'base64url').toString(); } catch { return null; }
  const expect = Buffer.from(sign(payload));
  const got = Buffer.from(sig);
  if (expect.length !== got.length || !timingSafeEqual(expect, got)) return null;
  const [email, expires] = payload.split('|');
  if (!email || Number(expires) < Date.now()) return null;
  return email;
}

export function requireAuth(req, res, next) {
  const raw = (req.headers.cookie || '').split(';').map(s => s.trim())
    .find(s => s.startsWith('jskit='));
  const email = raw ? verifyCookie(raw.slice(6)) : null;
  if (!email) return res.status(401).json({ error: 'not logged in' });
  req.userEmail = email;
  next();
}
