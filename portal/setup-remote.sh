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
# not portable between GNU and BSD. Returns non-zero if the write did not
# complete, so callers that publish on the strength of a value just written
# (the rotated COOKIE_SECRET, chiefly) can refuse instead of proceeding on a
# file that was never actually updated.
set_env_value() {
  sv_key="$1"
  sv_value="$2"
  sv_file="$3"
  sv_tmp="$sv_file.tmp.$$"
  : 2>/dev/null > "$sv_tmp" || return 1
  if [ -f "$sv_file" ]; then
    grep -v "^${sv_key}=" "$sv_file" >> "$sv_tmp"
  fi
  printf '%s=%s\n' "$sv_key" "$sv_value" 2>/dev/null >> "$sv_tmp" || { rm -f "$sv_tmp" 2>/dev/null; return 1; }
  mv "$sv_tmp" "$sv_file" 2>/dev/null || { rm -f "$sv_tmp" 2>/dev/null; return 1; }
  return 0
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
#
# `--peers=false` drops the Peer map from the JSON, leaving exactly one
# DNSName field (Self's) rather than one-per-peer. Without it, `head -1`
# picking "the first DNSName" only works because Go's ipnstate.Status struct
# happens to serialise Self before Peer; that ordering is implicit and
# undocumented, and `tailscale status --help` itself warns the JSON format
# is subject to change between releases. With peers excluded there is no
# ordering to depend on.
tailnet_hostname() {
  command -v tailscale >/dev/null 2>&1 || return 1
  tailscale status --json --peers=false 2>/dev/null \
    | grep -o '"DNSName" *: *"[^"]*"' \
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
  echo "Installed."
  case "$(uname)" in
    Linux)
      echo "Next: log in with 'sudo tailscale up' (this opens a browser). On Linux,"
      echo "tailscale up and the 'configure' subcommand below both need root unless"
      echo "your account is authorised as the tailnet operator. Once logged in, run"
      echo "'sudo tailscale set --operator=$USER' once so later commands need no sudo." ;;
    Darwin)
      echo "Next: log in with 'tailscale up' (this opens a browser)."
      echo "Installed via Homebrew, the Tailscale daemon is not started automatically;"
      echo "start it with 'sudo brew services start tailscale', or install the"
      echo "Mac App Store version instead, which starts and logs in via the GUI." ;;
    *)
      echo "Next: log in with 'tailscale up' (this opens a browser)." ;;
  esac
  return 0
}

MIN_SECRET_PUBLIC=64

# Refuse to publish a public portal behind a weak secret. Under Funnel the
# login page is on the internet and the signed cookie is the only barrier in
# front of agent sessions running with bypassPermissions, so this is a stop
# rather than a warning.
require_strong_secret() {
  rs_generate="$1"
  rs_secret="$(env_value COOKIE_SECRET "$ENV_FILE")"
  if [ "${#rs_secret}" -ge "$MIN_SECRET_PUBLIC" ] \
     && [ "$rs_secret" != "change-me-64-random-hex" ]; then
    return 0
  fi

  echo "Funnel puts your portal's login page on the public internet."
  echo "Behind it, agent sessions run with bypassPermissions inside your project,"
  echo "so the login cookie must be signed with a strong secret."
  echo "COOKIE_SECRET is currently ${#rs_secret} characters; $MIN_SECRET_PUBLIC are required."
  echo

  if [ "$rs_generate" != "yes" ]; then
    if [ -t 0 ]; then
      printf 'Generate a new COOKIE_SECRET now? This logs everyone out. [y/N]: '
      read -r rs_reply
    else
      rs_reply="n"
    fi
    case "$rs_reply" in
      y|Y|yes|Yes|YES) ;;
      *) die "Not publishing. Set a 64-character COOKIE_SECRET (openssl rand -hex 32) and retry, or use: configure serve" ;;
    esac
  fi

  command -v openssl >/dev/null 2>&1 || die "openssl not found; cannot generate a secret"
  rs_new="$(openssl rand -hex 32)"
  set_env_value COOKIE_SECRET "$rs_new" "$ENV_FILE" \
    || die "Could not write the new COOKIE_SECRET to $ENV_FILE. Not publishing."
  echo "Wrote a new 64-character COOKIE_SECRET. Everyone must log in again."
  return 0
}

# Every registered address becomes an internet-reachable login under Funnel,
# so publishing with an empty allowlist is always a mistake.
require_registered_users() {
  ru_registry="$PORTAL_DIR/data/users.json"
  if [ -f "$ru_registry" ] && command -v node >/dev/null 2>&1; then
    ru_count="$(node -e 'try{const u=require(process.argv[1]);console.log(Object.keys(u).length)}catch(e){console.log(0)}' "$ru_registry")"
    [ "$ru_count" -gt 0 ] || die "No users are registered in data/users.json. Run the setup wizard before publishing."
    echo "$ru_count address(es) on the allowlist; each is now an internet-reachable login."
    return 0
  fi
  ru_allow="$(env_value ALLOWED_EMAILS "$ENV_FILE")"
  [ -n "$ru_allow" ] || die "No users are configured. Create data/users.json or set ALLOWED_EMAILS before publishing."
  return 0
}

cmd_configure() {
  cc_mode="${1:-}"
  cc_generate="no"
  [ "${2:-}" = "--generate-secret" ] && cc_generate="yes"

  case "$cc_mode" in
    serve|funnel) ;;
    *) echo "Usage: setup-remote.sh configure serve|funnel [--generate-secret]" >&2; exit 1 ;;
  esac

  command -v tailscale >/dev/null 2>&1 \
    || die "tailscale is not installed. Run: ./setup-remote.sh install"
  [ -f "$ENV_FILE" ] \
    || die "$ENV_FILE not found. Run: cp .env.example .env"

  # The gate runs before anything is published, so a refusal leaves the portal
  # exactly as private as it was.
  if [ "$cc_mode" = "funnel" ]; then
    require_strong_secret "$cc_generate"
    require_registered_users
  fi

  cc_port="$(portal_port)"
  echo "Publishing port $cc_port with 'tailscale $cc_mode'..."
  tailscale "$cc_mode" --bg "$cc_port" \
    || die "tailscale $cc_mode failed. Likely causes: not logged in (try: tailscale up), or a permissions error on Linux/WSL (try: sudo tailscale set --operator=$USER, then retry without sudo). For funnel, also check that it is enabled in your tailnet's access controls."

  cc_host="$(tailnet_hostname)"
  [ -n "$cc_host" ] \
    || die "Could not read this machine's tailnet name from 'tailscale status'. Are you logged in?"

  set_env_value BASE_URL "https://$cc_host" "$ENV_FILE" \
    || die "Could not write BASE_URL to $ENV_FILE. Not treating this as configured; fix the write (disk full? read-only?) and retry."
  set_env_value BIND_HOST "127.0.0.1" "$ENV_FILE" \
    || die "Could not write BIND_HOST to $ENV_FILE. Not treating this as configured; fix the write (disk full? read-only?) and retry."
  if [ "$cc_mode" = "funnel" ]; then
    set_env_value EXPOSURE "public" "$ENV_FILE" \
      || die "Could not write EXPOSURE=public to $ENV_FILE. Refusing to report success: a later start would read the old value and could apply the weaker private secret bar even though the portal is actually published over Funnel."
  else
    set_env_value EXPOSURE "private" "$ENV_FILE" \
      || die "Could not write EXPOSURE=private to $ENV_FILE. Fix the write (disk full? read-only?) and retry."
  fi

  echo
  echo "Configured. Your portal address is:"
  echo "  https://$cc_host"
  if [ "$cc_mode" = "serve" ]; then
    echo "Reachable only from devices signed in to your tailnet."
    echo "Install the Tailscale app on your phone and sign in with the same account."
    echo "If this portal was previously published with 'configure funnel', confirm"
    echo "funnel is actually off (tailscale funnel status). Switching to serve does"
    echo "not stop it from publishing publicly; see 'Going back to private' in"
    echo "docs/portal-remote-access.md."
  else
    echo "Reachable from any browser on the internet. Keep the allowlist short."
  fi
  echo
  echo "Next: restart the portal, then run: ./setup-remote.sh verify"
  return 0
}

cmd_service() {
  cs_write_only="no"
  [ "${1:-}" = "--write-only" ] && cs_write_only="yes"
  cs_node="$(command -v node)"
  [ -n "$cs_node" ] || die "node not found; install Node 18 or newer first"

  case "$(uname)" in
    Linux)
      cs_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
      mkdir -p "$cs_dir"
      cs_unit="$cs_dir/job-search-portal.service"
      cat > "$cs_unit" <<EOF
[Unit]
Description=Job search submission portal

[Service]
WorkingDirectory=$PORTAL_DIR
ExecStart=$cs_node src/server.js
Restart=on-failure

[Install]
WantedBy=default.target
EOF
      echo "Wrote $cs_unit"
      if [ "$cs_write_only" = "yes" ]; then
        echo "Not enabling it (--write-only)."
        return 0
      fi
      systemctl --user daemon-reload || die "systemctl --user daemon-reload failed"
      systemctl --user enable --now job-search-portal \
        || die "could not enable job-search-portal; check: systemctl --user status job-search-portal"
      loginctl enable-linger "$USER" >/dev/null 2>&1 \
        || echo "Note: could not enable lingering; the portal will stop when you log out."
      echo "Enabled and started." ;;
    Darwin)
      cs_dir="${XDG_CONFIG_HOME:-$HOME/Library}/LaunchAgents"
      mkdir -p "$cs_dir"
      cs_plist="$cs_dir/com.job-search.portal.plist"
      cat > "$cs_plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.job-search.portal</string>
  <key>ProgramArguments</key>
  <array>
    <string>$cs_node</string>
    <string>src/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$PORTAL_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
EOF
      echo "Wrote $cs_plist"
      if [ "$cs_write_only" = "yes" ]; then
        echo "Not loading it (--write-only)."
        return 0
      fi
      launchctl load "$cs_plist" || die "launchctl load failed"
      echo "Loaded." ;;
    *)
      die "Unsupported platform $(uname); see docs/portal.md for a manual service unit" ;;
  esac
  return 0
}

cmd_verify() {
  cv_fails=0
  cv_port="$(portal_port)"
  cv_base="$(env_value BASE_URL "$ENV_FILE")"

  echo "Verifying the portal"
  echo "===================="

  # 1. The portal answers locally.
  if curl -fsS --max-time 10 "http://127.0.0.1:$cv_port/api/meta" >/dev/null 2>&1; then
    echo "  ok    portal responds on 127.0.0.1:$cv_port"
  else
    echo "  FAIL  portal does not respond on loopback at 127.0.0.1:$cv_port"
    echo "        Is it running? Start it with: npm start"
    cv_fails=$((cv_fails + 1))
  fi

  # 2. BASE_URL matches the live tailnet name. A machine rename silently
  #    breaks login links, and this is the only place that would catch it.
  cv_host="$(tailnet_hostname)"
  if [ -z "$cv_host" ]; then
    echo "  FAIL  could not read the tailnet name; run: tailscale up"
    cv_fails=$((cv_fails + 1))
  elif [ "$cv_base" = "https://$cv_host" ]; then
    echo "  ok    BASE_URL matches this machine's tailnet name"
  else
    echo "  FAIL  BASE_URL is $cv_base but this machine is https://$cv_host"
    echo "        Fix with: ./setup-remote.sh configure serve   (or funnel)"
    cv_fails=$((cv_fails + 1))
  fi

  # 3. The public URL serves valid HTTPS. curl without -k, so an invalid
  #    certificate is a failure rather than a warning.
  if [ -n "$cv_base" ]; then
    if curl -fsS --max-time 20 "$cv_base/api/meta" >/dev/null 2>&1; then
      echo "  ok    $cv_base responds over HTTPS with a valid certificate"
    else
      echo "  FAIL  $cv_base did not respond over HTTPS with a valid certificate"
      echo "        Check: tailscale $( [ "$(env_value EXPOSURE "$ENV_FILE")" = "public" ] && echo funnel || echo serve ) status"
      cv_fails=$((cv_fails + 1))
    fi

    # 4. Login round-trips. Always 200 by design (no allowlist oracle), so
    #    this proves the route is reachable, not that mail was delivered.
    if curl -fsS --max-time 20 -X POST "$cv_base/api/login" \
         -H 'content-type: application/json' -d '{"email":"verify@example.invalid"}' \
         >/dev/null 2>&1; then
      echo "  ok    the login route accepts requests"
    else
      echo "  FAIL  the login route did not respond"
      echo "        HTTPS itself is fine (check 3 passed); check the portal's own output or service log, and restart it if .env has changed since it last started."
      cv_fails=$((cv_fails + 1))
    fi
  fi

  echo
  if [ "$cv_fails" -eq 0 ]; then
    echo "All checks passed. Open $cv_base and request a login link."
    return 0
  fi
  echo "$cv_fails check(s) failed. Fix them before relying on the portal from a phone."
  return 1
}

usage() {
  echo "Usage: setup-remote.sh check|install|configure <serve|funnel>|service|verify" >&2
}

case "${1:-}" in
  check)     cmd_check ;;
  install)   cmd_install ;;
  configure) shift; cmd_configure "$@" ;;
  service)   shift; cmd_service "$@" ;;
  verify)    cmd_verify ;;
  *)         usage; exit 1 ;;
esac
