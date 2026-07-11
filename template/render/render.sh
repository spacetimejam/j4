#!/usr/bin/env bash
# Render an application's CV and cover letter to send-ready PDFs, named:
#   "<Name> - <Role> - CV.pdf"  and  "<Name> - <Role> - Cover Letter.pdf"
# Name comes from contacts.name, Role from the top-level `role:` field in each yaml.
# Usage: render/render.sh <role-slug>
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SLUG="${1:?usage: render.sh <role-slug>}"
APPDIR="$ROOT/applications/$SLUG"

# Pull a field from a yaml: `field <file> name` (contacts.name) or `field <file> role`.
field() {
  python3 -c "import yaml,sys
d=yaml.safe_load(open(sys.argv[1])) or {}
print((d.get('contacts',{}) or {}).get('name','') if sys.argv[2]=='name' else d.get(sys.argv[2],'') or '')" "$1" "$2"
}

render_one() {
  local cfg="$1" tmpl="$2" doctype="$3"
  [ -f "$cfg" ] || { echo "skip: $(basename "$cfg") not found"; return; }
  local name role out
  name="$(field "$cfg" name)"; role="$(field "$cfg" role)"
  [ -n "$role" ] || { echo "warning: no 'role:' in $(basename "$cfg"), filename will be incomplete"; }
  out="$APPDIR/${doctype} - ${name} - ${role}.pdf"
  typst compile --font-path "$HERE/fonts" --root "$ROOT" \
    --input config="/applications/$SLUG/$(basename "$cfg")" \
    "$HERE/templates/$tmpl" "$out"
  echo "rendered: $out"
}

render_one "$APPDIR/cv.yaml"           main.typ         "CV"
render_one "$APPDIR/cover-letter.yaml" cover-letter.typ "Cover Letter"
