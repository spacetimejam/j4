# j4 — job-search kit

A kit for running AI-assisted job searches. The repo (the "kit checkout") holds templates and shared services; each job-seeker gets their own project folder created by the setup wizard, conventionally a sibling directory named after their initials.

## Layout

- `setup/` — wizard (`setup.sh` + `lib.sh`, bash 3.2 compatible) and its test harness `setup/test/run-tests.sh` (plain bash, prints `Passed: N  Failed: N`). Run after any setup change.
- `template/` — files copied into each new project (CLAUDE.md.tmpl, tracker/, WORKFLOW.md, ...). Placeholders are `{{TOKEN}}`, substituted by `substitute_all` in `setup/lib.sh`.
- `portal/` — shared submission portal (Node 20+, Express, better-sqlite3, `npm test` uses node:test). One instance runs from the kit checkout and serves every project folder.
- `docs/superpowers/` — specs and plans; `docs/design-private/` — dated historical design records (do not update for later changes).

## Key decisions — don't re-litigate

- **One person per portal login; no helper mode.** A helper uses Claude Code CLI in the person's project folder, never the portal. Do not add any "view another user's sessions" feature (owner decision, 2026-07-14).
- **Shared portal, registry-based users.** `portal/data/users.json` (gitignored) maps lowercased email → `{name, projectDir, admin?}`; re-read on every lookup, so edits need no restart. The wizard registers users on `PORTAL=yes`; it no longer copies `portal/` into projects.
- **File-based tracker only.** `tracker/applications.csv` is the single source of truth; the grist option was removed 2026-07-14. If readability becomes an issue, generate views from the CSV rather than switching backends.
- **No mascot.** The capybara mascot experiment was judged a failed test and fully rolled back (owner decision, 2026-07-19). Do not reintroduce it.
- **Portal reply directives.** Agent replies may end with fenced blocks the queue strips and acts on: `session-title` (renames the session; sits before any email block) and `email-to-user` (sends deliverables). Parse order in `queue.js` is email first, then title on the cleaned text. A failed resume retries once in a fresh session with `buildRecoveryPrompt` context. Specs: `docs/superpowers/specs/2026-07-19-portal-session-titles-design.md`, `2026-07-19-portal-resume-fallback-design.md`.
- **Archive then delete.** Portal applications are archived off the list first; permanent delete works only on archived sessions, removes the derived `applications/<slug>/` folder (realpath-validated, delivered-files paths only), and appends a record to the project's `applications/DELETED.md`. Spec: `docs/superpowers/specs/2026-07-19-portal-archive-delete-design.md`.

## Constraints

- Setup scripts stay bash 3.2 compatible: no associative arrays, no readarray, no `sed -i`, no `${var,,}`, no GNU-only flags.
- Setup must never fail when node is absent (`register_portal_user` prints manual instructions and returns 0).
- Setup tests must never write the real registry: always set `PORTAL_REGISTRY` in tests.
- SETUP.md portal task text must keep the literal phrase "If you chose the portal" (tests grep for it).
- Docs in British English; no em/en dashes as sentence punctuation.

## Verification

- `bash setup/test/run-tests.sh`
- `cd portal && npm test`
