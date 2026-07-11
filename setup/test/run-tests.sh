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

# --- Summary ----------------------------------------------------------------

rm -rf "$WORK1" "$WORK2"
echo "Passed: $PASSES  Failed: $FAILS"
[ "$FAILS" -eq 0 ]
