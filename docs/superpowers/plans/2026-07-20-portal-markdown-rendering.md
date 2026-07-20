# Portal Markdown Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render markdown in Claude's portal replies as rich text, leaving user-typed messages as plain text.

**Architecture:** A new dependency-free ES module `portal/public/markdown.js` exports a pure `renderMarkdown(src) -> htmlString`. It is XSS-safe by construction: it escapes all text first and only ever emits its own known tags, so no HTML from Claude can reach the DOM. `app.js` becomes a module and calls it for `claude`-role messages only. `style.css` gains a `.msg.md` block for the rendered elements.

**Tech Stack:** Vanilla ES modules (no build step), `node:test` for unit tests, Express `express.static` serving `public/`.

Spec: `docs/superpowers/specs/2026-07-20-portal-markdown-rendering-design.md`

## Global Constraints

- No new dependencies. The portal's dependency list stays as-is.
- Only `claude`-role messages render markdown. `user` messages keep `esc(m.body)` and `white-space: pre-wrap`.
- Tables and nested lists are out of scope for v1.
- Docs in British English; no em/en dashes as sentence punctuation.
- Verification command: `cd portal && npm test`.
- All work happens in `~/j4dev` (the only checkout that pushes). `~/j4` is pull-only.
- Link `href`s are restricted to `http:`, `https:`, `mailto:`. Rejected links render as literal text.
- Headings clamp to `<h3>`..`<h6>` via `h{min(level + 2, 6)}`.

---

### Task 1: Renderer core (escaping, inline formatting, paragraphs)

This task establishes the safety model and all inline formatting. Block constructs come in Task 2.

**Files:**
- Create: `portal/public/markdown.js`
- Test: `portal/test/markdown.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function renderMarkdown(src: string): string`. Task 2 extends the block loop inside it. Task 3 imports it in `app.js`.

- [ ] **Step 1: Write the failing test**

Create `portal/test/markdown.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../public/markdown.js';

test('wraps plain text in a paragraph', () => {
  assert.equal(renderMarkdown('Hello there'), '<p>Hello there</p>');
});

test('separates paragraphs on a blank line', () => {
  assert.equal(renderMarkdown('One\n\nTwo'), '<p>One</p><p>Two</p>');
});

test('turns a single newline into a soft break', () => {
  assert.equal(renderMarkdown('One\nTwo'), '<p>One<br>Two</p>');
});

test('renders bold and italic', () => {
  assert.equal(renderMarkdown('a **b** c'), '<p>a <strong>b</strong> c</p>');
  assert.equal(renderMarkdown('a __b__ c'), '<p>a <strong>b</strong> c</p>');
  assert.equal(renderMarkdown('a *b* c'), '<p>a <em>b</em> c</p>');
  assert.equal(renderMarkdown('a _b_ c'), '<p>a <em>b</em> c</p>');
});

test('leaves snake_case words alone', () => {
  assert.equal(renderMarkdown('some_var_name here'), '<p>some_var_name here</p>');
});

test('renders inline code without parsing its contents', () => {
  assert.equal(renderMarkdown('use `a **b** c` now'),
    '<p>use <code>a **b** c</code> now</p>');
});

test('renders a safe link', () => {
  assert.equal(renderMarkdown('[site](https://example.com)'),
    '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">site</a></p>');
});

test('renders a mailto link', () => {
  assert.equal(renderMarkdown('[mail](mailto:a@b.com)'),
    '<p><a href="mailto:a@b.com" target="_blank" rel="noopener noreferrer">mail</a></p>');
});

test('refuses a javascript: link and renders it literally', () => {
  const html = renderMarkdown('[x](javascript:alert(1))');
  assert.ok(!html.includes('href'));
  assert.ok(html.includes('[x](javascript:alert(1))'));
});

test('escapes raw HTML so no live tag survives', () => {
  const html = renderMarkdown('<script>alert(1)</script>');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('escapes an img onerror payload', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
});

test('escapes HTML inside inline code', () => {
  assert.equal(renderMarkdown('`<b>hi</b>`'), '<p><code>&lt;b&gt;hi&lt;/b&gt;</code></p>');
});

test('handles empty and nullish input', () => {
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown(null), '');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd portal && npm test`
Expected: FAIL. The suite cannot resolve `../public/markdown.js` (`ERR_MODULE_NOT_FOUND`).

- [ ] **Step 3: Write the implementation**

Create `portal/public/markdown.js`:

```js
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
  text = text.replace(/\[([^\]]*)\]\(([^)\s]*)\)/g, (whole, label, href) => {
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd portal && npm test`
Expected: PASS. All markdown tests green, and the pre-existing suites still pass.

- [ ] **Step 5: Commit**

```bash
cd ~/j4dev
git add portal/public/markdown.js portal/test/markdown.test.js
git commit -m "feat(portal): safe inline markdown renderer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Block constructs (headings, lists, blockquotes, rules, code blocks)

**Files:**
- Modify: `portal/public/markdown.js` (replace the block loop in `renderMarkdown`, add two module-level constants)
- Test: `portal/test/markdown.test.js` (append)

**Interfaces:**
- Consumes: `renderInline`, `escapeHtml` from Task 1; `renderMarkdown`'s existing signature is unchanged.
- Produces: `renderMarkdown` now emits `<h3>`..`<h6>`, `<ul>`, `<ol>`, `<blockquote>`, `<hr>`, `<pre><code>` in addition to `<p>`.

- [ ] **Step 1: Write the failing tests**

Append to `portal/test/markdown.test.js`:

```js
test('renders headings clamped to h3..h6', () => {
  assert.equal(renderMarkdown('# One'), '<h3>One</h3>');
  assert.equal(renderMarkdown('## Two'), '<h4>Two</h4>');
  assert.equal(renderMarkdown('### Three'), '<h5>Three</h5>');
  assert.equal(renderMarkdown('#### Four'), '<h6>Four</h6>');
  assert.equal(renderMarkdown('###### Six'), '<h6>Six</h6>');
});

test('renders a bullet list', () => {
  assert.equal(renderMarkdown('- one\n- two'), '<ul><li>one</li><li>two</li></ul>');
  assert.equal(renderMarkdown('* one\n* two'), '<ul><li>one</li><li>two</li></ul>');
});

test('renders an ordered list', () => {
  assert.equal(renderMarkdown('1. one\n2. two'), '<ol><li>one</li><li>two</li></ol>');
});

test('formats inline markup inside list items', () => {
  assert.equal(renderMarkdown('- a **b**'), '<ul><li>a <strong>b</strong></li></ul>');
});

test('renders a blockquote', () => {
  assert.equal(renderMarkdown('> quoted'), '<blockquote>quoted</blockquote>');
});

test('renders a horizontal rule', () => {
  assert.equal(renderMarkdown('---'), '<hr>');
  assert.equal(renderMarkdown('***'), '<hr>');
});

test('renders a fenced code block without parsing its contents', () => {
  assert.equal(renderMarkdown('```\na **b**\n```'),
    '<pre><code>a **b**</code></pre>');
});

test('ignores the language tag on a fence', () => {
  assert.equal(renderMarkdown('```js\nlet x = 1;\n```'),
    '<pre><code>let x = 1;</code></pre>');
});

test('escapes HTML inside a fenced code block', () => {
  const html = renderMarkdown('```\n<script>alert(1)</script>\n```');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('keeps a paragraph separate from a following list', () => {
  assert.equal(renderMarkdown('Intro:\n- one'), '<p>Intro:</p><ul><li>one</li></ul>');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd portal && npm test`
Expected: FAIL. Headings, lists and fences currently come back wrapped in `<p>` (for example `renderMarkdown('# One')` returns `<p># One</p>`).

- [ ] **Step 3: Write the implementation**

In `portal/public/markdown.js`, add these two constants immediately below the `SAFE_HREF` line:

```js
/* A line that starts some other block, so a paragraph must stop before it. */
const BLOCK_START = /^\s*(```|#{1,6}\s|>|[-*+]\s|\d+[.)]\s)/;
const HR = /^\s*([-*_])\s*(\1\s*){2,}$/;
```

Then replace the whole `renderMarkdown` function with:

````js
export function renderMarkdown(src) {
  /* Stripping NULs first means the placeholder sentinel above cannot be forged
     by the input. */
  const lines = String(src ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    if (/^\s*```/.test(line)) {
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++; // step over the closing fence, if there is one
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    if (HR.test(line)) { out.push('<hr>'); i++; continue; }

    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) {
      const tag = `h${Math.min(heading[1].length + 2, 6)}`;
      out.push(`<${tag}>${renderInline(heading[2].trim())}</${tag}>`);
      i++;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderInline(body.join('\n'))}</blockquote>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i]) && !HR.test(lines[i])) {
        items.push(lines[i++].replace(/^\s*[-*+]\s+/, ''));
      }
      out.push(`<ul>${items.map(t => `<li>${renderInline(t)}</li>`).join('')}</ul>`);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ''));
      }
      out.push(`<ol>${items.map(t => `<li>${renderInline(t)}</li>`).join('')}</ol>`);
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim()
           && !BLOCK_START.test(lines[i]) && !HR.test(lines[i])) {
      para.push(lines[i++]);
    }
    if (!para.length) { i++; continue; } // never stall on an unmatched line
    out.push(`<p>${renderInline(para.join('\n'))}</p>`);
  }

  return out.join('');
}
````

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd portal && npm test`
Expected: PASS, including every Task 1 test (paragraphs and inline formatting must not regress).

- [ ] **Step 5: Commit**

```bash
cd ~/j4dev
git add portal/public/markdown.js portal/test/markdown.test.js
git commit -m "feat(portal): block-level markdown constructs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Wire the renderer into the portal UI

**Files:**
- Modify: `portal/public/index.html:11`
- Modify: `portal/public/app.js` (add an import at the top; change the message map in `renderSession`, currently line 114)
- Modify: `portal/public/style.css` (append a `.msg.md` block after the existing `.msg.claude` rule)

**Interfaces:**
- Consumes: `renderMarkdown` from Task 1 and Task 2.
- Produces: no new exports. `claude` messages render as `<div class="msg claude md">`.

There is no automated browser test in this repo, so this task is verified by the existing suite still passing plus a manual check.

- [ ] **Step 1: Make `app.js` load as a module**

In `portal/public/index.html`, change line 11 from:

```html
<script src="app.js"></script>
```

to:

```html
<script type="module" src="app.js"></script>
```

- [ ] **Step 2: Import the renderer in `app.js`**

At the very top of `portal/public/app.js`, above the existing `const app = ...` line, add:

```js
import { renderMarkdown } from './markdown.js';
```

- [ ] **Step 3: Render Claude's messages as markdown**

In `portal/public/app.js`, inside `renderSession`, replace this line:

```js
    ${s.messages.map(m => `<div class="msg ${m.role}">${esc(m.body)}</div>`).join('')}
```

with:

```js
    ${s.messages.map(m => m.role === 'claude'
      ? `<div class="msg claude md">${renderMarkdown(m.body)}</div>`
      : `<div class="msg ${m.role}">${esc(m.body)}</div>`).join('')}
```

- [ ] **Step 4: Style the rendered elements**

In `portal/public/style.css`, immediately after the existing `.msg.claude { ... }` rule, add:

```css
/* Rendered markdown in Claude's replies. Block elements handle their own
   spacing, so pre-wrap is switched off here. */
.msg.md { white-space: normal; }
.msg.md > :first-child { margin-top: 0; }
.msg.md > :last-child { margin-bottom: 0; }
.msg.md p { margin: 0 0 0.7em; }
.msg.md :is(h3, h4, h5, h6) { font-weight: 600; line-height: 1.3; margin: 1.1em 0 0.5em; }
.msg.md h3 { font-size: 1.05rem; }
.msg.md h4 { font-size: 0.98rem; }
.msg.md :is(h5, h6) { font-size: 0.92rem; color: var(--ink-soft); }
.msg.md :is(ul, ol) { margin: 0 0 0.7em; padding-left: 1.4em; }
.msg.md li { margin: 0.25em 0; }
.msg.md code {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace;
  font-size: 0.88em;
  background: var(--tint);
  border-radius: 5px;
  padding: 0.12em 0.35em;
}
.msg.md pre {
  background: var(--tint);
  border-radius: 10px;
  padding: 12px 14px;
  margin: 0 0 0.7em;
  overflow-x: auto;
}
.msg.md pre code { background: none; padding: 0; font-size: 0.85em; }
.msg.md blockquote {
  margin: 0 0 0.7em;
  padding-left: 12px;
  border-left: 3px solid var(--hairline);
  color: var(--ink-soft);
}
.msg.md hr { border: 0; border-top: 1px solid var(--hairline); margin: 1em 0; }
.msg.md a { overflow-wrap: anywhere; }
```

- [ ] **Step 5: Run the test suite**

Run: `cd portal && npm test`
Expected: PASS. Nothing here touches server code, so the existing suites must be unaffected.

- [ ] **Step 6: Manual check**

Run: `cd portal && npm start`, then open the portal and view a session whose Claude reply contains markdown.
Expected: headings, bold, lists, links and code render as rich text; the user's own messages are unchanged; long code lines scroll inside the bubble rather than overflowing the card. Check both light and dark themes (toggle your OS appearance).

- [ ] **Step 7: Commit**

```bash
cd ~/j4dev
git add portal/public/index.html portal/public/app.js portal/public/style.css
git commit -m "feat(portal): render Claude's markdown replies as rich text

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Roll out to both checkouts

**Files:** none changed. This task publishes the work.

**Interfaces:**
- Consumes: the commits from Tasks 1 to 3.
- Produces: `~/j4` (live) serving the new files.

- [ ] **Step 1: Confirm the full suite passes in `~/j4dev`**

Run: `cd ~/j4dev/portal && npm test`
Expected: PASS, no failures.

- [ ] **Step 2: Push from `~/j4dev`**

`~/j4dev` is the only checkout that pushes to the public repo.

```bash
cd ~/j4dev
git push origin master
```

- [ ] **Step 3: Pull into the live checkout**

`~/j4` is pull-only. It was level with `~/j4dev` at commit `3e75d24` when this plan was written, so this should fast-forward. If it does not, stop and report rather than forcing.

```bash
cd ~/j4
git status -s -- portal docs   # expect no local changes to these paths
git pull --ff-only origin master
```

- [ ] **Step 4: Verify the live files**

Run: `cd ~/j4 && ls portal/public/markdown.js && grep -n 'type="module"' portal/public/index.html`
Expected: the file exists and `index.html` line 11 carries `type="module"`.

No service restart is needed: `express.static` reads `public/` from disk per request, so a browser reload picks the change up.

- [ ] **Step 5: Confirm in the browser**

Open the live portal, hard-reload (Ctrl+Shift+R, to defeat any cached `app.js`), and open a session with a markdown-containing Claude reply.
Expected: rich text renders as in Task 3's manual check.

---

## Self-Review

**Spec coverage**

| Spec requirement | Task |
| --- | --- |
| `markdown.js` pure module, no DOM | 1 |
| Escape-first safety model, no raw HTML passthrough | 1 |
| Inline code, precedence over other inline rules | 1 |
| Links with `http`/`https`/`mailto` allowlist, literal fallback | 1 |
| Bold and italic | 1 |
| Paragraphs, soft break to `<br>` | 1 |
| Fenced code blocks, language tag ignored | 2 |
| Headings clamped to `h3`..`h6` | 2 |
| Bullet and ordered lists | 2 |
| Blockquotes | 2 |
| Horizontal rules | 2 |
| `index.html` module script tag | 3 |
| `app.js` claude-only rendering, user messages untouched | 3 |
| `.msg.md` styling, code-block overflow, both themes | 3 |
| Tests incl. XSS vectors (`<script>`, `onerror`, `javascript:`, HTML in code) | 1, 2 |
| Rollout j4dev to j4, no restart | 4 |

No gaps.

**Placeholder scan:** No TBD/TODO, no "add error handling", no "similar to Task N". Every code step carries complete code.

**Type consistency:** `renderMarkdown(src) -> string` is defined in Task 1 and used unchanged in Tasks 2 and 3. `escapeHtml`, `renderInline`, `emphasis`, `SAFE_HREF`, `BLOCK_START` and `HR` are module-private and referenced only where defined. The `md` class is emitted in Task 3 step 3 and styled by the same name in step 4.
