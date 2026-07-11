#!/usr/bin/env bash
# Job Search Kit setup wizard.
# Usage:
#   ./setup.sh                                   interactive
#   ./setup.sh --answers file.env --target dir   non-interactive
#   --skip-deps skips dependency checks (used by tests).
#   --assume-deps-yes answers yes to dependency install prompts.
# Bash 3.2 compatible.

set -eu

SETUP_DIR="$(cd "$(dirname "$0")" && pwd)"
KIT_DIR="$(dirname "$SETUP_DIR")"
TEMPLATE_DIR="$KIT_DIR/template"

# shellcheck source=lib.sh
. "$SETUP_DIR/lib.sh"

ANSWERS_FILE=""
TARGET_DIR=""
SKIP_DEPS="no"
ASSUME_DEPS_YES="no"

while [ $# -gt 0 ]; do
  case "$1" in
    --answers) ANSWERS_FILE="$2"; shift 2 ;;
    --target)  TARGET_DIR="$2"; shift 2 ;;
    --skip-deps) SKIP_DEPS="yes"; shift ;;
    --assume-deps-yes) ASSUME_DEPS_YES="yes"; shift ;;
    -h|--help)
      echo "Usage: setup.sh [--answers <file>] [--target <dir>] [--skip-deps] [--assume-deps-yes]"
      exit 0 ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

# --- Gather answers ----------------------------------------------------------

if [ -n "$ANSWERS_FILE" ]; then
  if [ ! -f "$ANSWERS_FILE" ]; then
    echo "Answers file not found: $ANSWERS_FILE" >&2
    exit 1
  fi
  # The --target flag wins over any TARGET_DIR line in the answers file.
  TARGET_DIR_FLAG="${TARGET_DIR:-}"
  # shellcheck disable=SC1090
  . "$ANSWERS_FILE"
  if [ -n "$TARGET_DIR_FLAG" ]; then
    TARGET_DIR="$TARGET_DIR_FLAG"
  fi
else
  echo "Job Search Kit setup"
  echo "===================="
  echo
  ask USER_NAME "Your full name"
  ask USER_EMAIL "Email address"
  ask USER_PHONE "Phone number"
  ask USER_LOCATION "Location (city)"
  ask FIELD "Your field (e.g. software engineering, graphic design)"
  ask CREATIVE "Is your work portfolio-led (design, illustration, photography, other creative work)? [y/N]" "no"
  ask SENIORITY "Seniority (e.g. mid-weight, senior)" "senior"
  ask_menu EMPLOYMENT_STATUS "Current employment status:" "employed" "between roles"
  ask_menu AI_TOOL "Which AI assistant will you use?" "claude-code" "other"
  ask_menu TRACKER "Application tracker:" "file" "grist"
  ask PORTAL "Set up the submission portal? (ships in a later release)" "no"
fi

if [ -z "${TARGET_DIR:-}" ]; then
  ask TARGET_DIR "Where should the project live?" "$HOME/job-search"
fi

# Normalise the creative answer like PORTAL below.
CREATIVE="${CREATIVE:-no}"
case "$CREATIVE" in
  y|Y|yes|Yes|YES) CREATIVE="yes" ;;
esac

for v in USER_NAME USER_EMAIL USER_PHONE USER_LOCATION FIELD SENIORITY EMPLOYMENT_STATUS AI_TOOL TRACKER PORTAL CREATIVE; do
  eval "val=\${$v:-}"
  if [ -z "$val" ]; then
    echo "Missing answer: $v" >&2
    exit 1
  fi
done

# --- Dependencies ------------------------------------------------------------

if [ "$SKIP_DEPS" = "no" ]; then
  echo
  echo "Checking dependencies..."

  if command -v git >/dev/null 2>&1; then
    echo "  git: found"
  else
    echo "  git: NOT found. Install git before using the kit." >&2
  fi

  if command -v python3 >/dev/null 2>&1; then
    if python3 -c 'import yaml' >/dev/null 2>&1; then
      echo "  python3 + yaml: found"
    else
      echo "  python3 found, but the yaml module is missing."
      if [ "$ASSUME_DEPS_YES" = "yes" ]; then
        reply="y"
        echo "  --assume-deps-yes: installing pyyaml."
      elif [ -t 0 ]; then
        read -r -p "  Run 'pip3 install --user pyyaml' now? [y/N]: " reply
      else
        reply="n"
        echo "  Non-interactive session: skipping pyyaml install (use --assume-deps-yes to install)."
      fi
      case "$reply" in
        y|Y) pip3 install --user pyyaml ;;
        *) echo "  Skipped. The render pipeline needs pyyaml." ;;
      esac
    fi
  else
    echo "  python3: NOT found. The render pipeline needs python3 with pyyaml." >&2
  fi

  if command -v typst >/dev/null 2>&1; then
    echo "  typst: found"
  else
    echo "  typst: not found."
    case "$(uname)" in
      Darwin)
        echo "  On macOS, install with: brew install typst" ;;
      *)
        if [ "$ASSUME_DEPS_YES" = "yes" ]; then
          reply="y"
          echo "  --assume-deps-yes: running the Typst installer."
        elif [ -t 0 ]; then
          read -r -p "  Run template/render/install-typst.sh now? [y/N]: " reply
        else
          reply="n"
          echo "  Non-interactive session: skipping the Typst installer (use --assume-deps-yes to install)."
        fi
        case "$reply" in
          y|Y) bash "$TEMPLATE_DIR/render/install-typst.sh" ;;
          *) echo "  Skipped. The installer also ships in your project at render/install-typst.sh." ;;
        esac ;;
    esac
  fi

  echo "  Detected AI CLIs (none will be installed):"
  found_cli="no"
  for cli in claude codex cursor gemini; do
    if command -v "$cli" >/dev/null 2>&1; then
      echo "    $cli"
      found_cli="yes"
    fi
  done
  [ "$found_cli" = "no" ] && echo "    none found"
fi

# --- Copy template -----------------------------------------------------------

if [ -d "$TARGET_DIR" ]; then
  if [ -n "$(ls -A "$TARGET_DIR" 2>/dev/null)" ]; then
    echo "Target directory is not empty: $TARGET_DIR" >&2
    echo "Refusing to overwrite. Choose an empty or new directory." >&2
    exit 1
  fi
else
  mkdir -p "$TARGET_DIR"
fi

cp -R "$TEMPLATE_DIR/." "$TARGET_DIR/"
cp "$SETUP_DIR/SETUP.md.tmpl" "$TARGET_DIR/SETUP.md.tmpl"

# Creative module: copy before substitution so any tokens in it resolve too.
if [ "$CREATIVE" = "yes" ]; then
  cp -R "$KIT_DIR/modules/creative/portfolio" "$TARGET_DIR/portfolio"
fi

# --- Substitute placeholders -------------------------------------------------

substitute_all "$TARGET_DIR"

# --- Per-answer wiring -------------------------------------------------------

if [ "$AI_TOOL" = "claude-code" ]; then
  SPINE_FILE="$TARGET_DIR/CLAUDE.md"
  mv "$TARGET_DIR/CLAUDE.md.tmpl" "$SPINE_FILE"
else
  SPINE_FILE="$TARGET_DIR/AGENTS.md"
  mv "$TARGET_DIR/CLAUDE.md.tmpl" "$SPINE_FILE"
fi

if [ "$CREATIVE" = "yes" ]; then
  # Repo map entry: insert a portfolio/ line before the tracker/ entry.
  spine_tmp="$SPINE_FILE.creative.$$"
  awk '
    /^tracker\// && !done {
      print "portfolio/           - case-study bank; start at portfolio/case-studies/README.md"
      done = 1
    }
    { print }
  ' "$SPINE_FILE" > "$spine_tmp" && mv "$spine_tmp" "$SPINE_FILE"

  cat >> "$SPINE_FILE" <<'EOF'

## Portfolio and case studies

This is a portfolio-led search. The `portfolio/` folder holds a map of the
live portfolio site (`portfolio/site.md`) and a case-study bank built through
a structured interview and synthesis flow. Start at
`portfolio/case-studies/README.md`, which explains the method end to end.
Keep case studies accurate: build them only from what the user actually did.
EOF
fi

if [ "$TRACKER" = "grist" ]; then
  cat >> "$TARGET_DIR/tracker/tracker.md" <<'EOF'

## Grist note

You chose Grist as your tracker. Full Grist support is out of scope for this
release, so the kit ships with the file-based tracker above. Replace this file
with your own Grist pointer (document ID, table name, API base and key
location) and keep the same columns.
EOF
fi

PORTAL_NOTE=""
case "$PORTAL" in
  y|Y|yes|Yes|YES) PORTAL="yes" ;;
esac
if [ "$PORTAL" = "yes" ]; then
  echo
  echo "Note: the submission portal ships in a later release. Recorded in SETUP.md as pending."
  PORTAL_NOTE="- Pending: submission portal requested; it ships in a later release."
fi

# --- SETUP.md ----------------------------------------------------------------

mv "$TARGET_DIR/SETUP.md.tmpl" "$TARGET_DIR/SETUP.md"
if [ "$CREATIVE" = "yes" ]; then
  printf '\n%s\n%s\n' \
    "- Offer the case-study interview: read portfolio/case-studies/README.md and, when the" \
    "  user is ready, run the interview and synthesis flow for their top projects." \
    >> "$TARGET_DIR/SETUP.md"
fi
if [ -n "$PORTAL_NOTE" ]; then
  printf '\n%s\n' "$PORTAL_NOTE" >> "$TARGET_DIR/SETUP.md"
fi

# --- Initialise git ------------------------------------------------------------

if command -v git >/dev/null 2>&1; then
  (
    cd "$TARGET_DIR"
    git init -q
    git add -A
    git -c user.name="Job Search Kit" -c user.email="setup@job-search-kit.invalid" \
      commit -q -m "initial project from job-search-kit"
  )
  echo "Initialised a git repository in the project with an initial commit."
else
  echo "git not found: skipping repository initialisation for the project."
fi

echo
echo "Done. Your project is at: $TARGET_DIR"
echo
echo "Next step: open the project with your AI assistant and ask it to read"
echo "SETUP.md. It walks the first session through intake, profile building"
echo "and a test render, then deletes itself when setup is complete."
