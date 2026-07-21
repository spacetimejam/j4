# Portal document panel design

Date: 2026-07-21

## Problem

Documents Claude produces for an application are only reachable for a short
while. Two separate causes:

1. **They are forgotten.** `queue.js` writes each delivery with
   `update sessions set files = ?`, replacing the column outright. A session
   remembers only its most recent email, so an earlier CV disappears the moment
   a later turn delivers anything else.
2. **They are hard to find.** The one list that exists, the "Your documents"
   card in `renderSession`, sits at the very bottom of the thread. As a
   conversation grows it is several screens below the fold.

The result is that a document is effectively visible only until the next
exchange. We want every document a session has ever delivered to stay findable
and downloadable, from a fixed place in the chat.

## Scope

- A document means a file Claude attached to an `email-to-user` directive in
  this session. Working files in `applications/<slug>/` that were never
  delivered (`fit.md`, `spec.md`, `cover-letter.yaml`, intermediate PNGs) are
  deliberately not listed. The delivered set is the curated one, and listing a
  whole directory would mean validating paths the portal never chose.
- Documents are per session. There is no cross-session library.
- The session view only. The list and archived views are untouched.

## Approach

Record deliveries in a new `documents` table rather than widening the existing
`files` column, and surface them through a side panel opened from a new sticky
chat header.

`files` keeps its current meaning, the most recent delivery, and every existing
reader of it stays as it is: the "Your documents" card, the
`/api/sessions/:id/files/:idx` download route, and `deriveApplicationFolder` in
`deletion.js`, which derives an application folder from `files[0]`. A table is
needed anyway for per-file delivery dates, and separating the two means the
history feature cannot disturb permanent deletion.

Two alternatives were rejected. Appending to the `files` JSON array would need
no schema change, but it would silently change what `files[0]` means for
deletion and leaves nowhere to put a delivery date. Reconstructing the history
from the message thread is not possible: `parseEmailDirective` strips the
directive block, and attachment paths are never stored on the message.

## Components

### 1. `portal/src/db.js`: schema and backfill

Add to `SCHEMA`, so it is created on first open like every other table:

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

`delivered_at` is UTC, in keeping with the existing rule: UTC at rest, London at
display time via `formatLondon`.

The unique index makes redelivery idempotent. If Claude revises a CV and emails
it again under the same path, one row survives and its `delivered_at` moves
forward. That is correct rather than merely convenient: there is a single file
on disk, so a second row would offer a download of the revised content under the
older date.

Backfill runs once, inside the same `getDb()` migration block that adds the
`files` and `archived` columns, guarded by `select count(*) from documents`
being zero. For every session with a non-empty `files` array it inserts one row
per path, with `delivered_at` set to the session's `updated_at`. That date is
approximate for older sessions, being the last activity rather than the delivery
itself, which is the best available and is only ever shown as a caption. Without
the backfill every live session would show an empty panel on day one.

### 2. `portal/src/queue.js`: record each delivery

In the `if (email)` branch, alongside the existing `files` update, insert every
attachment path:

```js
const rec = db.prepare(`insert into documents (id, session_id, path)
  values (?, ?, ?)
  on conflict (session_id, path)
  do update set delivered_at = datetime('now')`);
for (const p of email.attachments) rec.run(newId(), job.session_id, p);
```

This sits before the `send(...)` call, with the `files` update, for the reason
already recorded in the comment there: if the email send fails, the turn must
still be persisted and its deliverables downloadable.

### 3. `portal/src/server.js`: two routes

A shared helper replaces the inline path check now in the `files/:idx` route, so
the two download paths cannot drift apart:

`resolveOwnedFile(path, user)` returns the realpath of `path` if, after
resolving symlinks, it is inside `realpathSync(user.projectDir)`, and `null`
otherwise (including when either realpath throws). The existing route is
rewritten to call it, with no change in behaviour.

- `GET /api/sessions/:id/documents` returns
  `[{ id, name, delivered_at, available }]` ordered by `delivered_at desc`,
  after the usual `getOwnSession` ownership check. `name` is `basename(path)`.
  `available` is `resolveOwnedFile(...) !== null`, so a file removed from disk
  is shown greyed out rather than offering a download that 404s. No separate
  existence check is needed: `realpathSync` throws for a missing path, which the
  helper already turns into `null`.
- `GET /api/sessions/:id/documents/:docId` downloads one document. Ownership
  check on the session, then the row must belong to that session, then
  `resolveOwnedFile`, then `res.download`. Any failure is a 404, matching the
  existing route's habit of not distinguishing "absent" from "forbidden".

### 4. `portal/public/app.js`: the chat bar

`renderSession` currently emits a back link and an `h1`. Both are replaced by one
sticky bar holding, left to right: the back arrow, the session title, the status
pill, and a file button. Nothing is duplicated below it, so the bar is the only
heading the session view has.

The title takes the space left over and truncates to a single line, with the
full text in a `title` attribute for hover and long-press. The file button is a
fixed tap target of about 44px at the right edge, with a count badge, and is
omitted entirely when the session has no documents.

The count comes from the same `GET /documents` fetch that fills the panel, so
`renderSession` fetches the session and its documents together with
`Promise.all` and renders once.

### 5. `portal/public/app.js`: the panel

`openDocPanel(sessionId, docs)` builds a panel and appends it to `document.body`,
following `openSheet`. Mounting outside `#app` is load-bearing rather than
stylistic: while a session is `working`, `renderSession` reruns every ten
seconds and rewrites `app.innerHTML`, which would destroy a panel mounted
inside it mid-scroll. `renderSession` instead calls a refresh on an open panel
with the documents it has just fetched, so the list stays current while Claude
works.

Behaviour:

- Slides in from the right, `min(360px, 88vw)` wide, over a dimmed backdrop.
- Dismissed by clicking the backdrop, by the close button, or by Escape.
- `role="dialog"`, `aria-modal="true"`, `aria-label="Documents"`. Focus moves to
  the close button on open and returns to the file button on close.
- Each row: filename, then the delivery date through `formatLondon`, wrapped in
  a download link to `/api/sessions/:id/documents/:docId`. Rows with
  `available: false` render as plain text with a quiet "no longer available"
  caption instead of a link.
- Empty state is unreachable, because the button is hidden when there are no
  documents, but the panel still renders "No documents yet" rather than nothing
  if it is ever opened empty.

Filenames are escaped with the existing `esc`, as everywhere else outside
Claude's own messages.

### 6. `portal/public/style.css`

- `.chat-bar`: `position: sticky; top: 0`, opaque `--bg`, hairline
  `border-bottom`, `z-index: 5`, so it sits above the thread but below the
  panel, which takes the sheet's 10. Negative side and top margins
  cancel `#app`'s `40px 20px` padding so the bar spans the full column width and
  meets the top of the viewport, rather than leaving content visible in the
  gutters as it scrolls under.
- `.doc-panel-wrap` and `.doc-panel`: fixed, right-anchored, `--card`
  background, `padding-right` and `padding-bottom` respecting
  `env(safe-area-inset-*)`. Slide-in keyframes, disabled under
  `prefers-reduced-motion`, matching the `.sheet` treatment.
- `.doc-count` badge: small, `--tint` background, `--ink-soft` text.

### 7. The "Your documents" card

Kept, unchanged, at the bottom of the thread, still showing the most recent
delivery only. It is the fast path to what has just arrived, with the panel
holding the history. Its data source, the `files` column, is untouched by this
change.

## Tests

`portal/test/db.test.js`

- A fresh database has a `documents` table and the unique index.
- Backfill: a database seeded with a session whose `files` holds two paths, and
  an empty `documents` table, gains two rows on the next `getDb()`, dated from
  the session's `updated_at`.
- Backfill does not rerun: a second open adds no rows, and does not resurrect a
  row deleted in between.

`portal/test/queue.test.js`

- Two deliveries of different files accumulate to two rows.
- The same path delivered twice leaves one row, with the later `delivered_at`.
- `files` still holds only the latest delivery, so `deriveApplicationFolder`
  keeps working.

`portal/test/server.test.js`

- `GET /documents` is owner-scoped: another user's session is a 404.
- Ordering is newest first.
- A path that no longer exists on disk is returned with `available: false`.
- `GET /documents/:docId` downloads a real file, 404s for a document id from
  another session, and 404s for a path outside the user's `projectDir`.

The bar and panel are DOM code and are not unit-tested, following the precedent
set for `bindSubmit`: verifying them needs a real DOM, and jsdom is not worth
the dependency for this. They are covered by the manual check below.

## Rollout

Author and test in `~/j4dev`, commit code plus this spec, push to the public
remote, then `git pull` in `~/j4`, the live checkout. The schema change is
additive and applied by `getDb()` on next open, so the running service needs a
restart to pick up the server and queue changes, after which the migration and
backfill run once against the live database. The frontend files are static and
served fresh from disk, so a browser reload is enough for those.

## Verification

- `cd portal && npm test`
- `bash setup/test/run-tests.sh` (unchanged by this work, run as a regression
  check)
- Manual, in a browser: open a session with a delivered document, confirm the
  bar stays at the top of the screen while the thread scrolls, that the file
  button shows the right count, that the panel opens and closes by click,
  backdrop and Escape, and that a document downloads. Confirm on a phone-width
  window that the title truncates rather than wrapping and that the panel does
  not exceed the viewport.
