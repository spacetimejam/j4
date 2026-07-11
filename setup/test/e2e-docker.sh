#!/usr/bin/env bash
# End-to-end test in a clean Ubuntu container: full dependency install
# (including the Typst static binary), project instantiation from the kit,
# and a Typst smoke compile proving the toolchain renders PDFs. Template
# choice itself happens with the AI in the first session, so no shipped
# CV template is exercised here. Requires Docker and network access.
# Usage: setup/test/e2e-docker.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT="$(cd "$HERE/../.." && pwd)"

docker run --rm -v "$KIT:/kit:ro" ubuntu:24.04 bash -ec '
  apt-get update -qq >/dev/null
  apt-get install -y -qq git curl ca-certificates python3 python3-yaml xz-utils >/dev/null
  /kit/setup/setup.sh --answers /kit/setup/test/answers.env --target /root/my-search
  cd /root/my-search
  export PATH="$HOME/.local/bin:$PATH"
  typst --version
  mkdir -p applications/test
  printf "= Hello\nTypst toolchain smoke test.\n" > applications/test/smoke.typ
  typst compile applications/test/smoke.typ applications/test/smoke.pdf
  ls applications/test/*.pdf
'

echo "e2e: PASS"
