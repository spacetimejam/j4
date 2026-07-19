# Portal Session Titles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Session titles become the actual job title (agent-supplied via a `session-title` directive) instead of mirroring the submitted URL/first line, and long unbroken card titles wrap instead of invading the three-dot menu strip.

**Architecture:** A `session-title` fenced block mirrors the existing `email-to-user` directive: the system prompt instructs the agent to emit it, `parseTitleDirective` in agent.js strips and parses it, and the queue worker applies it to the session row. CSS gains `overflow-wrap: anywhere` on title-bearing elements.

**Tech Stack:** Node 20+, Express, better-sqlite3, node:test, vanilla CSS. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-19-portal-session-titles-design.md`

## Global Constraints

- Work in `/home/spacetimejam/j4dev`; run tests with `cd /home/spacetimejam/j4dev/portal && npm test`.
- No new dependencies.
- Parse order in the queue: `parseEmailDirective` first, then `parseTitleDirective` on its `clean` output; the stored message has both blocks removed.
- Title updates: trim, ignore if empty, truncate to 80 characters (matching creation-time titles).
- Prompt copy in British English; no em/en dashes as sentence punctuation.

---

### Task 1: `parseTitleDirective` and the prompt instruction

**Files:**
- Modify: `portal/src/agent.js` (add export after `parseEmailDirective`, ~line 102; add prompt paragraph before the "Never invent facts" line, ~line 88)
- Test: `portal/test/agent.test.js`

**Interfaces:**
- Produces: `parseTitleDirective(text)` returning `{ clean, title }`; `title` is a string or `null`; `clean` is `text` with a trailing ```` ```session-title ```` block removed (unchanged when no valid block). Task 2 consumes it from `./agent.js`.

- [ ] **Step 1: Write the failing tests**

Append to `portal/test/agent.test.js` (match its existing imports; add `parseTitleDirective` to the import from `../src/agent.js`):

```js
test('parseTitleDirective extracts and strips a trailing title block', () => {
  const text = 'Assessment here.\n```session-title\n{"title": "Designer at Acme"}\n```';
  const { clean, title } = parseTitleDirective(text);
  assert.equal(title, 'Designer at Acme');
  assert.equal(clean, 'Assessment here.');
});

test('parseTitleDirective returns null title on malformed JSON', () => {
  const text = 'Text.\n```session-title\n{not json}\n```';
  const { clean, title } = parseTitleDirective(text);
  assert.equal(title, null);
  assert.equal(clean, 'Text.');
});

test('parseTitleDirective returns null when absent or title missing', () => {
  assert.equal(parseTitleDirective('Just text.').title, null);
  assert.equal(parseTitleDirective('Just text.').clean, 'Just text.');
  const missing = parseTitleDirective('T.\n```session-title\n{"role": "x"}\n```');
  assert.equal(missing.title, null);
});

test('parseTitleDirective ignores a block not at the end', () => {
  const text = '```session-title\n{"title": "T"}\n```\ntrailing prose';
  const { clean, title } = parseTitleDirective(text);
  assert.equal(title, null);
  assert.equal(clean, text);
});

test('portal prompt instructs the session-title block', () => {
  assert.match(portalPrompt('Sam'), /session-title/);
});
```

(`portalPrompt` may already be imported in the test file; if not, add it to the import.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/spacetimejam/j4dev/portal && npm test`
Expected: new tests FAIL (`parseTitleDirective` is not exported).

- [ ] **Step 3: Implement**

In `portal/src/agent.js`, add after `parseEmailDirective`:

```js
export function parseTitleDirective(text) {
  const m = text.match(/```session-title\s*\n([\s\S]*?)\n?```\s*$/);
  if (!m) return { clean: text, title: null };
  const clean = text.slice(0, m.index).trimEnd();
  try {
    const parsed = JSON.parse(m[1]);
    if (typeof parsed.title !== 'string') return { clean, title: null };
    return { clean, title: parsed.title };
  } catch {
    return { clean, title: null };
  }
}
```

In `portalPrompt`, immediately before the final `Never invent facts` line, add this paragraph:

```
In every reply where you know the role and company (true from the stage 1 assessment onwards),
end your reply with exactly this fenced block so the portal can name the session properly:

\`\`\`session-title
{"title": "<role> at <company>"}
\`\`\`

Keep the title short and plain, like "Design Director at Acme". If an email-to-user block is
also present, put the session-title block immediately before it; otherwise it is the last thing
in your reply.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/spacetimejam/j4dev/portal && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/spacetimejam/j4dev && git add portal/src/agent.js portal/test/agent.test.js
git commit -m "feat(portal): session-title directive parsing and prompt instruction"
```

---

### Task 2: queue applies the title

**Files:**
- Modify: `portal/src/queue.js` (import at line 5; the directive-handling block in `processOneJob`, lines 28-34)
- Test: `portal/test/queue.test.js`

**Interfaces:**
- Consumes: `parseTitleDirective(text)` → `{ clean, title }` from `./agent.js` (Task 1).
- Produces: behaviour only; no new exports.

- [ ] **Step 1: Write the failing tests**

Append to `portal/test/queue.test.js`:

```js
test('title directive updates the session title and is stripped from the message', async () => {
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'linkedin url' });
  const runTurn = async () => ({
    sessionId: 'c-title',
    text: 'Here is my assessment.\n```session-title\n{"title": "Design Director at Acme"}\n```',
  });
  await processOneJob({ runTurn, send: async () => {} });
  const s = getDb().prepare('select * from sessions where id = ?').get(sid);
  assert.equal(s.title, 'Design Director at Acme');
  const msg = getDb().prepare("select body from messages where session_id = ? and role = 'claude'").get(sid);
  assert.equal(msg.body, 'Here is my assessment.');
});

test('title longer than 80 characters is truncated to 80', async () => {
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'x' });
  const long = 'A'.repeat(120);
  const runTurn = async () => ({
    sessionId: 'c-long',
    text: `Text.\n\`\`\`session-title\n{"title": "${long}"}\n\`\`\``,
  });
  await processOneJob({ runTurn, send: async () => {} });
  assert.equal(getDb().prepare('select title from sessions where id = ?').get(sid).title, 'A'.repeat(80));
});

test('empty or missing title leaves the session title unchanged', async () => {
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'x' });
  const runTurn = async () => ({
    sessionId: 'c-empty',
    text: 'Text.\n```session-title\n{"title": "   "}\n```',
  });
  await processOneJob({ runTurn, send: async () => {} });
  assert.equal(getDb().prepare('select title from sessions where id = ?').get(sid).title, 'Test role');
});

test('a reply with both title and email blocks applies both and strips both', async () => {
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'x' });
  let sent;
  const runTurn = async () => ({
    sessionId: 'c-both',
    text: 'Pack ready.\n```session-title\n{"title": "Writer at Beta"}\n```\n```email-to-user\n{"subject":"S","body":"B","attachments":[]}\n```',
  });
  await processOneJob({ runTurn, send: async e => { sent = e; } });
  const s = getDb().prepare('select * from sessions where id = ?').get(sid);
  assert.equal(s.title, 'Writer at Beta');
  assert.equal(s.status, 'done');
  assert.equal(sent.subject, 'S');
  const msg = getDb().prepare("select body from messages where session_id = ? and role = 'claude'").get(sid);
  assert.equal(msg.body, 'Pack ready.');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/spacetimejam/j4dev/portal && npm test`
Expected: the new queue tests FAIL (title remains 'Test role', message body still contains the block).

- [ ] **Step 3: Implement**

In `portal/src/queue.js`, change the import on line 5 to:

```js
import { runAgentTurn, parseEmailDirective, parseTitleDirective } from './agent.js';
```

Replace:

```js
    const { clean, email } = parseEmailDirective(text);
```

with:

```js
    const { clean: afterEmail, email } = parseEmailDirective(text);
    const { clean, title } = parseTitleDirective(afterEmail);
```

Then, immediately after the existing `update sessions set claude_session_id ...` statement, add:

```js
    const newTitle = (title || '').trim().slice(0, 80);
    if (newTitle) {
      db.prepare('update sessions set title = ? where id = ?').run(newTitle, job.session_id);
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/spacetimejam/j4dev/portal && npm test`
Expected: all PASS (existing queue tests keep passing: their texts carry no session-title block, so `clean` is unchanged).

- [ ] **Step 5: Commit**

```bash
cd /home/spacetimejam/j4dev && git add portal/src/queue.js portal/test/queue.test.js
git commit -m "feat(portal): apply agent-supplied session titles in the queue worker"
```

---

### Task 3: card title wrapping CSS

**Files:**
- Modify: `portal/public/style.css`

**Interfaces:** none (visual only; verified live after rollout).

- [ ] **Step 1: Implement**

Append to `portal/public/style.css`:

```css
/* Long unbroken titles (URLs) wrap inside the card instead of running past its
   edge or under the dots strip; the h1 in the session view has the same risk. */
.card strong, h1 { overflow-wrap: anywhere; }
```

- [ ] **Step 2: Run the suite to confirm nothing broke**

Run: `cd /home/spacetimejam/j4dev/portal && npm test`
Expected: all PASS (no server change).

- [ ] **Step 3: Commit**

```bash
cd /home/spacetimejam/j4dev && git add portal/public/style.css
git commit -m "style(portal): wrap long card and heading titles"
```

---

### Task 4: rollout

**Files:** none in-repo (operational).

- [ ] **Step 1: Push, pull, restart**

```bash
cd /home/spacetimejam/j4dev && git push origin master
cd /home/spacetimejam/j4 && git pull --ff-only origin master
systemctl --user restart job-search-portal
```

- [ ] **Step 2: Live check**

Confirm the portal serves the new app assets (`curl -s http://localhost:8710/style.css | grep -c "overflow-wrap"` returns 1+) and, with a real or disposable session, that a URL title wraps within the card and no longer covers the dots. Titles self-heal per session on the agent's next reply; no migration to run.
