# Portal Archive and Permanent Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a portal user archive applications off the main list, and permanently delete already-archived ones (removing the application folder on disk and leaving a DELETED.md record).

**Architecture:** A guarded `archived` column on `sessions`; three new endpoints (archive, restore, delete) plus an `?archived=1` filter on the list endpoint; a new `src/deletion.js` module owning folder derivation, the deletion log, and folder removal; vanilla-JS UI additions (card three-dot menu, cog menu, bottom sheet, `#archived` page).

**Tech Stack:** Node 20+, Express, better-sqlite3, node:test, vanilla JS/CSS frontend. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-19-portal-archive-delete-design.md`

## Global Constraints

- Work in `~/j4dev` (the push-capable checkout), repo root `/home/spacetimejam/j4dev`.
- Run tests with `cd /home/spacetimejam/j4dev/portal && npm test`.
- Owner-only access: missing and forbidden are both 404 (existing `getOwnSession` pattern).
- Delete returns 409 unless the session is already archived.
- Never delete files outside `applications/<slug>/` directly under the user's projectDir; never touch the tracker CSV.
- UI copy in British English; no em/en dashes as sentence punctuation.
- No new npm dependencies; frontend stays vanilla JS.

---

### Task 1: `archived` column migration

**Files:**
- Modify: `portal/src/db.js` (the guarded-migration block in `getDb`, lines 49-53)
- Test: `portal/test/db.test.js`

**Interfaces:**
- Produces: `sessions.archived` integer column, not null, default 0. Later tasks read/write it with plain SQL.

- [ ] **Step 1: Write the failing test**

Append to `portal/test/db.test.js`:

```js
test('sessions table has an archived column defaulting to 0', () => {
  const db = getDb();
  const cols = db.prepare('pragma table_info(sessions)').all();
  const col = cols.find(c => c.name === 'archived');
  assert.ok(col, 'archived column exists');
  db.prepare("insert into sessions (id, user_email, title) values ('arch-col-test', 'a@b.c', 'T')").run();
  assert.equal(db.prepare("select archived from sessions where id = 'arch-col-test'").get().archived, 0);
});
```

(If `db.test.js` imports differ, match its existing imports of `test`, `assert`, `getDb`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/spacetimejam/j4dev/portal && npm test`
Expected: the new test FAILS ('archived column exists').

- [ ] **Step 3: Write minimal implementation**

In `portal/src/db.js`, inside `getDb()` after the existing `files` migration:

```js
    if (!cols.some(c => c.name === 'archived')) {
      db.exec('alter table sessions add column archived integer not null default 0');
    }
```

(The `cols` variable from the `files` migration is reused; both checks read the same `pragma table_info` result taken before either migration runs, which is correct since each check guards its own column.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/spacetimejam/j4dev/portal && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/spacetimejam/j4dev && git add portal/src/db.js portal/test/db.test.js
git commit -m "feat(portal): archived flag on sessions"
```

---

### Task 2: archive/restore endpoints and archived list filter

**Files:**
- Modify: `portal/src/server.js` (list endpoint at lines 51-56; add two POST routes after it)
- Test: `portal/test/server.test.js`

**Interfaces:**
- Consumes: `sessions.archived` from Task 1.
- Produces: `POST /api/sessions/:id/archive`, `POST /api/sessions/:id/restore` (both return `{ ok: true }`, 404 if not owner); `GET /api/sessions` returns only `archived = 0`; `GET /api/sessions?archived=1` returns only `archived = 1`.

- [ ] **Step 1: Write the failing tests**

Append to `portal/test/server.test.js` (before `test.after`):

```js
test('archive hides a session from the list; restore brings it back', async () => {
  const r = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ jd: 'Archive test role' }),
  });
  const { id } = await r.json();

  let a = await fetch(`${base}/api/sessions/${id}/archive`, { method: 'POST', headers: { cookie: ownerCookie } });
  assert.equal(a.status, 200);

  const list = await (await fetch(`${base}/api/sessions`, { headers: { cookie: ownerCookie } })).json();
  assert.ok(!list.some(s => s.id === id));
  const archived = await (await fetch(`${base}/api/sessions?archived=1`, { headers: { cookie: ownerCookie } })).json();
  assert.ok(archived.some(s => s.id === id));
  assert.ok(archived.every(s => s.archived === 1));

  a = await fetch(`${base}/api/sessions/${id}/restore`, { method: 'POST', headers: { cookie: ownerCookie } });
  assert.equal(a.status, 200);
  const back = await (await fetch(`${base}/api/sessions`, { headers: { cookie: ownerCookie } })).json();
  assert.ok(back.some(s => s.id === id));
});

test('users cannot archive or restore each other\'s sessions', async () => {
  const r = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ jd: 'Archive isolation role' }),
  });
  const { id } = await r.json();
  assert.equal((await fetch(`${base}/api/sessions/${id}/archive`, { method: 'POST', headers: { cookie: operatorCookie } })).status, 404);
  assert.equal((await fetch(`${base}/api/sessions/${id}/restore`, { method: 'POST', headers: { cookie: operatorCookie } })).status, 404);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/spacetimejam/j4dev/portal && npm test`
Expected: both new tests FAIL (archive returns 404: route missing).

- [ ] **Step 3: Implement**

In `portal/src/server.js`, replace the `GET /api/sessions` handler with:

```js
  app.get('/api/sessions', requireAuth, (req, res) => {
    const archived = req.query.archived === '1' ? 1 : 0;
    const rows = getDb()
      .prepare('select * from sessions where user_email = ? and archived = ? order by updated_at desc')
      .all(req.userEmail, archived);
    res.json(rows);
  });
```

Immediately after it, add:

```js
  function setArchived(req, res, value) {
    const db = getDb();
    const session = getOwnSession(db, req.params.id, req.userEmail);
    if (!session) return res.status(404).json({ error: 'not found' });
    db.prepare('update sessions set archived = ? where id = ?').run(value, session.id);
    res.json({ ok: true });
  }
  app.post('/api/sessions/:id/archive', requireAuth, (req, res) => setArchived(req, res, 1));
  app.post('/api/sessions/:id/restore', requireAuth, (req, res) => setArchived(req, res, 0));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/spacetimejam/j4dev/portal && npm test`
Expected: all PASS (including the pre-existing list tests, which only create unarchived sessions).

- [ ] **Step 5: Commit**

```bash
cd /home/spacetimejam/j4dev && git add portal/src/server.js portal/test/server.test.js
git commit -m "feat(portal): archive and restore endpoints with archived list filter"
```

---

### Task 3: deletion module (folder derivation, DELETED.md log, folder removal)

**Files:**
- Create: `portal/src/deletion.js`
- Test: `portal/test/deletion.test.js`

**Interfaces:**
- Consumes: a session row (`{ files, title, created_at }`) and a user (`{ name, projectDir }`).
- Produces (used by Task 4):
  - `deriveApplicationFolder(session, user)` returns an absolute real path to `applications/<slug>/` or `null`.
  - `recordDeletion({ projectDir, title, userName, folderNote, messageCount, createdAt })` appends to `<projectDir>/applications/DELETED.md`, creating it (and `applications/`) if needed. `folderNote` is a string such as `'applications/acme-role/'` or `'none found'`.
  - `removeFolder(folder)` deletes the folder recursively; throws on failure.

- [ ] **Step 1: Write the failing tests**

Create `portal/test/deletion.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deriveApplicationFolder, recordDeletion, removeFolder } from '../src/deletion.js';

function freshProject() {
  const projectDir = mkdtempSync(join(tmpdir(), 'delproj-'));
  mkdirSync(join(projectDir, 'applications', 'acme-role'), { recursive: true });
  writeFileSync(join(projectDir, 'applications', 'acme-role', 'cv.pdf'), 'pdf');
  return projectDir;
}

test('derives the folder from a delivered file inside applications/<slug>/', () => {
  const projectDir = freshProject();
  const session = { files: JSON.stringify([join(projectDir, 'applications', 'acme-role', 'cv.pdf')]) };
  const folder = deriveApplicationFolder(session, { projectDir });
  assert.ok(folder && folder.endsWith(join('applications', 'acme-role')));
});

test('returns null when there are no files', () => {
  const projectDir = freshProject();
  assert.equal(deriveApplicationFolder({ files: null }, { projectDir }), null);
  assert.equal(deriveApplicationFolder({ files: '[]' }, { projectDir }), null);
});

test('rejects paths outside applications/<slug>/', () => {
  const projectDir = freshProject();
  const cases = [
    join(projectDir, 'applications', 'stray.pdf'),          // applications/ itself
    join(projectDir, 'core', 'profile.md'),                  // elsewhere in the project
    join(projectDir, 'applications', 'acme-role', 'sub', 'x.pdf'), // two levels deep
    '/etc/passwd',                                           // outside the project
  ];
  mkdirSync(join(projectDir, 'core'), { recursive: true });
  writeFileSync(join(projectDir, 'core', 'profile.md'), 'x');
  writeFileSync(join(projectDir, 'applications', 'stray.pdf'), 'x');
  mkdirSync(join(projectDir, 'applications', 'acme-role', 'sub'), { recursive: true });
  writeFileSync(join(projectDir, 'applications', 'acme-role', 'sub', 'x.pdf'), 'x');
  for (const p of cases) {
    assert.equal(deriveApplicationFolder({ files: JSON.stringify([p]) }, { projectDir }), null, p);
  }
});

test('rejects a symlink escaping the applications directory', () => {
  const projectDir = freshProject();
  const outside = mkdtempSync(join(tmpdir(), 'outside-'));
  writeFileSync(join(outside, 'secret.pdf'), 'x');
  symlinkSync(outside, join(projectDir, 'applications', 'link-slug'));
  const session = { files: JSON.stringify([join(projectDir, 'applications', 'link-slug', 'secret.pdf')]) };
  assert.equal(deriveApplicationFolder(session, { projectDir }), null);
});

test('recordDeletion creates and appends DELETED.md, including the none found case', () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'delproj-'));
  recordDeletion({ projectDir, title: 'Designer at Acme', userName: 'Sam', folderNote: 'applications/acme-role/', messageCount: 4, createdAt: '2026-07-01 10:00:00' });
  const logPath = join(projectDir, 'applications', 'DELETED.md');
  let text = readFileSync(logPath, 'utf8');
  assert.match(text, /^# Deleted applications/);
  assert.match(text, /Designer at Acme/);
  assert.match(text, /Folder removed: applications\/acme-role\//);
  assert.match(text, /Messages in session: 4/);
  recordDeletion({ projectDir, title: 'Writer at Beta', userName: 'Sam', folderNote: 'none found', messageCount: 1, createdAt: '2026-07-02 10:00:00' });
  text = readFileSync(logPath, 'utf8');
  assert.match(text, /Writer at Beta/);
  assert.match(text, /Folder removed: none found/);
  assert.equal(text.match(/^# Deleted applications/gm).length, 1);
});

test('removeFolder deletes recursively', () => {
  const projectDir = freshProject();
  const folder = join(projectDir, 'applications', 'acme-role');
  removeFolder(folder);
  assert.ok(!existsSync(folder));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/spacetimejam/j4dev/portal && npm test`
Expected: `deletion.test.js` FAILS (module not found).

- [ ] **Step 3: Implement**

Create `portal/src/deletion.js`:

```js
import { realpathSync, rmSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';

// The portal never records which folder the agent created for an application;
// the only handle is the delivered files' paths. A folder is only eligible for
// deletion if, after resolving symlinks, it sits exactly one level below the
// user's applications/ directory.
export function deriveApplicationFolder(session, user) {
  let paths;
  try {
    paths = JSON.parse(session.files || '[]');
  } catch {
    return null;
  }
  if (!Array.isArray(paths) || !paths.length || !user?.projectDir) return null;
  let folder, appsRoot;
  try {
    folder = realpathSync(dirname(paths[0]));
    appsRoot = realpathSync(join(user.projectDir, 'applications'));
  } catch {
    return null;
  }
  if (dirname(folder) !== appsRoot) return null;
  return folder;
}

export function recordDeletion({ projectDir, title, userName, folderNote, messageCount, createdAt }) {
  const dir = join(projectDir, 'applications');
  mkdirSync(dir, { recursive: true });
  const logPath = join(dir, 'DELETED.md');
  let entry = '';
  if (!existsSync(logPath)) {
    entry += '# Deleted applications\n\nApplications permanently deleted via the portal, recorded so a missing folder is explicable later.\n';
  }
  const day = new Date().toISOString().slice(0, 10);
  entry += `\n## ${day}: ${title}\n\nDeleted from the portal by ${userName}. Folder removed: ${folderNote}. Messages in session: ${messageCount}. Session created ${createdAt}.\n`;
  appendFileSync(logPath, entry);
}

export function removeFolder(folder) {
  rmSync(folder, { recursive: true, force: true });
}

export function folderNoteFor(folder) {
  return folder ? `applications/${basename(folder)}/` : 'none found';
}
```

(Also export `folderNoteFor` as shown; Task 4 uses it.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/spacetimejam/j4dev/portal && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/spacetimejam/j4dev && git add portal/src/deletion.js portal/test/deletion.test.js
git commit -m "feat(portal): deletion module with folder derivation and DELETED.md log"
```

---

### Task 4: DELETE endpoint

**Files:**
- Modify: `portal/src/server.js` (add route after the restore route; add import)
- Test: `portal/test/server.test.js`

**Interfaces:**
- Consumes: Task 2 routes, Task 3 module (`deriveApplicationFolder`, `recordDeletion`, `removeFolder`, `folderNoteFor`).
- Produces: `DELETE /api/sessions/:id` returning `{ ok: true }`; 404 non-owner/missing; 409 `{ error: 'archive before deleting' }` when not archived.

- [ ] **Step 1: Write the failing tests**

Append to `portal/test/server.test.js` (before `test.after`). Note the fixture writes delivered files under `<projectDir>/applications/<slug>/`, matching how the tests' legacy user fallback sets `projectDir` to the temp dir:

```js
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
```

(Merge these into the existing `node:fs` import at the top of the file.)

```js
async function createArchivedSession(jd) {
  const r = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ jd }),
  });
  const { id } = await r.json();
  await fetch(`${base}/api/sessions/${id}/archive`, { method: 'POST', headers: { cookie: ownerCookie } });
  return id;
}

test('delete refuses non-archived sessions with 409', async () => {
  const r = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ jd: 'Not archived yet' }),
  });
  const { id } = await r.json();
  const d = await fetch(`${base}/api/sessions/${id}`, { method: 'DELETE', headers: { cookie: ownerCookie } });
  assert.equal(d.status, 409);
});

test('delete removes rows, the application folder, and writes DELETED.md', async () => {
  const folder = join(projectDir, 'applications', 'acme-designer');
  mkdirSync(folder, { recursive: true });
  const pdf = join(folder, 'cv.pdf');
  writeFileSync(pdf, 'pdf');
  const id = await createArchivedSession('Designer at Acme');
  getDb().prepare('update sessions set files = ? where id = ?').run(JSON.stringify([pdf]), id);

  const d = await fetch(`${base}/api/sessions/${id}`, { method: 'DELETE', headers: { cookie: ownerCookie } });
  assert.equal(d.status, 200);
  assert.equal(getDb().prepare('select count(*) c from sessions where id = ?').get(id).c, 0);
  assert.equal(getDb().prepare('select count(*) c from messages where session_id = ?').get(id).c, 0);
  assert.equal(getDb().prepare('select count(*) c from jobs where session_id = ?').get(id).c, 0);
  assert.ok(!existsSync(folder));
  const log = readFileSync(join(projectDir, 'applications', 'DELETED.md'), 'utf8');
  assert.match(log, /Designer at Acme/);
  assert.match(log, /applications\/acme-designer\//);
});

test('delete with no files removes rows only and logs none found', async () => {
  const id = await createArchivedSession('No files role');
  const d = await fetch(`${base}/api/sessions/${id}`, { method: 'DELETE', headers: { cookie: ownerCookie } });
  assert.equal(d.status, 200);
  assert.equal(getDb().prepare('select count(*) c from sessions where id = ?').get(id).c, 0);
  const log = readFileSync(join(projectDir, 'applications', 'DELETED.md'), 'utf8');
  assert.match(log, /No files role/);
  assert.match(log, /none found/);
});

test('users cannot delete each other\'s sessions', async () => {
  const id = await createArchivedSession('Delete isolation role');
  assert.equal((await fetch(`${base}/api/sessions/${id}`, { method: 'DELETE', headers: { cookie: operatorCookie } })).status, 404);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/spacetimejam/j4dev/portal && npm test`
Expected: the new tests FAIL (DELETE returns 404: no route).

- [ ] **Step 3: Implement**

In `portal/src/server.js`, add to the imports:

```js
import { deriveApplicationFolder, recordDeletion, removeFolder, folderNoteFor } from './deletion.js';
```

Add after the restore route:

```js
  app.delete('/api/sessions/:id', requireAuth, (req, res) => {
    const db = getDb();
    const session = getOwnSession(db, req.params.id, req.userEmail);
    if (!session) return res.status(404).json({ error: 'not found' });
    if (!session.archived) return res.status(409).json({ error: 'archive before deleting' });
    const user = getUser(req.userEmail);
    const messageCount = db.prepare('select count(*) c from messages where session_id = ?').get(session.id).c;
    const folder = deriveApplicationFolder(session, user);
    let folderNote = folderNoteFor(folder);
    if (folder) {
      try {
        removeFolder(folder);
      } catch (err) {
        console.error('folder removal failed:', err);
        folderNote = `${folderNote} (removal failed, folder left in place)`;
      }
    }
    try {
      recordDeletion({
        projectDir: user.projectDir, title: session.title, userName: user.name,
        folderNote, messageCount, createdAt: session.created_at,
      });
    } catch (err) { console.error('DELETED.md write failed:', err); }
    db.prepare('delete from jobs where session_id = ?').run(session.id);
    db.prepare('delete from messages where session_id = ?').run(session.id);
    db.prepare('delete from sessions where id = ?').run(session.id);
    res.json({ ok: true });
  });
```

(The spec says folder failures must not abort the row deletion, and the log entry notes what happened; writing the record after the removal lets the note reflect the actual outcome, and a log write failure is itself non-fatal.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/spacetimejam/j4dev/portal && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/spacetimejam/j4dev && git add portal/src/server.js portal/test/server.test.js
git commit -m "feat(portal): permanent delete for archived sessions"
```

---

### Task 5: frontend (card menu, cog menu, bottom sheet, archived page)

**Files:**
- Modify: `portal/public/app.js`
- Modify: `portal/public/style.css`

**Interfaces:**
- Consumes: Task 2 and Task 4 endpoints exactly as specified there.
- Produces: user-facing UI; no code consumes it.

There is no browser test harness; this task is verified by the full test suite still passing (no server change) plus a manual smoke test in Step 3.

- [ ] **Step 1: Implement app.js changes**

In `portal/public/app.js`:

1. Change `route()` to:

```js
function route() {
  const id = location.hash.slice(1);
  if (id === 'archived') return renderArchived();
  id ? renderSession(id) : renderList();
}
```

2. Add the bottom-sheet helper (below `route()`):

```js
/* A minimal bottom sheet: dimmed backdrop, panel sliding up, tap the backdrop
   to dismiss. Actions is a list of { label, run } so menus can grow later. */
function openSheet(actions) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet" role="menu">${actions.map((a, i) =>
    `<button class="sheet-item" role="menuitem" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>`;
  wrap.onclick = e => { if (e.target === wrap) wrap.remove(); };
  wrap.querySelectorAll('.sheet-item').forEach(b => {
    b.onclick = () => { wrap.remove(); actions[Number(b.dataset.i)].run(); };
  });
  document.body.appendChild(wrap);
  wrap.querySelector('.sheet-item')?.focus();
}
```

3. Replace `renderList()` with:

```js
async function renderList() {
  const sessions = await (await api('/sessions')).json();
  setCapyMood(capyMood(sessions));
  app.innerHTML = `<div class="topbar"><h1>${esc(TITLE)}</h1>
      <button id="cog" class="icon-btn" title="Options" aria-label="Options">&#9881;</button></div>
    <div class="card"><strong>New application</strong>
      <textarea id="jd" placeholder="Paste the job description, or just a link to it"></textarea>
      <button id="submit">Send to Claude</button></div>
    <div id="list">${sessions.map(s => `
      <a class="card has-menu" href="#${s.id}"><span class="pill ${s.status}">${LABELS[s.status] || s.status}</span>
      <strong>${esc(s.title)}</strong><div class="muted">${s.updated_at}</div>
      <button class="dots" data-id="${s.id}" aria-label="Options for ${esc(s.title)}">&#8942;</button></a>`).join('')}</div>`;
  document.getElementById('submit').onclick = async () => {
    const jd = document.getElementById('jd').value;
    if (!jd.trim()) return alert('Please paste the job description or a link to it.');
    const { id } = await (await api('/sessions', { method: 'POST', body: JSON.stringify({ jd }) })).json();
    location.hash = id;
  };
  document.getElementById('cog').onclick = () => openSheet([
    { label: 'View archived applications', run: () => { location.hash = 'archived'; } },
  ]);
  document.querySelectorAll('.dots').forEach(b => b.onclick = e => {
    e.preventDefault();
    e.stopPropagation();
    openSheet([
      { label: 'Archive application', run: async () => {
        await api(`/sessions/${b.dataset.id}/archive`, { method: 'POST' });
        renderList();
      } },
    ]);
  });
}
```

4. Add `renderArchived()` after `renderList()`:

```js
async function renderArchived() {
  const sessions = await (await api('/sessions?archived=1')).json();
  app.innerHTML = `<a class="back" href="#">&larr; All applications</a>
    <h1>Archived applications</h1>
    ${sessions.length ? '' : '<p class="muted">Nothing is archived.</p>'}
    <div id="list">${sessions.map(s => `
      <div class="card"><strong>${esc(s.title)}</strong><div class="muted">${s.updated_at}</div>
      <div class="row">
        <button class="restore secondary" data-id="${s.id}">Restore</button>
        <button class="delete danger" data-id="${s.id}" data-title="${esc(s.title)}">Delete permanently</button>
      </div></div>`).join('')}</div>`;
  document.querySelectorAll('.restore').forEach(b => b.onclick = async () => {
    await api(`/sessions/${b.dataset.id}/restore`, { method: 'POST' });
    renderArchived();
  });
  document.querySelectorAll('.delete').forEach(b => b.onclick = async () => {
    if (!confirm(`Permanently delete "${b.dataset.title}"? This also deletes its application folder and files. This cannot be undone.`)) return;
    await api(`/sessions/${b.dataset.id}`, { method: 'DELETE' });
    renderArchived();
  });
}
```

- [ ] **Step 2: Implement style.css additions**

Append to `portal/public/style.css`:

```css
/* Top bar: title with a quiet cog on the right */
.topbar { display: flex; align-items: baseline; justify-content: space-between; }
.icon-btn {
  width: auto;
  padding: 4px 10px;
  margin: 0;
  background: none;
  border: 0;
  color: var(--ink-soft);
  font-size: 1.1rem;
  cursor: pointer;
}
.icon-btn:hover { background: none; color: var(--accent); }

/* Per-card overflow menu trigger */
.card.has-menu { position: relative; padding-right: 44px; }
.dots {
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
  width: auto;
  padding: 8px 12px;
  margin: 0;
  background: none;
  border: 0;
  color: var(--ink-soft);
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
}
.dots:hover { background: none; color: var(--accent); }

/* Bottom sheet */
.sheet-wrap {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 10;
}
.sheet {
  background: var(--card);
  border-radius: 14px 14px 0 0;
  box-shadow: var(--shadow);
  width: 100%;
  max-width: 620px;
  padding: 10px 10px calc(10px + env(safe-area-inset-bottom));
  animation: sheet-up 0.18s ease-out;
}
.sheet-item {
  background: none;
  color: var(--ink);
  border: 0;
  text-align: left;
  padding: 14px;
  margin: 0;
  border-radius: 10px;
  font-weight: 500;
}
.sheet-item:hover { background: var(--tint); }
@keyframes sheet-up { from { transform: translateY(24px); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .sheet { animation: none; } }

/* Archived page action row */
.row { display: flex; gap: 10px; }
.row button { width: auto; flex: 1; }
button.secondary { background: var(--tint); color: var(--ink); }
button.secondary:hover { background: var(--hairline); }
button.danger { background: var(--red); }
button.danger:hover { background: var(--red); filter: brightness(0.9); }
```

- [ ] **Step 3: Manual smoke test**

Run: `cd /home/spacetimejam/j4dev/portal && npm test` (must stay green), then start a throwaway instance:

```bash
cd /home/spacetimejam/j4dev/portal && \
DB_PATH=/tmp/claude-1000/-home-spacetimejam-j4/a6b23e73-961d-4874-a576-5df860d2babb/scratchpad/smoke.db \
PROJECT_DIR=/tmp/claude-1000/-home-spacetimejam-j4/a6b23e73-961d-4874-a576-5df860d2babb/scratchpad \
PORTAL_USERS_FILE=/nonexistent.json ALLOWED_EMAILS=smoke@test.com COOKIE_SECRET=smoke \
PORT=3999 node src/server.js
```

Then with curl (mint a cookie via `node -e` using `makeCookie` from `src/auth.js` with the same COOKIE_SECRET): create a session, archive it via the API, fetch `/` and confirm the page loads, fetch `/api/sessions` and `/api/sessions?archived=1` and confirm the split. Visual checks (three-dot alignment, sheet animation) are deferred to the live rollout check. Stop the server afterwards.

- [ ] **Step 4: Commit**

```bash
cd /home/spacetimejam/j4dev && git add portal/public/app.js portal/public/style.css
git commit -m "feat(portal): archive menu, cog menu, bottom sheet and archived page"
```

---

### Task 6: rollout

**Files:** none in-repo (operational).

- [ ] **Step 1: Push from j4dev**

```bash
cd /home/spacetimejam/j4dev && git push origin master
```

- [ ] **Step 2: Pull into the live checkout and restart**

```bash
cd /home/spacetimejam/j4 && git pull --ff-only origin master
systemctl restart <portal service>   # exact unit name is in the portal-deployment memory/host notes
```

(~/j4 was reset to origin/master on 2026-07-19, so the pull is fast-forward.)

- [ ] **Step 3: Live check**

Open the portal, confirm: three-dot menu archives a card; cog opens the sheet; `#archived` lists it with working Restore; permanent delete of a disposable test application removes it and writes `applications/DELETED.md` in the project folder.
