/* A small, dependency-free markdown renderer for Claude's portal replies.

   Safe by construction: every piece of text is HTML-escaped and the only tags
   emitted are the ones written here, so markup Claude sends can never become
   live HTML. Link hrefs are restricted to http/https/mailto. */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escapeHtml = s => s.replace(/[&<>"]/g, c => ESCAPES[c]);

const SAFE_HREF = /^(https?:|mailto:)/i;

/* Emphasis runs on already-escaped text. The italic underscore rule needs a
   word boundary so snake_case identifiers survive intact. */
function emphasis(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, '$1<em>$2</em>');
}

/* Inline formatting. Code spans and anchors are "held" behind placeholders so
   later passes cannot reach inside them: emphasis must not mangle a URL, and
   nothing may reinterpret the contents of a code span. */
function renderInline(src) {
  const held = [];
  const hold = html => `\u0000${held.push(html) - 1}\u0000`;

  let text = src.replace(/`([^`]+)`/g, (_, code) => hold(`<code>${escapeHtml(code)}</code>`));
  text = escapeHtml(text);
  text = text.replace(/\[([^\]]*)\]\(([^)\s\x00]*)\)/g, (whole, label, href) => {
    const url = href.trim();
    if (!SAFE_HREF.test(url)) return whole;
    return hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${emphasis(label)}</a>`);
  });
  text = emphasis(text).replace(/\n/g, '<br>');

  /* Held anchors can contain held code spans, so restore until none remain.
     This terminates: a fragment only ever holds lower indices than its own. */
  while (/\u0000\d+\u0000/.test(text)) {
    text = text.replace(/\u0000(\d+)\u0000/g, (_, i) => held[Number(i)]);
  }
  return text;
}

export function renderMarkdown(src) {
  /* Stripping NULs first means the placeholder sentinel above cannot be forged
     by the input. */
  const lines = String(src ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) { i++; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim()) para.push(lines[i++]);
    out.push(`<p>${renderInline(para.join('\n'))}</p>`);
  }
  return out.join('');
}
