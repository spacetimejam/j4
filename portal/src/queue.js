import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { getDb, newId } from './db.js';
import { config } from './config.js';
import { runAgentTurn, parseEmailDirective } from './agent.js';
import { sendEmail } from './email.js';

export function enqueue({ sessionId, prompt }) {
  getDb().prepare('insert into jobs (id, session_id, prompt) values (?, ?, ?)')
    .run(newId(), sessionId, prompt);
}

export async function processOneJob({ runTurn = runAgentTurn, send = sendEmail } = {}) {
  const db = getDb();
  const job = db.prepare("select * from jobs where status = 'queued' order by created_at limit 1").get();
  if (!job) return false;
  db.prepare("update jobs set status = 'running' where id = ?").run(job.id);
  const session = db.prepare('select * from sessions where id = ?').get(job.session_id);
  try {
    const { sessionId: claudeId, text } = await runTurn({
      prompt: job.prompt,
      resumeSessionId: session.claude_session_id || null,
    });
    const { clean, email } = parseEmailDirective(text);
    // Persist the turn immediately: if the email send fails below, the session
    // must still be resumable and its deliverables downloadable from the UI.
    db.prepare('insert into messages (id, session_id, role, body) values (?, ?, ?, ?)')
      .run(newId(), job.session_id, 'claude', clean);
    db.prepare("update sessions set claude_session_id = ?, updated_at = datetime('now') where id = ?")
      .run(claudeId, job.session_id);
    if (email) {
      db.prepare('update sessions set files = ? where id = ?')
        .run(JSON.stringify(email.attachments), job.session_id);
      const attachments = email.attachments.map(p => ({
        filename: basename(p),
        contentBase64: readFileSync(p).toString('base64'),
      }));
      await send({ to: session.user_email, subject: email.subject, text: email.body, attachments });
    }
    db.prepare("update sessions set status = ?, updated_at = datetime('now') where id = ?")
      .run(email ? 'done' : 'awaiting_reply', job.session_id);
    db.prepare("update jobs set status = 'done' where id = ?").run(job.id);
  } catch (err) {
    db.prepare("update jobs set status = 'failed', error = ? where id = ?").run(String(err), job.id);
    db.prepare("update sessions set status = 'needs_attention', updated_at = datetime('now') where id = ?")
      .run(job.session_id);
    try {
      await send({
        to: config.allowedEmails.find(e => e !== session.user_email) || config.allowedEmails[0],
        subject: `${config.portalTitle}: session "${session.title}" needs attention`,
        text: String(err),
        attachments: [],
      });
    } catch { /* alert is best-effort */ }
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
