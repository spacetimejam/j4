# Portal: archive and permanently delete applications

Date: 2026-07-19. Status: approved design, pending implementation.

## Purpose

Let a portal user tidy the application list. Archiving hides an application from the
main list, reversibly. Permanent deletion is a second, deliberate step available only
on already-archived applications; it removes the portal data and the application's
folder on disk, leaving a written record behind.

## Schema

Guarded migration in `portal/src/db.js`, same pattern as the existing `files`
migration: `alter table sessions add column archived integer not null default 0`.

## API (all under requireAuth, owner-only via the existing session lookup)

- `POST /api/sessions/:id/archive` sets `archived = 1`.
- `POST /api/sessions/:id/restore` sets `archived = 0`.
- `DELETE /api/sessions/:id` permanently deletes. Returns 409 unless the session is
  already archived. Steps, in order:
  1. Derive the application folder (see below). If one is found, append the record
     to the deletion log, then remove the folder recursively.
  2. Delete the session's `jobs` rows, `messages` rows, then the `sessions` row.
- `GET /api/sessions` now excludes archived sessions; `GET /api/sessions?archived=1`
  returns only archived ones.

## Application folder derivation and safety

The portal does not record the folder the agent created; the only handle is
`session.files` (JSON array of absolute paths to delivered documents).

- Candidate folder: `dirname` of the first file path.
- It is only accepted if, after `realpath` resolution, it sits exactly one level
  below `<projectDir>/applications/` (i.e. it is `applications/<slug>/`, not
  `applications/` itself, not anywhere else). `projectDir` comes from the user
  registry, resolved with `realpathSync` as the download endpoint already does.
- If the session has no files, or the candidate fails validation, no folder is
  deleted; the deletion proceeds on the database rows only and the deletion log
  notes that no folder was removed.

## Deletion log

Append-only record at `<projectDir>/applications/DELETED.md`, created with a short
heading on first use. One entry per deletion:

```
## 2026-07-19: <session title>
Deleted from the portal by <user name>. Folder removed: applications/<slug>/ (or
"none found"). Messages in session: <n>. Session created <created_at>.
```

This keeps the record next to the hole it explains, inside the person's own project.
Nothing else on disk is touched; the tracker CSV is left as it is.

## UI (public/app.js, public/style.css, vanilla JS)

- **Card menu.** Each card in the list gets a vertical three-dot button on its
  right-hand side. Tapping it opens a bottom sheet (fixed panel sliding up from the
  bottom with a dimmed backdrop; tapping the backdrop dismisses it) containing
  "Archive application". The sheet is built as a generic list of actions so later
  options slot in without rework. The three-dot button must not trigger the card's
  navigation.
- **Cog menu.** A cog icon at the top right of the list page opens the same style of
  bottom sheet with "View archived applications", which navigates to `#archived`.
- **Archived page.** New hash route `#archived` (alongside the existing `#<id>`
  routing) rendered as its own page with a back link to the main list. It lists
  archived applications as cards; each has "Restore" and "Delete permanently".
  Delete asks `confirm('Permanently delete "<title>"? This also deletes its
  application folder and files. This cannot be undone.')` before calling the API.
  Restore and delete both re-render the page.

## Error handling

- Archive/restore/delete on a session the user does not own: existing 404 behaviour.
- Delete on a non-archived session: 409 with a plain error body.
- Folder removal failures (permissions, already gone) do not abort the deletion:
  log the failure server-side, note it in DELETED.md, and continue deleting the
  database rows.

## Testing (portal/test, node:test, in-memory or temp fixtures as existing tests do)

- Archive hides a session from `GET /api/sessions` and shows it under `?archived=1`.
- Restore reverses it.
- Delete refuses (409) on a non-archived session.
- Delete on an archived session removes session, messages and jobs rows.
- Folder derivation: accepts `applications/<slug>/`, rejects paths outside it
  (including `applications/` itself and traversal attempts), and the no-files case.
- Deletion appends a DELETED.md entry, including the "none found" folder case.
- Users cannot archive, restore or delete each other's sessions.

## Rollout

Implement and commit in `~/j4dev`, push to the public repo, then pull into `~/j4`
(pull-only) and restart the live portal service. Note: `~/j4` currently has local
capybara commits not on origin; reconcile before pulling.
