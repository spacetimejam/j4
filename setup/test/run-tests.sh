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
check "SETUP.md sets expectations before intake" grep -q "only as good as what" "$TARGET1/SETUP.md"
check "SETUP.md offers career-step interviews" grep -q "career-step" "$TARGET1/SETUP.md"
check "intake holds the career-step interview" grep -q "^## Career-step interviews" "$TARGET1/core/intake.md"
check "master CV explains the Interviewed line" grep -q "Interviewed: <YYYY-MM-DD>" "$TARGET1/core/master-cv.md"
check "spine offers career-step interviews later" grep -q "career-step interview" "$TARGET1/CLAUDE.md"
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

# The kit ships a default template, so a new project has both files.
check "default CV template ships" test -f "$TARGET1/render/templates/main.typ"
check "default letter template ships" test -f "$TARGET1/render/templates/cover-letter.typ"
check "template licence ships" test -f "$TARGET1/render/templates/VANTAGE-LICENSE"

# Removing a template still fails with a pointer at the README.
mkdir -p "$TARGET1/applications/dummy-role"
rm "$TARGET1/render/templates/cover-letter.typ"
RENDER_OUT2="$(bash "$TARGET1/render/render.sh" dummy-role 2>&1)"
RENDER_RC2=$?
check "render.sh fails without a letter template" test "$RENDER_RC2" -ne 0
if echo "$RENDER_OUT2" | grep -q "Choosing your template"; then pass; else fail "missing-template message should point at 'Choosing your template'"; fi

# With typst present, the skeleton renders to a one-page CV and a letter.
if command -v typst >/dev/null 2>&1 && python3 -c 'import yaml' >/dev/null 2>&1; then
  RWORK_T="$(mktemp -d)"
  bash "$SETUP_DIR/setup.sh" --answers "$TEST_DIR/answers.env" --target "$RWORK_T/p" --skip-deps >/dev/null 2>&1
  mkdir -p "$RWORK_T/p/applications/demo"
  cp "$RWORK_T/p/render/templates/configuration.yaml" "$RWORK_T/p/applications/demo/cv.yaml"
  cp "$RWORK_T/p/render/templates/cover-letter.yaml" "$RWORK_T/p/applications/demo/cover-letter.yaml"
  # The skeleton letter is deliberately short, so the 66% page-fill rule in
  # cover-letter.typ stops it: the CV renders and the letter is refused.
  bash "$RWORK_T/p/render/render.sh" demo >"$RWORK_T/out.txt" 2>&1
  check "CV pdf produced" test -f "$RWORK_T/p/applications/demo/CV - Alex Example - Senior Widget Analyst.pdf"
  check "short letter refused by the page-fill rule" grep -q "cover letter too short" "$RWORK_T/out.txt"

  # A letter with far too many paragraphs must overflow to a second page and
  # be refused, not silently reported as 100% filled.
  mkdir -p "$RWORK_T/p/applications/overflow"
  cp "$RWORK_T/p/render/templates/configuration.yaml" "$RWORK_T/p/applications/overflow/cv.yaml"
  python3 -c "
import yaml
d = yaml.safe_load(open('$RWORK_T/p/render/templates/cover-letter.yaml')) or {}
d['paragraphs'] = list(d.get('paragraphs', [])) + [
    'Overflow padding paragraph to force a second page of the letter. ' * 60
    for _ in range(6)
]
yaml.safe_dump(d, open('$RWORK_T/p/applications/overflow/cover-letter.yaml', 'w'), sort_keys=False)
"
  bash "$RWORK_T/p/render/render.sh" overflow >"$RWORK_T/out2.txt" 2>&1
  check "overflowing letter refused as too long" grep -q "cover letter too long" "$RWORK_T/out2.txt"
  rm -rf "$RWORK_T"
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

# --- Wizard portal messaging ------------------------------------------------

PWORK="$(mktemp -d)"
PORTAL_REGISTRY="$PWORK/users.json" \
  bash "$SETUP_DIR/setup.sh" --answers "$TEST_DIR/answers-portal.env" \
  --target "$PWORK/proj" --skip-deps >"$PWORK/out.txt" 2>&1

check "wizard says the portal itself is not set up yet" \
  grep -qi "not set up yet" "$PWORK/out.txt"
# Assert the runbook by name. Grepping for "assistant" alone would pass without
# any change, because the wizard's closing message already says "AI assistant".
check "wizard points at the remote-access runbook" \
  grep -q "portal-remote-access.md" "$PWORK/out.txt"
check "SETUP.md portal task keeps the required phrase" \
  grep -q "If you chose the portal" "$PWORK/proj/SETUP.md"
check "SETUP.md portal task points at the runbook" \
  grep -q "portal-remote-access.md" "$PWORK/proj/SETUP.md"
rm -rf "$PWORK"

# --- portal/setup-remote.sh -------------------------------------------------

# shellcheck source=remote-tests.sh
. "$TEST_DIR/remote-tests.sh"

# --- install-typst.sh asset selection ----------------------------------------
IT="$SETUP_DIR/../template/render/install-typst.sh"
asset() { TYPST_PRINT_ASSET=1 TYPST_UNAME_S="$1" TYPST_UNAME_M="$2" bash "$IT"; }
check "linux x86_64 asset" test "$(asset Linux x86_64)" = "typst-x86_64-unknown-linux-musl"
check "linux arm64 asset" test "$(asset Linux aarch64)" = "typst-aarch64-unknown-linux-musl"
check "mac arm64 asset" test "$(asset Darwin arm64)" = "typst-aarch64-apple-darwin"
check "mac intel asset" test "$(asset Darwin x86_64)" = "typst-x86_64-apple-darwin"

# --- JAWBS_MODE ---------------------------------------------------------------
MWORK="$(mktemp -d)"
run_mode() { # run_mode <answers> <target>
  PORTAL_REGISTRY="$MWORK/users.json" JAWBS_SKIP_LOCAL=yes \
    bash "$SETUP_DIR/setup.sh" --answers "$1" --target "$2" --skip-deps >"$2.out" 2>&1
}
run_mode "$TEST_DIR/answers-terminal.env" "$MWORK/t" || fail "terminal mode exited non-zero"
check "terminal mode registers nobody" test ! -f "$MWORK/users.json"
check "terminal mode has no portal task" sh -c "! grep -q 'If you chose the portal' '$MWORK/t/SETUP.md'"
check "SETUP.md records the mode" grep -q "How Jawbs is used: terminal" "$MWORK/t/SETUP.md"

run_mode "$TEST_DIR/answers-local.env" "$MWORK/l" || fail "local mode exited non-zero"
check "local mode has no remote-access task" sh -c "! grep -q 'If you chose the portal' '$MWORK/l/SETUP.md'"
check "SETUP.md records local" grep -q "How Jawbs is used: local" "$MWORK/l/SETUP.md"
check "local with no writer answer leaves it to detection" grep -qx -- "- Writer: detect" "$MWORK/l/SETUP.md"
check "terminal mode is not asked about the writer" grep -qx -- "- Writer: not asked" "$MWORK/t/SETUP.md"

# The writer choice is recorded as answered, and an unknown one stops setup.
printf 'WRITER="chatgpt-only"\n' | cat "$TEST_DIR/answers-local.env" - > "$MWORK/w.env"
run_mode "$MWORK/w.env" "$MWORK/w" || fail "a writer choice exited non-zero"
check "SETUP.md records the writer" grep -qx -- "- Writer: chatgpt-only" "$MWORK/w/SETUP.md"
printf 'WRITER="gemini"\n' | cat "$TEST_DIR/answers-local.env" - > "$MWORK/wbad.env"
if run_mode "$MWORK/wbad.env" "$MWORK/wb"; then fail "an unknown WRITER should stop setup"; else pass; fi

# PORTAL=yes still means shared, PORTAL=no still means terminal.
run_mode "$TEST_DIR/answers-portal.env" "$MWORK/s" || fail "PORTAL=yes alias exited non-zero"
check "PORTAL=yes is shared" grep -q "How Jawbs is used: shared" "$MWORK/s/SETUP.md"
check "shared keeps the portal task" grep -q "If you chose the portal" "$MWORK/s/SETUP.md"
run_mode "$TEST_DIR/answers.env" "$MWORK/n" || fail "PORTAL=no alias exited non-zero"
check "PORTAL=no is terminal" grep -q "How Jawbs is used: terminal" "$MWORK/n/SETUP.md"

printf 'JAWBS_MODE="sideways"\n' | cat "$TEST_DIR/answers-terminal.env" - > "$MWORK/bad.env"
if run_mode "$MWORK/bad.env" "$MWORK/b"; then fail "an unknown JAWBS_MODE should stop setup"; else pass; fi
rm -rf "$MWORK"

# --- jawbs-local.sh -----------------------------------------------------------
LWORK="$(mktemp -d)"
PORTAL_REGISTRY="$LWORK/users.json" JAWBS_SKIP_LOCAL=yes \
  bash "$SETUP_DIR/setup.sh" --answers "$TEST_DIR/answers-local.env" --target "$LWORK/proj" --skip-deps >/dev/null 2>&1
mkdir -p "$LWORK/fakebin"
# A codex that is signed in.
printf '#!/bin/sh\n[ "$1 $2" = "login status" ] && exit 0\nexit 1\n' > "$LWORK/fakebin/codex"
chmod +x "$LWORK/fakebin/codex"
run_local() { # run_local <env-file> [PATH]; status lands in <env-file>.status
  JAWBS_STATUS_FILE="$1.status" \
  HOME="$LWORK/home" PORTAL_REGISTRY="$LWORK/users.json" JAWBS_ENV_FILE="$1" \
  JAWBS_SKIP_NPM=yes JAWBS_SKIP_LAUNCH=yes JAWBS_PORT_BASE=59700 PATH="${2:-$PATH}" \
    bash "$SETUP_DIR/jawbs-local.sh" "$LWORK/proj" >"$1.out" 2>&1
}
mkdir -p "$LWORK/home"
# A fake claude, so the test does not depend on the host having one.
printf '#!/bin/sh\nexit 0\n' > "$LWORK/fakebin/claude"; chmod +x "$LWORK/fakebin/claude"

run_local "$LWORK/env1" "$LWORK/fakebin:$PATH" || fail "jawbs-local.sh exited non-zero"
check ".env written" test -f "$LWORK/env1"
check ".env is local" grep -q '^EXPOSURE=local$' "$LWORK/env1"
check ".env binds loopback" grep -q '^BIND_HOST=127.0.0.1$' "$LWORK/env1"
check ".env port" grep -q '^PORT=59700$' "$LWORK/env1"
check ".env base url follows the port" grep -q '^BASE_URL=http://localhost:59700$' "$LWORK/env1"
check ".env logs email" grep -q '^EMAIL_PROVIDER=log$' "$LWORK/env1"
check "signed-in codex means both" grep -q '^SUBSCRIPTIONS=both$' "$LWORK/env1"
check "codex path recorded" grep -q "^CODEX_BIN=$LWORK/fakebin/codex$" "$LWORK/env1"
check "user registered" grep -q 'alex@example.com' "$LWORK/users.json"
check "skipped launch is reported as skipped" grep -qx skipped "$LWORK/env1.status"
check "a signed-in claude needs no sign-in" test "$(grep -c "not signed in" "$LWORK/env1.out")" = 0

# A signed-out claude does not stop setup, and the output says how to sign in.
# Not a terminal here, so no browser sign-in is attempted.
mkdir -p "$LWORK/fakebin-out"
cp "$LWORK/fakebin/codex" "$LWORK/fakebin-out/codex"
printf '#!/bin/sh\n[ "$1 $2" = "auth status" ] && exit 1\n[ "$1 $2" = "auth login" ] && touch "%s/login-tried"\nexit 0\n' "$LWORK" > "$LWORK/fakebin-out/claude"
chmod +x "$LWORK/fakebin-out/claude"
run_local "$LWORK/env1s" "$LWORK/fakebin-out:$PATH"
check "signed-out claude still sets up" grep -qx skipped "$LWORK/env1s.status"
check "signed-out claude is explained" grep -q "claude auth login" "$LWORK/env1s.out"
check "no sign-in attempted outside a terminal" test ! -e "$LWORK/login-tried"

# The wizard's writer choice wins over what is signed in. These PATHs keep the
# host's own codex (in ~/.local/bin) out of reach.
set_writer_line() { # set_writer_line <value>
  awk -v w="$1" '/^- Writer: / { print "- Writer: " w; next } { print }' "$LWORK/proj/SETUP.md" > "$LWORK/SETUP.tmp" \
    && mv "$LWORK/SETUP.tmp" "$LWORK/proj/SETUP.md"
}
mkdir -p "$LWORK/fb-nocodex" "$LWORK/fb-codexout" "$LWORK/fb-noclaude"
cp "$LWORK/fakebin/claude" "$LWORK/fb-nocodex/claude"
cp "$LWORK/fakebin/claude" "$LWORK/fb-codexout/claude"
printf '#!/bin/sh\nexit 1\n' > "$LWORK/fb-codexout/codex"; chmod +x "$LWORK/fb-codexout/codex"
cp "$LWORK/fakebin/codex" "$LWORK/fb-noclaude/codex"

set_writer_line claude-only
run_local "$LWORK/w1" "$LWORK/fakebin:/usr/bin:/bin"
check "claude-only is kept with a signed-in codex" grep -q '^SUBSCRIPTIONS=claude-only$' "$LWORK/w1"
check "claude-only runs on claude" grep -q '^AGENT_RUNNER=claude-sdk$' "$LWORK/w1"

set_writer_line both
run_local "$LWORK/w2" "$LWORK/fb-nocodex:/usr/bin:/bin"
check "both without codex is not set up" test ! -f "$LWORK/w2"
check "both without codex says how to install it" grep -q "npm install -g @openai/codex" "$LWORK/w2.out"
check "both without codex is not switched quietly" grep -qx -- "- Writer: both" "$LWORK/proj/SETUP.md"
run_local "$LWORK/w3" "$LWORK/fb-codexout:/usr/bin:/bin"
check "both with codex signed out still sets up" grep -q '^SUBSCRIPTIONS=both$' "$LWORK/w3"
check "both with codex signed out says how to sign in" grep -q "codex login" "$LWORK/w3.out"

set_writer_line chatgpt-only
run_local "$LWORK/w4" "$LWORK/fb-noclaude:/usr/bin:/bin"
check "chatgpt-only needs no claude" grep -q '^SUBSCRIPTIONS=chatgpt-only$' "$LWORK/w4"
check "chatgpt-only runs on codex" grep -q '^AGENT_RUNNER=codex$' "$LWORK/w4"
run_local "$LWORK/w5" "$LWORK/fb-nocodex:/usr/bin:/bin"
check "chatgpt-only without codex is not set up" test ! -f "$LWORK/w5"
check "chatgpt-only without codex says how to install it" grep -q "npm install -g @openai/codex" "$LWORK/w5.out"
set_writer_line detect

# SETUP.md deletes itself when setup is done; a re-run then finds the person
# in the registry by project folder.
mv "$LWORK/proj/SETUP.md" "$LWORK/SETUP.md.aside"
run_local "$LWORK/env1b" "$LWORK/fakebin:$PATH" || fail "re-run without SETUP.md exited non-zero"
check "re-run without SETUP.md still sets up" grep -q '^EXPOSURE=local$' "$LWORK/env1b"
check "re-run without SETUP.md completes" grep -qx skipped "$LWORK/env1b.status"
mv "$LWORK/users.json" "$LWORK/users.json.aside"
run_local "$LWORK/env1c" "$LWORK/fakebin:$PATH" || fail "no SETUP.md and no registry should still exit 0"
check "no SETUP.md and no registry is explained" grep -q "Could not find your name and email" "$LWORK/env1c.out"
check "no SETUP.md and no registry writes no .env" test ! -f "$LWORK/env1c"
check "no SETUP.md and no registry reports nothing" test ! -s "$LWORK/env1c.status"
mv "$LWORK/SETUP.md.aside" "$LWORK/proj/SETUP.md"
mv "$LWORK/users.json.aside" "$LWORK/users.json"

printf 'EXPOSURE=private\n' > "$LWORK/env2"
run_local "$LWORK/env2" "$LWORK/fakebin:$PATH"
check "existing .env left alone" test "$(cat "$LWORK/env2")" = "EXPOSURE=private"
check "a shared .env is explained" grep -q "settings for the shared Jawbs" "$LWORK/env2.out"
check "a shared .env is not launched" test ! -s "$LWORK/env2.status"
# An existing local .env is kept and setup carries on.
printf 'EXPOSURE=local\nPORT=59705\n' > "$LWORK/env2b"
run_local "$LWORK/env2b" "$LWORK/fakebin:$PATH"
check "an existing local .env is kept" grep -q "already has settings, so it was left" "$LWORK/env2b.out"
check "an existing local .env carries on" grep -qx skipped "$LWORK/env2b.status"

# Signed-out codex means claude-only.
printf '#!/bin/sh\nexit 1\n' > "$LWORK/fakebin/codex"
run_local "$LWORK/env3" "$LWORK/fakebin:$PATH"
check "signed-out codex means claude-only" grep -q '^SUBSCRIPTIONS=claude-only$' "$LWORK/env3"

# Someone else already registered: stop politely, exit 0.
printf '{ "someone@else.com": { "name": "S", "projectDir": "/x" } }\n' > "$LWORK/users.json"
run_local "$LWORK/env4" "$LWORK/fakebin:$PATH" || fail "registry clash should still exit 0"
check "clash writes no .env" test ! -f "$LWORK/env4"
check "clash explained" grep -q "another person" "$LWORK/env4.out"
rm -f "$LWORK/users.json"

# No node: instructions, exit 0.
JAWBS_NODE=definitely-not-node run_local "$LWORK/env5" "$LWORK/fakebin:$PATH" || fail "missing node should still exit 0"
check "missing node explained" grep -q "Node" "$LWORK/env5.out"
check "missing node writes no .env" test ! -f "$LWORK/env5"
check "missing node reports nothing" test ! -s "$LWORK/env5.status"
rm -rf "$LWORK"

# --- setup.sh closing message in local mode -----------------------------------
# A stand-in jawbs-local.sh reports each outcome; only "launched" may promise
# an open browser.
CWORK="$(mktemp -d)"
closing() { # closing <status or empty> <name>
  printf '#!/bin/sh\n[ -n "%s" ] && echo "%s" > "$JAWBS_STATUS_FILE"\nexit 0\n' "$1" "$1" > "$CWORK/stub-$2.sh"
  PORTAL_REGISTRY="$CWORK/users.json" JAWBS_LOCAL_SCRIPT="$CWORK/stub-$2.sh" \
    bash "$SETUP_DIR/setup.sh" --answers "$TEST_DIR/answers-local.env" --target "$CWORK/$2" --skip-deps >"$CWORK/$2.out" 2>&1
}
closing launched ok
check "launched says the browser is open" grep -q "should now be open in your web browser" "$CWORK/ok.out"
closing "" stopped
check "stopped early does not claim an open browser" sh -c "! grep -q 'should now be open' '$CWORK/stopped.out'"
check "stopped early says how to finish" grep -q "jawbs-local.sh $CWORK/stopped" "$CWORK/stopped.out"
check "stopped early gives the terminal next step" grep -q "Next step" "$CWORK/stopped.out"
closing skipped skip
check "skipped launch is neutral" grep -q "Jawbs is set up on this computer." "$CWORK/skip.out"
check "skipped launch does not claim an open browser" sh -c "! grep -q 'should now be open' '$CWORK/skip.out'"
closing failed bad
check "failed launch points at the log" grep -q "jawbs.log" "$CWORK/bad.out"
check "failed launch does not claim an open browser" sh -c "! grep -q 'should now be open' '$CWORK/bad.out'"
rm -rf "${CWORK:?}"

# --- write_local_env port choice -------------------------------------------------
# JAWBS_PORT_BASE keeps these off 8710, which the live portal owns.
PPWORK="$(mktemp -d)"
if command -v node >/dev/null 2>&1; then
  node -e 'require("net").createServer().listen(59710, "127.0.0.1", () => console.log("up"))' >"$PPWORK/busy.out" 2>&1 &
  BUSY_PID=$!
  n=0; while [ "$n" -lt 50 ] && ! grep -q up "$PPWORK/busy.out"; do sleep 0.1; n=$((n + 1)); done
  JAWBS_PORT_BASE=59710 write_local_env "$PPWORK/busy.env" claude-only "" node
  check "a taken port moves to the next one" grep -q '^PORT=59711$' "$PPWORK/busy.env"
  check "base url follows the moved port" grep -q '^BASE_URL=http://localhost:59711$' "$PPWORK/busy.env"
  kill "$BUSY_PID" 2>/dev/null; wait "$BUSY_PID" 2>/dev/null
fi
JAWBS_PORT_BASE=59720 write_local_env "$PPWORK/nonode.env" claude-only "" definitely-not-node
check "no node falls back to the first port" grep -q '^PORT=59720$' "$PPWORK/nonode.env"
rm -rf "${PPWORK:?}"

# --- install_launcher ---------------------------------------------------------
IWORK="$(mktemp -d)"
mkdir -p "$IWORK/kit/bin" "$IWORK/kit/setup/assets" "$IWORK/home"
cp "$SETUP_DIR/assets/jawbs.png" "$IWORK/kit/setup/assets/"
(
  HOME="$IWORK/home" JAWBS_OS=Linux JAWBS_DESKTOP_DIR="$IWORK/home/Desktop" PATH="/opt/fake:$PATH"
  export HOME JAWBS_OS JAWBS_DESKTOP_DIR PATH
  install_launcher "$IWORK/kit" "/opt/node/bin/node" >/dev/null 2>&1
)
L="$IWORK/kit/bin/jawbs-open"
check "launcher written" test -x "$L"
check "launcher bakes absolute node" grep -q '^NODE="/opt/node/bin/node"$' "$L"
check "launcher bakes setup PATH" grep -q '^export PATH="/opt/fake:' "$L"
check "launcher bakes kit dir" grep -q "^KIT=\"$IWORK/kit\"$" "$L"
check "linux menu entry" test -f "$IWORK/home/.local/share/applications/jawbs.desktop"
check "linux desktop entry is executable" test -x "$IWORK/home/Desktop/jawbs.desktop"
check "desktop entry runs the launcher" grep -q "^Exec=\"$L\"$" "$IWORK/home/.local/share/applications/jawbs.desktop"
check "launcher is valid bash" bash -n "$L"

rm -rf "$IWORK/home" && mkdir -p "$IWORK/home"
(
  HOME="$IWORK/home" JAWBS_OS=Darwin JAWBS_DESKTOP_DIR="$IWORK/home/Desktop"
  export HOME JAWBS_OS JAWBS_DESKTOP_DIR
  install_launcher "$IWORK/kit" "/opt/node/bin/node" >/dev/null 2>&1
)
APP="$IWORK/home/Applications/Jawbs.app"
check "mac app bundle" test -f "$APP/Contents/Info.plist"
check "mac app executable" test -x "$APP/Contents/MacOS/Jawbs"
check "mac app runs the launcher" grep -q "$L" "$APP/Contents/MacOS/Jawbs"
check "mac desktop shortcut" test -e "$IWORK/home/Desktop/Jawbs.app"

# The launcher starts node with a GUI's minimal PATH, and gives up as soon
# as node has exited rather than waiting out JAWBS_WAIT_SECS.
cat > "$IWORK/fake-node" <<'EOF'
#!/bin/sh
echo "started $*" >> "$FAKE_NODE_LOG"
EOF
chmod +x "$IWORK/fake-node"
(
  HOME="$IWORK/home" JAWBS_OS=Linux JAWBS_DESKTOP_DIR="$IWORK/home/Desktop"
  export HOME JAWBS_OS JAWBS_DESKTOP_DIR
  install_launcher "$IWORK/kit" "$IWORK/fake-node" >/dev/null 2>&1
)
mkdir -p "$IWORK/kit/portal/data"
T0=$(date +%s)
env -i HOME="$IWORK/home" PATH="/usr/bin:/bin" FAKE_NODE_LOG="$IWORK/node.log" JAWBS_PORT=59717 JAWBS_WAIT_SECS=15 JAWBS_NO_BROWSER=yes JAWBS_NO_DIALOG=yes \
  /bin/bash "$L" >/dev/null 2>"$IWORK/launch.err"
LAUNCH_RC=$?
T1=$(date +%s)
check "launcher starts node from a bare PATH" grep -q "started src/server.js" "$IWORK/node.log"
check "launcher reports a node that exited" test "$LAUNCH_RC" -eq 1
check "launcher stops waiting when node has exited" test $((T1 - T0)) -lt 6
check "launcher failure names the log" grep -q "jawbs.log" "$IWORK/launch.err"

# A server that keeps running must not hold the launcher open. This one never
# answers the probe, so the launcher should give up after JAWBS_WAIT_SECS
# rather than wait for the server to exit, which a healthy one never does.
cat > "$IWORK/fake-node" <<'EOF'
#!/bin/sh
[ "$1" = "-e" ] && exit 0
echo $$ > "$FAKE_NODE_PID"
exec sleep 30
EOF
T0=$(date +%s)
env -i HOME="$IWORK/home" PATH="/usr/bin:/bin" FAKE_NODE_PID="$IWORK/node.pid" JAWBS_PORT=59717 JAWBS_WAIT_SECS=2 JAWBS_NO_BROWSER=yes JAWBS_NO_DIALOG=yes \
  /bin/bash "$L" >/dev/null 2>&1
T1=$(date +%s)
check "launcher returns while the server keeps running" test $((T1 - T0)) -lt 10
check "launcher leaves the server running" kill -0 "$(cat "$IWORK/node.pid" 2>/dev/null)"
kill "$(cat "$IWORK/node.pid" 2>/dev/null)" 2>/dev/null

# With the real node and no curl anywhere on PATH, the launcher still finds
# a running Jawbs, and tells this kit's from another copy's.
if command -v node >/dev/null 2>&1; then
  REAL_NODE="$(command -v node)"
  mkdir -p "$IWORK/nocurl" "$IWORK/home2"
  for t in bash env dirname mkdir sed head tr sleep nohup chmod cat cp uname; do
    tp="$(command -v "$t" 2>/dev/null)" && ln -s "$tp" "$IWORK/nocurl/$t"
  done
  (
    HOME="$IWORK/home2" JAWBS_OS=Linux JAWBS_DESKTOP_DIR="$IWORK/home2/Desktop" PATH="$IWORK/nocurl"
    export HOME JAWBS_OS JAWBS_DESKTOP_DIR PATH
    install_launcher "$IWORK/kit" "$REAL_NODE" >/dev/null 2>&1
  )
  check "no-curl launcher PATH has no curl" test ! -e "$IWORK/nocurl/curl"
  check "no-curl launcher bakes the curl-free PATH" grep -q "^export PATH=\"$IWORK/nocurl\"$" "$L"
  # A stand-in Jawbs on a free port that reports the kit it was given.
  fake_jawbs() { # fake_jawbs <kit> <portfile>
    FJ_KIT="$1" FJ_PORT_FILE="$2" "$REAL_NODE" -e '
      const s = require("http").createServer((q, r) => {
        r.setHeader("content-type", "application/json");
        r.end(JSON.stringify({ title: "Jawbs", local: true, kit: process.env.FJ_KIT }));
      });
      s.listen(0, "127.0.0.1", () => require("fs").writeFileSync(process.env.FJ_PORT_FILE, String(s.address().port)));
    ' &
    FJ_PID=$!
    n=0; while [ "$n" -lt 50 ] && [ ! -s "$2" ]; do sleep 0.1; n=$((n + 1)); done
  }
  run_launcher() { # run_launcher [JAWBS_PORT]
    env -i HOME="$IWORK/home2" PATH="$IWORK/nocurl" ${1:+JAWBS_PORT=$1} JAWBS_WAIT_SECS=1 JAWBS_NO_BROWSER=yes JAWBS_NO_DIALOG=yes \
      /bin/bash "$L" >"$IWORK/run.out" 2>&1
  }
  fake_jawbs "$(cd "$IWORK/kit" && pwd -P)" "$IWORK/ours.port"
  if run_launcher "$(cat "$IWORK/ours.port")"; then pass; else fail "launcher without curl should find its own Jawbs"; fi
  # The port comes from portal/.env when JAWBS_PORT is not set.
  printf 'EXPOSURE=local\nPORT=%s\n' "$(cat "$IWORK/ours.port")" > "$IWORK/kit/portal/.env"
  if run_launcher; then pass; else fail "launcher should read PORT from portal/.env"; fi
  rm -f "$IWORK/kit/portal/.env"
  kill "$FJ_PID" 2>/dev/null; wait "$FJ_PID" 2>/dev/null

  fake_jawbs "/somewhere/else/kit" "$IWORK/other.port"
  rm -f "$IWORK/kit/portal/data/jawbs.log"
  if run_launcher "$(cat "$IWORK/other.port")"; then fail "another kit's Jawbs should stop the launcher"; else pass; fi
  check "another kit's Jawbs is explained" grep -q "Another copy of Jawbs" "$IWORK/run.out"
  check "no second node is started" test ! -e "$IWORK/kit/portal/data/jawbs.log"
  kill "$FJ_PID" 2>/dev/null; wait "$FJ_PID" 2>/dev/null
fi
rm -rf "$IWORK"

# --- render design scripts -----------------------------------------------------
# Needs typst and python3 with yaml; skipped with a note when either is missing.
if command -v typst >/dev/null 2>&1 && python3 -c 'import yaml' >/dev/null 2>&1; then
  RWORK="$(mktemp -d)"
  PORTAL_REGISTRY="$RWORK/users.json" \
    bash "$SETUP_DIR/setup.sh" --answers "$TEST_DIR/answers.env" --target "$RWORK/p" --skip-deps >/dev/null 2>&1
  RP="$RWORK/p"
  mkdir -p "$RP/applications/demo" "$RWORK/out"
  cp "$RP/render/sample/cv.yaml" "$RP/render/sample/cover-letter.yaml" "$RP/applications/demo/"

  JAWBS_OUT_DIR="$RWORK/out" bash "$RP/render/render.sh" demo >/dev/null 2>&1
  check "render.sh writes to JAWBS_OUT_DIR" test -n "$(ls "$RWORK/out"/CV*.pdf 2>/dev/null)"
  check "render.sh leaves the application folder alone with JAWBS_OUT_DIR" test -z "$(ls "$RP/applications/demo"/*.pdf 2>/dev/null)"

  # A design that announces itself, so the check proves which one was used.
  cp -R "$RP/render/templates" "$RP/render/alt"
  printf '#panic("alt design used")\n' > "$RP/render/alt/main.typ"
  JAWBS_TEMPLATES_DIR="$RP/render/alt" JAWBS_OUT_DIR="$RWORK/out" bash "$RP/render/render.sh" demo >"$RWORK/alt.out" 2>&1
  check "render.sh uses JAWBS_TEMPLATES_DIR" grep -q "alt design used" "$RWORK/alt.out"
  rm -rf "$RP/render/alt"

  # Tasks 2 and 4 add their checks here, above this line.
  rm -rf "$RWORK"
else
  echo "note: typst or python3 yaml not found; render design script tests skipped"
fi

# --- Summary ----------------------------------------------------------------

rm -rf "$WORK0" "$WORK1" "$WORK2" "$WORK3" "$WORK4"
echo "Passed: $PASSES  Failed: $FAILS"
[ "$FAILS" -eq 0 ]
