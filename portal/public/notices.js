import { formatResetLondon, resetHasPassed } from './time.js';

const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Shown when a turn is waiting on a limit or on the writing service. Built
   only from fixed strings and the formatted time, never from the error text.
   User-facing copy never names the writing service's vendor, except on your
   own computer when it needs signing in (see below). */
export function delayedNotice(d, now = new Date(), { local = false } = {}) {
  /* Claude Code is signed out. On your own computer only you can fix that, so
     say how; on a shared portal the owner has been emailed. */
  if (d.kind === 'signed_out') {
    const body = local
      ? `<p><strong>Jawbs isn't connected to Claude yet.</strong> Jawbs works through your Claude account, so it needs you to sign in once on this computer.</p>
    <ol><li>Open Terminal (on a Mac it's in Applications, inside Utilities).</li>
    <li>Type <code>claude auth login</code> and press Return. Your browser will open so you can sign in.</li>
    <li>Once you're signed in, come back here and press Try again.</li></ol>`
      : `<p><strong>Jawbs can't reach Claude right now.</strong> Its connection to Claude needs signing in again. The person who runs Jawbs has been told; once they've sorted it, press Try again.</p>`;
    return `<div class="notice-delayed" role="status">
    ${body}
    <button id="retry" class="secondary">Try again</button></div>`;
  }
  let when = '';
  if (resetHasPassed(d.resetsAt, d, now)) {
    when = ' The limit should have reset by now, so a retry should work.';
  } else {
    const at = formatResetLondon(d.resetsAt, d, now);
    if (at) when = ` The limit should reset at about ${esc(at)}.`;
  }
  /* On your own computer the person chose ChatGPT as the writer themselves and
     is the only one who can sign it back in, so here it is named, with the
     command. A shared portal keeps the unnamed wording and emails the owner. */
  if (d.kind === 'drafting' && d.draftingKind === 'auth' && local) {
    return `<div class="notice-delayed" role="status">
    <p><strong>Your draft is waiting.</strong> ChatGPT writes your CVs and cover letters, and it isn't signed in on this computer.</p>
    <ol><li>Open Terminal (on a Mac it's in Applications, inside Utilities).</li>
    <li>Type <code>codex login</code> and press Return. Your browser will open so you can sign in to ChatGPT.</li>
    <li>Once you're signed in, come back here and press Retry draft.</li></ol>
    <button id="retry" class="secondary">Retry draft</button></div>`;
  }
  if (d.kind === 'drafting') {
    const why = d.draftingKind === 'usage_limit' ? 'has reached its limit' : "isn't available right now";
    return `<div class="notice-delayed" role="status">
    <p><strong>Your draft is waiting.</strong> The writing service Jawbs uses ${why}, so the CV and cover letter haven't been written yet.${d.draftingKind === 'usage_limit' ? when : ''}</p>
    <button id="retry" class="secondary">Retry draft</button></div>`;
  }
  return `<div class="notice-delayed" role="status">
    <p><strong>Your reply is delayed.</strong> The Claude account behind Jawbs has reached its usage limit, so Jawbs couldn't answer this message yet.${when}</p>
    <button id="retry" class="secondary">Retry message</button></div>`;
}
