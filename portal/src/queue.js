import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { getDb, newId } from './db.js';
import { config } from './config.js';
import { runAgentTurn, parseEmailDirective, parseTitleDirective } from './agent.js';
import { sendEmail } from './email.js';
import { getUser, adminEmails } from './users.js';

export function enqueue({ sessionId, prompt }) {
  getDb().prepare('insert into jobs (id, session_id, prompt) values (?, ?, ?)')
    .run(newId(), sessionId, prompt);
}

// When a resumed turn fails (the Claude transcript may have been pruned), the
// retry runs in a fresh session that has no memory of the conversation. This
// prompt rebuilds that context from the portal's own message history.
export function buildRecoveryPrompt(session, messages, prompt) {
  const LABELS = { user: '[User]', claude: '[Claude]', system: '[Portal]' };
  const history = messages
    .map(m => `${LABELS[m.role] || `[${m.role}]`} ${m.body.slice(0, 2000)}`)
    .join('\n\n');
  return 'This is a resumed conversation whose earlier Claude session was lost. '
    + `Portal session title: ${session.title}. The conversation so far, oldest first:\n\n`
    + `${history}\n\n`
    + 'Re-orient yourself from the project tracker and the matching application folder '
    + 'before acting. Then handle the new message below as normal.\n\n'
    + prompt;
}

/* The Reply badge follows awaiting_reply, so the status has to mean "Claude
   asked you something that is still open", not merely "Claude stopped talking".
   The agent says which in its session-title block; when it says nothing we keep
   the old behaviour, because a silently missing badge hides a real question. */
function tryParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

export function sessionStatus({ email, awaitingUser }) {
  if (awaitingUser === true) return 'awaiting_reply';
  if (email) return 'done';
  return awaitingUser === false ? 'active' : 'awaiting_reply';
}

export async function processOneJob({ runTurn = runAgentTurn, send = sendEmail } = {}) {
  const db = getDb();
  const job = db.prepare("select * from jobs where status = 'queued' order by created_at limit 1").get();
  if (!job) return false;
  db.prepare("update jobs set status = 'running' where id = ?").run(job.id);
  const session = db.prepare('select * from sessions where id = ?').get(job.session_id);
  const user = getUser(session.user_email);
  try {
    if (!user) throw new Error(`no registered user for ${session.user_email}; add them to users.json`);
    let turn;
    try {
      turn = await runTurn({
        prompt: job.prompt,
        resumeSessionId: session.claude_session_id || null,
        user,
      });
    } catch (err) {
      // A resumed turn can fail because the Claude transcript was pruned.
      // Retry once in a fresh session with context rebuilt from our own
      // history; a fresh turn's failure is not retryable this way.
      if (!session.claude_session_id) throw err;
      const history = db.prepare('select role, body from messages where session_id = ? order by created_at')
        .all(session.id);
      turn = await runTurn({
        prompt: buildRecoveryPrompt(session, history, job.prompt),
        resumeSessionId: null,
        user,
      });
    }
    const { sessionId: claudeId, structured, text } = turn;
    // A schema-enforced turn says which text is the answer, so there is nothing
    // to parse out of prose and nothing the agent narrates can leak into the
    // reply. Runners that cannot enforce a schema still use the fenced blocks.
    // The SDK types structured_output as unknown, so a transport that returns
    // it as serialised JSON must be parsed rather than destructured blind:
    // otherwise every field is undefined and the alert below claims the agent
    // said nothing when it said plenty.
    const fields = typeof structured === 'string' ? tryParseJson(structured) : structured;
    let clean, title, awaitingUser, email;
    if (fields && typeof fields === 'object') {
      ({ reply: clean, title, awaiting_user: awaitingUser, email } = fields);
      // The schema guarantees this shape; the guard mirrors parseEmailDirective
      // so a malformed field degrades to "no email" rather than throwing here.
      if (email && (!email.subject || !email.body || !Array.isArray(email.attachments))) email = null;
    } else {
      const { clean: afterEmail, email: parsedEmail } = parseEmailDirective(text);
      ({ clean, title, awaitingUser } = parseTitleDirective(afterEmail));
      email = parsedEmail;
    }
    // Both paths, deliberately. The 2026-08-12 incident was a turn whose whole
    // text was a directive: strip it and nothing is left. A blank bubble marked
    // done is the failure this feature exists to end, so it fails loudly here
    // even when the deliverables parsed cleanly. The type check keeps a
    // non-string reply from surfacing as an opaque TypeError in the alert.
    if (typeof clean !== 'string' || !clean.trim()) throw new Error('agent returned an empty reply');
    // Persist the turn immediately: if the email send fails below, the session
    // must still be resumable and its deliverables downloadable from the UI.
    const msgId = newId();
    db.prepare('insert into messages (id, session_id, role, body) values (?, ?, ?, ?)')
      .run(msgId, job.session_id, 'claude', clean);
    db.prepare("update sessions set claude_session_id = ?, updated_at = datetime('now') where id = ?")
      .run(claudeId, job.session_id);
    const newTitle = (title || '').trim().slice(0, 80);
    if (newTitle) {
      db.prepare('update sessions set title = ? where id = ?').run(newTitle, job.session_id);
    }
    if (email) {
      db.prepare('update sessions set files = ? where id = ?')
        .run(JSON.stringify(email.attachments), job.session_id);
      // documents accumulates across the whole session; files above is only
      // ever the latest delivery. Redelivery of a revised file is idempotent:
      // there is one file on disk, so one row, with its date moved forward.
      const recordDoc = db.prepare(`insert into documents (id, session_id, path, message_id)
        values (?, ?, ?, ?)
        on conflict (session_id, path) do update set
          delivered_at = datetime('now'), message_id = excluded.message_id`);
      for (const p of email.attachments) recordDoc.run(newId(), job.session_id, p, msgId);
      const attachments = email.attachments.map(p => ({
        filename: basename(p),
        contentBase64: readFileSync(p).toString('base64'),
      }));
      await send({ to: session.user_email, subject: email.subject, text: email.body, attachments });
    }
    db.prepare("update sessions set status = ?, updated_at = datetime('now') where id = ?")
      .run(sessionStatus({ email: Boolean(email), awaitingUser }), job.session_id);
    db.prepare("update jobs set status = 'done' where id = ?").run(job.id);
  } catch (err) {
    db.prepare("update jobs set status = 'failed', error = ? where id = ?").run(String(err), job.id);
    db.prepare("update sessions set status = 'needs_attention', updated_at = datetime('now') where id = ?")
      .run(job.session_id);
    for (const admin of adminEmails()) {
      try {
        await send({
          to: admin,
          subject: `${config.portalTitle}: session "${session.title}" needs attention`,
          text: String(err),
          attachments: [],
        });
      } catch { /* alert is best-effort */ }
    }
  }
  return true;
}

export function startWorker(deps = {}) {
  const pollMs = deps.pollMs ?? 3000;
  // recover jobs stuck in 'running' from a crash/reboot
  getDb().prepare("update jobs set status = 'queued' where status = 'running'").run();
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await processOneJob(deps); } finally { busy = false; }
  }, pollMs);
}
