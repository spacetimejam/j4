# Portal Application Stage Pills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the portal's prose conversation-state pill with a short application-stage pill read from `tracker/applications.csv`, move the reply prompt to a red corner badge, and fix the two layout faults the long labels exposed.

**Architecture:** A new dependency-free `portal/src/tracker.js` parses the tracker CSV and matches a session to a row by its `<Role> at <Org>` title. `server.js` attaches a derived `stage` field to session responses, overriding it with `working` mid-turn and with `inactive` when an `applying` session has been quiet for 28 days. The frontend renders `stage` as the pill and `status` as the badge.

**Tech Stack:** Node 20+, Express 5, better-sqlite3, `node:test`. Frontend is dependency-free ES modules served by `express.static`.

Spec: `docs/superpowers/specs/2026-07-21-portal-application-stage-pills-design.md`

## Global Constraints

- Work in the `~/j4dev` checkout, on branch `feat/portal-application-stage-pills`. Never push from `~/j4`.
- Frontend and tracker parsing stay dependency-free. No new npm packages.
- Timestamps are stored as UTC and never converted at rest. Any `Date` parsing of a SQLite timestamp must append `Z`, because `YYYY-MM-DD HH:MM:SS` has no zone marker and `Date` reads that shape as local time.
- All user-supplied or filesystem-derived text rendered into HTML goes through `esc()` in `app.js`.
- British English in comments and user-visible copy. No em dashes or en dashes as sentence punctuation.
- The pill vocabulary is exactly: `Jawbs is working`, `Researching`, `Applying`, `Interviewing`, `Hired`, `Turned down`, `Inactive`. An unrecognised tracker value renders no pill at all.
- Every task ends with a commit. Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: `portal/src/tracker.js`

**Files:**
- Create: `portal/src/tracker.js`
- Test: `portal/test/tracker.test.js` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `parseCsv(text)` returns an array of row objects keyed by the trimmed header row. Values are trimmed. Blank lines are skipped.
  - `readTracker(projectDir)` returns parsed rows from `<projectDir>/tracker/applications.csv`, or `[]` if it is missing or unreadable. Never throws.
  - `stageFor(title, rows)` returns one of `'researching'`, `'applying'`, `'interviewing'`, `'hired'`, `'turned_down'`, or `null`.

- [ ] **Step 1: Write the failing tests**

Create `portal/test/tracker.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseCsv, readTracker, stageFor } from '../src/tracker.js';

test('parseCsv keys rows by header and trims values', () => {
  const rows = parseCsv('Role,Org,Status\n Designer , Acme , Applied \n');
  assert.deepEqual(rows, [{ Role: 'Designer', Org: 'Acme', Status: 'Applied' }]);
});

test('parseCsv handles quoted commas, escaped quotes and CRLF', () => {
  const rows = parseCsv('Role,Org,Notes\r\nDesigner,Acme,"one, two ""quoted"" three"\r\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Notes, 'one, two "quoted" three');
});

test('parseCsv handles a newline inside a quoted field', () => {
  const rows = parseCsv('Role,Notes\nDesigner,"line one\nline two"\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Notes, 'line one\nline two');
});

test('parseCsv skips blank lines and returns [] for empty input', () => {
  assert.deepEqual(parseCsv(''), []);
  assert.equal(parseCsv('Role,Org\nDesigner,Acme\n\n\n').length, 1);
});

test('stageFor matches Role and Org, case-insensitively', () => {
  const rows = [{ Role: 'Content Lead', Org: 'Wellcome Trust', Status: 'Applied' }];
  assert.equal(stageFor('Content Lead at Wellcome Trust', rows), 'applying');
  assert.equal(stageFor('content lead at WELLCOME TRUST', rows), 'applying');
});

test('stageFor matches when either Org is a prefix of the other', () => {
  const rows = [{ Role: 'Social Strategy Director', Org: 'M+C Saatchi UK', Status: 'Interviewing' }];
  assert.equal(stageFor('Social Strategy Director at M+C Saatchi', rows), 'interviewing');
  const short = [{ Role: 'Social Strategy Director', Org: 'M+C Saatchi', Status: 'Interviewing' }];
  assert.equal(stageFor('Social Strategy Director at M+C Saatchi UK', short), 'interviewing');
});

test('stageFor prefers an exact Org match over a prefix one', () => {
  const rows = [
    { Role: 'Designer', Org: 'Acme Group', Status: 'Applied' },
    { Role: 'Designer', Org: 'Acme', Status: 'Hired' },
  ];
  assert.equal(stageFor('Designer at Acme', rows), 'hired');
});

test('stageFor splits on the last " at "', () => {
  const rows = [{ Role: 'Analyst at Home', Org: 'Acme', Status: 'Researching' }];
  assert.equal(stageFor('Analyst at Home at Acme', rows), 'researching');
});

test('stageFor maps every legacy tracker value', () => {
  const cases = {
    Sourced: 'researching', Researching: 'researching',
    Drafting: 'applying', Applied: 'applying', Applying: 'applying',
    Interviewing: 'interviewing', Offer: 'interviewing',
    Hired: 'hired',
    Rejected: 'turned_down', Withdrawn: 'turned_down', 'Turned down': 'turned_down',
  };
  for (const [value, expected] of Object.entries(cases)) {
    const rows = [{ Role: 'Designer', Org: 'Acme', Status: value }];
    assert.equal(stageFor('Designer at Acme', rows), expected, value);
  }
});

test('stageFor returns null for an unknown status, no " at ", or no matching role', () => {
  assert.equal(stageFor('Designer at Acme', [{ Role: 'Designer', Org: 'Acme', Status: 'On hold' }]), null);
  assert.equal(stageFor('Designer at Acme', [{ Role: 'Designer', Org: 'Acme', Status: '' }]), null);
  assert.equal(stageFor('Just a title', [{ Role: 'Designer', Org: 'Acme', Status: 'Applied' }]), null);
  assert.equal(stageFor('Writer at Beta', [{ Role: 'Designer', Org: 'Acme', Status: 'Applied' }]), null);
  assert.equal(stageFor('', []), null);
});

test('readTracker reads the file and returns [] when it is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracker-'));
  assert.deepEqual(readTracker(dir), []);
  assert.deepEqual(readTracker(undefined), []);
  mkdirSync(join(dir, 'tracker'));
  writeFileSync(join(dir, 'tracker', 'applications.csv'), 'Role,Org,Status\nDesigner,Acme,Applied\n');
  assert.equal(readTracker(dir)[0].Org, 'Acme');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd portal && node --test test/tracker.test.js`
Expected: FAIL, cannot find module `../src/tracker.js`.

- [ ] **Step 3: Write the implementation**

Create `portal/src/tracker.js`:

```js
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* A minimal RFC 4180 reader. The tracker's Notes column is long prose full of
   commas and quoted passages, so splitting on commas would mangle most rows,
   and a dependency for one file read is not warranted. */
export function parseCsv(text) {
  const s = String(text ?? '').replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c !== '"') { field += c; continue; }
      if (s[i + 1] === '"') { field += '"'; i++; continue; }
      quoted = false;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  if (!header) return [];
  const keys = header.map(h => h.trim());
  return rows
    .filter(r => r.some(v => v.trim() !== ''))
    .map(r => Object.fromEntries(keys.map((k, n) => [k, (r[n] ?? '').trim()])));
}

/* Legacy values are kept in the map so an existing tracker reads correctly
   without being rewritten, and so a hand-typed row still lands somewhere
   sensible. Anything unrecognised deliberately yields no pill: a wrong stage
   is worse than none. */
const STAGES = {
  sourced: 'researching', researching: 'researching',
  drafting: 'applying', applied: 'applying', applying: 'applying',
  interviewing: 'interviewing', offer: 'interviewing',
  hired: 'hired',
  rejected: 'turned_down', withdrawn: 'turned_down', 'turned down': 'turned_down',
};

export function readTracker(projectDir) {
  if (!projectDir) return [];
  try {
    return parseCsv(readFileSync(join(projectDir, 'tracker', 'applications.csv'), 'utf8'));
  } catch {
    return []; // a missing or unreadable tracker simply means no pills
  }
}

/* Sessions are titled "<Role> at <Org>" by the agent's session-title directive.
   Split on the last " at ", since a role can contain the word. Org matches when
   either value is a prefix of the other, which is what lets a session titled
   "... at M+C Saatchi" find the tracker's "M+C Saatchi UK". */
export function stageFor(title, rows) {
  const t = String(title ?? '');
  const at = t.lastIndexOf(' at ');
  if (at < 0) return null;
  const role = t.slice(0, at).trim().toLowerCase();
  const org = t.slice(at + 4).trim().toLowerCase();
  if (!role || !org) return null;
  let match = null;
  for (const r of rows) {
    if ((r.Role || '').trim().toLowerCase() !== role) continue;
    const o = (r.Org || '').trim().toLowerCase();
    if (!o) continue;
    if (o === org) { match = r; break; }
    if (!match && (o.startsWith(org) || org.startsWith(o))) match = r;
  }
  if (!match) return null;
  return STAGES[(match.Status || '').trim().toLowerCase()] || null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd portal && node --test test/tracker.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 5: Run the whole suite for regressions**

Run: `cd portal && npm test`
Expected: PASS, no failures.

- [ ] **Step 6: Commit**

```bash
cd ~/j4dev
git add portal/src/tracker.js portal/test/tracker.test.js
git commit -m "feat(portal): read application stage from the tracker CSV

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Attach `stage` to session responses

**Files:**
- Modify: `portal/src/server.js` (imports, a new `withStage` helper, the two read routes)
- Test: `portal/test/server.test.js` (add cases)

**Interfaces:**
- Consumes: `readTracker` and `stageFor` from Task 1.
- Produces:
  - `INACTIVE_DAYS`, exported from `server.js`, value `28`.
  - `GET /api/sessions` and `GET /api/sessions/:id` responses gain `stage`, one of `'working'`, `'researching'`, `'applying'`, `'interviewing'`, `'hired'`, `'turned_down'`, `'inactive'`, or `null`. `status` is unchanged and still present.

- [ ] **Step 1: Write the failing tests**

Append to `portal/test/server.test.js`, before the final `test.after(...)` line:

```js
test('sessions carry a stage read from the tracker', async () => {
  mkdirSync(join(projectDir, 'tracker'), { recursive: true });
  writeFileSync(join(projectDir, 'tracker', 'applications.csv'),
    'Role,Org,Status\n'
    + 'Content Lead,Wellcome Trust,Applied\n'
    + 'Social Strategy Director,M+C Saatchi UK,Interviewing\n'
    + 'Campaigns Lead,Economic Change Unit,Withdrawn\n');
  const mk = async jd => {
    const r = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ jd }),
    });
    return (await r.json()).id;
  };
  const applying = await mk('Content Lead at Wellcome Trust');
  const interviewing = await mk('Social Strategy Director at M+C Saatchi');
  const unmatched = await mk('Some Role at Nowhere Ltd');
  // sessions are created 'working', which overrides the tracker stage
  const working = await (await fetch(`${base}/api/sessions/${applying}`, { headers: { cookie: ownerCookie } })).json();
  assert.equal(working.stage, 'working');

  const db = getDb();
  db.prepare("update sessions set status = 'awaiting_reply' where id in (?, ?, ?)")
    .run(applying, interviewing, unmatched);

  const detail = await (await fetch(`${base}/api/sessions/${applying}`, { headers: { cookie: ownerCookie } })).json();
  assert.equal(detail.stage, 'applying');

  const list = await (await fetch(`${base}/api/sessions`, { headers: { cookie: ownerCookie } })).json();
  const byId = Object.fromEntries(list.map(s => [s.id, s.stage]));
  assert.equal(byId[applying], 'applying');
  assert.equal(byId[interviewing], 'interviewing');
  assert.equal(byId[unmatched], null);
  // status is still present, because the reply badge needs it
  assert.equal(list.find(s => s.id === applying).status, 'awaiting_reply');
});

test('an applying session goes inactive after the quiet period', async () => {
  const r = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ jd: 'Content Lead at Wellcome Trust' }),
  });
  const { id } = await r.json();
  const db = getDb();
  const stageAfter = async days => {
    db.prepare("update sessions set status = 'awaiting_reply', updated_at = datetime('now', ?) where id = ?")
      .run(`-${days} days`, id);
    const s = await (await fetch(`${base}/api/sessions/${id}`, { headers: { cookie: ownerCookie } })).json();
    return s.stage;
  };
  assert.equal(await stageAfter(INACTIVE_DAYS - 1), 'applying');
  assert.equal(await stageAfter(INACTIVE_DAYS + 1), 'inactive');
});

test('only an applying stage can go inactive', async () => {
  const r = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ jd: 'Social Strategy Director at M+C Saatchi' }),
  });
  const { id } = await r.json();
  getDb().prepare("update sessions set status = 'awaiting_reply', updated_at = datetime('now', '-400 days') where id = ?").run(id);
  const s = await (await fetch(`${base}/api/sessions/${id}`, { headers: { cookie: ownerCookie } })).json();
  assert.equal(s.stage, 'interviewing');
});
```

The file already imports `mkdirSync` and `writeFileSync`. Add `INACTIVE_DAYS` to the existing `createApp` import line:

```js
const { createApp, INACTIVE_DAYS } = await import('../src/server.js');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd portal && node --test test/server.test.js`
Expected: FAIL, `stage` is `undefined` rather than `'working'`.

- [ ] **Step 3: Write the implementation**

In `portal/src/server.js`, add to the imports:

```js
import { readTracker, stageFor } from './tracker.js';
```

Add at module scope, below `getOwnSession`:

```js
export const INACTIVE_DAYS = 28;

/* The pill shows where the application stands, from the tracker, except while a
   turn is running. Inactive is derived here rather than stored: nothing has to
   maintain it and it clears itself on the next reply. */
function withStage(session, rows) {
  if (session.status === 'working') return { ...session, stage: 'working' };
  const stage = stageFor(session.title, rows);
  if (stage !== 'applying') return { ...session, stage };
  /* SQLite's YYYY-MM-DD HH:MM:SS carries no zone marker and Date reads that
     shape as local time, so the Z is what makes this UTC, as in formatLondon.
     A malformed timestamp gives NaN, which fails the comparison and leaves the
     session on applying, which is the safer answer. */
  const age = Date.now() - Date.parse(`${String(session.updated_at).replace(' ', 'T')}Z`);
  return { ...session, stage: age > INACTIVE_DAYS * 86400000 ? 'inactive' : 'applying' };
}
```

In `GET /api/sessions`, replace `res.json(rows)` with:

```js
    const tracker = readTracker(getUser(req.userEmail)?.projectDir);
    res.json(rows.map(s => withStage(s, tracker)));
```

The tracker is read once per request, not once per session, so a list of twelve costs one file read.

In `GET /api/sessions/:id`, replace `res.json({ ...session, messages, files })` with:

```js
    const tracker = readTracker(getUser(req.userEmail)?.projectDir);
    res.json({ ...withStage(session, tracker), messages, files });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd portal && node --test test/server.test.js`
Expected: PASS, 20 tests.

- [ ] **Step 5: Run the whole suite for regressions**

Run: `cd portal && npm test`
Expected: PASS, no failures.

- [ ] **Step 6: Commit**

```bash
cd ~/j4dev
git add portal/src/server.js portal/test/server.test.js
git commit -m "feat(portal): derive an application stage for each session

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Pills, badge and layout

**Files:**
- Modify: `portal/public/app.js` (the `LABELS` constant, `renderList`, `renderSession`)
- Modify: `portal/public/style.css` (`.pill` block, a new `.card .meta` and `.badge-reply`, `.chat-title`, `.chat-bar .pill`, the `.card strong, h1` rule)

**Interfaces:**
- Consumes: the `stage` field from Task 2, and the existing `status` field.
- Produces: no exports. The list card gains `.meta` and `.badge-reply`; the pill's class is now the stage key.

This task is DOM code and is verified by eye, following the precedent set for `bindSubmit` and the documents panel. **Do not run `npm start` and try to check it in a browser: you cannot log in, because the portal needs an emailed magic-link token.** Verify structurally as described in the steps, and the owner does the visual check at rollout.

- [ ] **Step 1: Replace the label map**

In `portal/public/app.js`, replace this line:

```js
const LABELS = { working: 'Claude is working', awaiting_reply: 'Your turn', done: 'Sent to your inbox, reply here with any notes', needs_attention: 'Needs attention', active: 'New' };
```

with:

```js
/* The pill shows where the application stands, from the tracker, except while
   Claude is mid-turn. Whether the chat wants a reply is a separate axis and
   shows as the red corner badge instead, so the two stop competing for one
   element. An unknown stage renders no pill at all. */
const STAGES = {
  working: 'Jawbs is working', researching: 'Researching', applying: 'Applying',
  interviewing: 'Interviewing', hired: 'Hired', turned_down: 'Turned down',
  inactive: 'Inactive',
};
const NEEDS_REPLY = new Set(['awaiting_reply', 'needs_attention']);
const pill = s => (STAGES[s.stage] ? `<span class="pill ${s.stage}">${STAGES[s.stage]}</span>` : '');
```

- [ ] **Step 2: Rebuild the list card**

In `renderList`, replace these two lines:

```js
      <a class="card has-menu" href="#${s.id}"><span class="pill ${s.status}">${LABELS[s.status] || s.status}</span>
      <strong>${esc(s.title)}</strong><div class="muted">${formatLondon(s.updated_at)}</div>
```

with:

```js
      <a class="card has-menu" href="#${s.id}"><strong>${esc(s.title)}</strong>
      <div class="meta"><span class="muted">${formatLondon(s.updated_at)}</span>${pill(s)}</div>
      ${NEEDS_REPLY.has(s.status) ? `<span class="badge-reply" aria-label="${esc(s.title)}: waiting for your reply">Reply</span>` : ''}
```

- [ ] **Step 3: Use the stage in the chat bar**

In `renderSession`, replace:

```js
      <span class="pill ${s.status}">${LABELS[s.status] || s.status}</span>
```

with:

```js
      ${pill(s)}
```

- [ ] **Step 4: Update the stylesheet**

In `portal/public/style.css`, replace the whole `.pill` rule and the four status colour rules under the "Status" comment:

```css
/* Status: a coloured dot and a quiet lowercase label */
.pill {
  font-size: 0.8rem;
  color: var(--ink-soft);
  float: right;
  margin-left: 12px;
  white-space: nowrap;
}
```

with:

```css
/* Application stage: a coloured dot and a quiet label. The float is gone
   deliberately: it made the card title wrap around the pill and split words
   mid-word. The pill now sits on the timestamp line instead. */
.pill {
  font-size: 0.8rem;
  color: var(--ink-soft);
  white-space: nowrap;
}
```

Replace these four rules:

```css
.pill.working::before { background: var(--amber); animation: breathe 2.4s ease-in-out infinite; }
.pill.awaiting_reply::before { background: var(--accent); }
.pill.done::before { background: var(--green); }
.pill.needs_attention::before { background: var(--red); }
```

with:

```css
.pill.working::before { background: var(--amber); animation: breathe 2.4s ease-in-out infinite; }
.pill.applying::before { background: var(--accent); }
.pill.interviewing::before { background: var(--amber); }
.pill.hired::before { background: var(--green); }
.pill.turned_down::before { background: var(--red); }
/* researching and inactive keep the default --ink-soft dot */
```

Add after the reduced-motion block:

```css
/* Timestamp on the left, stage pill on the right, on one line */
.card .meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

/* "Reply" flag over the card's top-right corner. The card is already
   position: relative for its overflow menu. */
.badge-reply {
  position: absolute;
  top: -6px;
  right: 12px;
  padding: 3px 7px;
  border-radius: 6px;
  background: var(--red);
  color: #fff;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
```

Change `.chat-title`'s font size from `1.05rem` to `0.93rem` (the 2px the owner asked for, at a 16px root).

Replace the `.chat-bar .pill` rule:

```css
.chat-bar .pill { float: none; margin: 0; flex: none; }
```

with:

```css
/* Shrinkable rather than flex: none, so no future label can widen the page
   past the viewport the way the old prose ones did. */
.chat-bar .pill {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

Finally, split the shared wrap rule at the end of the file:

```css
.card strong, h1 { overflow-wrap: anywhere; }
```

becomes:

```css
/* anywhere stays on h1, which includes the chat bar's single truncated line and
   still has to cope with a pasted URL. The card title is a wrapping block and
   only needs to break at word boundaries now that no float sits beside it. */
.card strong { overflow-wrap: break-word; }
h1 { overflow-wrap: anywhere; }
```

- [ ] **Step 5: Verify structurally**

Parse-check the module: copy `portal/public/app.js` to a temporary `.mjs` file and run `node --check` on it. Confirm the check works by injecting a deliberate syntax error first and seeing it fail, then restore and delete the temporary file.

Confirm the CSS braces balance, and that no rule still references `.pill.awaiting_reply`, `.pill.done` or `.pill.needs_attention`:

Run: `cd portal && grep -n "awaiting_reply\|\.pill\.done\|needs_attention" public/style.css`
Expected: no output.

Run: `cd portal && grep -n "LABELS" public/app.js`
Expected: no output.

- [ ] **Step 6: Run the suite for regressions**

Run: `cd portal && npm test`
Expected: PASS, no failures.

- [ ] **Step 7: Commit**

```bash
cd ~/j4dev
git add portal/public/app.js portal/public/style.css
git commit -m "feat(portal): show application stage as the pill, reply as a badge

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Agent prompt, templates and CLAUDE.md

**Files:**
- Modify: `portal/src/agent.js` (five status values and one trigger condition)
- Modify: `template/tracker/tracker.md:13`
- Modify: `template/WORKFLOW.md:19`
- Modify: `CLAUDE.md` (Key decisions list)

**Interfaces:**
- Consumes: the vocabulary from Task 1's `STAGES` map.
- Produces: nothing consumed by later tasks.

Read `portal/src/agent.js` in full before editing. The status words appear inside a long template literal prompt; change only the tracker values and the one trigger condition, and leave the surrounding prose voice alone.

- [ ] **Step 1: Update the agent prompt**

In `portal/src/agent.js`:

- Line 18: `(Status = Researching)` stays as it is. Confirm it, change nothing.
- Line 30: `set the tracker Status to Withdrawn` becomes `set the tracker Status to Turned down`.
- Line 38: `Status = Interviewing` stays as it is. Confirm it, change nothing.
- Line 52: `set the tracker Status to Rejected` becomes `set the tracker Status to Turned down`.
- Line 56: `set the tracker Status to Offer` becomes `set the tracker Status to Interviewing and record the offer in the notes`.

Line 33 is the substantive one. The stage 3 trigger currently reads:

```
STAGE 3: AFTER APPLYING. Once the application has been sent (tracker Status is Applied or later),
```

`Drafting` and `Applied` have collapsed into one `Applying` value, so a Status comparison can no longer tell whether the application went out. Change the test to the column that records exactly that:

```
STAGE 3: AFTER APPLYING. Once the application has been sent (the tracker row's Date_Applied is filled in),
```

Lines 35 and 36 follow on and currently read:

```
WORKFLOW.md section 7. When ${userName} confirms the application has been sent, set the tracker
Status to Applied per WORKFLOW.md section 6. Work out what the news is, then:
```

Setting the Status is now a no-op, since the row is already `Applying` from the drafting work, and the trigger above depends on `Date_Applied` instead. Replace those two lines with:

```
WORKFLOW.md section 7. When ${userName} confirms the application has been sent, fill in the
tracker row's Date_Applied per WORKFLOW.md section 6; the Status stays Applying. Work out what
the news is, then:
```

- [ ] **Step 2: Update the templates**

In `template/tracker/tracker.md`, line 13 currently reads:

```
| Status | Choice | Sourced / Researching / Drafting / Applied / Interviewing / Offer / Rejected / Withdrawn / On hold |
```

Replace the choice list with the five tracker values:

```
| Status | Choice | Researching / Applying / Interviewing / Hired / Turned down |
```

In `template/WORKFLOW.md`, line 19 currently reads:

```
- Log to the tracker: Role, Org, Source, `Status = Sourced` (or `Researching`).
```

Replace with:

```
- Log to the tracker: Role, Org, Source, `Status = Researching`.
```

There is one further use, `template/WORKFLOW.md:54`:

```
- Tracker: `Status → Applied`, `Date_Applied`, `CV_Version`, `Letter_Version`, and set `Next_Action` + `Next_Action_Date`.
```

becomes:

```
- Tracker: `Status → Applying`, `Date_Applied`, `CV_Version`, `Letter_Version`, and set `Next_Action` + `Next_Action_Date`.
```

Confirm with `cd ~/j4dev && grep -rn "Sourced\|Drafting\|Offer\|Rejected\|Withdrawn\|On hold" template/` that the only remaining match is `template/core/intake.md:15`, where "Offer:" is the verb "offer them a choice" and not a tracker status. Leave that one alone.

Do **not** change anything under `docs/superpowers/specs/` or `docs/superpowers/plans/` dated before today: those are historical records of decisions taken at the time, and the repo's convention is not to rewrite them for later changes.

- [ ] **Step 3: Add the decision to CLAUDE.md**

Append to the "Key decisions — don't re-litigate" list, after the documents entry. Match the neighbouring entries' house style: a bolded lead sentence, then the reasoning, with specific file and function names. Keep it to roughly the length of its neighbours, which run 700 to 1100 characters.

It must cover: the pill shows application stage from `tracker/applications.csv` rather than conversation state, with `working` overriding it and the reply prompt moved to a red corner badge; `stageFor` in `portal/src/tracker.js` matches a session by its `<Role> at <Org>` title, splitting on the last ` at ` with prefix matching on the org; legacy tracker values are kept in the map so existing CSVs read correctly and an unrecognised value renders no pill; `inactive` is derived at display time from `INACTIVE_DAYS` rather than stored; and the stage 3 trigger in `agent.js` keys off `Date_Applied` being filled in, not a Status comparison, because `Applying` spans both sides of sending. Cite the spec: `docs/superpowers/specs/2026-07-21-portal-application-stage-pills-design.md`.

- [ ] **Step 4: Verify**

Run: `cd portal && npm test`
Expected: PASS, no failures.

Run: `bash setup/test/run-tests.sh`
Expected: `Failed: 0`.

Run: `cd ~/j4dev && grep -rn "Applied or later" portal/src/agent.js`
Expected: no output.

Check for em and en dashes in what you wrote:
Run: `cd ~/j4dev && grep -nP '[\x{2013}\x{2014}]' CLAUDE.md template/tracker/tracker.md template/WORKFLOW.md portal/src/agent.js`
Expected: only pre-existing matches, none on lines you added or changed.

- [ ] **Step 5: Commit**

```bash
cd ~/j4dev
git add portal/src/agent.js template/tracker/tracker.md template/WORKFLOW.md CLAUDE.md
git commit -m "feat(portal): move the tracker to the five-stage vocabulary

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Live data migration (after all tasks, not a task)

`s/`, `n/` and `jc/` are untracked personal folders, so this is an operational step the owner runs, not a commit. Eleven rows across `s/tracker/applications.csv` and `n/tracker/applications.csv` get their `Status` rewritten: `Drafting` and `Applied` to `Applying`, `Withdrawn` to `Turned down`, `Researching` and `Interviewing` unchanged. The rewrite must preserve the CSV's existing quoting, so it needs a real CSV reader and writer rather than `sed`.

This is tidiness, not a prerequisite: `stageFor` maps the legacy values, so the portal reads the existing rows correctly either way.

## Rollout

Merge, push from `~/j4dev`, `git pull` in `~/j4`, then `systemctl --user restart job-search-portal`. The restart is needed because `server.js`, `tracker.js` and `agent.js` all changed. No schema change this time.
