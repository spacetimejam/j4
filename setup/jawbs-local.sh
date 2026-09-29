#!/usr/bin/env bash
# Set up Jawbs to run in the browser on this computer, for the project given.
# Called by setup.sh when the person chooses option 1, and safe to re-run by
# hand after installing something that was missing:
#   setup/jawbs-local.sh <project folder>
# Never exits non-zero for a missing prerequisite: it explains and stops.
# Bash 3.2 compatible.
set -u

SETUP_DIR="$(cd "$(dirname "$0")" && pwd)"
KIT_DIR="$(dirname "$SETUP_DIR")"
. "$SETUP_DIR/lib.sh"

PROJECT="${1:?usage: jawbs-local.sh <project folder>}"
PROJECT="$(cd "$PROJECT" && pwd)"
PORTAL_REGISTRY="${PORTAL_REGISTRY:-$KIT_DIR/portal/data/users.json}"
ENV_FILE="${JAWBS_ENV_FILE:-$KIT_DIR/portal/.env}"
NODE_BIN="${JAWBS_NODE:-node}"
RERUN="Once it is installed, run this to finish: $SETUP_DIR/jawbs-local.sh $PROJECT"

# Name and email come from the wizard's record in SETUP.md, so a re-run
# needs no questions.
answer() { sed -n "s/^- $1: //p" "$PROJECT/SETUP.md" 2>/dev/null | head -1; }
USER_NAME="$(answer Name)"
USER_EMAIL="$(answer Email)"
# SETUP.md deletes itself when setup is done; a later re-run finds the person
# in the registry by project folder instead.
if [ -z "$USER_NAME" ] || [ -z "$USER_EMAIL" ]; then
  found="$(registry_person_for "$PORTAL_REGISTRY" "$PROJECT" "$NODE_BIN")"
  if [ -n "$found" ]; then
    USER_NAME="${found%%	*}"
    USER_EMAIL="${found#*	}"
  fi
fi
if [ -z "$USER_NAME" ] || [ -z "$USER_EMAIL" ]; then
  echo "Could not find your name and email (not in $PROJECT/SETUP.md or the list of people"
  echo "using Jawbs here), so Jawbs was not set up."
  exit 0
fi

# setup.sh reads what happened from this file: launched, skipped or failed.
# Nothing written means setup stopped before the end.
report() { [ -n "${JAWBS_STATUS_FILE:-}" ] && echo "$1" > "$JAWBS_STATUS_FILE"; return 0; }

echo "Setting up Jawbs on this computer..."

# 1. Prerequisites.
if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  echo "Jawbs needs Node (version 18 or newer), which is not installed."
  echo "  macOS: download the installer from https://nodejs.org"
  echo "  Linux: sudo apt install -y nodejs npm"
  echo "$RERUN"
  exit 0
fi
if ! "$NODE_BIN" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)'; then
  echo "Jawbs needs Node 18 or newer, but this computer has $("$NODE_BIN" --version)."
  echo "$RERUN"
  exit 0
fi

# Who writes the CV and letter copy, as chosen in the wizard: both (Claude
# runs Jawbs, ChatGPT writes), claude-only or chatgpt-only. Anything else
# (a project from before the question, or "detect") is worked out below from
# what is signed in, as before.
WRITER="$(answer Writer)"
case "$WRITER" in both|claude-only|chatgpt-only) ;; *) WRITER="" ;; esac
interactive() { [ -t 0 ] && [ -t 1 ]; }
# Records a changed choice in SETUP.md, so the agent and a re-run both see it.
set_writer() {
  WRITER="$1"
  [ -f "$PROJECT/SETUP.md" ] || return 0
  sw_tmp="$PROJECT/SETUP.md.writer.$$"
  awk -v w="$1" '/^- Writer: / { print "- Writer: " w; next } { print }' "$PROJECT/SETUP.md" > "$sw_tmp" \
    && mv "$sw_tmp" "$PROJECT/SETUP.md"
}

# Claude, unless ChatGPT does everything. Signed out is not a reason to stop:
# Jawbs still installs, and its page says how to sign in if the person skips
# it here. In a terminal, offer the sign-in now, since that is where they are.
if [ "$WRITER" != "chatgpt-only" ]; then
  if ! command -v claude >/dev/null 2>&1; then
    echo "Jawbs uses Claude Code, which is not installed."
    echo "  Install it from https://claude.com/claude-code, then run: claude"
    echo "  and sign in once."
    echo "$RERUN"
    exit 0
  fi
  claude_signed_in() { claude auth status </dev/null >/dev/null 2>&1; }
  if ! claude_signed_in; then
    echo "Jawbs works through your Claude account, and Claude Code is not signed in yet."
    if interactive; then
      echo "Your browser will open so you can sign in. Come back here when it is done."
      claude auth login || true
    fi
    if claude_signed_in; then
      echo "Signed in to Claude."
    else
      echo "Still not signed in. Jawbs will be set up anyway, but it cannot answer until"
      echo "you sign in. To do that, open Terminal and run: claude auth login"
    fi
  fi
fi

# ChatGPT (through the Codex program), when it writes or does everything.
detect_subscriptions
if [ "$WRITER" = "both" ] && [ -z "$CODEX_BIN_FOUND" ]; then
  # Jawbs will not start set to use ChatGPT without Codex installed, so this
  # has to be settled now, and never by quietly switching to Claude.
  echo "You chose ChatGPT to write your CVs and cover letters, but the Codex program it"
  echo "works through is not installed."
  if interactive; then
    echo
    echo "  1) Stop here so I can install Codex, then carry on"
    echo "  2) Let Claude write the CVs and cover letters instead"
    echo
    ask_menu --quiet codex_choice "" stop claude
    if [ "$codex_choice" = "claude" ]; then
      set_writer claude-only
      echo "Claude will write your CVs and cover letters."
    fi
  fi
  if [ "$WRITER" = "both" ]; then
    echo "  Install it with: npm install -g @openai/codex   then sign in with: codex login"
    echo "$RERUN"
    exit 0
  fi
fi
if [ "$WRITER" = "chatgpt-only" ] && [ -z "$CODEX_BIN_FOUND" ]; then
  echo "You chose ChatGPT to run Jawbs, which works through the Codex program, and it is"
  echo "not installed."
  echo "  Install it with: npm install -g @openai/codex   then sign in with: codex login"
  echo "$RERUN"
  exit 0
fi
if { [ "$WRITER" = "both" ] || [ "$WRITER" = "chatgpt-only" ]; } && [ "$SUBSCRIPTIONS_FOUND" != "both" ]; then
  echo "Codex, which Jawbs uses to reach ChatGPT, is not signed in yet."
  if interactive; then
    echo "Your browser will open so you can sign in. Come back here when it is done."
    "$CODEX_BIN_FOUND" login || true
    detect_subscriptions
  fi
  if [ "$SUBSCRIPTIONS_FOUND" = "both" ]; then
    echo "Signed in to ChatGPT."
  elif [ "$WRITER" = "both" ]; then
    echo "Still not signed in. Jawbs will be set up anyway, but your CVs and cover letters"
    echo "will wait until you sign in. To do that, open Terminal and run: codex login"
  else
    echo "Still not signed in. Jawbs will be set up anyway, but it cannot answer until"
    echo "you sign in. To do that, open Terminal and run: codex login"
  fi
fi

# 2. A second person on the same kit copy would share one no-sign-in portal.
if registry_has_other "$PORTAL_REGISTRY" "$USER_EMAIL"; then
  echo "This copy of the kit already runs Jawbs for another person."
  echo "Jawbs on a computer serves one person, so a second person needs their"
  echo "own copy of the kit (git clone it again into another folder). Each copy"
  echo "picks its own port automatically."
  exit 0
fi

# 3. Install.
if [ "${JAWBS_SKIP_NPM:-no}" != "yes" ]; then
  echo "Installing Jawbs (this can take a minute)..."
  if ! (cd "$KIT_DIR/portal" && npm ci --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund >/dev/null 2>&1); then
    echo "Installing failed. Try again with: cd $KIT_DIR/portal && npm install"
    echo "$RERUN"
    exit 0
  fi
fi

# 4. Settings. The wizard's choice when there is one, else what is signed in.
if write_local_env "$ENV_FILE" "${WRITER:-$SUBSCRIPTIONS_FOUND}" "$CODEX_BIN_FOUND" "$NODE_BIN"; then
  echo "Settings written to $ENV_FILE."
elif grep -q '^EXPOSURE=local' "$ENV_FILE" 2>/dev/null; then
  echo "$ENV_FILE already has settings, so it was left as it is."
else
  echo "$ENV_FILE has settings for the shared Jawbs, so Jawbs on this computer was not"
  echo "started. Use a separate copy of the kit for this, or move that file aside first."
  exit 0
fi

# 5. Register.
register_portal_user "$PORTAL_REGISTRY" "$USER_EMAIL" "$USER_NAME" "$PROJECT" "yes" >/dev/null

# 6. Launcher, icons, first launch. JAWBS_SKIP_LAUNCH=yes (tests) skips all three.
if [ "${JAWBS_SKIP_LAUNCH:-no}" = "yes" ]; then
  report skipped
elif install_launcher "$KIT_DIR" "$(command -v "$NODE_BIN")" && "$KIT_DIR/bin/jawbs-open"; then
  report launched
else
  report failed
fi
exit 0
