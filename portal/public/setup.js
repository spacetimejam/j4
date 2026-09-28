/* The line an upload adds to the reply box. The person can edit it before
   sending, and the upload only reaches Claude inside a message. */
export const attachNote = path => `I've attached my CV: ${path}`;

export const appendNote = (text, note) => (text.trim() ? `${text.replace(/\n+$/, '')}\n${note}` : note);
