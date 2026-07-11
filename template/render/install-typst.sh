#!/usr/bin/env bash
# Install the Typst CLI as a self-contained static binary into ~/.local/bin.
# Idempotent: run on any Linux machine to get a working Typst. On macOS use
# `brew install typst` instead.
set -euo pipefail

DEST="$HOME/.local/bin"
mkdir -p "$DEST"

case "$(uname -m)" in
  x86_64)  ASSET="typst-x86_64-unknown-linux-musl" ;;
  aarch64) ASSET="typst-aarch64-unknown-linux-musl" ;;
  *) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac

# Fetch first, parse after: grep -m1 closing the pipe early makes curl exit 23
# under pipefail.
RELEASE_JSON=$(curl -s --max-time 15 https://api.github.com/repos/typst/typst/releases/latest)
VER=$(printf '%s' "$RELEASE_JSON" | grep '"tag_name"' | head -1 | cut -d'"' -f4)
[ -n "$VER" ] || { echo "could not resolve latest Typst version" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -sL --max-time 120 \
  "https://github.com/typst/typst/releases/download/${VER}/${ASSET}.tar.xz" \
  -o "$TMP/typst.tar.xz"
tar -xf "$TMP/typst.tar.xz" -C "$TMP"
install -m 0755 "$TMP/$ASSET/typst" "$DEST/typst"

hash -r 2>/dev/null || true
echo "installed: $("$DEST/typst" --version)  ->  $DEST/typst"
case ":$PATH:" in *":$DEST:"*) ;; *) echo "note: add $DEST to PATH" ;; esac
