#!/usr/bin/env bash
# Install the Typst CLI as a self-contained static binary into ~/.local/bin.
# Idempotent: run again any time to get a working Typst. Works on Linux and
# macOS.
set -euo pipefail

OS="${TYPST_UNAME_S:-$(uname -s)}"
ARCH="${TYPST_UNAME_M:-$(uname -m)}"
case "$OS/$ARCH" in
  Linux/x86_64)        ASSET="typst-x86_64-unknown-linux-musl"; EXT="tar.xz" ;;
  Linux/aarch64)       ASSET="typst-aarch64-unknown-linux-musl"; EXT="tar.xz" ;;
  Darwin/arm64)        ASSET="typst-aarch64-apple-darwin"; EXT="tar.xz" ;;
  Darwin/x86_64)       ASSET="typst-x86_64-apple-darwin"; EXT="tar.xz" ;;
  *) echo "unsupported system: $OS $ARCH" >&2; exit 1 ;;
esac
if [ "${TYPST_PRINT_ASSET:-}" = "1" ]; then echo "$ASSET"; exit 0; fi

DEST="$HOME/.local/bin"
mkdir -p "$DEST"

# Fetch first, parse after: grep -m1 closing the pipe early makes curl exit 23
# under pipefail.
RELEASE_JSON=$(curl -s --max-time 15 https://api.github.com/repos/typst/typst/releases/latest)
VER=$(printf '%s' "$RELEASE_JSON" | grep '"tag_name"' | head -1 | cut -d'"' -f4)
[ -n "$VER" ] || { echo "could not resolve latest Typst version" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -sL --max-time 120 \
  "https://github.com/typst/typst/releases/download/${VER}/${ASSET}.${EXT}" \
  -o "$TMP/typst.${EXT}"
tar -xf "$TMP/typst.${EXT}" -C "$TMP"
install -m 0755 "$TMP/$ASSET/typst" "$DEST/typst"

hash -r 2>/dev/null || true
echo "installed: $("$DEST/typst" --version)  ->  $DEST/typst"
case ":$PATH:" in *":$DEST:"*) ;; *) echo "note: add $DEST to PATH" ;; esac
