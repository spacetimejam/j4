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

export async function processOneJob({ runTurn = runAgentTurn, send = sendEmail } = {}) {
  const db = getDb();
  const job = db.prepare("select * from jobs where status = 'queued' order by created_at limit 1").get();
  if (!job) return false;
  db.prepare("update jobs set status = 'running' where id = ?").run(job.id);
  const session = db.prepare('select * from sessions where id = ?').get(job.session_id);
  const user = getUser(session.user_email);
  try {
    if (!user) throw new Error(`no registered user for ${session.user_email}; add them to users.json`);
    const { sessionId: claudeId, text } = await runTurn({
      prompt: job.prompt,
      resumeSessionId: session.claude_session_id || null,
      user,
    });
    const { clean: afterEmail, email } = parseEmailDirective(text);
    const { clean, title } = parseTitleDirective(afterEmail);
    // Persist the turn immediately: if the email send fails below, the session
    // must still be resumable and its deliverables downloadable from the UI.
    db.prepare('insert into messages (id, session_id, role, body) values (?, ?, ?, ?)')
      .run(newId(), job.session_id, 'claude', clean);
    db.prepare("update sessions set claude_session_id = ?, updated_at = datetime('now') where id = ?")
      .run(claudeId, job.session_id);
    const newTitle = (title || '').trim().slice(0, 80);
    if (newTitle) {
      db.prepare('update sessions set title = ? where id = ?').run(newTitle, job.session_id);
    }
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
