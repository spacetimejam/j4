import { formatResetLondon, resetHasPassed } from './time.js';

const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Shown when a turn is waiting on a limit or on the writing service. Built
   only from fixed strings and the formatted time, never from the error text.
   User-facing copy never names the vendor. */
export function delayedNotice(d, now = new Date()) {
  let when = '';
  if (resetHasPassed(d.resetsAt, d, now)) {
    when = ' The limit should have reset by now, so a retry should work.';
  } else {
    const at = formatResetLondon(d.resetsAt, d, now);
    if (at) when = ` The limit should reset at about ${esc(at)}.`;
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
