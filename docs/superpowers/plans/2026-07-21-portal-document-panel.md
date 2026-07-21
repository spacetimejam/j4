# Portal Document Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every document Claude has delivered in a portal session permanently findable, through a file button in a new sticky chat header that opens a side panel listing all of them.

**Architecture:** A new `documents` table records each delivered attachment path, appended to rather than overwritten, so history survives later turns. The existing `sessions.files` column keeps its current meaning (most recent delivery only) so the "Your documents" card, the `files/:idx` download route and `deriveApplicationFolder` are untouched. Two new API routes list and serve documents; the frontend replaces the session view's back link and `h1` with a sticky bar carrying a file button, which opens a right-hand panel mounted on `document.body`.

**Tech Stack:** Node 20+, Express 5, better-sqlite3, `node:test`. Frontend is dependency-free ES modules served by `express.static` from `portal/public/`.

Spec: `docs/superpowers/specs/2026-07-21-portal-document-panel-design.md`

## Global Constraints

- Work in the `~/j4dev` checkout, on branch `feat/portal-document-panel`. Never push from `~/j4`.
- Docs and user-visible copy in British English. No em dashes or en dashes as sentence punctuation.
- Timestamps are stored as UTC (`datetime('now')`) and never converted at rest. Display goes through `formatLondon` from `public/time.js`.
- Frontend code stays dependency-free. No new npm packages in this plan.
- All user-supplied or filesystem-derived text rendered into HTML goes through the existing `esc()` helper in `app.js`. Only `renderMarkdown` may emit tags, and only for Claude's own message bodies.
- Verification commands: `cd portal && npm test` and `bash setup/test/run-tests.sh`, both run from the repo root's respective directories.
- Every task ends with a commit. Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: `documents` table and one-time backfill

**Files:**
- Modify: `portal/src/db.js:7-42` (SCHEMA), `portal/src/db.js:44-59` (`getDb`)
- Test: `portal/test/db.test.js` (add cases)
- Test: `portal/test/documents-migration.test.js` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a `documents` table with columns `id text primary key`, `session_id text not null`, `path text not null`, `delivered_at text not null default (datetime('now'))`, plus a unique index `documents_session_path` on `(session_id, path)`. `getDb()` and `newId()` keep their current signatures.

A separate test file is needed for the backfill because `db.test.js` sets `DB_PATH=':memory:'` and holds a module-level singleton, so it cannot simulate a pre-existing database. `node --test test/` runs each file in its own process, so a second file may set its own `DB_PATH` without interfering.

- [ ] **Step 1: Write the failing schema tests**

Append to `portal/test/db.test.js`:

```js
test('documents table exists with a unique session/path index', () => {
  const db = getDb();
  const names = db.prepare("select name from sqlite_master where type='table'").all().map(r => r.name);
  assert.ok(names.includes('documents'), 'documents table exists');
  const cols = db.prepare('pragma table_info(documents)').all().map(c => c.name);
  for (const c of ['id', 'session_id', 'path', 'delivered_at']) assert.ok(cols.includes(c), c);
  const idx = db.prepare("select name from sqlite_master where type='index' and tbl_name='documents'")
    .all().map(r => r.name);
  assert.ok(idx.includes('documents_session_path'));
});

test('documents rows get a default delivered_at and reject duplicate paths', () => {
  const db = getDb();
  db.prepare("insert into sessions (id, user_email, title) values ('doc-col-test', 'a@b.c', 'T')").run();
  db.prepare('insert into documents (id, session_id, path) values (?, ?, ?)')
    .run(newId(), 'doc-col-test', '/tmp/cv.pdf');
  const row = db.prepare("select * from documents where session_id = 'doc-col-test'").get();
  assert.match(row.delivered_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.throws(
    () => db.prepare('insert into documents (id, session_id, path) values (?, ?, ?)')
      .run(newId(), 'doc-col-test', '/tmp/cv.pdf'),
    /UNIQUE/,
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd portal && node --test test/db.test.js`
Expected: FAIL, with "documents table exists" failing and the second test erroring on `no such table: documents`.

- [ ] **Step 3: Add the table to SCHEMA**

In `portal/src/db.js`, append to the `SCHEMA` template literal, after the `jobs` table:

```sql
create table if not exists documents (
  id text primary key,
  session_id text not null references sessions(id),
  path text not null,
  delivered_at text not null default (datetime('now'))
);
create unique index if not exists documents_session_path
  on documents (session_id, path);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd portal && node --test test/db.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing backfill test**

Create `portal/test/documents-migration.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// A real file on disk, not :memory:, so the database survives being closed and
// reopened. That is the only way to exercise a migration against pre-existing
// data.
const dbPath = join(mkdtempSync(join(tmpdir(), 'docsmig-')), 'portal.db');
process.env.DB_PATH = dbPath;

// Seed a database in the shape it had before this feature: sessions carry a
// files column, and no documents table exists.
const seed = new Database(dbPath);
seed.exec(`
  create table sessions (
    id text primary key,
    user_email text not null,
    title text not null,
    claude_session_id text,
    status text not null default 'active',
    created_at text not null default (datetime('now')),
    updated_at text not null default (datetime('now')),
    files text,
    archived integer not null default 0
  );
`);
seed.prepare(`insert into sessions (id, user_email, title, files, updated_at)
  values ('s1', 'a@b.c', 'Role one', ?, '2026-07-01 09:30:00')`)
  .run(JSON.stringify(['/tmp/cv.pdf', '/tmp/letter.pdf']));
seed.prepare(`insert into sessions (id, user_email, title, files, updated_at)
  values ('s2', 'a@b.c', 'Role two', ?, '2026-07-02 10:00:00')`)
  .run(JSON.stringify([]));
seed.prepare(`insert into sessions (id, user_email, title, updated_at)
  values ('s3', 'a@b.c', 'Role three', '2026-07-03 11:00:00')`)
  .run();
seed.close();

const { getDb } = await import('../src/db.js');

test('backfill copies existing files into documents, dated from updated_at', () => {
  const rows = getDb().prepare('select * from documents order by path').all();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.path), ['/tmp/cv.pdf', '/tmp/letter.pdf']);
  assert.ok(rows.every(r => r.session_id === 's1'));
  assert.ok(rows.every(r => r.delivered_at === '2026-07-01 09:30:00'));
});

test('sessions with no files or a null files column are skipped', () => {
  const other = getDb().prepare("select count(*) c from documents where session_id in ('s2','s3')").get();
  assert.equal(other.c, 0);
});

test('backfill does not rerun and does not resurrect deleted rows', async () => {
  const db = getDb();
  db.prepare("delete from documents where path = '/tmp/cv.pdf'").run();
  db.close();
  // The module caches its handle in a private variable, so the only way to make
  // getDb() open the file again is to evaluate a second copy of the module. The
  // query string is what defeats Node's module cache.
  const again = await import(`../src/db.js?rerun=${Date.now()}`);
  const rows = again.getDb().prepare('select path from documents').all();
  assert.deepEqual(rows.map(r => r.path), ['/tmp/letter.pdf']);
});
```

This test must run last in the file, because it closes the shared handle. `node:test` runs top-level tests in declaration order, so keep it at the end.

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd portal && node --test test/documents-migration.test.js`
Expected: FAIL, first test asserting `rows.length` is 0, not 2.

- [ ] **Step 7: Implement the backfill**

In `portal/src/db.js`, inside `getDb()`, after the existing `archived` column migration and before `return db`:

```js
    // One-time backfill for databases that predate the documents table: the
    // files column holds only the most recent delivery, so this is the whole
    // history we can recover. updated_at is the closest available date, being
    // last activity rather than delivery, and is only ever shown as a caption.
    if (db.prepare('select count(*) c from documents').get().c === 0) {
      const rows = db.prepare("select id, files, updated_at from sessions where files is not null and files != ''").all();
      const insert = db.prepare('insert or ignore into documents (id, session_id, path, delivered_at) values (?, ?, ?, ?)');
      const backfill = db.transaction(() => {
        for (const row of rows) {
          let paths;
          try {
            paths = JSON.parse(row.files);
          } catch {
            continue; // a malformed column must not stop the server starting
          }
          if (!Array.isArray(paths)) continue;
          for (const p of paths) {
            if (typeof p === 'string' && p) insert.run(newId(), row.id, p, row.updated_at);
          }
        }
      });
      backfill();
    }
```

`newId` is declared below `getDb` in the same module as a function declaration, so it is hoisted and available here.

- [ ] **Step 8: Run both test files to verify they pass**

Run: `cd portal && node --test test/db.test.js test/documents-migration.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 9: Run the whole suite for regressions**

Run: `cd portal && npm test`
Expected: PASS, no failures.

- [ ] **Step 10: Commit**

```bash
cd ~/j4dev
git add portal/src/db.js portal/test/db.test.js portal/test/documents-migration.test.js
git commit -m "feat(portal): record delivered documents in their own table

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Record every delivery in `queue.js`

**Files:**
- Modify: `portal/src/queue.js:72-80` (the `if (email)` branch)
- Test: `portal/test/queue.test.js` (add cases)

**Interfaces:**
- Consumes: the `documents` table and `newId` from Task 1.
- Produces: after `processOneJob` handles a turn carrying an `email-to-user` directive, one `documents` row per attachment path, and `sessions.files` still holding only that turn's attachments as a JSON array.

- [ ] **Step 1: Write the failing tests**

Append to `portal/test/queue.test.js`:

```js
test('each delivery adds documents rows while files keeps only the latest', async () => {
  const sid = mkSession();
  const first = join(tmpdir(), `cv-${newId()}.pdf`);
  const second = join(tmpdir(), `letter-${newId()}.pdf`);
  writeFileSync(first, 'one');
  writeFileSync(second, 'two');

  enqueue({ sessionId: sid, prompt: 'first' });
  await processOneJob({
    runTurn: async () => ({
      sessionId: 'c-d1',
      text: `Done.\n\`\`\`email-to-user\n${JSON.stringify({ subject: 'S', body: 'B', attachments: [first] })}\n\`\`\``,
    }),
    send: async () => {},
  });

  enqueue({ sessionId: sid, prompt: 'second' });
  await processOneJob({
    runTurn: async () => ({
      sessionId: 'c-d2',
      text: `Done.\n\`\`\`email-to-user\n${JSON.stringify({ subject: 'S', body: 'B', attachments: [second] })}\n\`\`\``,
    }),
    send: async () => {},
  });

  const paths = getDb().prepare('select path from documents where session_id = ? order by path').all(sid).map(r => r.path);
  assert.deepEqual(paths.sort(), [first, second].sort());
  // files still holds the latest delivery only, which deriveApplicationFolder relies on
  assert.deepEqual(JSON.parse(getDb().prepare('select files from sessions where id = ?').get(sid).files), [second]);
});

test('redelivering the same path keeps one row and moves its date forward', async () => {
  const sid = mkSession();
  const p = join(tmpdir(), `cv-${newId()}.pdf`);
  writeFileSync(p, 'v1');
  const directive = JSON.stringify({ subject: 'S', body: 'B', attachments: [p] });
  const runTurn = async () => ({ sessionId: 'c-re', text: `Done.\n\`\`\`email-to-user\n${directive}\n\`\`\`` });

  enqueue({ sessionId: sid, prompt: 'first' });
  await processOneJob({ runTurn, send: async () => {} });
  const before = getDb().prepare('select delivered_at from documents where session_id = ?').get(sid).delivered_at;

  // rewind the stored date so the update is observable without waiting a second
  getDb().prepare("update documents set delivered_at = '2020-01-01 00:00:00' where session_id = ?").run(sid);

  enqueue({ sessionId: sid, prompt: 'again' });
  await processOneJob({ runTurn, send: async () => {} });

  const rows = getDb().prepare('select * from documents where session_id = ?').all(sid);
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].delivered_at, '2020-01-01 00:00:00');
  assert.ok(rows[0].delivered_at >= before);
});

test('a failed email send still records the documents', async () => {
  const sid = mkSession();
  const p = join(tmpdir(), `cv-${newId()}.pdf`);
  writeFileSync(p, 'x');
  enqueue({ sessionId: sid, prompt: 'x' });
  await processOneJob({
    runTurn: async () => ({
      sessionId: 'c-fail',
      text: `Done.\n\`\`\`email-to-user\n${JSON.stringify({ subject: 'S', body: 'B', attachments: [p] })}\n\`\`\``,
    }),
    send: async () => { throw new Error('provider down'); },
  });
  assert.equal(getDb().prepare('select count(*) c from documents where session_id = ?').get(sid).c, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd portal && node --test test/queue.test.js`
Expected: FAIL, the first new test asserting `[]` does not equal two paths.

- [ ] **Step 3: Implement the recording**

In `portal/src/queue.js`, inside `if (email) {`, immediately after the existing `update sessions set files = ?` statement and before the `const attachments = ...` mapping:

```js
      // documents accumulates across the whole session; files above is only
      // ever the latest delivery. Redelivery of a revised file is idempotent:
      // there is one file on disk, so one row, with its date moved forward.
      const recordDoc = db.prepare(`insert into documents (id, session_id, path)
        values (?, ?, ?)
        on conflict (session_id, path) do update set delivered_at = datetime('now')`);
      for (const p of email.attachments) recordDoc.run(newId(), job.session_id, p);
```

This sits before the `send(...)` call for the reason the existing comment gives: if the send fails, the turn must still be persisted and its deliverables reachable.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd portal && node --test test/queue.test.js`
Expected: PASS, 18 tests.

- [ ] **Step 5: Run the whole suite for regressions**

Run: `cd portal && npm test`
Expected: PASS, no failures.

- [ ] **Step 6: Commit**

```bash
cd ~/j4dev
git add portal/src/queue.js portal/test/queue.test.js
git commit -m "feat(portal): accumulate delivered documents across a session

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Documents API routes

**Files:**
- Modify: `portal/src/server.js:130-150` (the `files/:idx` route), `portal/src/server.js:70-97` (the DELETE route), plus new routes
- Test: `portal/test/server.test.js` (add cases)

**Interfaces:**
- Consumes: the `documents` table from Task 1.
- Produces:
  - `resolveOwnedFile(path, user)` in `server.js`, module scope, returning the realpath string if it resolves inside `realpathSync(user.projectDir)`, else `null`. Never throws.
  - `GET /api/sessions/:id/documents` returning `[{ id, name, delivered_at, available }]`, newest first. `id` is the document row id, `name` is `basename(path)`, `delivered_at` is the stored UTC string, `available` is a boolean.
  - `GET /api/sessions/:id/documents/:docId` returning the file as a download, or 404.

- [ ] **Step 1: Write the failing tests**

Append to `portal/test/server.test.js`, before the `test.after` line:

```js
test('documents list is newest first, owner-scoped, and flags missing files', async () => {
  const present = join(projectDir, 'kept.pdf');
  writeFileSync(present, 'kept-bytes');
  const gone = join(projectDir, 'gone.pdf');
  const r = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ jd: 'Documents list role' }),
  });
  const { id } = await r.json();
  const ins = getDb().prepare('insert into documents (id, session_id, path, delivered_at) values (?, ?, ?, ?)');
  ins.run('doc-old', id, present, '2026-07-01 09:00:00');
  ins.run('doc-new', id, gone, '2026-07-05 09:00:00');

  const docs = await (await fetch(`${base}/api/sessions/${id}/documents`, { headers: { cookie: ownerCookie } })).json();
  assert.deepEqual(docs, [
    { id: 'doc-new', name: 'gone.pdf', delivered_at: '2026-07-05 09:00:00', available: false },
    { id: 'doc-old', name: 'kept.pdf', delivered_at: '2026-07-01 09:00:00', available: true },
  ]);

  assert.equal((await fetch(`${base}/api/sessions/${id}/documents`, { headers: { cookie: operatorCookie } })).status, 404);
  assert.equal((await fetch(`${base}/api/sessions/${id}/documents`)).status, 401);
});

test('a document downloads, and only for its own session and inside projectDir', async () => {
  const inside = join(projectDir, 'pack.pdf');
  writeFileSync(inside, 'pack-bytes');
  const mk = async jd => {
    const r = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ jd }),
    });
    return (await r.json()).id;
  };
  const idA = await mk('Doc download role A');
  const idB = await mk('Doc download role B');
  const ins = getDb().prepare('insert into documents (id, session_id, path) values (?, ?, ?)');
  ins.run('dl-ok', idA, inside);
  ins.run('dl-evil', idA, '/etc/passwd');
  ins.run('dl-other', idB, inside);

  const ok = await fetch(`${base}/api/sessions/${idA}/documents/dl-ok`, { headers: { cookie: ownerCookie } });
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), 'pack-bytes');

  // outside the project directory
  assert.equal((await fetch(`${base}/api/sessions/${idA}/documents/dl-evil`, { headers: { cookie: ownerCookie } })).status, 404);
  // a document id belonging to a different session
  assert.equal((await fetch(`${base}/api/sessions/${idA}/documents/dl-other`, { headers: { cookie: ownerCookie } })).status, 404);
  // an unknown document id
  assert.equal((await fetch(`${base}/api/sessions/${idA}/documents/nope`, { headers: { cookie: ownerCookie } })).status, 404);
  // another user
  assert.equal((await fetch(`${base}/api/sessions/${idA}/documents/dl-ok`, { headers: { cookie: operatorCookie } })).status, 404);
});

test('permanent delete removes the session documents rows', async () => {
  const id = await createArchivedSession('Doc cascade role');
  getDb().prepare('insert into documents (id, session_id, path) values (?, ?, ?)')
    .run('cascade-doc', id, join(projectDir, 'whatever.pdf'));
  const d = await fetch(`${base}/api/sessions/${id}`, { method: 'DELETE', headers: { cookie: ownerCookie } });
  assert.equal(d.status, 200);
  assert.equal(getDb().prepare('select count(*) c from documents where session_id = ?').get(id).c, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd portal && node --test test/server.test.js`
Expected: FAIL. The list test fails first, because an unmatched `/api/...` path falls through to `express.static` and returns 404 HTML, so `res.json()` throws on parsing.

- [ ] **Step 3: Extract the path guard**

In `portal/src/server.js`, add at module scope, below `getOwnSession`:

```js
// Resolve a recorded absolute path, but only if it is inside the user's own
// project directory after symlinks are followed. realpathSync throws for a
// missing path, so a deleted file resolves to null and is reported as
// unavailable rather than offered as a broken download.
function resolveOwnedFile(path, user) {
  if (!path || !user?.projectDir) return null;
  let real, root;
  try {
    real = realpathSync(path);
    root = realpathSync(user.projectDir);
  } catch {
    return null;
  }
  if (real !== root && !real.startsWith(root + sep)) return null;
  return real;
}
```

Then rewrite the body of the existing `GET /api/sessions/:id/files/:idx` route to use it, leaving its behaviour identical:

```js
  app.get('/api/sessions/:id/files/:idx', requireAuth, (req, res) => {
    const session = getOwnSession(getDb(), req.params.id, req.userEmail);
    if (!session) return res.status(404).json({ error: 'not found' });
    const paths = JSON.parse(session.files || '[]');
    const idx = Number(req.params.idx);
    if (!Number.isInteger(idx) || idx < 0 || idx >= paths.length) return res.status(404).json({ error: 'not found' });
    const real = resolveOwnedFile(paths[idx], getUser(req.userEmail));
    if (!real) return res.status(404).json({ error: 'not found' });
    res.download(real, basename(real), err => {
      if (err && !res.headersSent) res.status(404).json({ error: 'file unavailable' });
    });
  });
```

- [ ] **Step 4: Add the two documents routes**

In `portal/src/server.js`, directly after the `files/:idx` route:

```js
  app.get('/api/sessions/:id/documents', requireAuth, (req, res) => {
    const db = getDb();
    const session = getOwnSession(db, req.params.id, req.userEmail);
    if (!session) return res.status(404).json({ error: 'not found' });
    const user = getUser(req.userEmail);
    const rows = db.prepare('select * from documents where session_id = ? order by delivered_at desc, rowid desc')
      .all(session.id);
    res.json(rows.map(r => ({
      id: r.id,
      name: basename(r.path),
      delivered_at: r.delivered_at,
      available: resolveOwnedFile(r.path, user) !== null,
    })));
  });

  app.get('/api/sessions/:id/documents/:docId', requireAuth, (req, res) => {
    const db = getDb();
    const session = getOwnSession(db, req.params.id, req.userEmail);
    if (!session) return res.status(404).json({ error: 'not found' });
    const row = db.prepare('select * from documents where id = ? and session_id = ?')
      .get(req.params.docId, session.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    const real = resolveOwnedFile(row.path, getUser(req.userEmail));
    if (!real) return res.status(404).json({ error: 'not found' });
    res.download(real, basename(real), err => {
      if (err && !res.headersSent) res.status(404).json({ error: 'file unavailable' });
    });
  });
```

- [ ] **Step 5: Cascade the delete**

In the `app.delete('/api/sessions/:id', ...)` route, alongside the existing deletes:

```js
    db.prepare('delete from documents where session_id = ?').run(session.id);
    db.prepare('delete from jobs where session_id = ?').run(session.id);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd portal && node --test test/server.test.js`
Expected: PASS, 17 tests.

- [ ] **Step 7: Run the whole suite for regressions**

Run: `cd portal && npm test`
Expected: PASS, no failures.

- [ ] **Step 8: Commit**

```bash
cd ~/j4dev
git add portal/src/server.js portal/test/server.test.js
git commit -m "feat(portal): serve a session's full document history

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Sticky chat bar

**Files:**
- Modify: `portal/public/app.js:137-156` (`renderSession`)
- Modify: `portal/public/style.css` (add a chat bar block)

**Interfaces:**
- Consumes: `GET /api/sessions/:id/documents` from Task 3.
- Produces: a `.chat-bar` element at the top of the session view containing `#doc-btn` (present only when the session has at least one document), and a `docs` array in `renderSession`'s scope that Task 5 opens the panel with.

This task is DOM code and is verified by eye, following the precedent set for `bindSubmit`: a real DOM would be needed to test it, and jsdom is not worth the dependency here.

- [ ] **Step 1: Fetch documents alongside the session**

In `portal/public/app.js`, replace this line in `renderSession`:

```js
  const s = await (await api('/sessions/' + id)).json();
```

with:

```js
  const [sRes, dRes] = await Promise.all([api('/sessions/' + id), api(`/sessions/${id}/documents`)]);
  const s = await sRes.json();
  const docs = dRes.ok ? await dRes.json() : [];
```

The two `api()` calls are started before either is awaited, so this is one round trip rather than two. The `dRes.ok` guard keeps a chat readable if the documents route fails: the bar renders without its button rather than the whole view throwing.

- [ ] **Step 2: Replace the back link and heading with the bar**

Still in `renderSession`, replace the first two lines of the `app.innerHTML` template:

```js
    <a class="back" href="#">&larr; All applications</a>
    <h1>${esc(s.title)} <span class="pill ${s.status}">${LABELS[s.status] || s.status}</span></h1>
```

with:

```js
    <div class="chat-bar">
      <a class="back" href="#" aria-label="All applications">&larr;</a>
      <span class="chat-title" title="${esc(s.title)}">${esc(s.title)}</span>
      <span class="pill ${s.status}">${LABELS[s.status] || s.status}</span>
      ${docs.length ? `<button id="doc-btn" class="icon-btn" title="Documents" aria-label="Documents (${docs.length})"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg><span class="doc-count">${docs.length}</span></button>` : ''}
    </div>
```

The `.pill` here keeps the same classes it had inside the `h1`, so the existing status dot styling applies unchanged.

- [ ] **Step 3: Style the bar**

Append to `portal/public/style.css`, after the "Top bar" block:

```css
/* Session chat bar: sticks to the top of the viewport so the job title and the
   documents button stay reachable however long the thread grows. The negative
   margins cancel #app's 40px/20px padding, so the bar spans the full column
   and meets the top of the screen instead of letting text scroll through the
   gutters beside it. */
.chat-bar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 10px;
  margin: -40px -20px 18px;
  padding: 12px 20px;
  background: var(--bg);
  border-bottom: 1px solid var(--hairline);
}
.chat-bar .back { margin: 0; font-size: 1.1rem; flex: none; }
.chat-title {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chat-bar .pill { float: none; margin: 0; flex: none; }
#doc-btn {
  flex: none;
  position: relative;
  min-width: 44px;
  min-height: 44px;
  justify-content: center;
}
.doc-count {
  font-size: 0.7rem;
  font-weight: 600;
  line-height: 1;
  padding: 2px 5px;
  margin-left: 2px;
  border-radius: 7px;
  background: var(--tint);
  color: var(--ink-soft);
}
```

- [ ] **Step 4: Check it by eye**

Run: `cd portal && npm start`
Then open `http://localhost:3000`, log in, and open a session with at least one delivered document.

Expected: the bar sits at the top with back arrow, title, status dot and a file button showing a count. Scrolling the thread leaves the bar in place with no text visible beside or under it. A long title truncates with an ellipsis rather than wrapping. A session with no documents shows no button. Stop the server with Ctrl+C.

- [ ] **Step 5: Run the suite for regressions**

Run: `cd portal && npm test`
Expected: PASS, no failures.

- [ ] **Step 6: Commit**

```bash
cd ~/j4dev
git add portal/public/app.js portal/public/style.css
git commit -m "feat(portal): pin the job title and a documents button to the top of a chat

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Documents side panel

**Files:**
- Modify: `portal/public/app.js` (add `openDocPanel`, wire `#doc-btn`, refresh on poll)
- Modify: `portal/public/style.css` (add a panel block)

**Interfaces:**
- Consumes: `#doc-btn` and the `docs` array from Task 4; `GET /api/sessions/:id/documents/:docId` from Task 3; `formatLondon` from `public/time.js`, already imported by `app.js`.
- Produces: `openDocPanel(sessionId, docs)`, `refreshDocPanel(sessionId, docs)` and `docRows(sessionId, docs)` at module scope in `app.js`.

- [ ] **Step 1: Add the panel module functions**

In `portal/public/app.js`, add below `openSheet`:

```js
/* The documents panel is mounted on document.body rather than inside #app.
   That is load-bearing: while a session is working, renderSession reruns every
   ten seconds and rewrites app.innerHTML, which would tear an open panel out
   from under the reader mid-scroll. renderSession refreshes it in place
   instead. */
let docPanel = null;

function docRows(sessionId, docs) {
  if (!docs.length) return '<p class="muted">No documents yet.</p>';
  return docs.map(d => d.available
    ? `<a class="doc-row" href="/api/sessions/${sessionId}/documents/${d.id}" download>
         <span class="doc-name">${esc(d.name)}</span>
         <span class="muted">${formatLondon(d.delivered_at)}</span></a>`
    : `<div class="doc-row unavailable">
         <span class="doc-name">${esc(d.name)}</span>
         <span class="muted">no longer available</span></div>`).join('');
}

function refreshDocPanel(sessionId, docs) {
  if (!docPanel) return;
  docPanel.querySelector('.doc-list').innerHTML = docRows(sessionId, docs);
}

function openDocPanel(sessionId, docs) {
  const opener = document.activeElement;
  const wrap = document.createElement('div');
  wrap.className = 'doc-wrap';
  wrap.innerHTML = `<div class="doc-panel" role="dialog" aria-modal="true" aria-label="Documents">
    <div class="doc-head"><strong>Documents</strong>
      <button class="doc-close icon-btn" aria-label="Close">&times;</button></div>
    <div class="doc-list">${docRows(sessionId, docs)}</div></div>`;
  const close = () => {
    if (!docPanel) return;
    docPanel.remove();
    docPanel = null;
    document.removeEventListener('keydown', onKey);
    if (opener?.isConnected) opener.focus();
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  wrap.onclick = e => { if (e.target === wrap) close(); };
  wrap.querySelector('.doc-close').onclick = close;
  document.addEventListener('keydown', onKey);
  document.body.appendChild(wrap);
  docPanel = wrap;
  wrap.querySelector('.doc-close').focus();
}
```

- [ ] **Step 2: Wire the button and the poll refresh**

In `renderSession`, after the `bindSubmit(...)` call and before the `if (s.status === 'working')` line:

```js
  document.getElementById('doc-btn')?.addEventListener('click', () => openDocPanel(id, docs));
  refreshDocPanel(id, docs);
```

`refreshDocPanel` is a no-op when nothing is open, so it covers both the first render and every ten-second poll while Claude is working.

- [ ] **Step 3: Style the panel**

Append to `portal/public/style.css`, after the bottom sheet block:

```css
/* Documents panel: slides in from the right, over the thread. */
.doc-wrap {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  justify-content: flex-end;
  z-index: 10;
}
.doc-panel {
  width: min(360px, 88vw);
  height: 100%;
  overflow-y: auto;
  background: var(--card);
  box-shadow: var(--shadow);
  padding: 18px 18px calc(18px + env(safe-area-inset-bottom));
  padding-right: calc(18px + env(safe-area-inset-right));
  animation: doc-in 0.18s ease-out;
}
.doc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.doc-close { font-size: 1.4rem; line-height: 1; }
.doc-row {
  display: block;
  padding: 12px 0;
  border-top: 1px solid var(--hairline);
  text-decoration: none;
  color: inherit;
}
.doc-row .doc-name { display: block; overflow-wrap: anywhere; }
.doc-row:not(.unavailable):hover .doc-name { color: var(--accent); }
.doc-row.unavailable .doc-name { color: var(--ink-soft); }
@keyframes doc-in { from { transform: translateX(24px); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .doc-panel { animation: none; } }
```

- [ ] **Step 4: Check it by eye**

Run: `cd portal && npm start`
Then open `http://localhost:3000` and a session with delivered documents.

Expected: the file button opens a panel from the right listing every document with its London-formatted delivery date, newest first, including documents delivered before the most recent turn. Clicking a row downloads the file. The panel closes on backdrop click, on the close button and on Escape, and focus returns to the file button. On a phone-width window the panel does not exceed the viewport. Stop the server with Ctrl+C.

- [ ] **Step 5: Run the suite for regressions**

Run: `cd portal && npm test`
Expected: PASS, no failures.

- [ ] **Step 6: Commit**

```bash
cd ~/j4dev
git add portal/public/app.js portal/public/style.css
git commit -m "feat(portal): list a session's documents in a side panel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Document the decision and verify the whole kit

**Files:**
- Modify: `CLAUDE.md` (the "Key decisions" list)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the decision entry**

In `CLAUDE.md`, append to the "Key decisions" list, after the UTC/London entry:

```markdown
- **Delivered documents accumulate; `files` does not.** `sessions.files` holds
  only the most recent delivery, because `deriveApplicationFolder` in
  `deletion.js` derives an application folder from `files[0]` and the "Your
  documents" card shows the latest pack. The full history lives in the
  `documents` table, appended by `queue.js` on every `email-to-user` directive
  and unique per `(session_id, path)`, so redelivering a revised file updates
  one row rather than adding a second pointing at the same bytes. The session
  view surfaces it through a sticky `.chat-bar` and a right-hand panel mounted
  on `document.body`, not inside `#app`, because the ten-second poll while a
  session is working rewrites `app.innerHTML`. Spec:
  `docs/superpowers/specs/2026-07-21-portal-document-panel-design.md`.
```

- [ ] **Step 2: Run both suites**

Run: `cd portal && npm test`
Expected: PASS, no failures.

Run: `bash setup/test/run-tests.sh`
Expected: `Failed: 0`.

- [ ] **Step 3: Commit**

```bash
cd ~/j4dev
git add CLAUDE.md
git commit -m "docs: record the document panel decision in CLAUDE.md

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Rollout (after all tasks)

Not a task: this needs the owner, because it touches the live host.

1. In `~/j4dev`, merge `feat/portal-document-panel` into `master` and push.
2. In `~/j4`, `git pull` (fast-forward).
3. Restart the portal service. The schema change and backfill run once on the
   next `getDb()`, against the live database. Unlike the recent frontend-only
   changes, a browser reload alone is not enough here.
