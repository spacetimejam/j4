import express from 'express';
import { basename, sep } from 'node:path';
import { realpathSync } from 'node:fs';
import { getDb, newId } from './db.js';
import { config } from './config.js';
import { checkConfig } from './preflight.js';
import { issueToken, redeemToken, makeCookie, requireAuth } from './auth.js';
import { sendEmail } from './email.js';
import { enqueue, startWorker, stopWorker } from './queue.js';
import { getUser } from './users.js';
import { isLocal, localHostGuard } from './local.js';
import { deriveApplicationFolder, recordDeletion, removeFolder, folderNoteFor } from './deletion.js';
import { readTracker, stageFor } from './tracker.js';
import { setupPending, findSetupSession, startSetupSession } from './setup-session.js';
import { saveUpload, MAX_UPLOAD_BYTES } from './upload.js';
import { fileURLToPath } from 'node:url';

// The kit checkout this portal runs from, resolved, so bin/jawbs-open can
// tell its own Jawbs from another copy answering on the same port.
const KIT_DIR = realpathSync(fileURLToPath(new URL('../..', import.meta.url)));

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

export const INACTIVE_DAYS = 28;

/* The pill shows where the application stands, from the tracker, except while a
   turn is running. Inactive is derived here rather than stored: nothing has to
   maintain it and it clears itself on the next reply. */
function withStage(session, rows) {
  if (session.status === 'working') return { ...session, stage: 'working' };
  const stage = stageFor(session.title, rows);
  if (stage !== 'applying') return { ...session, stage };
  /* SQLite's YYYY-MM-DD HH:MM:SS carries no zone marker and Date reads that
     shape as local time, so the Z is what makes this UTC, as in formatLondon.
     A malformed timestamp gives NaN, which fails the comparison and leaves the
     session on applying, which is the safer answer. */
  const age = Date.now() - Date.parse(`${String(session.updated_at).replace(' ', 'T')}Z`);
  return { ...session, stage: age > INACTIVE_DAYS * 86400000 ? 'inactive' : 'applying' };
}

// Prepended once when a blocked draft is retried, so Claude resumes the draft
// rather than reading the repeated message as new.
export const DRAFT_RETRY_PREFIX = 'Retrying after the writer was unavailable: carry on with the draft.\n\n';

// Which failure kind each retryable session status is waiting on.
const RETRYABLE = { usage_limited: 'usage_limit', drafting_blocked: 'drafting_blocked', signed_out: 'signed_out' };

// The failed turn a delayed session is waiting on, or null. Only the latest
// job counts: once the user sends something newer, the notice is stale.
// rowid breaks ties between jobs created in the same second.
function delayedFor(db, session) {
  const kind = RETRYABLE[session.status];
  if (!kind) return null;
  const job = db.prepare('select * from jobs where session_id = ? order by created_at desc, rowid desc limit 1')
    .get(session.id);
  if (!job || job.status !== 'failed' || job.failure_kind !== kind) return null;
  if (kind === 'signed_out') return { jobId: job.id, kind: 'signed_out' };
  if (kind === 'drafting_blocked') {
    return {
      jobId: job.id, kind: 'drafting', draftingKind: job.limit_type || 'error',
      resetsAt: job.resets_at, exact: job.resets_at_exact === 1, limitType: 'unknown',
    };
  }
  return {
    jobId: job.id,
    kind: 'usage_limit',
    resetsAt: job.resets_at,
    exact: job.resets_at_exact === 1,
    limitType: job.limit_type || 'unknown',
  };
}

export function createApp({ send = sendEmail, quit = null } = {}) {
  const app = express();
  const local = isLocal();
  // Before static files: a rebinding attack's first request is for index.html.
  if (local) app.use(localHostGuard);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(new URL('../public', import.meta.url).pathname));

  app.get('/api/meta', (req, res) => res.json(local ? { title: config.portalTitle, local: true, kit: KIT_DIR } : { title: config.portalTitle }));

  if (!local) {
    // Local mode has no sign-in, so the login routes do not exist there.
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
  }

  app.get('/api/me', requireAuth, (req, res) => res.json({ email: req.userEmail }));

  app.get('/api/setup', requireAuth, (req, res) => {
    const pending = setupPending(getUser(req.userEmail)?.projectDir);
    const session = findSetupSession(getDb(), req.userEmail);
    res.json({ pending, sessionId: session?.id ?? null });
  });

  app.post('/api/setup/start', requireAuth, (req, res) => {
    if (!setupPending(getUser(req.userEmail)?.projectDir)) return res.status(409).json({ error: 'setup is complete' });
    res.json({ id: startSetupSession(getDb(), req.userEmail).id });
  });

  app.get('/api/sessions', requireAuth, (req, res) => {
    const archived = req.query.archived === '1' ? 1 : 0;
    const rows = getDb()
      .prepare('select * from sessions where user_email = ? and archived = ? order by updated_at desc')
      .all(req.userEmail, archived);
    const tracker = readTracker(getUser(req.userEmail)?.projectDir);
    res.json(rows.map(s => withStage(s, tracker)));
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
    const user = getUser(req.userEmail);
    const tracker = readTracker(user?.projectDir);
    const docs = db.prepare(
      'select * from documents where session_id = ? and message_id is not null'
    ).all(session.id);
    const docsByMsg = {};
    for (const d of docs) (docsByMsg[d.message_id] ??= []).push(d);
    const enriched = messages.map(m => {
      const msgDocs = docsByMsg[m.id];
      if (!msgDocs) return m;
      return { ...m, docs: msgDocs.map(d => ({
        id: d.id,
        name: basename(d.path),
        available: resolveOwnedFile(d.path, user) !== null,
      })) };
    });
    res.json({ ...withStage(session, tracker), messages: enriched, files, delayed: delayedFor(db, session) });
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

  // Sends the waiting message again. The same job is requeued rather than a new
  // one added, so the user's message is not duplicated in the history.
  app.post('/api/sessions/:id/retry', requireAuth, (req, res) => {
    const db = getDb();
    const session = getOwnSession(db, req.params.id, req.userEmail);
    if (!session) return res.status(404).json({ error: 'not found' });
    const retried = db.transaction(() => {
      const delayed = delayedFor(db, session);
      if (!delayed) return false;
      const prompt = db.prepare('select prompt from jobs where id = ?').get(delayed.jobId).prompt;
      const next = delayed.kind === 'drafting' && !prompt.startsWith(DRAFT_RETRY_PREFIX)
        ? DRAFT_RETRY_PREFIX + prompt : prompt;
      db.prepare(`update jobs set status = 'queued', prompt = ?, error = null, failure_kind = null,
          resets_at = null, resets_at_exact = null, limit_type = null where id = ?`).run(next, delayed.jobId);
      db.prepare("update sessions set status = 'working', updated_at = datetime('now') where id = ?").run(session.id);
      return true;
    })();
    if (!retried) return res.status(409).json({ error: 'nothing to retry' });
    res.json({ ok: true });
  });

  // Setup sessions only: the CV that SETUP.md asks for. Raw body rather than
  // multipart, so no new dependency; the name travels in X-Filename.
  app.post('/api/sessions/:id/upload', requireAuth,
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
    (req, res) => {
      const session = getOwnSession(getDb(), req.params.id, req.userEmail);
      if (!session) return res.status(404).json({ error: 'not found' });
      if (session.kind !== 'setup') return res.status(409).json({ error: 'uploads are for Getting started only' });
      if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'empty file' });
      // A signed cookie can outlive its registry entry (registry is re-read
      // per lookup, so a removal takes effect with no matching session
      // cleanup); treat that the same as no session, not a crash.
      const user = getUser(req.userEmail);
      if (!user) return res.status(404).json({ error: 'not found' });
      let name;
      try { name = decodeURIComponent(String(req.headers['x-filename'] || '')); } catch { name = ''; }
      try {
        res.json({ path: saveUpload(user.projectDir, name, req.body) });
      } catch (err) {
        if (err.code === 'bad_type') return res.status(415).json({ error: err.message });
        if (err.code === 'outside') return res.status(400).json({ error: err.message });
        throw err;
      }
    });

  // Local only: the page's Quit Jawbs link. Answers first, then stops, so the
  // page can say goodbye; the worker finishes any turn in hand before exit.
  if (local && quit) {
    app.post('/api/quit', requireAuth, (req, res) => {
      res.json({ ok: true });
      setImmediate(() => { quit(); });
    });
  }

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const issues = checkConfig(config);
  for (const issue of issues) {
    const prefix = issue.level === 'error' ? 'ERROR' : 'WARNING';
    console[issue.level === 'error' ? 'error' : 'warn'](`${prefix}: ${issue.message}`);
  }
  if (issues.some(issue => issue.level === 'error')) {
    console.error('\nThe portal did not start. Fix the errors above and try again.');
    console.error('Setup guidance: docs/portal.md and docs/portal-remote-access.md');
    process.exit(1);
  }
  const server = createApp({
    quit: async () => {
      console.log('Quit requested: finishing any reply in progress, then stopping.');
      await stopWorker();
      server.close(() => process.exit(0));
    },
  }).listen(config.port, config.bindHost, () =>
    console.log(`${config.portalTitle} on ${config.bindHost}:${config.port}`));
  startWorker();
}
