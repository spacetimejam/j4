# Tests for portal/setup-remote.sh. Sourced by run-tests.sh, so `check`,
# `pass`, `fail` and the counters are already defined.

REMOTE_SH="$(dirname "$TEST_DIR")/../portal/setup-remote.sh"

# A stub `tailscale` earlier on PATH than any real one. It records every
# invocation to $TS_LOG and answers `status --json` with a canned tailnet so
# hostname derivation can be tested without a network.
make_tailscale_stub() {
  stub_dir="$1"
  mkdir -p "$stub_dir"
  cat > "$stub_dir/tailscale" <<'STUB'
#!/usr/bin/env bash
echo "$@" >> "$TS_LOG"
if [ "$1" = "status" ]; then
  cat <<'JSON'
{"Self":{"DNSName":"box.tail1234.ts.net.","Online":true},"BackendState":"Running"}
JSON
  exit 0
fi
exit 0
STUB
  chmod +x "$stub_dir/tailscale"
}

RWORK2="$(mktemp -d)"
make_tailscale_stub "$RWORK2/bin"
export TS_LOG="$RWORK2/ts.log"
: > "$TS_LOG"

check "setup-remote.sh exists and is executable" test -x "$REMOTE_SH"

check "no subcommand exits non-zero" \
  sh -c "! PATH=$RWORK2/bin:\$PATH '$REMOTE_SH' >/dev/null 2>&1"

check "an unknown subcommand exits non-zero" \
  sh -c "! PATH=$RWORK2/bin:\$PATH '$REMOTE_SH' frobnicate >/dev/null 2>&1"

if PATH="$RWORK2/bin:$PATH" "$REMOTE_SH" check >"$RWORK2/check.out" 2>&1; then
  pass
else
  fail "check should exit 0 when tailscale is present"
fi
check "check reports the tailscale it found" \
  grep -qi "tailscale" "$RWORK2/check.out"

# check must be read-only: it reports, it does not configure.
check "check does not invoke serve or funnel" \
  sh -c "! grep -qE '^(serve|funnel)' '$TS_LOG'"

# install is idempotent when tailscale is already present.
if PATH="$RWORK2/bin:$PATH" "$REMOTE_SH" install >"$RWORK2/install.out" 2>&1; then
  pass
else
  fail "install should exit 0 when tailscale is already installed"
fi
check "install says tailscale is already present" \
  grep -qi "already" "$RWORK2/install.out"

# With no tailscale on PATH, check must still exit 0 and say what is missing.
# Build the PATH from every /usr/bin AND /bin entry EXCEPT tailscale
# (symlinked into EMPTY_BIN), rather than appending /usr/bin:/bin directly: a
# host that already has tailscale installed system-wide (as this one does)
# would otherwise still find and invoke the real binary via that fallback,
# which is exactly what must never happen in this test suite. Both
# directories are covered, not just /usr/bin: on stock macOS /bin and
# /usr/bin are separate, non-overlapping directories and bash lives only in
# /bin/bash, which the script's `#!/usr/bin/env bash` shebang needs env to
# find via PATH. On a merged-/usr Linux box (as here, where /bin is a
# symlink to /usr/bin) the two globs mostly collide; -f makes that collision
# a silent overwrite instead of an error. The single ln invocation with
# glob-expanded arguments avoids forking ln/basename once per entry.
EMPTY_BIN="$RWORK2/empty"
mkdir -p "$EMPTY_BIN"
ln -sf /usr/bin/* /bin/* "$EMPTY_BIN/" 2>/dev/null
rm -f "$EMPTY_BIN/tailscale"
if PATH="$EMPTY_BIN" "$REMOTE_SH" check >"$RWORK2/check2.out" 2>&1; then
  pass
else
  fail "check should exit 0 even when tailscale is missing"
fi
check "check reports tailscale as missing" \
  grep -qi "not installed" "$RWORK2/check2.out"

rm -rf "$RWORK2"

# --- configure --------------------------------------------------------------

CWORK="$(mktemp -d)"
make_tailscale_stub "$CWORK/bin"
cp "$REMOTE_SH" "$CWORK/setup-remote.sh"
chmod +x "$CWORK/setup-remote.sh"
CENV="$CWORK/.env"

STRONG="$(printf 'a%.0s' $(seq 1 64))"
WEAK="$(printf 'b%.0s' $(seq 1 32))"

reset_env() {
  # $1 = COOKIE_SECRET to seed
  # ALLOWED_EMAILS is seeded so require_registered_users' allowlist check
  # (a separate gate from the COOKIE_SECRET one under test here) does not
  # block these scenarios: there is no data/users.json in this scratch
  # PORTAL_DIR, so require_registered_users falls back to ALLOWED_EMAILS.
  printf 'PORT=8710\nCOOKIE_SECRET=%s\nALLOWED_EMAILS=test@example.com\n' "$1" > "$CENV"
  export TS_LOG="$CWORK/ts.log"
  : > "$TS_LOG"
}

# serve: writes private exposure and a loopback bind, and does not demand 64.
reset_env "$WEAK"
if PATH="$CWORK/bin:$PATH" "$CWORK/setup-remote.sh" configure serve >/dev/null 2>&1; then
  pass
else
  fail "configure serve should succeed with a 32-character secret"
fi
check "configure serve calls tailscale serve" grep -q '^serve' "$TS_LOG"
check "configure serve writes EXPOSURE=private" grep -q '^EXPOSURE=private$' "$CENV"
check "configure serve writes a loopback BIND_HOST" grep -q '^BIND_HOST=127.0.0.1$' "$CENV"
check "configure serve derives BASE_URL from tailscale status" \
  grep -q '^BASE_URL=https://box.tail1234.ts.net$' "$CENV"

# funnel with a weak secret: refuses, and crucially never publishes.
reset_env "$WEAK"
check "configure funnel refuses a weak secret" \
  sh -c "! PATH=$CWORK/bin:\$PATH '$CWORK/setup-remote.sh' configure funnel </dev/null >/dev/null 2>&1"
check "configure funnel does not publish when it refuses" \
  sh -c "! grep -q '^funnel' '$TS_LOG'"
check "configure funnel leaves EXPOSURE unchanged when it refuses" \
  sh -c "! grep -q '^EXPOSURE=public$' '$CENV'"

# funnel with a strong secret: publishes and records public exposure.
reset_env "$STRONG"
if PATH="$CWORK/bin:$PATH" "$CWORK/setup-remote.sh" configure funnel </dev/null >/dev/null 2>&1; then
  pass
else
  fail "configure funnel should succeed with a 64-character secret"
fi
check "configure funnel calls tailscale funnel" grep -q '^funnel' "$TS_LOG"
check "configure funnel writes EXPOSURE=public" grep -q '^EXPOSURE=public$' "$CENV"

# funnel with a weak secret and --generate-secret: rotates, then publishes.
reset_env "$WEAK"
if PATH="$CWORK/bin:$PATH" "$CWORK/setup-remote.sh" configure funnel --generate-secret \
    >/dev/null 2>&1; then
  pass
else
  fail "configure funnel --generate-secret should succeed"
fi
check "generated secret is at least 64 characters" \
  sh -c "test \$(grep '^COOKIE_SECRET=' '$CENV' | cut -d= -f2- | tr -d '\n' | wc -c) -ge 64"
check "configure funnel publishes after generating" grep -q '^funnel' "$TS_LOG"

# Bad arguments.
reset_env "$STRONG"
check "configure with no mode exits non-zero" \
  sh -c "! PATH=$CWORK/bin:\$PATH '$CWORK/setup-remote.sh' configure >/dev/null 2>&1"
check "configure with a bad mode exits non-zero" \
  sh -c "! PATH=$CWORK/bin:\$PATH '$CWORK/setup-remote.sh' configure sideways >/dev/null 2>&1"

# funnel --generate-secret whose write cannot complete: set_env_value must
# report the failure (not silently succeed) and require_strong_secret must
# not treat the file as updated. The whole point is that this is caught
# before anything is published. Forced by copying the script into its own
# directory and chmod'ing that directory read-only (no write bit) once the
# starting .env is in place: creating set_env_value's temp file, or the
# final mv, then fails with EACCES, which is exactly the class of failure
# (disk full, read-only filesystem, permissions) a real install could hit.
UWORK="$CWORK/unwritable"
mkdir -p "$UWORK"
cp "$REMOTE_SH" "$UWORK/setup-remote.sh"
chmod +x "$UWORK/setup-remote.sh"
UENV="$UWORK/.env"
printf 'PORT=8710\nCOOKIE_SECRET=%s\nALLOWED_EMAILS=test@example.com\n' "$WEAK" > "$UENV"
export TS_LOG="$CWORK/ts.log"
: > "$TS_LOG"
chmod 555 "$UWORK"
check "configure funnel --generate-secret refuses when the secret write fails" \
  sh -c "! PATH=$CWORK/bin:\$PATH '$UWORK/setup-remote.sh' configure funnel --generate-secret </dev/null >/dev/null 2>&1"
check "configure funnel does not publish when the secret write fails" \
  sh -c "! grep -q '^funnel' '$TS_LOG'"
chmod 755 "$UWORK"
check "COOKIE_SECRET is left unchanged when the write fails" \
  grep -q "^COOKIE_SECRET=${WEAK}\$" "$UENV"

# BASE_URL/BIND_HOST/EXPOSURE writes, after tailscale has already published,
# must also be checked: a silently unwritten EXPOSURE=public would leave a
# later start reading the old (private) value and applying the weaker
# 32-character secret bar to a portal that is actually public. Forced the
# same way as above, with a directory made read-only after the starting
# .env is in place.
EWORK="$CWORK/unwritable-post"
mkdir -p "$EWORK"
cp "$REMOTE_SH" "$EWORK/setup-remote.sh"
chmod +x "$EWORK/setup-remote.sh"
EENV="$EWORK/.env"
printf 'PORT=8710\nCOOKIE_SECRET=%s\nALLOWED_EMAILS=test@example.com\nEXPOSURE=private\n' "$STRONG" > "$EENV"
export TS_LOG="$CWORK/ts.log"
: > "$TS_LOG"
chmod 555 "$EWORK"
check "configure serve fails when the post-publish .env write cannot complete" \
  sh -c "! PATH=$CWORK/bin:\$PATH '$EWORK/setup-remote.sh' configure serve >/dev/null 2>&1"
check "configure serve still calls tailscale before the write fails" \
  grep -q '^serve' "$TS_LOG"
chmod 755 "$EWORK"
check "EXPOSURE is left unchanged when the post-publish write fails" \
  grep -q '^EXPOSURE=private$' "$EENV"

rm -rf "$CWORK"

# --- service and verify -----------------------------------------------------

SWORK="$(mktemp -d)"
make_tailscale_stub "$SWORK/bin"
cp "$REMOTE_SH" "$SWORK/setup-remote.sh"
chmod +x "$SWORK/setup-remote.sh"
export TS_LOG="$SWORK/ts.log"
: > "$TS_LOG"

# Port 59717, not the portal's usual 8710: a real portal may be running on
# this host (the kit's own live install listens on 8710), and verify's first
# check curls loopback. Using the default port would make these tests pass or
# fail depending on whether the developer's portal happens to be up.
printf 'PORT=59717\nBASE_URL=https://box.tail1234.ts.net\nEXPOSURE=private\n' > "$SWORK/.env"

# service writes a unit without enabling anything, so it is safe under test.
if PATH="$SWORK/bin:$PATH" XDG_CONFIG_HOME="$SWORK/config" \
   "$SWORK/setup-remote.sh" service --write-only >"$SWORK/svc.out" 2>&1; then
  pass
else
  fail "service --write-only should exit 0"
fi
case "$(uname)" in
  Linux)
    check "service writes a systemd user unit" \
      test -f "$SWORK/config/systemd/user/job-search-portal.service"
    check "the unit runs the portal from its own folder" \
      grep -q "WorkingDirectory=$SWORK" "$SWORK/config/systemd/user/job-search-portal.service" ;;
  Darwin)
    check "service writes a launchd plist" \
      test -f "$SWORK/config/LaunchAgents/com.job-search.portal.plist" ;;
esac

# verify fails cleanly when the portal is not running, and says which check failed.
check "verify exits non-zero when the portal is not running" \
  sh -c "! PATH=$SWORK/bin:\$PATH '$SWORK/setup-remote.sh' verify >'$SWORK/ver.out' 2>&1"
check "verify names the loopback check that failed" \
  grep -qi "127.0.0.1:59717\|loopback" "$SWORK/ver.out"
check "verify's login-route failure suggests checking the portal's log and restarting it" \
  sh -c "grep -qi 'service log' '$SWORK/ver.out' && grep -qi 'restart' '$SWORK/ver.out'"

# verify fails when BASE_URL disagrees with the live tailnet hostname.
printf 'PORT=59717\nBASE_URL=https://stale.tail1234.ts.net\nEXPOSURE=private\n' > "$SWORK/.env"
PATH="$SWORK/bin:$PATH" "$SWORK/setup-remote.sh" verify >"$SWORK/ver2.out" 2>&1
check "verify flags a stale BASE_URL" \
  grep -qi "box.tail1234.ts.net" "$SWORK/ver2.out"

rm -rf "$SWORK"
