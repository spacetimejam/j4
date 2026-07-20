# Portal markdown rendering design

Date: 2026-07-20

## Problem

Claude's replies in the portal often contain markdown (`**bold**`, `- lists`,
`## headings`, `` `code` ``, links). The portal renders every message as
HTML-escaped plain text with `white-space: pre-wrap` (`public/app.js`,
`public/style.css`), so this markup shows up as literal characters instead of
rich text. We want Claude's replies to render as rich text.

## Scope

- Only messages with role `claude` render markdown. User messages (pasted job
  descriptions, replies) stay as plain typed text with line breaks preserved,
  so a pasted description that happens to contain `#` or `*` is never
  reformatted.
- Tables and nested lists are out of scope for v1. They are rare in Claude's
  portal replies and add disproportionate parsing complexity. They can be
  added later if needed.

## Approach

A small, dependency-free renderer, chosen over vendoring `marked` + `DOMPurify`
or rendering server-side. It matches the portal's minimalist, no-build-step,
small-focused-files style, adds no dependencies, and is the safest option
because malicious or echoed HTML never becomes live markup: we escape first and
only ever emit our own known tags.

## Components

### 1. `portal/public/markdown.js` (new)

A pure ES module exporting `renderMarkdown(src) -> htmlString`. No DOM calls, so
it is importable unchanged by both the browser (`<script type="module">`) and
`node:test`.

**Block level** (line-based):

- Fenced code blocks between ` ``` ` fences. Contents captured literally,
  escaped, wrapped in `<pre><code>`. Any language after the opening fence is
  ignored.
- Headings `#`..`######`. Clamped to `<h3>`..`<h6>` (tag =
  `h{min(level + 2, 6)}`) so a message heading never competes with the page
  `<h1>`.
- Bullet lists: consecutive lines matching `[-*+] ` become `<ul><li>`.
- Ordered lists: consecutive lines matching `\d+. ` become `<ol><li>`.
- Blockquotes: consecutive `> ` lines become one `<blockquote>`.
- Horizontal rule: a line of `---`, `***`, or `___` becomes `<hr>`.
- Paragraphs: runs of other non-blank lines become `<p>`. A single newline
  inside a paragraph becomes `<br>`, matching today's line-break-preserving
  behaviour.

**Inline** (precedence-ordered, applied to block text content):

1. Inline code `` `...` `` first. Contents escaped and not re-parsed.
2. Links `[text](url)`. `url` is accepted only if it starts with `http:`,
   `https:`, or `mailto:` (case-insensitive, after trimming). Otherwise the
   whole `[text](url)` renders as escaped literal text.
3. Bold `**...**` or `__...__` -> `<strong>`.
4. Italic `*...*` or `_..._` -> `<em>`.

**Safety model** (XSS-safe by construction):

- All text and code contents are HTML-escaped (`& < > "`).
- Only our own known tags are ever emitted; there is no raw-HTML passthrough,
  so any HTML Claude sends becomes inert escaped text.
- Link `href`s are protocol-restricted to `http`/`https`/`mailto`; rejected
  links degrade to literal text. Escaped `"` cannot break out of the `href`
  attribute.
- Inline code is extracted before escaping and emphasis parsing (placeholder
  technique) so its contents are never interpreted as markup.

### 2. Integration: `portal/public/index.html` + `portal/public/app.js`

- `index.html`: `<script src="app.js">` becomes
  `<script type="module" src="app.js">`.
- `app.js`: add `import { renderMarkdown } from './markdown.js'`. In
  `renderSession`, `claude` messages render as
  `<div class="msg claude md">${renderMarkdown(m.body)}</div>`; `user` messages
  are unchanged (`esc(m.body)`, `pre-wrap` preserved). The `md` class lets CSS
  switch off `pre-wrap` for rendered content.

### 3. Styling: `portal/public/style.css`

A `.msg.md` block:

- `white-space: normal` (block elements handle spacing now).
- First/last child margins collapsed so bubble padding stays even.
- Restrained heading sizes for `<h3>`..`<h6>`.
- List indentation for `<ul>`/`<ol>`.
- Inline `code` and `<pre>` code blocks: monospace stack, subtle tint,
  `overflow-x: auto` so long lines scroll inside the bubble instead of
  overflowing the card.
- `blockquote`: accent left-border, muted text.
- `hr`: hairline.

Reuses existing `--accent`/`--tint`/`--hairline` variables so it works in both
light and dark themes. Links already inherit `a { color: var(--accent) }`.

### 4. Tests: `portal/test/markdown.test.js` (new, `node:test`)

Imports `renderMarkdown` from `../public/markdown.js`. Covers each construct
(bold, italic, inline code, code blocks, links, `ul`/`ol`, headings,
blockquote, hr, paragraph and soft-break handling) and explicit XSS vectors
that must be neutralised:

- `<script>alert(1)</script>` renders escaped, no live tag.
- `<img src=x onerror=alert(1)>` renders escaped, no live tag.
- `[x](javascript:alert(1))` renders as literal text, no `href`.
- HTML inside a code block renders escaped.

## Rollout

Author and test in `~/j4dev`, commit code plus this spec, push to the public
remote, then `git pull` in `~/j4` (the live checkout). Both checkouts currently
sit on the same commit, so the pull is a clean fast-forward. No service restart
is needed: the change is frontend-only static files, which `express.static`
serves fresh from disk on each request, so a browser reload picks them up.

## Verification

- `cd portal && npm test` (existing suite plus the new markdown tests).
- Manual: open a session with a Claude reply containing markdown and confirm it
  renders as rich text in both light and dark themes.
