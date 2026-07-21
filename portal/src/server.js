import express from 'express';
import { basename, sep } from 'node:path';
import { realpathSync } from 'node:fs';
import { getDb, newId } from './db.js';
import { config } from './config.js';
import { issueToken, redeemToken, makeCookie, requireAuth } from './auth.js';
import { sendEmail } from './email.js';
import { enqueue, startWorker } from './queue.js';
import { getUser } from './users.js';
import { deriveApplicationFolder, recordDeletion, removeFolder, folderNoteFor } from './deletion.js';

// Look up a session only if it belongs to the requesting user. Missing and
// forbidden are deliberately the same answer (404) so the API never confirms
// that someone else's session id exists.
function getOwnSession(db, id, email) {
  return db.prepare('select * from sessions where id = ? and user_email = ?').get(id, email);
}

// Resolve a recorded absolute path, but only if it is inside the user's own
// project directory after symlinks are followed. realpathSync throws for a
// missing path, so a deleted file resolves to null and is reported as
// unavailable rather than offered as a broken download.
function resolveOwnedFile(path, user) {
  if (!path || !user?.projectDir) return null;
  let real, root;
  try {
    real = realpathSync(path);
    root = realpathSync(user.projectDir);
  } catch {
    return null;
  }
  if (real !== root && !real.startsWith(root + sep)) return null;
  return real;
}

export function createApp({ send = sendEmail } = {}) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(new URL('../public', import.meta.url).pathname));

  app.get('/api/meta', (req, res) => res.json({ title: config.portalTitle }));

  app.post('/api/login', async (req, res) => {
    const token = issueToken(req.body?.email);
    if (token) {
      const link = `${config.baseUrl}/auth/${token}`;
      try {
        await send({
          to: String(req.body.email).toLowerCase(),
          subject: `Your ${config.portalTitle} login link`,
          text: `Hello! Click to log in (valid for 15 minutes): ${link}`,
          attachments: [],
        });
      } catch (err) { console.error('login email failed:', err); }
    }
    res.json({ ok: true }); // same response either way; no allowlist oracle
  });

  app.get('/auth/:token', (req, res) => {
    const email = redeemToken(req.params.token);
    if (!email) return res.status(400).send('This link has expired. Please request a new one.');
    res.setHeader('Set-Cookie',
      `jskit=${makeCookie(email)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${90 * 86400}`);
    res.redirect('/');
  });

  app.get('/api/me', requireAuth, (req, res) => res.json({ email: req.userEmail }));

  app.get('/api/sessions', requireAuth, (req, res) => {
    const archived = req.query.archived === '1' ? 1 : 0;
    const rows = getDb()
      .prepare('select * from sessions where user_email = ? and archived = ? order by updated_at desc')
      .all(req.userEmail, archived);
    res.json(rows);
  });

  function setArchived(req, res, value) {
    const db = getDb();
    const session = getOwnSession(db, req.params.id, req.userEmail);
    if (!session) return res.status(404).json({ error: 'not found' });
    db.prepare('update sessions set archived = ? where id = ?').run(value, session.id);
    res.json({ ok: true });
  }
  app.post('/api/sessions/:id/archive', requireAuth, (req, res) => setArchived(req, res, 1));
  app.post('/api/sessions/:id/restore', requireAuth, (req, res) => setArchived(req, res, 0));

  app.delete('/api/sessions/:id', requireAuth, (req, res) => {
    const db = getDb();
    const session = getOwnSession(db, req.params.id, req.userEmail);
    if (!session) return res.status(404).json({ error: 'not found' });
    if (!session.archived) return res.status(409).json({ error: 'archive before deleting' });
    const user = getUser(req.userEmail);
    const messageCount = db.prepare('select count(*) c from messages where session_id = ?').get(session.id).c;
    const folder = deriveApplicationFolder(session, user);
    let folderNote = folderNoteFor(folder);
    if (folder) {
      try {
        removeFolder(folder);
      } catch (err) {
        console.error('folder removal failed:', err);
        folderNote = `${folderNote} (removal failed, folder left in place)`;
      }
    }
    try {
      recordDeletion({
        projectDir: user.projectDir, title: session.title, userName: user.name,
        folderNote, messageCount, createdAt: session.created_at,
      });
    } catch (err) { console.error('DELETED.md write failed:', err); }
    db.prepare('delete from documents where session_id = ?').run(session.id);
    db.prepare('delete from jobs where session_id = ?').run(session.id);
    db.prepare('delete from messages where session_id = ?').run(session.id);
    db.prepare('delete from sessions where id = ?').run(session.id);
    res.json({ ok: true });
  });

  app.post('/api/sessions', requireAuth, (req, res) => {
    const jd = req.body?.jd?.trim();
    if (!jd) return res.status(400).json({ error: 'jd required' });
    const isLink = /^https?:\/\/\S+$/.test(jd);
    const firstLine = jd.split('\n').find(l => l.trim())?.trim() || 'New application';
    const title = isLink
      ? jd.replace(/^https?:\/\//, '').slice(0, 80)
      : firstLine.slice(0, 80);
    const id = newId();
    const db = getDb();
    db.prepare("insert into sessions (id, user_email, title, status) values (?, ?, ?, 'working')")
      .run(id, req.userEmail, title);
    db.prepare('insert into messages (id, session_id, role, body) values (?, ?, ?, ?)')
      .run(newId(), id, 'user', jd);
    const userName = getUser(req.userEmail)?.name || 'the user';
    const prompt = isLink
      ? `${userName} has sent a link to a job listing via the portal. Fetch the job description from this URL (use WebFetch; if the page is blocked or empty, ask for the text to be pasted instead), then proceed as with any new job description.\n\n${jd}`
      : `New job description from ${userName} via the portal.\n\n${jd}`;
    enqueue({ sessionId: id, prompt });
    res.json({ id });
  });

  app.get('/api/sessions/:id', requireAuth, (req, res) => {
    const db = getDb();
    const session = getOwnSession(db, req.params.id, req.userEmail);
    if (!session) return res.status(404).json({ error: 'not found' });
    const messages = db.prepare('select * from messages where session_id = ? order by created_at').all(session.id);
    const files = (JSON.parse(session.files || '[]')).map((p, idx) => ({ idx, name: basename(p) }));
    res.json({ ...session, messages, files });
  });

  app.get('/api/sessions/:id/files/:idx', requireAuth, (req, res) => {
    const session = getOwnSession(getDb(), req.params.id, req.userEmail);
    if (!session) return res.status(404).json({ error: 'not found' });
    const paths = JSON.parse(session.files || '[]');
    const idx = Number(req.params.idx);
    if (!Number.isInteger(idx) || idx < 0 || idx >= paths.length) return res.status(404).json({ error: 'not found' });
    const real = resolveOwnedFile(paths[idx], getUser(req.userEmail));
    if (!real) return res.status(404).json({ error: 'not found' });
    res.download(real, basename(real), err => {
      if (err && !res.headersSent) res.status(404).json({ error: 'file unavailable' });
    });
  });

  app.get('/api/sessions/:id/documents', requireAuth, (req, res) => {
    const db = getDb();
    const session = getOwnSession(db, req.params.id, req.userEmail);
    if (!session) return res.status(404).json({ error: 'not found' });
    const user = getUser(req.userEmail);
    const rows = db.prepare('select * from documents where session_id = ? order by delivered_at desc, rowid asc')
      .all(session.id);
    res.json(rows.map(r => ({
      id: r.id,
      name: basename(r.path),
      delivered_at: r.delivered_at,
      available: resolveOwnedFile(r.path, user) !== null,
    })));
  });

  app.get('/api/sessions/:id/documents/:docId', requireAuth, (req, res) => {
    const db = getDb();
    const session = getOwnSession(db, req.params.id, req.userEmail);
    if (!session) return res.status(404).json({ error: 'not found' });
    const row = db.prepare('select * from documents where id = ? and session_id = ?')
      .get(req.params.docId, session.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    const real = resolveOwnedFile(row.path, getUser(req.userEmail));
    if (!real) return res.status(404).json({ error: 'not found' });
    res.download(real, basename(real), err => {
      if (err && !res.headersSent) res.status(404).json({ error: 'file unavailable' });
    });
  });

  app.post('/api/sessions/:id/reply', requireAuth, (req, res) => {
    const body = req.body?.body?.trim();
    if (!body) return res.status(400).json({ error: 'body required' });
    const db = getDb();
    const session = getOwnSession(db, req.params.id, req.userEmail);
    if (!session) return res.status(404).json({ error: 'not found' });
    db.prepare('insert into messages (id, session_id, role, body) values (?, ?, ?, ?)')
      .run(newId(), session.id, 'user', body);
    db.prepare("update sessions set status = 'working', updated_at = datetime('now') where id = ?").run(session.id);
    const userName = getUser(req.userEmail)?.name || 'the user';
    enqueue({ sessionId: session.id, prompt: `${userName} replies via the portal:\n\n${body}` });
    res.json({ ok: true });
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createApp().listen(config.port, () => console.log(`${config.portalTitle} on :${config.port}`));
  startWorker();
}
