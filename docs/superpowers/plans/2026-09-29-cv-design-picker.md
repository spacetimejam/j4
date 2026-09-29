# CV Design Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a person choose any Typst Universe CV template as their CV and letter design, offered twice in setup session C and any time from a "Change CV design" item in the portal's cog menu, with the switch made only once the new design is proven.

**Architecture:** Three small project scripts do the mechanical work and enforce the rules in code: `render/fetch-template.py` (refuses anything outside the CV category, downloads and unpacks safely), `render/try-design.sh` (renders a candidate against a shipped sample and the person's test CV into a scratch folder, and checks the page rules), and `render/switch-design.sh` (proves, then swaps the live design, keeping the old one). Claude does the creative adaptation between fetch and switch, following one written procedure in `render/README.md`. The portal adds a `design` session kind with its own prompt, started from the cog menu.

**Tech Stack:** Bash (3.2 compatible), Python 3 standard library, Typst 0.15, Node 18+ (Express, better-sqlite3, node:test).

**Spec:** `docs/superpowers/specs/2026-09-29-cv-design-picker-design.md`

## Global Constraints

- The choosable set is exactly Typst Universe's CV template category: `https://typst.app/universe/search/?kind=templates&category=cv`. In the package index that means an entry with `"template"` set and `"cv"` in `"categories"`.
- The content model does not change: designs read `configuration.yaml`, `cv.yaml` and `cover-letter.yaml` exactly as today, passed in via `sys.inputs.config`. No new fields.
- The live design (`render/templates/`) is never modified until the candidate has passed `render/try-design.sh`. Nothing is half-switched.
- A passing design means: the CV is exactly one page, and the letter compiles, which includes its own `<letter-end>` check (panics below 66% of the page or past page one).
- Scripts under `template/render/` and `setup/` must run on macOS bash 3.2: no associative arrays, no `readarray`/`mapfile`, no `sed -i`, no `${var,,}`, no GNU-only flags. This host runs bash 5.2, so check by inspection.
- `fetch-template.py` uses the Python 3 standard library only (no `requests`, no `curl`).
- User-facing text: British English, warm and plain, no em or en dashes as sentence punctuation. Docs follow the same dash rule.
- Session titles for `setup` and `design` sessions are fixed ("Getting started", "CV design") and never renamed by the agent.
- Work in `~/j4dev` (the development clone); never in `~/j4`, which runs the live portal. Tests that need a port use a spare one, never 8710.
- Verification: `bash setup/test/run-tests.sh` prints `Passed: N  Failed: 0`; `cd portal && npm test` prints `# fail 0`.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Nn4qZV4LTHywVrTJYFVbup
  ```

## Review Focus

1. **A pasted Universe link in any of its real shapes** (`.../package/brilliant-cv`, `.../package/brilliant-cv/4.1.0/`, with a `?` query or `#` fragment, or a mixed-case or padded name like ` Brilliant-CV `) should resolve to the right package, not be refused as unrecognised. Pinned in Task 3.
2. **No internet, or a download that fails part-way**, should give one plain sentence and leave no half-unpacked folder that a later run could mistake for a good copy. Pinned in Task 3.
3. **Picking the same template twice** (e.g. a retry after a failed adaptation) should replace the earlier unpacked copy cleanly, with no stale files from the first attempt. Pinned in Task 3.
4. **Two design switches on the same day** (e.g. switching, then going straight back) must not overwrite the earlier kept design. Pinned in Task 4.
5. **Pressing "Change CV design" twice, or again while a design conversation exists**, should reopen the same conversation, not start a second one that adapts in parallel. Pinned in Task 6.

---

## File Structure

Project template (copied into every new project by `setup/setup.sh`):

- `template/render/render.sh` (modify): honours `JAWBS_TEMPLATES_DIR` and `JAWBS_OUT_DIR`.
- `template/render/try-design.sh` (create): proves a candidate design; never touches live files.
- `template/render/switch-design.sh` (create): proves, then makes a design live, keeping the old one.
- `template/render/fetch-template.py` (create): CV-category-only fetch and safe unpack, plus a short report.
- `template/render/sample/cv.yaml`, `template/render/sample/cover-letter.yaml` (create): fictional content every design is proven against.
- `template/render/templates/SOURCE.md` (create): records the default design's origin.
- `template/render/.gitignore` (create): keeps scratch folders out of the project's git.
- `template/render/README.md` (modify): "Choosing your template" rewritten around the scripts, plus "Adapting a template", the one procedure the agent follows.
- `setup/SETUP.md.tmpl` (modify): task 10 offers the link before and after the test CV; names the test application `applications/test-render/`.

Kit tests:

- `setup/test/test_fetch_template.py` (create): unittest suite for `fetch-template.py`, no network.
- `setup/test/run-tests.sh` (modify): runs that suite, and exercises `try-design.sh`/`switch-design.sh` when Typst is installed.

Portal:

- `portal/src/design-link.js` (create): the category link, on its own so `agent.js` can import it without an import cycle.
- `portal/src/design-session.js` (create): the opening prompt, find/start for `design` sessions; re-exports the link.
- `portal/src/agent.js` (modify): `designSteps`, `designPrompt`, session C wording in `setupPrompt`, dispatch in `runAgentTurn`.
- `portal/src/server.js` (modify): `POST /api/design/start`.
- `portal/src/queue.js` (modify): fixed titles and no provenance alert for `design` sessions.
- `portal/public/app.js` (modify): cog menu item.
- `portal/test/design-session.test.js` (create), `portal/test/agent.test.js` (modify), `portal/test/queue.test.js` (modify).

Docs: `CLAUDE.md` (key decision), `docs/portal.md` (one paragraph).

---

### Task 1: `render.sh` renders a chosen design into a chosen folder

**Files:**
- Modify: `template/render/render.sh`
- Test: `setup/test/run-tests.sh`

**Interfaces:**
- Produces: `render/render.sh <slug>` with optional env `JAWBS_TEMPLATES_DIR` (absolute path to a folder holding `main.typ` and `cover-letter.typ`; default `render/templates`) and `JAWBS_OUT_DIR` (absolute path for the PDFs; default `applications/<slug>`). Exit status non-zero when Typst fails, including a letter's `<letter-end>` panic.

- [ ] **Step 1: Write the failing test**

Append to `setup/test/run-tests.sh`, just before the `# --- Summary` line:

```bash
# --- render design scripts -----------------------------------------------------
# Needs typst and python3 with yaml; skipped with a note when either is missing.
if command -v typst >/dev/null 2>&1 && python3 -c 'import yaml' >/dev/null 2>&1; then
  RWORK="$(mktemp -d)"
  PORTAL_REGISTRY="$RWORK/users.json" \
    bash "$SETUP_DIR/setup.sh" --answers "$TEST_DIR/answers.env" --target "$RWORK/p" --skip-deps >/dev/null 2>&1
  RP="$RWORK/p"
  mkdir -p "$RP/applications/demo" "$RWORK/out"
  cp "$RP/render/sample/cv.yaml" "$RP/render/sample/cover-letter.yaml" "$RP/applications/demo/"

  JAWBS_OUT_DIR="$RWORK/out" bash "$RP/render/render.sh" demo >/dev/null 2>&1
  check "render.sh writes to JAWBS_OUT_DIR" test -n "$(ls "$RWORK/out"/CV*.pdf 2>/dev/null)"
  check "render.sh leaves the application folder alone with JAWBS_OUT_DIR" test -z "$(ls "$RP/applications/demo"/*.pdf 2>/dev/null)"

  # A design that announces itself, so the check proves which one was used.
  cp -R "$RP/render/templates" "$RP/render/alt"
  printf '#panic("alt design used")\n' > "$RP/render/alt/main.typ"
  JAWBS_TEMPLATES_DIR="$RP/render/alt" JAWBS_OUT_DIR="$RWORK/out" bash "$RP/render/render.sh" demo >"$RWORK/alt.out" 2>&1
  check "render.sh uses JAWBS_TEMPLATES_DIR" grep -q "alt design used" "$RWORK/alt.out"
  rm -rf "$RP/render/alt"

  # Tasks 2 and 4 add their checks here, above this line.
  rm -rf "$RWORK"
else
  echo "note: typst or python3 yaml not found; render design script tests skipped"
fi
```

Later tasks insert their checks immediately above the `# Tasks 2 and 4 add their checks here` comment. This test also needs `render/sample/`, which does not exist yet: create the two sample files now, as part of this task.

Create `template/render/sample/cv.yaml`:

```yaml
# Fictional content for proving a CV design (render/try-design.sh). Not a
# real person and never sent anywhere. Keep it a realistic length: a design
# that only fits one page with thin content is not a design that fits.
theme: {}

contacts:
  name: "Jordan Sample"
  phone: "07700 900123"
  email: "jordan.sample@example.com"
  location: "Manchester"
  website:
    url: "https://www.example.com"
    displayText: "www.example.com"
  linkedin:
    url: "https://www.linkedin.com/in/jordan-sample"
    displayText: "linkedin.com/in/jordan-sample"

position: "Senior Operations Manager"
role: "Senior Operations Manager"

about:
  - >-
    Operations manager with eleven years in logistics and retail supply chains,
    most recently running a 140-person regional distribution network. Strongest
    at turning messy processes into ones people can run without heroics.
  - >-
    Works best close to the floor, with data to hand and a team that says
    plainly what is going wrong.

key_skills:
  - Network planning
  - Budget ownership to 9 million pounds
  - Supplier negotiation
  - Lean process design
  - Team leadership
  - Stakeholder reporting

education:
  - qualification: BSc (Hons)
    course: Logistics and Supply Chain Management
    institution: University of Salford
    dates: 2010 - 2013

jobs:
  - position: Senior Operations Manager
    company: Northway Distribution
    from: Apr 2021
    to: Present
    intro: >-
      Runs three regional warehouses and the transport team serving 400 stores.
    description:
      - Cut late store deliveries from 9% to 2% in a year by redesigning route planning.
      - Owns a 9 million pound operating budget; delivered 6% savings two years running.
      - Led the move to a new warehouse system with no lost trading days.
  - position: Operations Manager
    company: Brightside Retail
    from: Jun 2017
    to: Mar 2021
    intro: >-
      Managed the returns centre and its 60-strong team.
    description:
      - Halved returns processing time by introducing a triage line.
      - Built the first weekly performance pack the board actually read.
      - Brought agency staff turnover down from 45% to 20%.
  - position: Shift Manager
    company: Brightside Retail
    from: Sep 2013
    to: May 2017
    intro: >-
      Ran night shifts in the main fulfilment centre.
    description:
      - Led a team of 25 across picking, packing and loading.
      - Trained twelve team leaders, eight of whom were later promoted.
      - Cut picking errors by a third with a simple two-step check.
```

Create `template/render/sample/cover-letter.yaml`:

```yaml
# Fictional content for proving a letter design (render/try-design.sh). Four
# full paragraphs, so the letter's own fill check (at least 66% of the page)
# is tested against a realistic letter rather than a stub.
theme: {}

contacts:
  name: "Jordan Sample"
  phone: "07700 900123"
  email: "jordan.sample@example.com"
  location: "Manchester"
  website:
    url: "https://www.example.com"
    displayText: "www.example.com"
  linkedin:
    url: "https://www.linkedin.com/in/jordan-sample"
    displayText: "linkedin.com/in/jordan-sample"

position: "Senior Operations Manager"
role: "Head of Operations"
date: 29 September 2026
subject: "Application for Head of Operations"
greeting: "Dear Hiring Team,"

paragraphs:
  - >-
    I am writing to apply for the Head of Operations role advertised on your
    careers page. For the last four years I have run Northway Distribution's
    regional network of three warehouses and a transport team serving four
    hundred stores, and the challenges your advert describes, growing volume
    without growing cost and keeping service steady through a systems change,
    are the ones I have spent that time solving.
  - >-
    The clearest example is delivery reliability. When I joined, nearly one
    store delivery in ten arrived late, and the fixes on offer were more vans
    and more overtime. I rebuilt route planning around actual store opening
    patterns instead, trialled it in one region for six weeks, and rolled it
    out once the numbers held. Late deliveries fell to two per cent within a
    year, and the transport budget came in under plan.
  - >-
    I also know what a systems change feels like from the floor. I led our
    move to a new warehouse management system across all three sites, and we
    did not lose a single trading day. That came from unglamorous work:
    rehearsing the cutover twice, training team leaders to train their own
    teams, and keeping a paper fallback ready that we were glad never to use.
    I would bring the same care to the migration your advert mentions.
  - >-
    I would welcome the chance to talk about how I could help your network
    through its next stage of growth. I am available for interview at any
    time, and I am happy to share the performance pack I built at Northway
    as an example of how I report to a board. Thank you for considering my
    application.

signoff: "Best wishes,"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/j4dev && bash setup/test/run-tests.sh 2>&1 | grep -E "JAWBS_|Passed"`
Expected: `FAIL: render.sh writes to JAWBS_OUT_DIR` and `FAIL: render.sh uses JAWBS_TEMPLATES_DIR` (render.sh still writes into `applications/demo`), so also `FAIL: render.sh leaves the application folder alone`.

- [ ] **Step 3: Implement the overrides**

In `template/render/render.sh`, after the `APPDIR="$ROOT/applications/$SLUG"` line add:

```bash
# try-design.sh renders a candidate design into a scratch folder with these;
# left unset, render.sh uses the live design and the application folder.
TEMPLATES="${JAWBS_TEMPLATES_DIR:-$HERE/templates}"
OUTDIR="${JAWBS_OUT_DIR:-$APPDIR}"
```

Then replace every use of `$HERE/templates` in the file with `$TEMPLATES` (the two missing-template checks and the two `typst` invocations, four places in `render_one` and the checks above it), and in `render_one` change

```bash
  out="$APPDIR/${doctype} - ${name} - ${role}.pdf"
```

to

```bash
  out="$OUTDIR/${doctype} - ${name} - ${role}.pdf"
```

In the two missing-template messages, change `render/templates/main.typ` and `render/templates/cover-letter.typ` to `$TEMPLATES/main.typ` and `$TEMPLATES/cover-letter.typ` so a candidate's missing file is named correctly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/j4dev && bash setup/test/run-tests.sh 2>&1 | grep -E "FAIL|Passed"`
Expected: no `FAIL` lines; `Failed: 0`.

- [ ] **Step 5: Commit**

```bash
cd ~/j4dev && git add template/render/render.sh template/render/sample setup/test/run-tests.sh
git commit -m "render.sh: render a chosen design into a chosen folder; sample CV and letter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Nn4qZV4LTHywVrTJYFVbup"
```

---

### Task 2: `try-design.sh` proves a candidate without touching anything live

**Files:**
- Create: `template/render/try-design.sh` (mode 755)
- Create: `template/render/.gitignore`
- Test: `setup/test/run-tests.sh` (inside the render block from Task 1)

**Interfaces:**
- Consumes: `render.sh` with `JAWBS_TEMPLATES_DIR`/`JAWBS_OUT_DIR` (Task 1); `render/sample/*.yaml` (Task 1).
- Produces: `render/try-design.sh <candidate-dir>`, exit 0 and a final line starting `PASS:` when the candidate passes; exit 1 and lines starting `FAIL:` otherwise; exit 2 for a candidate outside the project. Uses and removes `applications/_design-trial/`. Renders `applications/test-render/` too when it has a `cv.yaml`.

- [ ] **Step 1: Write the failing tests**

Inside the render block, immediately above the `# Tasks 2 and 4 add their checks here` comment, add:

```bash
  cp -R "$RP/render/templates" "$RP/render/templates-candidate"
  LIVE_SUM="$(cat "$RP/render/templates"/* | cksum)"
  bash "$RP/render/try-design.sh" "$RP/render/templates-candidate" >"$RWORK/try1.out" 2>&1
  check "the default design passes try-design" grep -q "^PASS:" "$RWORK/try1.out"
  check "try-design removes its trial folder" test ! -e "$RP/applications/_design-trial"

  # A CV that runs to two pages must fail, and nothing live may change.
  printf '\n#pagebreak()\nSecond page.\n' >> "$RP/render/templates-candidate/main.typ"
  if bash "$RP/render/try-design.sh" "$RP/render/templates-candidate" >"$RWORK/try2.out" 2>&1; then
    fail "a two-page CV should fail try-design"
  else
    pass
  fi
  check "a two-page CV is named as the reason" grep -q "2 pages" "$RWORK/try2.out"
  check "a failed try leaves the live design byte-identical" test "$(cat "$RP/render/templates"/* | cksum)" = "$LIVE_SUM"

  # The person's own test CV is tried too when it exists.
  mkdir -p "$RP/applications/test-render"
  cp "$RP/render/sample/cv.yaml" "$RP/applications/test-render/cv.yaml"
  rm -rf "$RP/render/templates-candidate" && cp -R "$RP/render/templates" "$RP/render/templates-candidate"
  bash "$RP/render/try-design.sh" "$RP/render/templates-candidate" >"$RWORK/try3.out" 2>&1
  check "try-design also tries applications/test-render" grep -q "applications/test-render" "$RWORK/try3.out"
  check "try-design writes no PDFs into test-render" test -z "$(ls "$RP/applications/test-render"/*.pdf 2>/dev/null)"

  if bash "$RP/render/try-design.sh" "$RWORK" >/dev/null 2>&1; then fail "a candidate outside the project should be refused"; else pass; fi
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/j4dev && bash setup/test/run-tests.sh 2>&1 | grep -E "FAIL|Passed"`
Expected: `FAIL: the default design passes try-design` and the others that depend on the script (it does not exist).

- [ ] **Step 3: Write `template/render/try-design.sh`**

```bash
#!/usr/bin/env bash
# Prove a candidate CV and letter design before it goes live.
# Usage: render/try-design.sh <candidate-dir>
#
# Renders the candidate against render/sample/ and, when it exists, the
# person's own test CV in applications/test-render/, into a scratch folder.
# Passes only if every CV is exactly one page and every letter compiles, which
# includes the letter's own <letter-end> check (under 66% of the page or past
# page one fails). Never touches render/templates/ or any application's PDFs.
# Bash 3.2 compatible.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
CAND="$(cd "${1:?usage: try-design.sh <candidate-dir>}" && pwd)"

# Typst resolves the template's imports within --root, so the candidate has to
# live inside the project.
case "$CAND/" in
  "$ROOT"/*) ;;
  *) echo "error: the candidate must be inside the project ($ROOT), e.g. render/templates-candidate/" >&2; exit 2 ;;
esac

if ! command -v typst >/dev/null 2>&1 && [ -x "$HOME/.local/bin/typst" ]; then
  PATH="$HOME/.local/bin:$PATH"
fi

for f in main.typ cover-letter.typ; do
  if [ ! -f "$CAND/$f" ]; then
    echo "FAIL: the candidate has no $f" >&2
    exit 1
  fi
done

SCRATCH="$(mktemp -d)"
TRIAL="$ROOT/applications/_design-trial"
cleanup() { rm -rf "$SCRATCH" "$TRIAL"; }
trap cleanup EXIT
rm -rf "$TRIAL"
mkdir -p "$TRIAL"
cp "$HERE/sample/cv.yaml" "$HERE/sample/cover-letter.yaml" "$TRIAL/"

failed=0

# pages <config-path-from-root>: how many pages the candidate's CV runs to.
# One tiny PNG per page is the page count, with nothing beyond Typst needed.
pages() {
  pg_dir="$(mktemp -d "$SCRATCH/pages.XXXXXX")"
  if ! typst compile --font-path "$HERE/fonts" --root "$ROOT" --ppi 10 \
      --input config="$1" "$CAND/main.typ" "$pg_dir/p-{p}.png" >/dev/null 2>&1; then
    echo 0
    return
  fi
  ls "$pg_dir" | wc -l | tr -d ' '
}

try_slug() {
  ts_slug="$1"
  ts_out="$SCRATCH/out-$ts_slug"
  mkdir -p "$ts_out"
  echo "Trying the design with applications/$ts_slug/"
  if ! JAWBS_TEMPLATES_DIR="$CAND" JAWBS_OUT_DIR="$ts_out" bash "$HERE/render.sh" "$ts_slug"; then
    echo "FAIL: applications/$ts_slug/ did not render (see the Typst message above)"
    failed=1
    return
  fi
  ts_pages="$(pages "/applications/$ts_slug/cv.yaml")"
  if [ "$ts_pages" != "1" ]; then
    echo "FAIL: the CV for applications/$ts_slug/ runs to $ts_pages pages; it must be exactly one"
    failed=1
  fi
}

try_slug _design-trial
if [ -f "$ROOT/applications/test-render/cv.yaml" ]; then
  try_slug test-render
fi

if [ "$failed" -eq 0 ]; then
  echo "PASS: the design renders a one-page CV and a letter that fills its page."
else
  echo "The design is not ready. Nothing live has changed."
  exit 1
fi
```

Then `chmod 755 template/render/try-design.sh`.

Create `template/render/.gitignore`:

```
# Scratch folders used while choosing a design (see README.md).
template-source/
templates-candidate/
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/j4dev && bash setup/test/run-tests.sh 2>&1 | grep -E "FAIL|Passed"`
Expected: `Failed: 0`.
If `the default design passes try-design` fails with the letter "too short" panic, the sample letter is too thin for the default layout: lengthen each paragraph of `template/render/sample/cover-letter.yaml` by a sentence (keep it four paragraphs, still plausible) until the default passes. The default design passing the sample is the baseline everything else is measured against.

- [ ] **Step 5: Check bash 3.2 by inspection**

Read `template/render/try-design.sh` once more for `local` (fine in 3.2), arrays, `mapfile`, `[[ ]]` with regex, `${x,,}`: none should be present.

- [ ] **Step 6: Commit**

```bash
cd ~/j4dev && git add template/render/try-design.sh template/render/.gitignore setup/test/run-tests.sh template/render/sample
git commit -m "render: try-design.sh proves a candidate design without touching live files

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Nn4qZV4LTHywVrTJYFVbup"
```

---

### Task 3: `fetch-template.py` fetches only CV-category templates

**Files:**
- Create: `template/render/fetch-template.py` (mode 755)
- Create: `setup/test/test_fetch_template.py`
- Modify: `setup/test/run-tests.sh` (run the suite)

**Interfaces:**
- Produces: `render/fetch-template.py <name | name:version | Universe package URL>`. Exit 0 and a report on stdout; exit 1 and one plain reason on stderr on refusal or failure; exit 2 on bad usage. Unpacks to `render/template-source/<name>-<version>/`. Env overrides for tests: `JAWBS_TYPST_INDEX_URL`, `JAWBS_TYPST_PACKAGES_URL`, `JAWBS_TEMPLATE_SOURCE_DIR`. Report lines begin `Fetched:`, `Licence:`, `Unpacked to:`, `Own cover letter:`, `Fonts to check:`.

- [ ] **Step 1: Write the failing tests**

Create `setup/test/test_fetch_template.py`:

```python
"""Tests for template/render/fetch-template.py. No network: the package index
and tarballs are fixtures served over file:// URLs."""
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "..", "template", "render", "fetch-template.py")


def make_tarball(path, files):
    """files: {member name: text}. Written as a .tar.gz at path."""
    with tarfile.open(path, "w:gz") as tar:
        for name, text in files.items():
            data = text.encode()
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))


class FetchTemplateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.pkgs = os.path.join(self.tmp, "pkgs")
        self.dest = os.path.join(self.tmp, "template-source")
        os.makedirs(self.pkgs)
        index = [
            {"name": "good-cv", "version": "1.0.0", "template": {"path": "template"},
             "categories": ["cv"], "license": "MIT"},
            {"name": "good-cv", "version": "1.2.0", "template": {"path": "template"},
             "categories": ["cv"], "license": "MIT"},
            {"name": "plain-lib", "version": "0.1.0", "categories": ["cv"], "license": "MIT"},
            {"name": "slides-tpl", "version": "0.1.0", "template": {"path": "template"},
             "categories": ["presentation"], "license": "MIT"},
            {"name": "evil-cv", "version": "0.1.0", "template": {"path": "template"},
             "categories": ["cv"], "license": "MIT"},
            {"name": "missing-cv", "version": "0.1.0", "template": {"path": "template"},
             "categories": ["cv"], "license": "MIT"},
        ]
        self.index = os.path.join(self.tmp, "index.json")
        with open(self.index, "w") as f:
            json.dump(index, f)
        make_tarball(os.path.join(self.pkgs, "good-cv-1.0.0.tar.gz"),
                     {"typst.toml": "[package]\n", "template/main.typ": '#set text(font: "Libertinus Serif")\n'})
        make_tarball(os.path.join(self.pkgs, "good-cv-1.2.0.tar.gz"),
                     {"typst.toml": "[package]\n", "LICENSE": "MIT",
                      "template/main.typ": '#set text(font: ("Roboto", "Libertinus Serif"))\n',
                      "template/cover-letter.typ": "letter\n"})
        make_tarball(os.path.join(self.pkgs, "evil-cv-0.1.0.tar.gz"),
                     {"typst.toml": "[package]\n", "../escape.typ": "nope\n"})
        # missing-cv has no tarball, standing in for a failed download.

    def run_fetch(self, arg):
        env = dict(os.environ,
                   JAWBS_TYPST_INDEX_URL="file://" + self.index,
                   JAWBS_TYPST_PACKAGES_URL="file://" + self.pkgs,
                   JAWBS_TEMPLATE_SOURCE_DIR=self.dest)
        return subprocess.run([sys.executable, SCRIPT, arg], env=env,
                              capture_output=True, text=True)

    def test_name_fetches_latest_version(self):
        r = self.run_fetch("good-cv")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.isfile(os.path.join(self.dest, "good-cv-1.2.0", "template", "main.typ")))
        self.assertIn("Fetched: good-cv 1.2.0", r.stdout)
        self.assertIn("Licence: MIT", r.stdout)
        self.assertIn("Own cover letter: yes", r.stdout)
        self.assertIn("Roboto", r.stdout)
        self.assertNotIn("Libertinus", r.stdout.split("Fonts to check:")[1])

    def test_name_and_version(self):
        r = self.run_fetch("good-cv:1.0.0")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.isdir(os.path.join(self.dest, "good-cv-1.0.0")))
        self.assertIn("Own cover letter: no", r.stdout)

    def test_universe_links_in_their_real_shapes(self):
        for link in ("https://typst.app/universe/package/good-cv",
                     "https://typst.app/universe/package/good-cv/",
                     "https://typst.app/universe/package/good-cv/1.0.0/",
                     "https://typst.app/universe/package/good-cv?x=1#top",
                     "  Good-CV  "):
            r = self.run_fetch(link)
            self.assertEqual(r.returncode, 0, f"{link}: {r.stderr}")

    def test_refuses_a_package_that_is_not_a_template(self):
        r = self.run_fetch("plain-lib")
        self.assertEqual(r.returncode, 1)
        self.assertIn("not a template", r.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.dest, "plain-lib-0.1.0")))

    def test_refuses_a_template_outside_the_cv_category(self):
        r = self.run_fetch("slides-tpl")
        self.assertEqual(r.returncode, 1)
        self.assertIn("category=cv", r.stderr)

    def test_refuses_an_unknown_name(self):
        r = self.run_fetch("no-such-cv")
        self.assertEqual(r.returncode, 1)
        self.assertIn("no Typst Universe package", r.stderr)

    def test_refuses_an_unsafe_archive_and_leaves_nothing(self):
        r = self.run_fetch("evil-cv")
        self.assertEqual(r.returncode, 1)
        self.assertIn("unsafe", r.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.dest, "evil-cv-0.1.0")))
        self.assertFalse(os.path.exists(os.path.join(self.dest, "escape.typ")))
        leftovers = os.listdir(self.dest) if os.path.isdir(self.dest) else []
        self.assertEqual([p for p in leftovers if p.endswith(".partial")], [])

    def test_a_failed_download_is_one_plain_sentence_and_leaves_nothing(self):
        r = self.run_fetch("missing-cv")
        self.assertEqual(r.returncode, 1)
        self.assertIn("Could not download", r.stderr)
        self.assertNotIn("Traceback", r.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.dest, "missing-cv-0.1.0")))

    def test_no_package_list_is_one_plain_sentence(self):
        env = dict(os.environ, JAWBS_TYPST_INDEX_URL="file://" + self.tmp + "/nope.json",
                   JAWBS_TEMPLATE_SOURCE_DIR=self.dest)
        r = subprocess.run([sys.executable, SCRIPT, "good-cv"], env=env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)
        self.assertIn("Could not read the Typst package list", r.stderr)
        self.assertNotIn("Traceback", r.stderr)

    def test_fetching_again_replaces_the_earlier_copy(self):
        self.assertEqual(self.run_fetch("good-cv").returncode, 0)
        stale = os.path.join(self.dest, "good-cv-1.2.0", "stale.typ")
        with open(stale, "w") as f:
            f.write("left over from an earlier attempt")
        self.assertEqual(self.run_fetch("good-cv").returncode, 0)
        self.assertFalse(os.path.exists(stale))

    def test_usage(self):
        r = subprocess.run([sys.executable, SCRIPT], capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)


if __name__ == "__main__":
    unittest.main()
```

In `setup/test/run-tests.sh`, just before the render block from Task 1, add:

```bash
# --- fetch-template.py ----------------------------------------------------------
FETCH_OUT="$(mktemp)"
if (cd "$TEST_DIR" && python3 -m unittest -q test_fetch_template) >"$FETCH_OUT" 2>&1; then
  pass
else
  fail "fetch-template.py unit tests (details below)"
  cat "$FETCH_OUT"
fi
rm -f "$FETCH_OUT"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/j4dev/setup/test && python3 -m unittest -q test_fetch_template 2>&1 | tail -3`
Expected: `FAILED (failures=...` or errors, since the script does not exist.

- [ ] **Step 3: Write `template/render/fetch-template.py`**

```python
#!/usr/bin/env python3
"""Fetch a CV template from Typst Universe into render/template-source/.

Usage: render/fetch-template.py <name | name:version | Universe package link>

Only templates in Typst Universe's CV category are accepted:
https://typst.app/universe/search/?kind=templates&category=cv
Anything else is refused with the reason. This is where that rule lives, so it
holds whoever or whatever runs the script. Standard library only.
"""
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.error
import urllib.request

INDEX_URL = os.environ.get("JAWBS_TYPST_INDEX_URL", "https://packages.typst.org/preview/index.json")
PACKAGES_URL = os.environ.get("JAWBS_TYPST_PACKAGES_URL", "https://packages.typst.org/preview")
CATEGORY_LINK = "https://typst.app/universe/search/?kind=templates&category=cv"
HERE = os.path.dirname(os.path.abspath(__file__))
DEST_ROOT = os.environ.get("JAWBS_TEMPLATE_SOURCE_DIR", os.path.join(HERE, "template-source"))

# Families Typst embeds, so a template naming them needs nothing bundled.
TYPST_FONTS = {"libertinus serif", "new computer modern", "new computer modern math", "dejavu sans mono"}


class Refusal(Exception):
    """A reason to stop, worded for the person reading it."""


def parse_request(text):
    t = text.strip()
    m = re.match(r"^https?://typst\.app/universe/package/([A-Za-z0-9_-]+)(?:/([0-9][0-9.]*))?/?(?:[?#].*)?$", t)
    if not m:
        m = re.match(r"^@?(?:preview/)?([A-Za-z0-9_-]+)(?::([0-9][0-9.]*))?$", t)
    if not m:
        raise Refusal(f'"{text.strip()}" is not a template name or a Typst Universe package link.')
    return m.group(1).lower(), m.group(2)


def version_key(v):
    return tuple(int(x) for x in re.findall(r"\d+", v))


def choose(index, name, version):
    entries = [p for p in index if p.get("name") == name]
    if not entries:
        raise Refusal(f'There is no Typst Universe package called "{name}". The CV templates are listed at {CATEGORY_LINK}')
    if version:
        entries = [p for p in entries if p.get("version") == version]
        if not entries:
            raise Refusal(f"{name} has no version {version}.")
    pkg = max(entries, key=lambda p: version_key(p.get("version", "0")))
    if not pkg.get("template"):
        raise Refusal(f"{name} is a package, not a template, so it is not one of the CV templates at {CATEGORY_LINK}")
    if "cv" not in (pkg.get("categories") or []):
        raise Refusal(f"{name} is a template, but not one of the CV templates at {CATEGORY_LINK}")
    return pkg


def fetch(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def unpack(data, dest):
    """Unpack into dest via a .partial folder, so a failure leaves nothing."""
    tmp = dest + ".partial"
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    try:
        real_tmp = os.path.realpath(tmp)
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
            members = tar.getmembers()
            for m in members:
                target = os.path.realpath(os.path.join(tmp, m.name))
                inside = target == real_tmp or target.startswith(real_tmp + os.sep)
                if not inside or m.issym() or m.islnk():
                    raise Refusal(f"The download contains an unsafe path ({m.name}), so it was not unpacked.")
            safe = [m for m in members if m.isfile() or m.isdir()]
            if hasattr(tarfile, "data_filter"):
                tar.extractall(tmp, members=safe, filter="data")
            else:
                tar.extractall(tmp, members=safe)
    except Refusal:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    except (tarfile.TarError, OSError) as e:
        shutil.rmtree(tmp, ignore_errors=True)
        raise Refusal(f"The download could not be unpacked ({e}).")
    shutil.rmtree(dest, ignore_errors=True)
    os.rename(tmp, dest)


def typ_files(root):
    for dirpath, _, names in os.walk(root):
        for n in names:
            if n.endswith(".typ"):
                yield os.path.join(dirpath, n)


def fonts_named(root):
    found = set()
    for path in typ_files(root):
        with open(path, encoding="utf-8", errors="replace") as f:
            src = f.read()
        for m in re.finditer(r"font\s*:\s*(\([^)]*\)|\"[^\"]+\")", src):
            found.update(re.findall(r"\"([^\"]+)\"", m.group(1)))
    return found


def fonts_available():
    """Families Typst can see, including render/fonts/; empty if Typst is absent."""
    try:
        out = subprocess.run(["typst", "fonts", "--font-path", os.path.join(HERE, "fonts")],
                             capture_output=True, text=True, timeout=60).stdout
    except (OSError, subprocess.SubprocessError):
        return set()
    return {line.strip().lower() for line in out.splitlines() if line.strip()}


def report(pkg, dest):
    letters = [os.path.relpath(p, dest) for p in typ_files(dest) if "letter" in os.path.basename(p).lower()]
    have = TYPST_FONTS | fonts_available()
    check = sorted(f for f in fonts_named(dest) if f.lower() not in have)
    print(f"Fetched: {pkg['name']} {pkg['version']}")
    print(f"Licence: {pkg.get('license', 'not stated')}")
    print(f"Unpacked to: {dest}")
    print("Own cover letter: " + (f"yes ({', '.join(sorted(letters))})" if letters else "no"))
    print("Fonts to check: " + (", ".join(check) if check else "none"))


def main(argv):
    if len(argv) != 2:
        print(__doc__.strip().splitlines()[2], file=sys.stderr)
        return 2
    try:
        name, version = parse_request(argv[1])
        try:
            index = json.loads(fetch(INDEX_URL))
        except (urllib.error.URLError, OSError, ValueError) as e:
            raise Refusal(f"Could not read the Typst package list ({e}). Check the internet connection and try again.")
        pkg = choose(index, name, version)
        url = f"{PACKAGES_URL}/{pkg['name']}-{pkg['version']}.tar.gz"
        try:
            data = fetch(url)
        except (urllib.error.URLError, OSError) as e:
            raise Refusal(f"Could not download {pkg['name']} {pkg['version']} ({e}). Check the internet connection and try again.")
        os.makedirs(DEST_ROOT, exist_ok=True)
        dest = os.path.join(DEST_ROOT, f"{pkg['name']}-{pkg['version']}")
        unpack(data, dest)
    except Refusal as e:
        print(str(e), file=sys.stderr)
        return 1
    report(pkg, dest)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
```

Then `chmod 755 template/render/fetch-template.py`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/j4dev/setup/test && python3 -m unittest -q test_fetch_template 2>&1 | tail -3`
Expected: `OK`.
Then: `bash setup/test/run-tests.sh 2>&1 | grep -E "FAIL|Passed"`, expected `Failed: 0`.

- [ ] **Step 5: One live check against the real index**

Run (network needed; a scratch folder, not a project):
`cd "$(mktemp -d)" && JAWBS_TEMPLATE_SOURCE_DIR="$PWD/src" python3 ~/j4dev/template/render/fetch-template.py brilliant-cv && python3 ~/j4dev/template/render/fetch-template.py tidy-slides; echo "exit $?"`
Expected: brilliant-cv is fetched with `Own cover letter: yes (...)`; the second name is refused with exit 1 (it is either unknown or outside the CV category). Record the output in the task's report.

- [ ] **Step 6: Commit**

```bash
cd ~/j4dev && git add template/render/fetch-template.py setup/test/test_fetch_template.py setup/test/run-tests.sh
git commit -m "render: fetch-template.py fetches only Typst Universe CV templates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Nn4qZV4LTHywVrTJYFVbup"
```

---

### Task 4: `switch-design.sh` proves, then swaps, and keeps the old design

**Files:**
- Create: `template/render/switch-design.sh` (mode 755)
- Create: `template/render/templates/SOURCE.md`
- Test: `setup/test/run-tests.sh` (render block)

**Interfaces:**
- Consumes: `try-design.sh` (Task 2).
- Produces: `render/switch-design.sh <design-dir>`. Refuses (exit 1, live design untouched) when `<design-dir>` lacks `SOURCE.md`, is the live folder, or fails `try-design.sh`. On success moves the live design to `render/templates-previous/<YYYY-MM-DD>-<name>[-N]/` (name = first word after `Package:` in the live `SOURCE.md`, or `unknown`) and moves `<design-dir>` to `render/templates/`. Prints `Now using: <Package line>` and where the old one went. The same command restores an earlier design from `render/templates-previous/`.
- `SOURCE.md` format (first lines, parsed by the script):
  ```
  # Design source
  Package: <name> <version>
  Licence: <licence> (<licence file name>)
  Adopted: <YYYY-MM-DD>
  Changes: <one line or more on what the adaptation changed>
  ```

- [ ] **Step 1: Write the failing tests**

Inside the render block, immediately above the `# Tasks 2 and 4 add their checks here` comment, add:

```bash
  rm -rf "$RP/applications/test-render" "$RP/render/templates-candidate"
  # trial_candidate <package-name>: a copy of the live design labelled as <package-name>.
  trial_candidate() {
    rm -rf "$RP/render/templates-candidate"
    cp -R "$RP/render/templates" "$RP/render/templates-candidate"
    printf '# Design source\nPackage: %s 1.0.0\nLicence: MIT (LICENSE)\nAdopted: 2026-09-29\nChanges: none\n' "$1" \
      > "$RP/render/templates-candidate/SOURCE.md"
  }
  trial_candidate trial-cv
  rm -f "$RP/render/templates-candidate/SOURCE.md"
  if bash "$RP/render/switch-design.sh" "$RP/render/templates-candidate" >/dev/null 2>&1; then
    fail "a design without SOURCE.md should be refused"
  else
    pass
  fi

  trial_candidate trial-cv
  bash "$RP/render/switch-design.sh" "$RP/render/templates-candidate" >"$RWORK/sw1.out" 2>&1
  check "switch-design makes the candidate live" grep -q "^Package: trial-cv" "$RP/render/templates/SOURCE.md"
  check "switch-design keeps the old design" test -d "$RP/render/templates-previous/$(date +%Y-%m-%d)-vantage-cv"
  check "switch-design empties the candidate folder" test ! -e "$RP/render/templates-candidate"

  # Two more switches the same day, each replacing a live trial-cv: the second
  # kept trial-cv must not overwrite the first.
  trial_candidate trial-cv
  bash "$RP/render/switch-design.sh" "$RP/render/templates-candidate" >/dev/null 2>&1
  trial_candidate trial-cv
  bash "$RP/render/switch-design.sh" "$RP/render/templates-candidate" >/dev/null 2>&1
  TODAY="$(date +%Y-%m-%d)"
  check "a same-day switch keeps the first kept design" test -d "$RP/render/templates-previous/$TODAY-trial-cv"
  check "a same-day switch keeps the second under a new name" test -d "$RP/render/templates-previous/$TODAY-trial-cv-2"

  # Going back: restore the default from templates-previous.
  bash "$RP/render/switch-design.sh" "$RP/render/templates-previous/$TODAY-vantage-cv" >"$RWORK/sw2.out" 2>&1
  check "restoring brings the default back" grep -q "^Package: vantage-cv" "$RP/render/templates/SOURCE.md"
  check "restoring says what is in use" grep -q "^Now using: vantage-cv" "$RWORK/sw2.out"

  # A failing design is refused and nothing moves.
  cp -R "$RP/render/templates" "$RP/render/templates-candidate"
  printf '\n#pagebreak()\nSecond page.\n' >> "$RP/render/templates-candidate/main.typ"
  LIVE_SUM="$(cat "$RP/render/templates"/* | cksum)"
  if bash "$RP/render/switch-design.sh" "$RP/render/templates-candidate" >/dev/null 2>&1; then
    fail "a failing design should not be switched in"
  else
    pass
  fi
  check "a refused switch leaves the live design byte-identical" test "$(cat "$RP/render/templates"/* | cksum)" = "$LIVE_SUM"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/j4dev && bash setup/test/run-tests.sh 2>&1 | grep -E "FAIL|Passed"`
Expected: failures for the switch-design checks (script and `SOURCE.md` do not exist).

- [ ] **Step 3: Write `template/render/templates/SOURCE.md`**

```markdown
# Design source
Package: vantage-cv 1.0.0 (Jawbs default)
Licence: MIT (VANTAGE-LICENSE)
Adopted: shipped with the kit
Changes: adapted to Jawbs' yaml content model; letter designed to match.
```

- [ ] **Step 4: Write `template/render/switch-design.sh`**

```bash
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
if ! mv "$NEW" "$LIVE"; then
  mv "$dest" "$LIVE"
  die "Could not move the new design into place, so the old one was put back."
fi
echo "Now using: $(sed -n 's/^Package: *//p' "$LIVE/SOURCE.md" | head -1)"
echo "The previous design is kept in ${dest#$ROOT/}/"
```

Then `chmod 755 template/render/switch-design.sh`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ~/j4dev && bash setup/test/run-tests.sh 2>&1 | grep -E "FAIL|Passed"`
Expected: `Failed: 0`.

- [ ] **Step 6: Commit**

```bash
cd ~/j4dev && git add template/render/switch-design.sh template/render/templates/SOURCE.md setup/test/run-tests.sh
git commit -m "render: switch-design.sh proves then swaps a design, keeping the old one

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Nn4qZV4LTHywVrTJYFVbup"
```

---

### Task 5: The procedure, and session C offering the link twice

**Files:**
- Modify: `template/render/README.md` (replace "Choosing your template")
- Modify: `setup/SETUP.md.tmpl` (task 10)
- Modify: `portal/src/agent.js` (`designSteps`, session C bullet in `setupPrompt`)
- Create: `portal/src/design-link.js`
- Test: `setup/test/run-tests.sh`, `portal/test/agent.test.js`

**Interfaces:**
- Produces: `DESIGN_CATEGORY_URL` exported from `portal/src/design-link.js`, value `'https://typst.app/universe/search/?kind=templates&category=cv'`. It lives in its own module, imported by `agent.js` and (Task 6) re-exported by `design-session.js`, because `design-session.js` imports `queue.js`, which imports `agent.js`: defining the link in `design-session.js` would make `agent.js` part of an import cycle. `designSteps(deliver)` exported from `portal/src/agent.js`, returning the numbered adaptation steps as a string (used by `setupPrompt` here and `designPrompt` in Task 6). `render/README.md` section headed exactly `## Adapting a template`. The session C test application is `applications/test-render/`.

- [ ] **Step 1: Write the failing tests**

In `setup/test/run-tests.sh`, after the career-step checks on `$TARGET1` (search for `spine offers career-step interviews later`), add:

```bash
check "SETUP.md links the CV templates" grep -q "https://typst.app/universe/search/?kind=templates&category=cv" "$TARGET1/SETUP.md"
check "SETUP.md offers a design before the test CV" grep -q "pick a design now" "$TARGET1/SETUP.md"
check "SETUP.md offers a design after the test CV" grep -q "happy with the look" "$TARGET1/SETUP.md"
check "SETUP.md names the test application" grep -q "applications/test-render/" "$TARGET1/SETUP.md"
check "project has the design scripts" test -x "$TARGET1/render/fetch-template.py" -a -x "$TARGET1/render/try-design.sh" -a -x "$TARGET1/render/switch-design.sh"
check "project has the design sample" test -f "$TARGET1/render/sample/cv.yaml"
check "render README has the adaptation procedure" grep -q "^## Adapting a template" "$TARGET1/render/README.md"
```

Append to `portal/test/agent.test.js`:

```js
const { DESIGN_CATEGORY_URL } = await import('../src/design-link.js');
const { designSteps } = await import('../src/agent.js');

test('setup session C offers the CV templates before and after the test CV', () => {
  for (const structured of [true, false]) {
    const p = setupPrompt('Sam', { structured });
    assert.ok(p.includes(DESIGN_CATEGORY_URL));
    assert.doesNotMatch(p, /do not offer to browse Typst Universe/);
    assert.match(p, /pick a design now/);
    assert.match(p, /happy with the look/);
    assert.match(p, /switch-design\.sh/);
  }
});

test('the adaptation steps fetch, adapt by the README, switch, then deliver', () => {
  const s = designSteps('the email field');
  for (const needle of ['render/fetch-template.py', 'Adapting a template', 'render/switch-design.sh', 'the email field']) {
    assert.ok(s.includes(needle), needle);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/j4dev && bash setup/test/run-tests.sh 2>&1 | grep -E "FAIL|Passed"; cd portal && npm test 2>&1 | grep -E "^# fail|^not ok"`
Expected: the new setup checks fail; portal fails to import `design-link.js`.

- [ ] **Step 3: Rewrite "Choosing your template" in `template/render/README.md`**

Replace the whole section from `## Choosing your template` up to (not including) `## Hard rules` with:

````markdown
## Choosing your template

Any template in Typst Universe's CV category can be your design, and only
those: https://typst.app/universe/search/?kind=templates&category=cv

Ask your AI assistant for the one you like, by name or by pasting its page
link. It fetches it, adapts it to your content, proves it renders your CV on
one page with a letter that fills its page, and only then switches over. Your
previous design is kept, so you can always go back.

If you already have a designed CV you like, the assistant can replicate it
instead, by **measuring the PDF, not eyeballing renders**: extract the colours,
type sizes and baseline positions programmatically (for example with PyMuPDF)
and match those numbers in the Typst template. Iterating by visual comparison
of screenshots is slow and inaccurate. The result still goes live through
`switch-design.sh` below.

## Adapting a template

The procedure an assistant follows for a chosen template. The content model
never changes: the design is adapted to the yaml, never the yaml to the design.

1. **Fetch.** `render/fetch-template.py <name or link>`. It refuses anything
   outside the CV category and says why; relay that and ask for another pick.
   It unpacks to `render/template-source/<name>-<version>/` and reports the
   licence, whether the template has its own cover letter, and fonts to check.
2. **Build the candidate** in `render/templates-candidate/`, starting from a copy
   of `render/templates/`:
   - `main.typ` takes the template's CV layout and reads the CV yaml exactly as
     the current `main.typ` does (`yaml(sys.inputs.at("config", ...))`, the same
     field names). Sections the content model lacks (photos, language grids)
     are left out or mapped onto existing fields; never add fields.
   - `cover-letter.typ`: if the template has its own letter, adapt that the same
     way. If not, restyle the current letter with the CV's fonts, colours and
     header so the two read as a set. Keep the `<letter-end>` length guard from
     "Hard rules" below.
   - Fonts: bundle any the template needs into `render/fonts/` if their licence
     permits (OFL, Apache, MIT); where an icon font cannot be bundled, drop the
     icons rather than render missing glyphs.
   - Copy the template's licence file in, and write `SOURCE.md`:
     ```
     # Design source
     Package: <name> <version>
     Licence: <licence> (<licence file name>)
     Adopted: <YYYY-MM-DD>
     Changes: <what the adaptation changed: letter matched or restyled, icons dropped, fonts bundled>
     ```
3. **Prove and switch.** `render/switch-design.sh render/templates-candidate`.
   It runs `render/try-design.sh`, which renders the candidate against
   `render/sample/` and your test CV in `applications/test-render/`, and fails
   unless every CV is one page and every letter fills its page. Only then does
   it move the current design to `render/templates-previous/<date>-<name>/`
   and make the candidate live. Fix what it reports and run it again.
4. **If it cannot be made to pass**, delete `render/templates-candidate/`, say
   plainly what went wrong, and offer another pick. The live design is untouched.
5. **Going back:** `render/switch-design.sh render/templates-previous/<folder>`.

Letters already sent never change. Re-renders and new applications use the
live design.
````

Also delete the sentence in the file's opening paragraph that points to the old section ("You can swap it for a Typst Universe template whenever you like: see \"Choosing your template\" below.") and replace it with: `You can change it for any Typst Universe CV template: see "Choosing your template" below.`

- [ ] **Step 4: Rewrite task 10 in `setup/SETUP.md.tmpl`**

Replace task 10 (from `10. The project ships with a default CV` through `` `render/README.md`. ``) with:

```markdown
10. Choose the design and render a test CV. The project ships with a default
    CV and cover letter design in `render/templates/`, and any template in
    Typst Universe's CV category can replace it:
    https://typst.app/universe/search/?kind=templates&category=cv
    - Before rendering, share that link and ask {{USER_NAME}} whether they
      would like to pick a design now or see the default first.
    - Render a test CV from `core/master-cv.md`: copy the skeleton
      `render/templates/configuration.yaml` to `applications/test-render/cv.yaml`,
      fill it from the master CV, and run `render/render.sh test-render`. Check
      it fits one page and show it to {{USER_NAME}}.
    - Then ask whether they are happy with the look or would like to pick
      another from the link.
    A pick at either point follows "Adapting a template" in `render/README.md`,
    then renders the test CV again in the new design.
```

- [ ] **Step 5: Add `DESIGN_CATEGORY_URL`, `designSteps`, and the session C bullet**

Create `portal/src/design-link.js`:

```js
// The one list a person may choose a CV design from (owner decision,
// 2026-09-29). render/fetch-template.py enforces the same rule in code.
// Its own module so agent.js can import it without importing queue.js.
export const DESIGN_CATEGORY_URL = 'https://typst.app/universe/search/?kind=templates&category=cv';
```

In `portal/src/agent.js`, add the import at the top with the other imports:

```js
import { DESIGN_CATEGORY_URL } from './design-link.js';
```

Add, just above `export const setupPrompt`:

```js
// How a chosen CV template becomes the live design, shared by session C and
// the "CV design" conversation. The scripts hold the rules (CV category only,
// proven before switching); render/README.md holds the adaptation itself.
export const designSteps = deliver => `
When they name a template or paste its Typst Universe link:
1. If it is a letter-only template, a national form (a Japanese rirekisho or shokumu keirekisho,
   a Europass CV) or written for a language other than English, say what it is and check they
   mean it before going further.
2. Say that adapting it takes a few minutes and that they can close the window, then carry on in
   the same turn: run render/fetch-template.py with what they gave you. If it refuses, relay the
   reason plainly and ask for another pick.
3. Build the candidate following "Adapting a template" in render/README.md exactly: the yaml
   content model never changes, the letter matches the CV, fonts are bundled only where their
   licence allows, and SOURCE.md records where the design came from.
4. Run render/switch-design.sh render/templates-candidate. It proves the design and only then
   switches. Fix what it reports and run it again. If you cannot make it pass, delete
   render/templates-candidate/, say plainly what went wrong, and offer another pick: the live
   design must never be half-changed.
5. Render the test CV and letter in the new design (render/render.sh test-render, creating
   applications/test-render/ from core/master-cv.md first if it does not exist) and deliver both
   PDFs through ${deliver}.
To go back to an earlier design, run render/switch-design.sh on the folder they want in
render/templates-previous/.`;
```

In `setupPrompt`, replace the session C bullet (the four lines beginning `- Session C: the project already has a working default CV template`) with:

```js
- Session C: before rendering the test CV, share the CV templates link
  (${DESIGN_CATEGORY_URL}) as a markdown link and ask whether they would like to pick a design now
  or see the default first. Render the test CV into applications/test-render/ as SETUP.md says and
  deliver the PDF through ${deliver} so it appears as a download, then ask whether they are happy
  with the look or would like to pick another from the link.
${designSteps(deliver)}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd ~/j4dev && bash setup/test/run-tests.sh 2>&1 | grep -E "FAIL|Passed"; cd portal && npm test 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: `Failed: 0` and `# fail 0`.

- [ ] **Step 7: Commit**

```bash
cd ~/j4dev && git add template/render/README.md setup/SETUP.md.tmpl setup/test/run-tests.sh portal/src/agent.js portal/src/design-link.js portal/test/agent.test.js
git commit -m "Session C offers the CV templates before and after the test CV

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Nn4qZV4LTHywVrTJYFVbup"
```

---

### Task 6: "Change CV design" in the portal

**Files:**
- Create: `portal/src/design-session.js`
- Modify: `portal/src/agent.js` (`designPrompt`, `runAgentTurn`)
- Modify: `portal/src/server.js` (`POST /api/design/start`)
- Modify: `portal/src/queue.js` (fixed titles, no provenance alert)
- Modify: `portal/public/app.js` (cog item)
- Create: `portal/test/design-session.test.js`
- Modify: `portal/test/agent.test.js`, `portal/test/queue.test.js`

**Interfaces:**
- Consumes: `DESIGN_CATEGORY_URL`, `designSteps(deliver)` (Task 5).
- Produces: `findDesignSession(db, email)` → the newest unarchived `kind = 'design'` session row or `undefined`; `startDesignSession(db, email)` → `{ id, created }`, one open design session per person; `DESIGN_OPENING_PROMPT` (string); `designPrompt(userName, { structured })` → system prompt string; `POST /api/design/start` → `200 { id }`, or `409 { error }` while setup is pending.

- [ ] **Step 1: Write the failing tests**

Create `portal/test/design-session.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const projectDir = mkdtempSync(join(tmpdir(), 'proj-'));
process.env.PROJECT_DIR = projectDir;
process.env.DB_PATH = ':memory:';
process.env.PORTAL_USERS_FILE = '/nonexistent-portal-users.json';
process.env.ALLOWED_EMAILS = 'owner@test.com';
process.env.COOKIE_SECRET = 'testsecret';
const { createApp } = await import('../src/server.js');
const { makeCookie } = await import('../src/auth.js');
const { getDb } = await import('../src/db.js');
const { DESIGN_OPENING_PROMPT, DESIGN_CATEGORY_URL } = await import('../src/design-session.js');

const server = createApp({ send: async () => {} }).listen(0);
const base = `http://localhost:${server.address().port}`;
const cookie = `jskit=${makeCookie('owner@test.com')}`;
test.after(() => server.close());
const post = path => fetch(base + path, { method: 'POST', headers: { cookie } });

test('design start is refused while setup is pending', async () => {
  writeFileSync(join(projectDir, 'SETUP.md'), '# Setup incomplete');
  const r = await post('/api/design/start');
  assert.equal(r.status, 409);
  rmSync(join(projectDir, 'SETUP.md'));
});

test('design start opens one CV design conversation with one opening turn, however often pressed', async () => {
  const a = await (await post('/api/design/start')).json();
  const b = await (await post('/api/design/start')).json();
  assert.equal(a.id, b.id);
  const db = getDb();
  const s = db.prepare('select * from sessions where id = ?').get(a.id);
  assert.equal(s.kind, 'design');
  assert.equal(s.title, 'CV design');
  assert.equal(s.status, 'working');
  const jobs = db.prepare('select prompt from jobs where session_id = ?').all(a.id);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].prompt, DESIGN_OPENING_PROMPT);
});

test('an archived design conversation is not reopened', async () => {
  const db = getDb();
  const first = (await (await post('/api/design/start')).json()).id;
  db.prepare('update sessions set archived = 1 where id = ?').run(first);
  const second = (await (await post('/api/design/start')).json()).id;
  assert.notEqual(first, second);
});

test('the opening prompt carries the CV templates link', () => {
  assert.ok(DESIGN_OPENING_PROMPT.includes(DESIGN_CATEGORY_URL));
});
```

Append to `portal/test/agent.test.js`:

```js
const { designPrompt } = await import('../src/agent.js');

test('a design session gets the design prompt, with the link and the steps', async () => {
  let seen = null;
  const runners = { fake: async args => { seen = args; return { sessionId: 's', text: 'x' }; } };
  await runAgentTurn({ prompt: 'hi', user: { name: 'Sam', projectDir: '/tmp' }, kind: 'design' },
    { runners, runnerName: 'fake' });
  assert.equal(seen.systemPrompt, designPrompt('Sam', { structured: false }));
  for (const structured of [true, false]) {
    const p = designPrompt('Sam', { structured });
    assert.ok(p.includes(DESIGN_CATEGORY_URL));
    assert.match(p, /switch-design\.sh/);
    assert.match(p, /CV design/);
  }
});
```

In `portal/test/queue.test.js`, next to the existing session-title tests (search for `title` tests that use `kind`, or add after `a signed-out Claude marks the session signed_out`), add:

```js
test('a design session keeps its title whatever the agent suggests', async () => {
  const sid = mkSession();
  getDb().prepare("update sessions set kind = 'design', title = 'CV design' where id = ?").run(sid);
  enqueue({ sessionId: sid, prompt: 'x' });
  await processOneJob({
    runTurn: async () => ({ sessionId: 'c-d', structured: { reply: 'Done.', title: 'Brilliant CV', awaiting_user: false, email: null }, text: '' }),
    send: async () => {},
  });
  assert.equal(getDb().prepare('select title from sessions where id = ?').get(sid).title, 'CV design');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/j4dev/portal && npm test 2>&1 | grep -E "^# fail|^not ok"`
Expected: failures in `design-session.test.js` (404 from the missing route, missing exports), `agent.test.js` (no `designPrompt`) and the queue title test.

- [ ] **Step 3: Implement `design-session.js`**

Create `portal/src/design-session.js`:

```js
import { newId } from './db.js';
import { enqueue } from './queue.js';
import { DESIGN_CATEGORY_URL } from './design-link.js';

export { DESIGN_CATEGORY_URL };

export const DESIGN_OPENING_PROMPT = 'The person has opened "Change CV design" from the menu. '
  + 'Tell them which design they are using now (from render/templates/SOURCE.md), share the CV templates '
  + `link (${DESIGN_CATEGORY_URL}) as a markdown link, mention that an earlier design can be restored if `
  + 'render/templates-previous/ holds one, and ask which template they would like.';

export function findDesignSession(db, email) {
  return db.prepare(`select * from sessions where user_email = ? and kind = 'design' and archived = 0
    order by created_at desc limit 1`).get(email);
}

// One open CV design conversation per person: pressing the menu item again
// reopens it rather than starting a second adaptation in parallel.
export function startDesignSession(db, email) {
  return db.transaction(() => {
    const existing = findDesignSession(db, email);
    if (existing) return { id: existing.id, created: false };
    const id = newId();
    db.prepare("insert into sessions (id, user_email, title, status, kind) values (?, ?, 'CV design', 'working', 'design')")
      .run(id, email);
    enqueue({ sessionId: id, prompt: DESIGN_OPENING_PROMPT });
    return { id, created: true };
  })();
}
```

- [ ] **Step 4: Implement `designPrompt` and the dispatch in `agent.js`**

Add after `setupPrompt`:

```js
export const designPrompt = (userName, { structured = false } = {}) => {
  const protocol = structured ? structuredProtocol(userName, false) : fencedProtocol(userName);
  const deliver = structured ? 'the email field' : 'an email-to-user block';
  return `
You are helping ${userName} choose the design of their CV and cover letter, in the ${config.portalTitle}
web app. The person you are talking to IS ${userName}. Address them directly, warmly and plainly, in
British English, with no dashes as punctuation, unless the project's own notes say otherwise.

The choice is any template in Typst Universe's CV category, and nothing else:
${DESIGN_CATEGORY_URL}
Share it as a markdown link. render/fetch-template.py refuses anything outside it.

This is a chat window, not a terminal: ask one question per turn, say so with awaiting_user when a
question is outstanding, and keep each turn short enough to read comfortably on a phone.
${designSteps(deliver)}

Never set a session title: this conversation is always called "CV design", so leave
"title" ${structured ? 'null' : 'out of the session-title block'}.

${protocol}

Never invent facts about ${userName}. Never apply to anything. Never email anyone except via ${deliver}.
`;
};
```

In `runAgentTurn`, replace the `systemPrompt` assignment with:

```js
  const systemPrompt = kind === 'setup'
    ? setupPrompt(user.name, { structured })
    : kind === 'design'
      ? designPrompt(user.name, { structured })
      : portalPrompt(user.name, { structured, drafting: draftingEnabled({ subscriptions, runnerName }) });
```

- [ ] **Step 5: Add the route in `server.js`**

Add the import beside the setup-session import:

```js
import { startDesignSession } from './design-session.js';
```

Add after the `/api/setup/start` route:

```js
  // "Change CV design" in the cog menu. While setup is pending, session C
  // covers the choice, so the menu item is hidden and this refuses.
  app.post('/api/design/start', requireAuth, (req, res) => {
    if (setupPending(getUser(req.userEmail)?.projectDir)) {
      return res.status(409).json({ error: 'finish Getting started first' });
    }
    res.json({ id: startDesignSession(getDb(), req.userEmail).id });
  });
```

- [ ] **Step 6: Fixed titles and no provenance alert in `queue.js`**

Near the top of `queue.js` add:

```js
// Conversations whose title is fixed by the portal, and which render test
// documents rather than applications, so they never trip the provenance alert.
const FIXED_KINDS = new Set(['setup', 'design']);
```

Change `if (newTitle && session.kind !== 'setup') {` to `if (newTitle && !FIXED_KINDS.has(session.kind)) {`, and change `const unproven = drafting && session.kind !== 'setup' ? ...` to `const unproven = drafting && !FIXED_KINDS.has(session.kind) ? ...`. Update the comment above the latter from "Setup sessions never draft through ChatGPT either" to "Setup and design sessions never draft through ChatGPT either".

- [ ] **Step 7: The cog menu item in `app.js`**

In `renderList`, change the cog handler to:

```js
  document.getElementById('cog').onclick = () => openSheet([
    { label: 'View archived applications', run: () => { location.hash = 'archived'; } },
    // Session C offers the design while setup is pending, so this waits until after.
    ...(setup.pending ? [] : [{ label: 'Change CV design', run: async () => {
      const r = await api('/design/start', { method: 'POST' });
      if (r.ok) location.hash = (await r.json()).id;
    } }]),
    ...(LOCAL ? [{ label: 'Quit Jawbs', run: quitJawbs }] : []),
  ]);
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd ~/j4dev/portal && npm test 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: `# fail 0`.

- [ ] **Step 9: Check the page in a browser**

Start a scratch portal from `~/j4dev/portal` on a spare port with a project whose `SETUP.md` is absent (the recipe in the memory note `j4-dev-environment-hazards`: `EXPOSURE=local`, `BIND_HOST=127.0.0.1`, `PORT=59731`, `BASE_URL=http://localhost:59731`, `EMAIL_PROVIDER=log`, `AGENT_RUNNER=cli AGENT_CMD=false`, scratch `DB_PATH` and `PORTAL_USERS_FILE`), then drive it with Playwright's cached Chromium from a `.cjs` script requiring `/home/spacetimejam/shareverified/node_modules/playwright`: open `/#`, click `#cog`, confirm the sheet lists "Change CV design", click it, confirm the hash changes to a session titled "CV design". Then create `SETUP.md` in the project, reload, open the cog, and confirm the item is absent. Stop the server by the PID from `ss -ltnp` on port 59731, never `pkill -f`.

- [ ] **Step 10: Commit**

```bash
cd ~/j4dev && git add portal/src portal/public/app.js portal/test
git commit -m "Portal: Change CV design opens a CV design conversation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Nn4qZV4LTHywVrTJYFVbup"
```

---

### Task 7: Docs, the key decision, and one live run

**Files:**
- Modify: `CLAUDE.md` (key decisions)
- Modify: `docs/portal.md`

- [ ] **Step 1: Record the decision in `CLAUDE.md`**

Replace the last sentence of the "Intake can run in the portal" bullet ("...so session C renders without a template choice; choosing a Typst Universe design stays a terminal task.") with "...so session C renders without a template choice." Then add a new bullet after it:

```markdown
- **CV designs come from Typst Universe's CV category, and only there.** Session C offers the category link (https://typst.app/universe/search/?kind=templates&category=cv) before and after the test CV in `applications/test-render/`, and after setup the cog menu's "Change CV design" opens a `kind = 'design'` session ("CV design", one open per person, `designPrompt`). Three project scripts hold the rules so a prompt cannot bend them: `render/fetch-template.py` refuses anything that is not a template in the `cv` category, `render/try-design.sh` proves a candidate against `render/sample/` and the test CV (CV one page, letter passes its own fill guard) without touching live files, and `render/switch-design.sh` switches only after that, keeping the old design in `render/templates-previous/`. The yaml content model never changes, so ChatGPT drafting and existing applications keep working; the letter matches the CV where it can. The adaptation procedure lives once, in `template/render/README.md` "Adapting a template" (owner decision, 2026-09-29). Spec: `docs/superpowers/specs/2026-09-29-cv-design-picker-design.md`.
```

- [ ] **Step 2: Mention it in `docs/portal.md`**

After the paragraph that begins "Jawbs opens on a conversation called Getting started", add:

```markdown
In Getting started, Jawbs offers a link to Typst Universe's CV templates
before and after it renders your test CV: name any template there, or paste
its link, and Jawbs adapts it to your CV and cover letter, checks it still
fits one page, and switches over. After setup, "Change CV design" in the cog
menu does the same, and can put an earlier design back.
```

- [ ] **Step 3: Run both suites**

Run: `cd ~/j4dev && bash setup/test/run-tests.sh 2>&1 | tail -1; cd portal && npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: `Failed: 0`, `# fail 0`.

- [ ] **Step 4: One live adaptation in a scratch project**

Create a scratch project with `setup/setup.sh --answers setup/test/answers.env --target <scratch> --skip-deps` (set `PORTAL_REGISTRY` to a scratch path). In that folder, start Claude Code (`claude`) and ask it to follow `render/README.md` "Adapting a template" for `brilliant-cv` (ships a letter), then separately for a CV-only template such as `modern-cv`. For each: confirm `switch-design.sh` reported `Now using:`, open the rendered sample PDFs (from a `render/render.sh test-render` after copying `render/sample/*.yaml` into `applications/test-render/`), and check by eye that the CV is one page and the letter looks like a set with it. Record the outcome, including anything the procedure left the agent guessing about, and fix the README wording if it did.

- [ ] **Step 5: Commit**

```bash
cd ~/j4dev && git add CLAUDE.md docs/portal.md template/render/README.md
git commit -m "Docs: CV designs from Typst Universe's CV category

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Nn4qZV4LTHywVrTJYFVbup"
```
