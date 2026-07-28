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
# Build the PATH from every /usr/bin entry EXCEPT tailscale (symlinked into
# EMPTY_BIN), rather than appending /usr/bin:/bin directly: a host that
# already has tailscale installed system-wide (as this one does) would
# otherwise still find and invoke the real binary via that fallback, which
# is exactly what must never happen in this test suite.
EMPTY_BIN="$RWORK2/empty"
mkdir -p "$EMPTY_BIN"
for real_bin in /usr/bin/*; do
  bin_name="$(basename "$real_bin")"
  [ "$bin_name" = "tailscale" ] && continue
  ln -sf "$real_bin" "$EMPTY_BIN/$bin_name" 2>/dev/null
done
if PATH="$EMPTY_BIN" "$REMOTE_SH" check >"$RWORK2/check2.out" 2>&1; then
  pass
else
  fail "check should exit 0 even when tailscale is missing"
fi
check "check reports tailscale as missing" \
  grep -qi "not installed" "$RWORK2/check2.out"

rm -rf "$RWORK2"
