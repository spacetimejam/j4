#!/usr/bin/env bash
# Tests for the setup wizard. Plain bash, no framework.
set -u

TEST_DIR="$(cd "$(dirname "$0")" && pwd)"
SETUP_DIR="$(dirname "$TEST_DIR")"

FAILS=0
PASSES=0

fail() {
  echo "FAIL: $1"
  FAILS=$((FAILS + 1))
}

pass() {
  PASSES=$((PASSES + 1))
}

check() {
  # check <description> <command...>
  desc="$1"
  shift
  if "$@"; then
    pass
  else
    fail "$desc"
  fi
}

# --- Unit tests: suggest_target_dir ----------------------------------------

# shellcheck source=../lib.sh
. "$SETUP_DIR/lib.sh"

UWORK="$(mktemp -d)"
check "initials from two-word name" \
  test "$(suggest_target_dir "$UWORK" "Sam Jackson" 2>/dev/null)" = "$UWORK/sj"
check "initials strip punctuation" \
  test "$(suggest_target_dir "$UWORK" "Anna Marie O'Brien" 2>/dev/null)" = "$UWORK/amo"
check "single-word name" \
  test "$(suggest_target_dir "$UWORK" "Cher" 2>/dev/null)" = "$UWORK/c"
mkdir "$UWORK/sj"
check "clash extends into last name" \
  test "$(suggest_target_dir "$UWORK" "Sam Jackson" 2>/dev/null)" = "$UWORK/sja"
if suggest_target_dir "$UWORK" "Sam Jackson" 2>&1 >/dev/null | grep -q "suggesting sja"; then
  pass
else
  fail "clash should print a note about the suggested alternative"
fi
mkdir "$UWORK/sja" "$UWORK/sjac" "$UWORK/sjack" "$UWORK/sjacks" "$UWORK/sjackso" "$UWORK/sjackson"
check "exhausted last name falls back to numbers" \
  test "$(suggest_target_dir "$UWORK" "Sam Jackson" 2>/dev/null)" = "$UWORK/sj2"
mkdir "$UWORK/c"
check "single-word clash goes straight to numbers" \
  test "$(suggest_target_dir "$UWORK" "Cher" 2>/dev/null)" = "$UWORK/c2"
rm -rf "$UWORK"

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

# --- Run 0: default target is an initials subfolder of the kit root --------

# The default lands inside the kit root, so run setup from a temp copy of
# the kit rather than polluting the real repo.
WORK0="$(mktemp -d)"
mkdir "$WORK0/kit"
(cd "$(dirname "$SETUP_DIR")" && tar cf - --exclude .git --exclude portal/node_modules --exclude portal/data .) | (cd "$WORK0/kit" && tar xf -)
printf '\n' | bash "$WORK0/kit/setup/setup.sh" --answers "$TEST_DIR/answers.env" --skip-deps >/dev/null 2>&1 \
  || fail "setup.sh exited non-zero when using the default target"
check "default target is the user's initials under the kit root" test -f "$WORK0/kit/ae/CLAUDE.md"

# --- Run 1: AI_TOOL=claude-code -------------------------------------------

WORK1="$(mktemp -d)"
TARGET1="$WORK1/my-search"

bash "$SETUP_DIR/setup.sh" --answers "$TEST_DIR/answers.env" --target "$TARGET1" --skip-deps >/dev/null 2>&1 \
  || fail "setup.sh exited non-zero on first run"

check "CLAUDE.md exists" test -f "$TARGET1/CLAUDE.md"
check "CLAUDE.md contains substituted name" grep -q "Alex Example" "$TARGET1/CLAUDE.md"
if grep -q '{{' "$TARGET1/CLAUDE.md" 2>/dev/null; then
  fail "CLAUDE.md still contains {{ placeholders"
else
  pass
fi
check "SETUP.md exists" test -f "$TARGET1/SETUP.md"
check "SETUP.md records the name answer" grep -q "Alex Example" "$TARGET1/SETUP.md"
check "SETUP.md records the field answer" grep -q "software engineering" "$TARGET1/SETUP.md"
check "core/profile.md exists" test -f "$TARGET1/core/profile.md"
check "WORKFLOW.md exists" test -f "$TARGET1/WORKFLOW.md"
check "tracker/applications.csv exists" test -f "$TARGET1/tracker/applications.csv"
check "render/render.sh exists" test -f "$TARGET1/render/render.sh"
check ".claude/settings.json ships transcript retention" grep -q "cleanupPeriodDays" "$TARGET1/.claude/settings.json"

# The instantiated project is a git repo with exactly one commit.
if git -C "$TARGET1" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  pass
else
  fail "target project is not a git repository"
fi
COMMITS="$(git -C "$TARGET1" rev-list --count HEAD 2>/dev/null || echo 0)"
if [ "$COMMITS" = "1" ]; then
  pass
else
  fail "target project should have exactly one commit, has: $COMMITS"
fi
if git -C "$TARGET1" log -1 --format=%s 2>/dev/null | grep -q "initial project from job-search-kit"; then
  pass
else
  fail "initial commit message mismatch"
fi

# With no vendored template, render.sh must fail with a clear pointer at the
# README's "Choosing your template" section, not a raw typst error.
mkdir -p "$TARGET1/applications/dummy-role"
RENDER_OUT="$(bash "$TARGET1/render/render.sh" dummy-role 2>&1)"
RENDER_RC=$?
if [ "$RENDER_RC" -ne 0 ]; then
  pass
else
  fail "render.sh should exit non-zero without a vendored template"
fi
if echo "$RENDER_OUT" | grep -q "Choosing your template"; then
  pass
else
  fail "render.sh missing-template message should point at 'Choosing your template' in render/README.md"
fi

# Also test missing cover-letter.typ with main.typ present.
# Create both templates, then remove only cover-letter.typ.
touch "$TARGET1/render/templates/main.typ"
touch "$TARGET1/render/templates/cover-letter.typ"
rm "$TARGET1/render/templates/cover-letter.typ"
RENDER_OUT2="$(bash "$TARGET1/render/render.sh" dummy-role 2>&1)"
RENDER_RC2=$?
if [ "$RENDER_RC2" -ne 0 ]; then
  pass
else
  fail "render.sh should exit non-zero without a vendored cover-letter template"
fi
if echo "$RENDER_OUT2" | grep -q "Choosing your template"; then
  pass
else
  fail "render.sh missing-cover-letter-template message should point at 'Choosing your template' in render/README.md"
fi

# No remaining {{ tokens anywhere in substituted file types.
LEFTOVER="$(grep -rl '{{' "$TARGET1" --include='*.md' --include='*.yaml' --include='*.tmpl' 2>/dev/null || true)"
if [ -n "$LEFTOVER" ]; then
  fail "leftover {{ tokens in: $LEFTOVER"
else
  pass
fi

# The non-creative run must not include the creative module.
if [ -d "$TARGET1/portfolio" ]; then
  fail "portfolio/ should not exist when CREATIVE=no"
else
  pass
fi
if grep -q "case-study interview" "$TARGET1/SETUP.md" 2>/dev/null; then
  fail "SETUP.md should not mention the case-study interview when CREATIVE=no"
else
  pass
fi

# The non-portal run must not include the portal.
if [ -d "$TARGET1/portal" ]; then
  fail "portal/ should not exist when PORTAL=no"
else
  pass
fi
if grep -q "If you chose the portal" "$TARGET1/SETUP.md" 2>/dev/null; then
  fail "SETUP.md should not contain a portal task when PORTAL=no"
else
  pass
fi
if [ -f "$TARGET1/docs/portal.md" ]; then
  fail "docs/portal.md should not exist when PORTAL=no"
else
  pass
fi

# --- Run 2: AI_TOOL=other ---------------------------------------------------

WORK2="$(mktemp -d)"
TARGET2="$WORK2/my-search"
ANSWERS2="$WORK2/answers-other.env"
sed -e 's/^AI_TOOL=.*/AI_TOOL="other"/' "$TEST_DIR/answers.env" > "$ANSWERS2"

bash "$SETUP_DIR/setup.sh" --answers "$ANSWERS2" --target "$TARGET2" --skip-deps >/dev/null 2>&1 \
  || fail "setup.sh exited non-zero on second run"

check "AGENTS.md exists when AI_TOOL=other" test -f "$TARGET2/AGENTS.md"
if [ -f "$TARGET2/CLAUDE.md" ]; then
  fail "CLAUDE.md should not exist when AI_TOOL=other"
else
  pass
fi

# --- Run 3: creative module -------------------------------------------------

WORK3="$(mktemp -d)"
TARGET3="$WORK3/my-search"

bash "$SETUP_DIR/setup.sh" --answers "$TEST_DIR/answers-creative.env" --target "$TARGET3" --skip-deps >/dev/null 2>&1 \
  || fail "setup.sh exited non-zero on creative run"

check "portfolio/site.md exists" test -f "$TARGET3/portfolio/site.md"
check "portfolio/case-studies/README.md exists" test -f "$TARGET3/portfolio/case-studies/README.md"
check "interview-questions.md exists" test -f "$TARGET3/portfolio/case-studies/interview-questions.md"
check "question-generator prompt exists" test -f "$TARGET3/portfolio/case-studies/prompts/question-generator.md"
check "synthesis prompt exists" test -f "$TARGET3/portfolio/case-studies/prompts/synthesis.md"
check "hiring-manager-review prompt exists" test -f "$TARGET3/portfolio/case-studies/prompts/hiring-manager-review.md"
check "CLAUDE.md mentions portfolio/" grep -q "portfolio/" "$TARGET3/CLAUDE.md"
check "SETUP.md has a case-study item" grep -q "case-study interview" "$TARGET3/SETUP.md"

# The case-study item must sit inside the numbered Tasks list, before the
# "Delete this file" step, so an AI working the list in order sees it.
CS_LINE="$(grep -n "case-study interview" "$TARGET3/SETUP.md" | head -1 | cut -d: -f1)"
DEL_LINE="$(grep -n "Delete this file" "$TARGET3/SETUP.md" | head -1 | cut -d: -f1)"
if [ -z "$CS_LINE" ] || [ -z "$DEL_LINE" ]; then
  fail "could not locate case-study item or delete-this-file line in SETUP.md"
elif [ "$CS_LINE" -lt "$DEL_LINE" ]; then
  pass
else
  fail "case-study item (line $CS_LINE) is not before the delete-this-file line (line $DEL_LINE)"
fi

# No leftover tokens in the creative project either.
LEFTOVER3="$(grep -rl '{{' "$TARGET3" --include='*.md' --include='*.yaml' --include='*.tmpl' 2>/dev/null || true)"
if [ -n "$LEFTOVER3" ]; then
  fail "leftover {{ tokens in creative project: $LEFTOVER3"
else
  pass
fi

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

# --- Portal unit tests (optional) ---------------------------------------------
# The portal's own node tests need its dependencies installed first
# (cd portal && npm install). Skip cleanly when node or node_modules is
# absent so this suite still runs on machines without a node toolchain.

KIT_DIR="$(dirname "$SETUP_DIR")"
if command -v node >/dev/null 2>&1 && [ -d "$KIT_DIR/portal/node_modules" ]; then
  if (cd "$KIT_DIR/portal" && npm test >/dev/null 2>&1); then
    pass
  else
    fail "portal unit tests (cd portal && npm test) failed"
  fi
else
  echo "SKIP: portal unit tests (node or portal/node_modules not available)"
fi

# --- Summary ----------------------------------------------------------------

rm -rf "$WORK0" "$WORK1" "$WORK2" "$WORK3" "$WORK4"
echo "Passed: $PASSES  Failed: $FAILS"
[ "$FAILS" -eq 0 ]
