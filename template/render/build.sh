#!/usr/bin/env bash
# Render a Typst source file to PDF, with the bundled fonts available.
# Usage: render/build.sh <input.typ> [output.pdf]
# If output is omitted, writes alongside the input with a .pdf extension.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IN="${1:?usage: build.sh <input.typ> [output.pdf]}"
OUT="${2:-${IN%.typ}.pdf}"

typst compile \
  --font-path "$HERE/fonts" \
  --root "$(cd "$HERE/.." && pwd)" \
  "$IN" "$OUT"

echo "rendered: $OUT"
