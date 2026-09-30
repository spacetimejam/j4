/* The line an upload adds to the reply box. The person can edit it before
   sending, and the upload only reaches Claude inside a message. */
export const attachNote = path => `I've attached my CV: ${path}`;

export const appendNote = (text, note) => (text.trim() ? `${text.replace(/\n+$/, '')}\n${note}` : note);

/* The very first turn reads the person's folder before it can greet them, so
   the page sits empty for a minute or so. Say so, or it looks broken. Shown
   only until the first message lands. Fixed strings only. */
export function firstMessageNotice(s) {
  if (s.kind !== 'setup' || s.status !== 'working' || s.messages?.length) return '';
  return `<div class="notice-wait" role="status">
    <p><strong>Jawbs is getting things set up.</strong></p>
    <p>The first message can take a minute or so to come through. That's normal, and there's nothing you need to do: stay on this page and it will appear here.</p></div>`;
}
