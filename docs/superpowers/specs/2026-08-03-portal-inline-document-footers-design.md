# Portal inline document footers design

Date: 2026-08-03

## Problem

Documents Claude delivers are shown in a "Your documents" card pinned just above
the reply textarea in the session view. As new messages arrive, the card stays
fixed near the bottom and the only way to see older deliveries is the side panel.
The user wants documents to appear inline on the Claude message that delivered
them, scrolling up with the conversation like any other content.

## Scope

- The session chat view only. The list, archived, and login views are untouched.
- The side panel (chat bar doc button) stays as-is; it remains the single place
  to find all documents without scrolling.
- The standalone "Your documents" card is removed.

## Approach

Add a `message_id` column to the `documents` table so each delivered document
knows which Claude message it belongs to. The session API attaches documents to
their messages, and the frontend renders them as a footer inside the message
bubble.

## Components

### 1. `portal/src/db.js`: schema migration

Add a guarded migration in `getDb()`, following the existing pattern for `files`
and `archived`:

```js
const docCols = db.prepare('pragma table_info(documents)').all();
if (!docCols.some(c => c.name === 'message_id')) {
  db.exec('alter table documents add column message_id text');
}
```

This runs after the existing backfill, so every row from the initial
`documents_backfill_done` migration is in place before the new column is added.

Backfill existing rows by matching each document's `delivered_at` to the closest
Claude message in the same session whose `created_at` is less than or equal to
the document's `delivered_at`. Guarded by a `documents_message_id_backfill_done`
marker in `meta`, same pattern as the first backfill:

```js
const msgDone = db.prepare("select 1 from meta where key = 'documents_message_id_backfill_done'").get();
if (!msgDone) {
  const docs = db.prepare('select id, session_id, delivered_at from documents where message_id is null').all();
  const findMsg = db.prepare(
    `select id from messages
     where session_id = ? and role = 'claude' and created_at <= ?
     order by created_at desc limit 1`);
  const setMsg = db.prepare('update documents set message_id = ? where id = ?');
  const markMsgDone = db.prepare(
    "insert or ignore into meta (key, value) values ('documents_message_id_backfill_done', datetime('now'))");
  const backfillMsg = db.transaction(() => {
    for (const doc of docs) {
      const msg = findMsg.get(doc.session_id, doc.delivered_at);
      if (msg) setMsg.run(msg.id, doc.id);
    }
    markMsgDone.run();
  });
  backfillMsg();
}
```

The column is nullable. A document with no matching Claude message (edge case:
a session whose only message was deleted, or timing anomaly) stays unattached.
It still appears in the side panel but not on any message bubble.

### 2. `portal/src/queue.js`: record message_id on delivery

The message insert already generates an ID. Capture it and pass it to the
document recording step:

```js
const msgId = newId();
db.prepare('insert into messages (id, session_id, role, body) values (?, ?, ?, ?)')
  .run(msgId, job.session_id, 'claude', clean);
```

The `recordDoc` prepared statement gains a `message_id` parameter:

```js
const recordDoc = db.prepare(`insert into documents (id, session_id, path, message_id)
  values (?, ?, ?, ?)
  on conflict (session_id, path) do update set
    delivered_at = datetime('now'), message_id = ?`);
for (const p of email.attachments) recordDoc.run(newId(), job.session_id, p, msgId, msgId);
```

On redelivery, both `delivered_at` and `message_id` are updated, so the
document tracks the message that most recently delivered it.

### 3. `portal/src/server.js`: attach documents to messages

In the `GET /api/sessions/:id` handler, after fetching messages, query
documents grouped by `message_id`:

```js
const docs = db.prepare(
  'select * from documents where session_id = ? and message_id is not null'
).all(session.id);
const docsByMsg = {};
for (const d of docs) (docsByMsg[d.message_id] ??= []).push(d);
```

Each message in the response gains a `docs` array when it has associated
documents:

```js
const msgDocs = docsByMsg[m.id];
return {
  ...m,
  ...(msgDocs ? { docs: msgDocs.map(d => ({
    id: d.id,
    name: basename(d.path),
    available: resolveOwnedFile(d.path, user) !== null,
  })) } : {}),
};
```

The `files` field on the session response stays. `deriveApplicationFolder`
reads `files[0]` and must not be disturbed.

### 4. `portal/public/app.js`: inline footer, remove card

In `renderSession`, the message rendering loop checks for `m.docs`:

```js
s.messages.map(m => {
  if (m.role === 'claude') {
    const docFooter = m.docs?.length ? `<div class="msg-docs">${m.docs.map(d =>
      d.available
        ? `<a class="msg-doc" href="/api/sessions/${id}/documents/${d.id}" download>${esc(d.name)}</a>`
        : `<span class="msg-doc unavailable">${esc(d.name)}</span>`
    ).join('')}</div>` : '';
    return `<div class="msg claude md">${renderMarkdown(m.body)}${docFooter}</div>`;
  }
  return `<div class="msg ${m.role}">${esc(m.body)}</div>`;
})
```

The standalone "Your documents" card is removed:

```diff
-${s.files?.length ? `<div class="card">...` : ''}
```

The `files` field is no longer read by the frontend. The server still returns
it for `deriveApplicationFolder`, so no backend change.

### 5. `portal/public/style.css`: `.msg-docs`

A quiet row at the bottom of the Claude message bubble, visually separated:

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
```

No changes to the panel, chat bar, or doc button styles.

### 6. Side panel

Unchanged. The chat bar doc button and side panel stay exactly as they are.

### 7. Existing readers of `files`

`files` stays on the session row and continues to hold only the most recent
delivery. `deriveApplicationFolder` in `deletion.js` reads `files[0]` and is
unaffected. The `/api/sessions/:id/files/:idx` download route stays for any
external link that might reference it, though the frontend no longer renders
links to it.

## Tests

### `portal/test/db.test.js`

- A fresh database has a `message_id` column on `documents`.
- Backfill: a database seeded with a document row whose `message_id` is null,
  and a Claude message in the same session with `created_at` equal to the
  document's `delivered_at`, gets its `message_id` set on the next `getDb()`.
- Backfill does not rerun: a second open after clearing a `message_id` leaves
  it null.
- A document with no matching Claude message (delivered_at before any message)
  keeps `message_id` null.

### `portal/test/queue.test.js`

- A delivery sets `message_id` on the document row to the id of the Claude
  message inserted in the same turn.
- Redelivery of the same path updates `message_id` to the new message.

### `portal/test/server.test.js`

- `GET /sessions/:id` includes `docs` on the Claude message that delivered
  them.
- A document with `message_id` null does not appear on any message's `docs`.
- A document whose file is missing from disk appears with `available: false`.
- The `files` field is still present on the session response.

## CLAUDE.md update

Add to the "Key decisions" section:

> **Inline document footers.** Documents appear as download chips at the foot of
> the Claude message that delivered them, rather than in a standalone card above
> the reply box. The `documents.message_id` column links each document to its
> message; the side panel remains as the single-place-to-find-everything view.
> `session.files` is retained for `deriveApplicationFolder` but the frontend no
> longer reads it. Spec: `docs/superpowers/specs/2026-08-03-portal-inline-document-footers-design.md`.

## Rollout

Author and test in `~/j4dev`, commit code plus this spec, push to the public
remote, then `git pull` in `~/j4`. The schema change is additive (new nullable
column + guarded backfill) and applied by `getDb()` on next open, so the running
service needs a restart. The frontend files are static and served fresh, so a
browser reload is enough for those.

## Verification

- `cd portal && npm test`
- `bash setup/test/run-tests.sh` (unchanged by this work, run as a regression
  check)
- Manual, in a browser: open a session where Claude has delivered documents.
  Confirm the document chips appear at the bottom of the correct Claude message.
  Send a new reply and confirm the chips scroll up with the message. Confirm
  the side panel still works and shows all documents. Confirm on a phone-width
  window that the chips wrap rather than overflowing.
