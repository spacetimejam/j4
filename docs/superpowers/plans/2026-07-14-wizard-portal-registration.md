# Wizard Shared-Portal Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `PORTAL=yes` in the setup wizard registers the new person in the kit checkout's shared portal registry (`portal/data/users.json`) instead of copying a per-project portal.

**Architecture:** A new `register_portal_user` function in `setup/lib.sh` performs a node-based read-modify-write upsert of the registry (manual-instructions fallback when node is absent). `setup/setup.sh` gains a `PORTAL_ADMIN` answer, drops the portal-copy block, and calls the new function; the SETUP.md portal task text changes to match. Tests extend `setup/test/run-tests.sh`; the registry path is overridable via `PORTAL_REGISTRY` so tests never touch the real registry.

**Tech Stack:** Bash 3.2-compatible shell, node (for JSON editing only), plain-bash test harness in `setup/test/run-tests.sh`.

## Global Constraints

- Bash 3.2 compatible: no associative arrays, no readarray, no GNU-only flags, no `sed -i`.
- Setup must never fail because node is missing: print the manual JSON entry and continue (exit 0 path).
- Tests must never write to the real kit registry: always set `PORTAL_REGISTRY` in tests.
- Registry entry shape must match what `portal/src/users.js` expects: key = trimmed lowercased email; value `{ "name": <string>, "projectDir": <string> }` plus `"admin": true` only when answered yes (key omitted otherwise).
- Upsert semantics: existing entry for the same email is replaced in place; all other entries preserved byte-for-byte in content (formatting: `JSON.stringify(users, null, 2)` + trailing newline).
- British English in all user-facing copy and docs.
- The SETUP.md portal task must keep the literal phrase "If you chose the portal" (existing tests grep for it) and stay inside the numbered Tasks list before the "Delete this file" step.
- Run the full setup suite (`bash setup/test/run-tests.sh`) after every task; it must pass before each commit.

---

### Task 1: `register_portal_user` in lib.sh

**Files:**
- Modify: `setup/lib.sh` (append the new function)
- Test: `setup/test/run-tests.sh` (new unit-test section after the `suggest_target_dir` unit tests, i.e. after the `rm -rf "$UWORK"` line)

**Interfaces:**
- Produces: `register_portal_user <registry_file> <email> <name> <project_dir> <admin:yes|no>` — upserts the entry, creating the file and its parent directory if needed; prints `Registered <email> in <file>` or `Updated <email> in <file>`; when node is missing prints manual instructions containing the phrase `by hand` and returns 0 without creating the file. Task 2 calls this from setup.sh.

- [ ] **Step 1: Write the failing tests**

In `setup/test/run-tests.sh`, directly after the `rm -rf "$UWORK"` line that ends the `suggest_target_dir` unit tests, insert:

```bash
# --- Unit tests: register_portal_user ---------------------------------------

RWORK="$(mktemp -d)"
REG="$RWORK/data/users.json"

if command -v node >/dev/null 2>&1; then
  register_portal_user "$REG" " Alice@Example.COM " "Alice Example" "/home/x/proj-a" "yes" >/dev/null
  check "registry file created" test -f "$REG"
  check "email key is trimmed and lowercased" \
    node -e 'const u=require(process.argv[1]); process.exit("alice@example.com" in u ? 0 : 1)' "$REG"
  check "admin flag set when answered yes" \
    node -e 'const u=require(process.argv[1]); process.exit(u["alice@example.com"].admin === true ? 0 : 1)' "$REG"
  check "name and projectDir stored" \
    node -e 'const u=require(process.argv[1])["alice@example.com"]; process.exit(u.name === "Alice Example" && u.projectDir === "/home/x/proj-a" ? 0 : 1)' "$REG"

  register_portal_user "$REG" "bob@example.com" "Bob Example" "/home/x/proj-b" "no" >/dev/null
  check "second user appended" \
    node -e 'const u=require(process.argv[1]); process.exit(Object.keys(u).length === 2 ? 0 : 1)' "$REG"
  check "non-admin entry has no admin key" \
    node -e 'const u=require(process.argv[1]); process.exit("admin" in u["bob@example.com"] ? 1 : 0)' "$REG"
  check "first user untouched by second registration" \
    node -e 'const u=require(process.argv[1]); process.exit(u["alice@example.com"].admin === true ? 0 : 1)' "$REG"

  out="$(register_portal_user "$REG" "alice@example.com" "Alice Renamed" "/home/x/proj-a2" "no")"
  echo "$out" | grep -q "Updated alice@example.com" || fail "re-registration should report Updated"
  check "re-registration updates in place, no duplicate" \
    node -e 'const u=require(process.argv[1]); const a=u["alice@example.com"]; process.exit(Object.keys(u).length === 2 && a.name === "Alice Renamed" && a.projectDir === "/home/x/proj-a2" && !("admin" in a) ? 0 : 1)' "$REG"
else
  echo "SKIP: register_portal_user node-path tests (node not available)"
fi

# node-absent fallback: run in a subshell whose PATH has no node. The
# fallback path only needs shell builtins plus tr, so a stub dir with a
# tr symlink is enough.
STUB="$(mktemp -d)"
ln -s "$(command -v tr)" "$STUB/tr"
FALLBACK_REG="$RWORK/fallback/users.json"
out="$(PATH="$STUB" register_portal_user "$FALLBACK_REG" "Carol@Example.com" "Carol" "/home/x/proj-c" "yes" 2>&1)" \
  || fail "register_portal_user must return 0 when node is missing"
echo "$out" | grep -q "by hand" || fail "node-absent fallback should print manual instructions"
echo "$out" | grep -q '"carol@example.com"' || fail "manual instructions should show the lowercased entry"
if [ -f "$FALLBACK_REG" ]; then
  fail "node-absent fallback must not create the registry file"
else
  pass
fi
rm -rf "$RWORK" "$STUB"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bash setup/test/run-tests.sh`
Expected: FAIL — `register_portal_user: command not found` surfaces as failed checks (the harness continues on failure and prints a non-zero Failed count).

- [ ] **Step 3: Implement**

Append to `setup/lib.sh`:

```bash
# register_portal_user <registry_file> <email> <name> <project_dir> <admin yes|no>
# Upserts one entry in the shared portal registry (portal/data/users.json).
# The registry is edited with node so JSON escaping is always correct; the
# portal itself needs Node 20+, so node being present is the normal case.
# Without node, print the entry to add by hand and succeed anyway: portal
# registration must never break project setup.
register_portal_user() {
  reg_file="$1"
  reg_email="$2"
  reg_name="$3"
  reg_dir="$4"
  reg_admin="$5"
  reg_email_lc="$(printf '%s' "$reg_email" | tr -d ' ' | tr '[:upper:]' '[:lower:]')"
  if ! command -v node >/dev/null 2>&1; then
    echo "node not found: cannot update the portal registry automatically."
    echo "Add this entry to $reg_file by hand:"
    if [ "$reg_admin" = "yes" ]; then
      echo "  \"$reg_email_lc\": { \"name\": \"$reg_name\", \"projectDir\": \"$reg_dir\", \"admin\": true }"
    else
      echo "  \"$reg_email_lc\": { \"name\": \"$reg_name\", \"projectDir\": \"$reg_dir\" }"
    fi
    return 0
  fi
  REG_FILE="$reg_file" REG_EMAIL="$reg_email" REG_NAME="$reg_name" \
  REG_DIR="$reg_dir" REG_ADMIN="$reg_admin" node -e '
    const fs = require("fs");
    const path = require("path");
    const file = process.env.REG_FILE;
    const email = process.env.REG_EMAIL.trim().toLowerCase();
    let users = {};
    if (fs.existsSync(file)) users = JSON.parse(fs.readFileSync(file, "utf8"));
    const existed = Object.prototype.hasOwnProperty.call(users, email);
    const entry = { name: process.env.REG_NAME, projectDir: process.env.REG_DIR };
    if (process.env.REG_ADMIN === "yes") entry.admin = true;
    users[email] = entry;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(users, null, 2) + "\n");
    console.log((existed ? "Updated " : "Registered ") + email + " in " + file);
  '
}
```

Note the manual-fallback email uses `tr -d ' '` plus lowercase so it matches the node path's `trim().toLowerCase()` for ordinary addresses (emails contain no interior spaces).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bash setup/test/run-tests.sh`
Expected: `Failed: 0`; the new checks all pass (or the node-path block prints its SKIP line on machines without node, with the fallback checks still passing).

- [ ] **Step 5: Commit**

```bash
git add setup/lib.sh setup/test/run-tests.sh
git commit -m "feat(setup): registry upsert helper for the shared portal"
```

---

### Task 2: Wire registration into setup.sh, retire the portal copy

**Files:**
- Modify: `setup/setup.sh` (interactive questions, normalisation block, portal block, SETUP.md task text)
- Modify: `setup/test/answers-portal.env` (add `PORTAL_ADMIN="yes"`)
- Create: `setup/test/answers-portal2.env`
- Test: `setup/test/run-tests.sh` (rewrite the "Run 4: portal" section)

**Interfaces:**
- Consumes: `register_portal_user` from Task 1 (already sourced via `lib.sh`).
- Produces: setup.sh honours `PORTAL_REGISTRY` (env var, default `$KIT_DIR/portal/data/users.json`) and the `PORTAL_ADMIN` answer (default `no`). Task 3 documents both.

- [ ] **Step 1: Update answers files**

Append to `setup/test/answers-portal.env`:

```bash
PORTAL_ADMIN="yes"
```

Create `setup/test/answers-portal2.env`:

```bash
USER_NAME="Bea Example"
USER_EMAIL="bea@example.com"
USER_PHONE="07000000001"
USER_LOCATION="Leeds"
FIELD="graphic design"
SENIORITY="mid-weight"
EMPLOYMENT_STATUS="between roles"
AI_TOOL="claude-code"
TRACKER="file"
PORTAL="yes"
CREATIVE="no"
```

(No `PORTAL_ADMIN` line: exercises the default-no path.)

- [ ] **Step 2: Rewrite the failing tests**

In `setup/test/run-tests.sh`, replace the entire "Run 4: portal" section (from the `# --- Run 4: portal ---` header down to, but not including, the `# --- Portal unit tests (optional) ---` header) with:

```bash
# --- Run 4: portal registration ---------------------------------------------
# PORTAL=yes registers the person in the shared portal registry instead of
# copying a portal into the project. PORTAL_REGISTRY points the wizard at a
# temp registry so tests never touch the real kit one.

WORK4="$(mktemp -d)"
TARGET4="$WORK4/my-search"
TARGET4B="$WORK4/second-search"
REG4="$WORK4/reg/users.json"

PORTAL_REGISTRY="$REG4" bash "$SETUP_DIR/setup.sh" --answers "$TEST_DIR/answers-portal.env" --target "$TARGET4" --skip-deps >"$WORK4/out1.txt" 2>&1 \
  || fail "setup.sh exited non-zero on portal run"

if [ -d "$TARGET4/portal" ]; then
  fail "portal/ must no longer be copied into the target"
else
  pass
fi
if [ -f "$TARGET4/docs/portal.md" ]; then
  fail "docs/portal.md must no longer be copied into the target"
else
  pass
fi
check "SETUP.md has a portal task" grep -q "If you chose the portal" "$TARGET4/SETUP.md"

# The portal task must sit inside the numbered Tasks list, before the
# "Delete this file" step, so an AI working the list in order sees it.
PORTAL_LINE="$(grep -n "If you chose the portal" "$TARGET4/SETUP.md" | head -1 | cut -d: -f1)"
DEL_LINE4="$(grep -n "Delete this file" "$TARGET4/SETUP.md" | head -1 | cut -d: -f1)"
if [ -z "$PORTAL_LINE" ] || [ -z "$DEL_LINE4" ]; then
  fail "could not locate portal task or delete-this-file line in SETUP.md"
elif [ "$PORTAL_LINE" -lt "$DEL_LINE4" ]; then
  pass
else
  fail "portal task (line $PORTAL_LINE) is not before the delete-this-file line (line $DEL_LINE4)"
fi

if command -v node >/dev/null 2>&1; then
  check "registry created by wizard" test -f "$REG4"
  check "wizard registered the user with admin flag" \
    node -e 'const u=require(process.argv[1])["alex@example.com"]; process.exit(u && u.admin === true && u.name === "Alex Example" ? 0 : 1)' "$REG4"
  check "projectDir is the absolute target" \
    node -e 'const u=require(process.argv[1])["alex@example.com"]; process.exit(u.projectDir === process.argv[2] ? 0 : 1)' "$REG4" "$TARGET4"
  check "wizard output mentions the registry" grep -q "users.json" "$WORK4/out1.txt"

  PORTAL_REGISTRY="$REG4" bash "$SETUP_DIR/setup.sh" --answers "$TEST_DIR/answers-portal2.env" --target "$TARGET4B" --skip-deps >/dev/null 2>&1 \
    || fail "setup.sh exited non-zero on second portal run"
  check "second wizard run appended a second user" \
    node -e 'const u=require(process.argv[1]); process.exit(Object.keys(u).length === 2 && "bea@example.com" in u ? 0 : 1)' "$REG4"
  check "PORTAL_ADMIN defaults to no" \
    node -e 'const u=require(process.argv[1]); process.exit("admin" in u["bea@example.com"] ? 1 : 0)' "$REG4"
  check "first user survives second run" \
    node -e 'const u=require(process.argv[1]); process.exit(u["alex@example.com"].admin === true ? 0 : 1)' "$REG4"
else
  echo "SKIP: portal registration assertions (node not available)"
fi

# PORTAL=no must not create or touch a registry.
if [ -f "$WORK4/no-reg/users.json" ]; then
  fail "unexpected pre-existing test registry"
fi
PORTAL_REGISTRY="$WORK4/no-reg/users.json" bash "$SETUP_DIR/setup.sh" --answers "$TEST_DIR/answers.env" --target "$WORK4/no-portal" --skip-deps >/dev/null 2>&1 \
  || fail "setup.sh exited non-zero on PORTAL=no run"
if [ -f "$WORK4/no-reg/users.json" ]; then
  fail "PORTAL=no must not create a registry"
else
  pass
fi
```

Also update the final cleanup line to include the new dirs if any were added outside `$WORK4` (all Run 4 artefacts live under `$WORK4`, so the existing `rm -rf ... "$WORK4"` stays correct).

- [ ] **Step 3: Run tests to verify they fail**

Run: `bash setup/test/run-tests.sh`
Expected: FAIL — `portal/ must no longer be copied into the target` and `registry created by wizard` both fail (setup.sh still copies the portal and never writes a registry).

- [ ] **Step 4: Implement in setup.sh**

Four edits:

**(a) Interactive questions.** Replace the single `ask PORTAL ...` line (line 65) with:

```bash
  ask PORTAL "Register with the shared submission portal (submit job descriptions from your phone)? [y/N]" "no"
  case "$PORTAL" in
    y|Y|yes|Yes|YES)
      ask PORTAL_ADMIN "Should this person receive portal failure alerts? [y/N]" "no" ;;
  esac
```

**(b) Normalisation.** In the block that normalises `CREATIVE` (around line 76), add the same treatment for `PORTAL_ADMIN` right after it:

```bash
PORTAL_ADMIN="${PORTAL_ADMIN:-no}"
case "$PORTAL_ADMIN" in
  y|Y|yes|Yes|YES) PORTAL_ADMIN="yes" ;;
  n|N|no|No|NO) PORTAL_ADMIN="no" ;;
esac
```

(Do not add `PORTAL_ADMIN` to the required-answers `for v in ...` loop: it has a default.)

**(c) Portal block.** Replace the whole `if [ "$PORTAL" = "yes" ]; then ... fi` block that copies the portal (lines 233-246, starting after the existing `case "$PORTAL" in` normalisation, which stays) with:

```bash
if [ "$PORTAL" = "yes" ]; then
  # Register this person with the shared portal run from the kit checkout.
  # The registry is re-read by the portal on every lookup, so the new user
  # can log in as soon as this entry lands; no restart needed.
  PORTAL_REGISTRY="${PORTAL_REGISTRY:-$KIT_DIR/portal/data/users.json}"
  ABS_TARGET="$(cd "$TARGET_DIR" && pwd)"
  echo
  register_portal_user "$PORTAL_REGISTRY" "$USER_EMAIL" "$USER_NAME" "$ABS_TARGET" "$PORTAL_ADMIN"
  if [ "$PORTAL_ADMIN" = "yes" ]; then
    echo "Portal: registered as a failure-alert recipient (admin)."
  else
    echo "Portal: registered (no failure alerts)."
  fi
fi
```

**(d) SETUP.md task text.** In the awk block that inserts the portal task into SETUP.md (around line 275), replace the three `print` lines of task text with:

```awk
      print n ". If you chose the portal: this person is already registered with the"
      print "   shared portal in the kit checkout. If that portal has never been set up,"
      print "   configure it per the kit's docs/portal.md (its .env and npm install in"
      print "   the kit's portal/ folder), then test a submission end to end with the user."
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bash setup/test/run-tests.sh`
Expected: `Failed: 0`. Also run the portal's own suite to confirm nothing there is affected: `cd portal && npm test` → all pass.

- [ ] **Step 6: Commit**

```bash
git add setup/setup.sh setup/test/run-tests.sh setup/test/answers-portal.env setup/test/answers-portal2.env
git commit -m "feat(setup): wizard registers users with the shared portal instead of copying it"
```

---

### Task 3: Documentation

**Files:**
- Modify: `docs/portal.md` (deployment/user-management copy)
- Modify: `docs/getting-started/guide.typ` (wizard walkthrough sentence)

No test cycle; verify with a read-through plus `bash setup/test/run-tests.sh` and `cd portal && npm test` still green.

- [ ] **Step 1: Update `docs/portal.md`**

In the section describing `data/users.json` (the "Users" material added by the multi-user work), add after the schema description:

```markdown
You rarely need to edit this file by hand to add someone: the setup wizard
registers each new person automatically when they answer yes to the portal
question, including asking whether they should receive failure alerts.
Manual edits remain the way to remove someone or change an existing entry.
The wizard honours `PORTAL_REGISTRY` if you keep the registry somewhere
other than `portal/data/users.json` in the kit checkout.
```

Check the surrounding deployment note (one shared portal from the kit checkout) still reads correctly with this addition; adjust joining sentences if needed, keeping British English.

- [ ] **Step 2: Update the getting-started guide**

In `docs/getting-started/guide.typ`, in the Step 5 paragraph describing what the wizard asks (around line 89), extend the sentence about the wizard's questions so it mentions the portal briefly. Insert after "asks a short set of questions about you and your search":

```
(including whether to register you with the shared submission portal, if your household runs one)
```

Match the sentence's existing punctuation and flow; do not restructure the paragraph.

- [ ] **Step 3: Verify and commit**

Run: `bash setup/test/run-tests.sh` (expected `Failed: 0`) and `cd portal && npm test` (expected all pass). Re-read both edited docs for consistency.

```bash
git add docs/portal.md docs/getting-started/guide.typ
git commit -m "docs: wizard now registers users with the shared portal"
```

---

## Self-review notes

- Spec coverage: PORTAL_ADMIN question (Task 2a/2b), upsert with lowercasing and in-place update (Task 1), node fallback that never fails setup (Task 1), no portal copy (Task 2c), output summary (Task 2c), SETUP.md text (Task 2d), docs (Task 3), tests including registry isolation via PORTAL_REGISTRY and node-absent simulation via PATH stub (Tasks 1-2). Out of scope respected: no portal server changes.
- The literal grep phrase "If you chose the portal" is preserved in the new SETUP.md task text.
- `answers.env` (PORTAL=no) is reused for the no-registry assertion, so the e2e Docker test (which uses answers.env, no node installed) is unaffected.
