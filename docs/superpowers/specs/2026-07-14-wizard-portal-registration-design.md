# Setup wizard: shared-portal user registration

**Date:** 2026-07-14
**Status:** Approved for planning

## Goal

When the setup wizard is answered `PORTAL=yes`, it registers the new person
in the kit checkout's shared multi-user portal instead of copying a
per-project portal into their project. After the wizard finishes, the person
can log in to the shared portal immediately (no restart needed, since the
portal re-reads its registry on every lookup).

## Background

The portal now supports multiple users via a gitignored registry at
`portal/data/users.json` mapping each login email to
`{ name, projectDir, admin }`. The deployment model is one portal run from
the kit checkout serving every project folder. The wizard's current
`PORTAL=yes` behaviour (copying `portal/` into the project, wiring a
single-user `.env`) predates this and is retired by this change. The
portal's own legacy env fallback (`ALLOWED_EMAILS`/`PROJECT_DIR`/`USER_NAME`)
is untouched.

## Behaviour

With `PORTAL=yes`:

1. **New answer `PORTAL_ADMIN`.** Interactive: after the existing questions,
   ask "Should this person receive portal failure alerts? [y/N]" (default
   no). Non-interactive: read `PORTAL_ADMIN` from the answers file,
   defaulting to no when absent. Normalised like `PORTAL`/`CREATIVE`.
2. **Registry upsert.** After the project is created, upsert into
   `KIT_DIR/portal/data/users.json`, creating `data/` and the file if
   absent:
   - key: `USER_EMAIL`, trimmed and lowercased
   - `name`: `USER_NAME`
   - `projectDir`: absolute path of `TARGET_DIR`
   - `admin`: `true` only if `PORTAL_ADMIN` is yes; otherwise the key is
     omitted
   - If the email already exists, update that entry in place (name,
     projectDir, admin) and say so. Re-running setup for the same person
     converges; other entries are never touched.
3. **Mechanism.** A `node -e` read-modify-write of the JSON (the portal
   requires Node 20+ anyway). If node is missing, print the exact JSON
   entry to add by hand plus the registry path, and continue; setup must
   not fail.
4. **No portal copy.** The `cp -R portal` block, its cleanup lines, and the
   `docs/portal.md` copy into the project are removed.
5. **Output.** The wizard prints what it registered (email, project dir,
   admin or not) and the registry path.

`PORTAL=no` (or unset): no registry access, no portal files touched.

## SETUP.md task text

The portal task inserted into the project's SETUP.md changes to reflect the
shared portal: the person is already registered; remaining work applies only
if the kit portal has never been configured (its `.env`, `npm install`
inside the kit's `portal/`, and one end-to-end test submission). Wording in
British English.

## Docs

- `docs/portal.md`: deployment section states the wizard performs
  registration; manual `users.json` editing remains documented for
  removals and edits.
- Getting-started guide: wizard walkthrough updated (portal question now
  registers rather than copies; mention the failure-alerts question).

## Testing

Extend the existing `setup/test` harness:

- registration creates `users.json` with the correct entry; `admin: true`
  present only when answered yes
- a second registration (different email) appends without altering the
  first entry
- re-registration of the same email updates in place, no duplicate key
- `PORTAL=no` leaves the kit's `portal/data` untouched
- node-absent degradation covered if the harness can simulate it (PATH
  stub); otherwise documented as manually verified
- tests must not write to the real kit registry: point the wizard at a
  temporary kit dir or make the registry path overridable for tests
  (e.g. honour a `PORTAL_REGISTRY` override, defaulting to
  `KIT_DIR/portal/data/users.json`)

## Out of scope

- Any change to the portal server code
- Helper mode (deliberately excluded; one person per login)
- Migrating existing per-project portal copies
