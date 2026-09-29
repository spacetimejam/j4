#!/usr/bin/env bash
# Prove a candidate CV and letter design before it goes live.
# Usage: render/try-design.sh <candidate-dir>
#
# Renders the candidate against render/sample/ and, when it exists, the
# person's own test CV in applications/test-render/, into a scratch folder.
# Passes only if every CV is exactly one page and every letter compiles, which
# includes the letter's own <letter-end> check (under 66% of the page or past
# page one fails). Never touches render/templates/ or any application's PDFs.
# Bash 3.2 compatible.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
CAND="$(cd "${1:?usage: try-design.sh <candidate-dir>}" && pwd)"

# Typst resolves the template's imports within --root, so the candidate has to
# live inside the project.
case "$CAND/" in
  "$ROOT"/*) ;;
  *) echo "error: the candidate must be inside the project ($ROOT), e.g. render/templates-candidate/" >&2; exit 2 ;;
esac

if ! command -v typst >/dev/null 2>&1 && [ -x "$HOME/.local/bin/typst" ]; then
  PATH="$HOME/.local/bin:$PATH"
fi

for f in main.typ cover-letter.typ; do
  if [ ! -f "$CAND/$f" ]; then
    echo "FAIL: the candidate has no $f" >&2
    exit 1
  fi
done

SCRATCH="$(mktemp -d)"
TRIAL="$ROOT/applications/_design-trial"
cleanup() { rm -rf "$SCRATCH" "$TRIAL"; }
trap cleanup EXIT
rm -rf "$TRIAL"
mkdir -p "$TRIAL"
cp "$HERE/sample/cv.yaml" "$HERE/sample/cover-letter.yaml" "$TRIAL/"

failed=0

# pages <config-path-from-root> <template-file>: how many pages the candidate's
# CV (main.typ) or letter (cover-letter.typ) runs to. One tiny PNG per page is
# the page count, with nothing beyond Typst needed.
pages() {
  pg_dir="$(mktemp -d "$SCRATCH/pages.XXXXXX")"
  if ! typst compile --font-path "$HERE/fonts" --root "$ROOT" --ppi 10 \
      --input config="$1" "$CAND/$2" "$pg_dir/p-{p}.png" >/dev/null 2>&1; then
    echo 0
    return
  fi
  ls "$pg_dir" | wc -l | tr -d ' '
}

try_slug() {
  ts_slug="$1"
  ts_out="$SCRATCH/out-$ts_slug"
  mkdir -p "$ts_out"
  echo "Trying the design with applications/$ts_slug/"
  if ! JAWBS_TEMPLATES_DIR="$CAND" JAWBS_OUT_DIR="$ts_out" bash "$HERE/render.sh" "$ts_slug"; then
    echo "FAIL: applications/$ts_slug/ did not render (see the Typst message above)"
    failed=1
    return
  fi
  ts_pages="$(pages "/applications/$ts_slug/cv.yaml" main.typ)"
  if [ "$ts_pages" != "1" ]; then
    echo "FAIL: the CV for applications/$ts_slug/ runs to $ts_pages pages; it must be exactly one"
    failed=1
  fi
  # The letter is checked here too rather than left to the candidate's own
  # panic: a letter template that forgets the check would otherwise pass.
  if [ -f "$ROOT/applications/$ts_slug/cover-letter.yaml" ]; then
    check_letter "$ts_slug"
  fi
}

# check_letter <slug>: exactly one page, the <letter-end> marker present, and
# the letter at least 66% of the way down that page.
check_letter() {
  cl_slug="$1"
  cl_cfg="/applications/$cl_slug/cover-letter.yaml"
  cl_pages="$(pages "$cl_cfg" cover-letter.typ)"
  if [ "$cl_pages" != "1" ]; then
    echo "FAIL: the letter for applications/$cl_slug/ runs to $cl_pages pages; it must be exactly one"
    failed=1
    return
  fi
  cl_fill="$(typst query --font-path "$HERE/fonts" --root "$ROOT" --input config="$cl_cfg" \
    "$CAND/cover-letter.typ" '<letter-end>' --field value --one 2>/dev/null \
    | python3 -c 'import json,sys
try: print(json.load(sys.stdin)["fill-pct"])
except Exception: pass' || true)"
  if [ -z "$cl_fill" ]; then
    echo "FAIL: the letter template does not mark where the letter ends (the <letter-end> marker in render/README.md), so its page fill cannot be checked"
    failed=1
    return
  fi
  if python3 -c "import sys; sys.exit(0 if float('$cl_fill') < 66 else 1)"; then
    echo "FAIL: the letter for applications/$cl_slug/ fills only ${cl_fill}% of the page; it must reach at least 66%"
    failed=1
  fi
}

try_slug _design-trial
if [ -f "$ROOT/applications/test-render/cv.yaml" ]; then
  try_slug test-render
fi

if [ "$failed" -eq 0 ]; then
  echo "PASS: the design renders a one-page CV and a letter that fills its page."
else
  echo "The design is not ready. Nothing live has changed."
  exit 1
fi
