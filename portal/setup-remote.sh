#!/usr/bin/env bash
# Publish the job-search portal with Tailscale.
#
# Usage:
#   ./setup-remote.sh check                    report what is installed
#   ./setup-remote.sh install                  install tailscale
#   ./setup-remote.sh configure serve|funnel   publish the portal
#   ./setup-remote.sh service                  install a service unit
#   ./setup-remote.sh verify                   prove it works end to end
#
# Every subcommand is idempotent. Bash 3.2 compatible (macOS ships 3.2).
#
# Deliberately `set -u` and not `set -eu`: several helpers here treat "grep
# matched nothing" as a normal outcome, and -e would abort on it.
set -u

PORTAL_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$PORTAL_DIR/.env"

die() {
  echo "Error: $1" >&2
  exit 1
}

# env_value <key> <file>: print the value of KEY=..., or nothing.
env_value() {
  ev_key="$1"
  ev_file="$2"
  [ -f "$ev_file" ] || return 0
  grep "^${ev_key}=" "$ev_file" 2>/dev/null | tail -1 | cut -d= -f2-
}

# set_env_value <key> <value> <file>: upsert KEY=value. No `sed -i`, which is
# not portable between GNU and BSD.
set_env_value() {
  sv_key="$1"
  sv_value="$2"
  sv_file="$3"
  sv_tmp="$sv_file.tmp.$$"
  : > "$sv_tmp"
  if [ -f "$sv_file" ]; then
    grep -v "^${sv_key}=" "$sv_file" >> "$sv_tmp"
  fi
  printf '%s=%s\n' "$sv_key" "$sv_value" >> "$sv_tmp"
  mv "$sv_tmp" "$sv_file"
}

portal_port() {
  pp_value="$(env_value PORT "$ENV_FILE")"
  if [ -n "$pp_value" ]; then
    printf '%s' "$pp_value"
  else
    printf '8710'
  fi
}

# The tailnet hostname, read back from Tailscale rather than constructed, so a
# renamed machine or a custom tailnet name still yields a correct URL.
tailnet_hostname() {
  command -v tailscale >/dev/null 2>&1 || return 1
  tailscale status --json 2>/dev/null \
    | tr ',' '\n' \
    | grep '"DNSName"' \
    | head -1 \
    | cut -d'"' -f4 \
    | sed 's/\.$//'
}

cmd_check() {
  echo "Portal remote-access check"
  echo "=========================="
  echo "  portal folder: $PORTAL_DIR"

  case "$(uname)" in
    Darwin) echo "  platform:      macOS" ;;
    Linux)  echo "  platform:      Linux (or WSL)" ;;
    *)      echo "  platform:      $(uname) (untested)" ;;
  esac

  if command -v node >/dev/null 2>&1; then
    echo "  node:          $(node --version)"
  else
    echo "  node:          NOT found. The portal needs Node 18 or newer."
  fi

  if [ -d "$PORTAL_DIR/node_modules" ]; then
    echo "  dependencies:  installed"
  else
    echo "  dependencies:  NOT installed. Run: npm install"
  fi

  if [ -f "$ENV_FILE" ]; then
    echo "  .env:          present"
  else
    echo "  .env:          missing. Run: cp .env.example .env"
  fi

  if command -v tailscale >/dev/null 2>&1; then
    echo "  tailscale:     found"
    ts_host="$(tailnet_hostname)"
    if [ -n "$ts_host" ]; then
      echo "  tailnet name:  $ts_host"
    else
      echo "  tailnet name:  unknown. Not logged in? Run: tailscale up"
    fi
  else
    echo "  tailscale:     not installed. Run: ./setup-remote.sh install"
  fi

  return 0
}

cmd_install() {
  if command -v tailscale >/dev/null 2>&1; then
    echo "tailscale is already installed; nothing to do."
    return 0
  fi
  case "$(uname)" in
    Darwin)
      command -v brew >/dev/null 2>&1 \
        || die "Homebrew not found. Install Tailscale from https://tailscale.com/download/mac"
      echo "Installing tailscale with Homebrew..."
      brew install tailscale || die "brew install tailscale failed" ;;
    Linux)
      echo "Installing tailscale with the official installer..."
      command -v curl >/dev/null 2>&1 || die "curl not found; install curl first"
      curl -fsSL https://tailscale.com/install.sh | sh \
        || die "the Tailscale installer failed" ;;
    *)
      die "Unsupported platform $(uname). See https://tailscale.com/download" ;;
  esac
  command -v tailscale >/dev/null 2>&1 \
    || die "tailscale still not on PATH after installing; open a new terminal and retry"
  echo "Installed. Next: log in with 'tailscale up' (this opens a browser)."
  return 0
}

usage() {
  echo "Usage: setup-remote.sh check|install|configure <serve|funnel>|service|verify" >&2
}

case "${1:-}" in
  check)     cmd_check ;;
  install)   cmd_install ;;
  *)         usage; exit 1 ;;
esac
