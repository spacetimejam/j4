# Portal Keyboard Submit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Cmd+Enter (macOS) or Ctrl+Enter (Windows and Linux) submit the portal's new application box and per-application chat box.

**Architecture:** A new dependency-free ES module `public/keys.js` exports one pure predicate, `isSubmitChord(e)`, which is unit-tested under `node:test` with plain object literals standing in for keyboard events. `public/app.js` gains a `bindSubmit(textarea, button, run)` helper that points both the button's click and the textarea's keydown at the same submit function, guarded by an in-flight flag.

**Tech Stack:** Vanilla ES modules, no build step. Tests are `node:test` plus `node:assert/strict`, run by `npm test` from `portal/`.

## Global Constraints

- Work in the `~/j4dev` checkout, never `~/j4`. The live checkout is pull-only.
- Spec: `docs/superpowers/specs/2026-07-20-portal-keyboard-submit-design.md`.
- Plain Enter must keep inserting a newline in both textareas. Never bind bare Enter to submit.
- Only Claude's messages render markdown; nothing in this plan touches message rendering or `esc()`.
- Docs in British English, and no em or en dashes as sentence punctuation.
- No new npm dependencies. `keys.js` must stay free of DOM calls so `node:test` can import it.

---

### Task 1: The `isSubmitChord` predicate

**Files:**
- Create: `portal/public/keys.js`
- Test: `portal/test/keys.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `isSubmitChord(e) -> boolean`, a named export of `portal/public/keys.js`. Task 2 imports it. The parameter `e` is any object with the shape of a `KeyboardEvent`, read-only, and only these properties are touched: `key`, `metaKey`, `ctrlKey`, `altKey`, `shiftKey`, `repeat`, `isComposing`.

- [ ] **Step 1: Write the failing test**

Create `portal/test/keys.test.js`. The `chord` helper supplies the defaults a real `KeyboardEvent` would have, so each test states only what it is varying.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSubmitChord } from '../public/keys.js';

const chord = over => ({
  key: 'Enter',
  metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
  repeat: false, isComposing: false,
  ...over,
});

test('accepts Cmd+Enter and Ctrl+Enter', () => {
  assert.equal(isSubmitChord(chord({ metaKey: true })), true);
  assert.equal(isSubmitChord(chord({ ctrlKey: true })), true);
});

test('ignores Enter with no modifier, so it still inserts a newline', () => {
  assert.equal(isSubmitChord(chord({})), false);
  assert.equal(isSubmitChord(chord({ shiftKey: true })), false);
});

test('ignores the chord when Alt or Shift is also held', () => {
  assert.equal(isSubmitChord(chord({ metaKey: true, altKey: true })), false);
  assert.equal(isSubmitChord(chord({ metaKey: true, shiftKey: true })), false);
  assert.equal(isSubmitChord(chord({ ctrlKey: true, shiftKey: true })), false);
});

test('ignores other keys held with the modifier', () => {
  assert.equal(isSubmitChord(chord({ key: 'k', metaKey: true })), false);
  assert.equal(isSubmitChord(chord({ key: 'a', ctrlKey: true })), false);
});

test('ignores an auto-repeating held chord', () => {
  assert.equal(isSubmitChord(chord({ metaKey: true, repeat: true })), false);
});

test('ignores Enter that is confirming an IME composition', () => {
  assert.equal(isSubmitChord(chord({ metaKey: true, isComposing: true })), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ~/j4dev/portal && npm test
```

Expected: FAIL. The run cannot resolve `../public/keys.js`, so it reports `ERR_MODULE_NOT_FOUND` for `keys.test.js`. The other suites still pass.

- [ ] **Step 3: Write the minimal implementation**

Create `portal/public/keys.js`:

```js
/* Cmd+Enter on macOS, Ctrl+Enter elsewhere. Both modifiers are accepted on
   every platform: neither combination is bound to anything else in the portal,
   so there is nothing to gain from sniffing the platform here.

   The exclusions matter. Alt and Shift keep neighbouring chords such as
   Cmd+Shift+Enter from submitting; repeat stops a held chord firing a burst of
   submissions; isComposing stops the shortcut hijacking the Enter that
   confirms an IME candidate. */
export function isSubmitChord(e) {
  return e.key === 'Enter' && (e.metaKey || e.ctrlKey)
    && !e.altKey && !e.shiftKey && !e.repeat && !e.isComposing;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd ~/j4dev/portal && npm test
```

Expected: PASS, with the six new `keys.test.js` tests included and every pre-existing suite still green.

- [ ] **Step 5: Commit**

```bash
cd ~/j4dev
git add portal/public/keys.js portal/test/keys.test.js
git commit -m "feat(portal): add Cmd/Ctrl+Enter chord predicate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Wire both textareas to the chord

**Files:**
- Modify: `portal/public/app.js:1` (add the import), `:6-8` (add the platform constant), a new `bindSubmit` helper beside `openSheet`, `portal/public/app.js:60-72` (`renderList`), `portal/public/app.js:122-128` (`renderSession`)

**Interfaces:**
- Consumes: `isSubmitChord(e) -> boolean` from `./keys.js`, as defined in Task 1.
- Produces: nothing that a later task depends on. This is the final code task.

There is no automated test here. Verifying `bindSubmit` needs a real DOM, and adding jsdom for two bindings is not worth the dependency, so Step 5 is a manual browser check. Note that `renderList` and `renderSession` both rewrite `app.innerHTML` on every call, so handlers are re-attached on each render and no listener cleanup is needed.

- [ ] **Step 1: Add the import, the platform constant and the helper**

In `portal/public/app.js`, add to the existing import at line 1:

```js
import { renderMarkdown } from './markdown.js';
import { isSubmitChord } from './keys.js';
```

Below the existing `LABELS` line, beside `let TITLE`, add:

```js
/* navigator.platform is deprecated but still populated everywhere current; the
   userAgent fallback covers its removal. Getting this wrong only mislabels a
   tooltip, because isSubmitChord accepts both modifiers on every platform. */
const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
const SUBMIT_HINT = isMac ? 'Cmd+Enter' : 'Ctrl+Enter';
```

Add this helper directly after the `openSheet` function (after line 41):

```js
/* Point a textarea and its button at the same submit, so the chord and a click
   do the same thing. The in-flight flag means a fast second chord cannot fire a
   second POST while the first is still going, which also covers double-clicks. */
function bindSubmit(textarea, button, run) {
  let busy = false;
  const go = async () => {
    if (busy) return;
    busy = true;
    try { await run(); } finally { busy = false; }
  };
  button.onclick = go;
  textarea.onkeydown = e => {
    if (!isSubmitChord(e)) return;
    e.preventDefault();
    go();
  };
}
```

- [ ] **Step 2: Convert the new application box in `renderList`**

In the template literal, give the button its tooltip. Replace:

```js
      <button id="submit">Send to Claude</button></div>
```

with:

```js
      <button id="submit" title="Send to Claude (${SUBMIT_HINT})">Send to Claude</button></div>
```

Then replace the whole existing handler:

```js
  document.getElementById('submit').onclick = async () => {
    const jd = document.getElementById('jd').value;
    if (!jd.trim()) return alert('Please paste the job description or a link to it.');
    const { id } = await (await api('/sessions', { method: 'POST', body: JSON.stringify({ jd }) })).json();
    location.hash = id;
  };
```

with:

```js
  bindSubmit(document.getElementById('jd'), document.getElementById('submit'), async () => {
    const jd = document.getElementById('jd').value;
    if (!jd.trim()) return alert('Please paste the job description or a link to it.');
    const { id } = await (await api('/sessions', { method: 'POST', body: JSON.stringify({ jd }) })).json();
    location.hash = id;
  });
```

- [ ] **Step 3: Convert the chat box in `renderSession`**

In the template literal, replace:

```js
    <textarea id="reply" placeholder="Your reply"></textarea><button id="send">Send</button>`;
```

with:

```js
    <textarea id="reply" placeholder="Your reply"></textarea><button id="send" title="Send (${SUBMIT_HINT})">Send</button>`;
```

Then replace the whole existing handler:

```js
  document.getElementById('send').onclick = async () => {
    const body = document.getElementById('reply').value;
    if (!body.trim()) return;
    await api(`/sessions/${id}/reply`, { method: 'POST', body: JSON.stringify({ body }) });
    renderSession(id);
  };
```

with:

```js
  bindSubmit(document.getElementById('reply'), document.getElementById('send'), async () => {
    const body = document.getElementById('reply').value;
    if (!body.trim()) return;
    await api(`/sessions/${id}/reply`, { method: 'POST', body: JSON.stringify({ body }) });
    renderSession(id);
  });
```

- [ ] **Step 4: Run the full suite for regressions**

```bash
cd ~/j4dev/portal && npm test
```

Expected: PASS, unchanged from Task 1 Step 4. No test exercises `app.js`, so this is purely a check that nothing else broke.

- [ ] **Step 5: Check it by hand in a desktop browser**

```bash
cd ~/j4dev/portal && npm start
```

Open the printed local URL and log in. Confirm all six:

1. Typing in the new application box and pressing Ctrl+Enter (Cmd+Enter on a Mac) creates the application, exactly as the button does.
2. Plain Enter in that same box still inserts a newline and does not submit.
3. In a session, Ctrl+Enter in the reply box sends the reply.
4. Plain Enter in the reply box still inserts a newline.
5. Both buttons still work when clicked.
6. Hovering each button shows the shortcut in a tooltip.

Stop the server with Ctrl+C when done.

- [ ] **Step 6: Commit**

```bash
cd ~/j4dev
git add portal/public/app.js
git commit -m "feat(portal): submit both textareas with Cmd/Ctrl+Enter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Record the decision and roll out

**Files:**
- Modify: `CLAUDE.md` (the "Key decisions" list)

**Interfaces:**
- Consumes: the working feature from Task 2.
- Produces: nothing. This is the final task.

- [ ] **Step 1: Add the decision to `CLAUDE.md`**

Add this bullet to the "Key decisions" list, directly after the "Markdown rendering, Claude's replies only" entry:

```markdown
- **Keyboard submit.** Cmd+Enter (macOS) or Ctrl+Enter submits both portal
  textareas, via `isSubmitChord` in `portal/public/keys.js` and `bindSubmit` in
  `app.js`. Plain Enter stays a newline in both boxes, deliberately: the new
  application box receives pasted multi-line job descriptions. `bindSubmit` also
  guards against double submits. Spec:
  `docs/superpowers/specs/2026-07-20-portal-keyboard-submit-design.md`.
```

- [ ] **Step 2: Commit**

```bash
cd ~/j4dev
git add CLAUDE.md
git commit -m "docs: record portal keyboard submit in CLAUDE.md

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 3: Push, then update the live checkout**

```bash
cd ~/j4dev && git push
cd ~/j4 && git pull --ff-only
```

Expected: the pull fast-forwards cleanly. Both checkouts started this work on `6eb55e1` and `~/j4` has no commits of its own.

- [ ] **Step 4: Confirm the live portal picked it up**

No service restart is needed. These are frontend-only static files, and `express.static` serves them fresh from disk on each request. Hard-reload https://jawbs.duckdns.org in a desktop browser and confirm Ctrl+Enter sends from a reply box.
