#!/usr/bin/env bash
# Make a design the live one, after proving it.
# Usage: render/switch-design.sh <design-dir>
#
# <design-dir> is a new candidate (render/templates-candidate/) or an earlier
# design kept in render/templates-previous/. It must have a SOURCE.md and pass
# render/try-design.sh. The live design then moves to
# render/templates-previous/<date>-<name>/, so nothing is ever lost, and the
# chosen one becomes render/templates/. If anything fails, the live design is
# left exactly as it was. Bash 3.2 compatible.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
NEW="$(cd "${1:?usage: switch-design.sh <design-dir>}" && pwd)"
LIVE="$HERE/templates"
PREV="$HERE/templates-previous"

die() { echo "$1" >&2; exit 1; }

[ "$NEW" != "$LIVE" ] || die "That is already the live design."
[ -f "$NEW/SOURCE.md" ] || die "Record where this design came from in $NEW/SOURCE.md first (see render/README.md, \"Adapting a template\")."
bash "$HERE/try-design.sh" "$NEW" || die "The design did not pass, so the live design was left as it is."

name="$(sed -n 's/^Package: *//p' "$LIVE/SOURCE.md" 2>/dev/null | head -1 | awk '{print $1}' | tr -cd 'A-Za-z0-9._-')"
name="${name:-unknown}"
base="$PREV/$(date +%Y-%m-%d)-$name"
dest="$base"
n=2
while [ -e "$dest" ]; do
  dest="$base-$n"
  n=$((n + 1))
done
mkdir -p "$PREV"
mv "$LIVE" "$dest"
trap 'mv "$dest" "$LIVE" 2>/dev/null; exit 1' INT TERM HUP
if ! mv "$NEW" "$LIVE"; then
  mv "$dest" "$LIVE"
  die "Could not move the new design into place, so the old one was put back."
fi
trap - INT TERM HUP
echo "Now using: $(sed -n 's/^Package: *//p' "$LIVE/SOURCE.md" | head -1)"
echo "The previous design is kept in ${dest#"$ROOT"/}/"
