# Portal inline document footers — Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move delivered-document links from a standalone card above the reply box to inline footers on the Claude message that delivered them, so they scroll with the conversation.

**Architecture:** Add a `message_id` column to the `documents` table linking each document to the Claude message that carried the `email-to-user` directive. The session API attaches documents to their messages; the frontend renders download chips inside the message bubble. The side panel and chat-bar doc button are unchanged.

**Tech Stack:** Node 18+ (node:test), better-sqlite3, Express, vanilla JS frontend.

## Global constraints

- Node 18+ — no `Object.groupBy` (Node 21+), no top-level await in CJS.
- Portal tests use `node:test` and `node:assert`; no external test framework.
- `files` column on `sessions` stays for `deriveApplicationFolder` in `deletion.js`.
- UTC at rest, London at display time.
- Frontend: no external dependencies, no CSP changes, XSS-safe by construction.

---

### Task 1: Add `message_id` column and backfill

**Files:**
- Modify: `portal/src/db.js:56-103` (add migration + backfill in `getDb()`)
- Test: `portal/test/db.test.js` (fresh-db column check)
- Create: `portal/test/documents-message-id-migration.test.js` (backfill)

**Interfaces:**
- Consumes: existing `getDb()`, `newId()`
- Produces: `documents.message_id` column (nullable text), populated for rows with a matching Claude message

- [ ] **Step 1: Write the fresh-db test in `db.test.js`**

Append to `portal/test/db.test.js`:

```js
test('documents table has a message_id column', () => {
  const db = getDb();
  const cols = db.prepare('pragma table_info(documents)').all().map(c => c.name);
  assert.ok(cols.includes('message_id'), 'message_id column exists');
});
```

- [ ] **Step 2: Write the migration test file**

Create `portal/test/documents-message-id-migration.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dbPath = join(mkdtempSync(join(tmpdir(), 'msgidmig-')), 'portal.db');
process.env.DB_PATH = dbPath;

// Seed a database in the shape it had before this feature: documents exists
// (from the earlier migration) but has no message_id column. Include sessions
// and messages so the backfill has something to match against.
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
  create table messages (
    id text primary key,
    session_id text not null references sessions(id),
    role text not null,
    body text not null,
    created_at text not null default (datetime('now'))
  );
  create table documents (
    id text primary key,
    session_id text not null references sessions(id),
    path text not null,
    delivered_at text not null default (datetime('now'))
  );
  create unique index if not exists documents_session_path
    on documents (session_id, path);
  create table meta (key text primary key, value text);
  insert into meta (key, value) values ('documents_backfill_done', '2026-07-21 00:00:00');
`);
// Session with a Claude message and a document delivered at the same time
seed.prepare(`insert into sessions (id, user_email, title)
  values ('s1', 'a@b.c', 'Role one')`).run();
seed.prepare(`insert into messages (id, session_id, role, body, created_at)
  values ('msg1', 's1', 'claude', 'Here are your docs.', '2026-07-20 12:00:00')`).run();
seed.prepare(`insert into documents (id, session_id, path, delivered_at)
  values ('doc1', 's1', '/tmp/cv.pdf', '2026-07-20 12:00:00')`).run();
// A second document delivered later, with a second Claude message
seed.prepare(`insert into messages (id, session_id, role, body, created_at)
  values ('msg2', 's1', 'claude', 'Updated pack.', '2026-07-21 10:00:00')`).run();
seed.prepare(`insert into documents (id, session_id, path, delivered_at)
  values ('doc2', 's1', '/tmp/letter.pdf', '2026-07-21 10:00:00')`).run();
// A document with no matching Claude message (delivered before any message)
seed.prepare(`insert into sessions (id, user_email, title)
  values ('s2', 'a@b.c', 'Role two')`).run();
seed.prepare(`insert into documents (id, session_id, path, delivered_at)
  values ('doc3', 's2', '/tmp/orphan.pdf', '2026-07-19 08:00:00')`).run();
seed.close();

const { getDb } = await import('../src/db.js');

test('backfill sets message_id on documents with a matching Claude message', () => {
  const db = getDb();
  const doc1 = db.prepare("select message_id from documents where id = 'doc1'").get();
  assert.equal(doc1.message_id, 'msg1');
  const doc2 = db.prepare("select message_id from documents where id = 'doc2'").get();
  assert.equal(doc2.message_id, 'msg2');
});

test('a document with no matching Claude message keeps message_id null', () => {
  const doc3 = getDb().prepare("select message_id from documents where id = 'doc3'").get();
  assert.equal(doc3.message_id, null);
});

test('backfill does not rerun after a message_id is cleared', async () => {
  const db = getDb();
  db.prepare("update documents set message_id = null where id = 'doc1'").run();
  db.close();
  const again = await import(`../src/db.js?rerun=${Date.now()}`);
  const doc1 = again.getDb().prepare("select message_id from documents where id = 'doc1'").get();
  assert.equal(doc1.message_id, null);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd portal && node --test test/db.test.js test/documents-message-id-migration.test.js`
Expected: `message_id column exists` fails; migration tests fail.

- [ ] **Step 4: Implement the migration in `db.js`**

In `getDb()`, after the existing `documents_backfill_done` block (around line 100), add:

```js
// Add message_id to documents for databases that predate inline footers.
const docCols = db.prepare('pragma table_info(documents)').all();
if (!docCols.some(c => c.name === 'message_id')) {
  db.exec('alter table documents add column message_id text');
}
// Backfill message_id by matching each document to the closest preceding
// Claude message in the same session. Guarded by a marker row, same
// pattern as the documents backfill above.
const msgDone = db.prepare("select 1 from meta where key = 'documents_message_id_backfill_done'").get();
if (!msgDone) {
  const unmapped = db.prepare('select id, session_id, delivered_at from documents where message_id is null').all();
  const findMsg = db.prepare(
    `select id from messages
     where session_id = ? and role = 'claude' and created_at <= ?
     order by created_at desc limit 1`);
  const setMsg = db.prepare('update documents set message_id = ? where id = ?');
  const markMsgDone = db.prepare(
    "insert or ignore into meta (key, value) values ('documents_message_id_backfill_done', datetime('now'))");
  const backfillMsg = db.transaction(() => {
    for (const doc of unmapped) {
      const msg = findMsg.get(doc.session_id, doc.delivered_at);
      if (msg) setMsg.run(msg.id, doc.id);
    }
    markMsgDone.run();
  });
  backfillMsg();
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd portal && node --test test/db.test.js test/documents-message-id-migration.test.js`
Expected: all pass.

- [ ] **Step 6: Run the full test suite as a regression check**

Run: `cd portal && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add portal/src/db.js portal/test/db.test.js portal/test/documents-message-id-migration.test.js
git commit -m "feat(portal): add documents.message_id column with backfill

Links each document to the Claude message that delivered it. Existing
rows are backfilled by matching delivered_at to the closest preceding
Claude message in the same session.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Record `message_id` on delivery in `queue.js`

**Files:**
- Modify: `portal/src/queue.js:69-91` (capture msgId, pass to recordDoc)
- Test: `portal/test/queue.test.js`

**Interfaces:**
- Consumes: `documents.message_id` column from Task 1
- Produces: document rows with `message_id` set to the Claude message id

- [ ] **Step 1: Write the failing tests in `queue.test.js`**

Append to `portal/test/queue.test.js`:

```js
test('delivery sets message_id on document rows', async () => {
  const sid = mkSession();
  const p = join(tmpdir(), `cv-${newId()}.pdf`);
  writeFileSync(p, 'cv');
  const directive = JSON.stringify({ subject: 'S', body: 'B', attachments: [p] });
  enqueue({ sessionId: sid, prompt: 'go' });
  await processOneJob({
    runTurn: async () => ({
      sessionId: 'c-msgid',
      text: `Done.\n\`\`\`email-to-user\n${directive}\n\`\`\``,
    }),
    send: async () => {},
  });
  const msg = getDb().prepare("select id from messages where session_id = ? and role = 'claude'").get(sid);
  const doc = getDb().prepare('select message_id from documents where session_id = ?').get(sid);
  assert.equal(doc.message_id, msg.id);
});

test('redelivery of the same path updates message_id to the new message', async () => {
  const sid = mkSession();
  const p = join(tmpdir(), `cv-${newId()}.pdf`);
  writeFileSync(p, 'v1');
  const directive = JSON.stringify({ subject: 'S', body: 'B', attachments: [p] });
  const mkTurn = cid => async () => ({ sessionId: cid, text: `Done.\n\`\`\`email-to-user\n${directive}\n\`\`\`` });

  enqueue({ sessionId: sid, prompt: 'first' });
  await processOneJob({ runTurn: mkTurn('c-re1'), send: async () => {} });
  const msg1 = getDb().prepare("select id from messages where session_id = ? and role = 'claude' order by created_at").get(sid);

  enqueue({ sessionId: sid, prompt: 'again' });
  await processOneJob({ runTurn: mkTurn('c-re2'), send: async () => {} });
  const msgs = getDb().prepare("select id from messages where session_id = ? and role = 'claude' order by created_at").all(sid);
  const doc = getDb().prepare('select message_id from documents where session_id = ?').get(sid);
  assert.notEqual(doc.message_id, msg1.id);
  assert.equal(doc.message_id, msgs[1].id);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd portal && node --test test/queue.test.js`
Expected: the two new tests fail (message_id is null).

- [ ] **Step 3: Implement in `queue.js`**

In `processOneJob`, change the message insert to capture the id, and update `recordDoc` to set `message_id`. Replace the block starting at the `db.prepare('insert into messages ...')` line:

Before (lines ~74-91):
```js
    db.prepare('insert into messages (id, session_id, role, body) values (?, ?, ?, ?)')
      .run(newId(), job.session_id, 'claude', clean);
```

After:
```js
    const msgId = newId();
    db.prepare('insert into messages (id, session_id, role, body) values (?, ?, ?, ?)')
      .run(msgId, job.session_id, 'claude', clean);
```

And replace the `recordDoc` prepared statement:

Before:
```js
      const recordDoc = db.prepare(`insert into documents (id, session_id, path)
        values (?, ?, ?)
        on conflict (session_id, path) do update set delivered_at = datetime('now')`);
      for (const p of email.attachments) recordDoc.run(newId(), job.session_id, p);
```

After:
```js
      const recordDoc = db.prepare(`insert into documents (id, session_id, path, message_id)
        values (?, ?, ?, ?)
        on conflict (session_id, path) do update set
          delivered_at = datetime('now'), message_id = excluded.message_id`);
      for (const p of email.attachments) recordDoc.run(newId(), job.session_id, p, msgId);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd portal && node --test test/queue.test.js`
Expected: all pass.

- [ ] **Step 5: Run the full test suite as a regression check**

Run: `cd portal && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add portal/src/queue.js portal/test/queue.test.js
git commit -m "feat(portal): record message_id when storing delivered documents

Each document now knows which Claude message delivered it, so the
frontend can render it inline on that message.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Attach documents to messages in the session API

**Files:**
- Modify: `portal/src/server.js:159-167` (`GET /sessions/:id` handler)
- Test: `portal/test/server.test.js`

**Interfaces:**
- Consumes: `documents.message_id` from Tasks 1-2, `resolveOwnedFile` from `server.js`
- Produces: `docs` array on message objects in `GET /sessions/:id` response — `[{ id, name, available }]`

- [ ] **Step 1: Write the failing tests in `server.test.js`**

Append to `portal/test/server.test.js`, before the `test.after` line:

```js
test('session detail attaches docs to the Claude message that delivered them', async () => {
  const p = join(projectDir, 'inline-cv.pdf');
  writeFileSync(p, 'inline-bytes');
  const r = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ jd: 'Inline docs role' }),
  });
  const { id } = await r.json();
  const db = getDb();
  const msgId = 'inline-msg-1';
  db.prepare("insert into messages (id, session_id, role, body) values (?, ?, 'claude', 'Here are your docs.')").run(msgId, id);
  db.prepare('insert into documents (id, session_id, path, message_id) values (?, ?, ?, ?)')
    .run('inline-doc-1', id, p, msgId);

  const detail = await (await fetch(`${base}/api/sessions/${id}`, { headers: { cookie: ownerCookie } })).json();
  const claudeMsg = detail.messages.find(m => m.id === msgId);
  assert.ok(claudeMsg, 'Claude message found');
  assert.ok(claudeMsg.docs, 'docs array present');
  assert.equal(claudeMsg.docs.length, 1);
  assert.equal(claudeMsg.docs[0].id, 'inline-doc-1');
  assert.equal(claudeMsg.docs[0].name, 'inline-cv.pdf');
  assert.equal(claudeMsg.docs[0].available, true);
});

test('a document with null message_id does not appear on any message', async () => {
  const r = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ jd: 'Orphan doc role' }),
  });
  const { id } = await r.json();
  const db = getDb();
  db.prepare("insert into messages (id, session_id, role, body) values (?, ?, 'claude', 'No docs here.')").run('orphan-msg', id);
  db.prepare('insert into documents (id, session_id, path) values (?, ?, ?)')
    .run('orphan-doc', id, join(projectDir, 'orphan.pdf'));

  const detail = await (await fetch(`${base}/api/sessions/${id}`, { headers: { cookie: ownerCookie } })).json();
  const withDocs = detail.messages.filter(m => m.docs?.length);
  assert.equal(withDocs.length, 0);
});

test('an unavailable document file shows available: false on the message', async () => {
  const r = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ jd: 'Missing file docs role' }),
  });
  const { id } = await r.json();
  const db = getDb();
  const msgId = 'missing-file-msg';
  db.prepare("insert into messages (id, session_id, role, body) values (?, ?, 'claude', 'Docs ready.')").run(msgId, id);
  db.prepare('insert into documents (id, session_id, path, message_id) values (?, ?, ?, ?)')
    .run('missing-file-doc', id, join(projectDir, 'does-not-exist.pdf'), msgId);

  const detail = await (await fetch(`${base}/api/sessions/${id}`, { headers: { cookie: ownerCookie } })).json();
  const claudeMsg = detail.messages.find(m => m.id === msgId);
  assert.equal(claudeMsg.docs[0].available, false);
});

test('session detail still includes the files field', async () => {
  const p = join(projectDir, 'files-field-cv.pdf');
  writeFileSync(p, 'cv');
  const r = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ jd: 'Files field role' }),
  });
  const { id } = await r.json();
  getDb().prepare('update sessions set files = ? where id = ?').run(JSON.stringify([p]), id);
  const detail = await (await fetch(`${base}/api/sessions/${id}`, { headers: { cookie: ownerCookie } })).json();
  assert.deepEqual(detail.files, [{ idx: 0, name: 'files-field-cv.pdf' }]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd portal && node --test test/server.test.js`
Expected: `docs array present` assertion fails (no `docs` on messages).

- [ ] **Step 3: Implement in `server.js`**

In the `GET /sessions/:id` handler, after the `messages` query and `files` parsing, add the documents lookup and attach to messages:

Replace the response-building section (around lines 159-167):

```js
  app.get('/api/sessions/:id', requireAuth, (req, res) => {
    const db = getDb();
    const session = getOwnSession(db, req.params.id, req.userEmail);
    if (!session) return res.status(404).json({ error: 'not found' });
    const messages = db.prepare('select * from messages where session_id = ? order by created_at').all(session.id);
    const files = (JSON.parse(session.files || '[]')).map((p, idx) => ({ idx, name: basename(p) }));
    const user = getUser(req.userEmail);
    const tracker = readTracker(user?.projectDir);
    const docs = db.prepare(
      'select * from documents where session_id = ? and message_id is not null'
    ).all(session.id);
    const docsByMsg = {};
    for (const d of docs) (docsByMsg[d.message_id] ??= []).push(d);
    const enriched = messages.map(m => {
      const msgDocs = docsByMsg[m.id];
      if (!msgDocs) return m;
      return { ...m, docs: msgDocs.map(d => ({
        id: d.id,
        name: basename(d.path),
        available: resolveOwnedFile(d.path, user) !== null,
      })) };
    });
    res.json({ ...withStage(session, tracker), messages: enriched, files });
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd portal && node --test test/server.test.js`
Expected: all pass.

- [ ] **Step 5: Run the full test suite as a regression check**

Run: `cd portal && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add portal/src/server.js portal/test/server.test.js
git commit -m "feat(portal): attach documents to messages in session API

GET /sessions/:id now includes a docs array on Claude messages that
delivered documents, so the frontend can render them inline.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Frontend inline footers and CSS

**Files:**
- Modify: `portal/public/app.js:253-257` (message rendering + remove card)
- Modify: `portal/public/style.css` (add `.msg-docs` and `.msg-doc` rules)

**Interfaces:**
- Consumes: `docs` array on message objects from Task 3

No automated tests — the frontend is DOM code and follows the precedent set by `bindSubmit` and the document panel (see the panel spec). Covered by the manual verification in the spec.

- [ ] **Step 1: Update the message rendering in `app.js`**

Replace the message-mapping line and the "Your documents" card:

Before (lines 253-257):
```js
    ${s.messages.map(m => m.role === 'claude'
      ? `<div class="msg claude md">${renderMarkdown(m.body)}</div>`
      : `<div class="msg ${m.role}">${esc(m.body)}</div>`).join('')}
    ${s.files?.length ? `<div class="card"><strong>Your documents</strong>${s.files.map(f =>
      `<div><a href="/api/sessions/${id}/files/${f.idx}" download>${esc(f.name)}</a></div>`).join('')}</div>` : ''}
```

After:
```js
    ${s.messages.map(m => {
      if (m.role === 'claude') {
        const docFooter = m.docs?.length ? `<div class="msg-docs">${m.docs.map(d =>
          d.available
            ? `<a class="msg-doc" href="/api/sessions/${id}/documents/${d.id}" download>${esc(d.name)}</a>`
            : `<span class="msg-doc unavailable">${esc(d.name)}</span>`
        ).join('')}</div>` : '';
        return `<div class="msg claude md">${renderMarkdown(m.body)}${docFooter}</div>`;
      }
      return `<div class="msg ${m.role}">${esc(m.body)}</div>`;
    }).join('')}
```

- [ ] **Step 2: Add styles in `style.css`**

Append after the `.msg.md a` rule (line 208), before the `.muted` rule:

```css
.msg-docs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--hairline);
}
.msg-doc {
  display: inline-block;
  font-size: 0.82rem;
  padding: 4px 10px;
  border-radius: 8px;
  background: var(--tint);
  color: var(--accent);
  text-decoration: none;
  overflow-wrap: anywhere;
}
.msg-doc:hover { background: var(--hairline); }
.msg-doc.unavailable {
  color: var(--ink-soft);
  cursor: default;
}
.msg-doc.unavailable:hover { background: var(--tint); }
```

- [ ] **Step 3: Run the full test suite as a regression check**

Run: `cd portal && npm test`
Expected: all pass (no functional backend change).

- [ ] **Step 4: Commit**

```bash
git add portal/public/app.js portal/public/style.css
git commit -m "feat(portal): render documents as inline footers on Claude messages

Documents now appear as download chips at the foot of the Claude
message that delivered them, scrolling with the conversation. The
standalone 'Your documents' card is removed.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Documentation

**Files:**
- Modify: `CLAUDE.md` (add key decision entry)

**Interfaces:** None.

- [ ] **Step 1: Add the key decision to `CLAUDE.md`**

In the "Key decisions: don't re-litigate" section, after the "Delivered documents accumulate" entry, add:

```
- **Inline document footers.** Documents appear as download chips at the foot of the Claude message that delivered them, rather than in a standalone card above the reply box. The `documents.message_id` column links each document to its message; the side panel remains as the single-place-to-find-everything view. `session.files` is retained for `deriveApplicationFolder` but the frontend no longer reads it. Spec: `docs/superpowers/specs/2026-08-03-portal-inline-document-footers-design.md`.
```

- [ ] **Step 2: Commit the spec and plan together with the CLAUDE.md update**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-08-03-portal-inline-document-footers-design.md docs/superpowers/plans/2026-08-03-portal-inline-document-footers.md
git commit -m "docs: inline document footers spec, plan, and CLAUDE.md entry

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
