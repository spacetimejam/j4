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
if [ -z "$USER_NAME" ] || [ -z "$USER_EMAIL" ]; then
  echo "Could not read your name and email from $PROJECT/SETUP.md, so Jawbs was not set up."
  exit 0
fi

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
if ! command -v claude >/dev/null 2>&1; then
  echo "Jawbs uses Claude Code, which is not installed."
  echo "  Install it from https://claude.com/claude-code, then run: claude"
  echo "  and sign in once."
  echo "$RERUN"
  exit 0
fi

# 2. A second person on the same kit copy would share one no-sign-in portal.
if registry_has_other "$PORTAL_REGISTRY" "$USER_EMAIL"; then
  echo "This copy of the kit already runs Jawbs for another person."
  echo "Jawbs on a computer serves one person, so a second person needs their"
  echo "own copy of the kit (git clone it again into another folder)."
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

# 4. Settings.
detect_subscriptions
if write_local_env "$ENV_FILE" "$SUBSCRIPTIONS_FOUND" "$CODEX_BIN_FOUND"; then
  echo "Settings written to $ENV_FILE."
else
  echo "$ENV_FILE already has settings, so it was left as it is."
fi

# 5. Register.
register_portal_user "$PORTAL_REGISTRY" "$USER_EMAIL" "$USER_NAME" "$PROJECT" "yes" >/dev/null

# 6. Launcher, icons, first launch. JAWBS_SKIP_LAUNCH=yes (tests) skips all three.
if [ "${JAWBS_SKIP_LAUNCH:-no}" != "yes" ] && type install_launcher >/dev/null 2>&1; then
  install_launcher "$KIT_DIR" "$(command -v "$NODE_BIN")"
  "$KIT_DIR/bin/jawbs-open" || true
fi
exit 0
