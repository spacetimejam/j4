# CV design picker: any Typst Universe CV template, chosen in Jawbs

Date: 2026-09-29. Status: design approved in conversation, awaiting spec review.

## Intent

Every project ships with one CV and letter design (derived from vantage-cv).
Changing it is a terminal-only task today: `render/README.md` "Choosing your
template" walks a person and Claude Code through vendoring a Typst Universe
template by hand, and the portal's `setupPrompt` says outright "do not offer to
browse Typst Universe here".

The owner wants the person to choose their own design from Typst Universe's CV
templates, with Jawbs sharing the link and doing the work.

Agreed in conversation:

1. **The choice is exactly the Typst Universe CV template category**,
   https://typst.app/universe/search/?kind=templates&category=cv (88 templates
   on 2026-09-29), and nothing outside it. Not a curated shortlist, and not
   Universe at large.
2. **Offered twice inside setup, both in session C**: before the test CV is
   built (pick now, or see the default first), and straight after it is built
   (happy with it, or pick another). SETUP.md is shared by the portal and
   terminal sessions, so both get this.
3. **And any time after setup** from a "Change CV design" item in the portal's
   cog menu, which opens its own conversation.
4. **The cover letter matches where it can**: the template's own letter if it
   ships one, otherwise Jawbs' default letter restyled with the CV's fonts,
   colours and header.

Success: in Getting started, someone clicks the link, browses the CV category,
types "brilliant-cv" (or pastes its Universe page), waits a few minutes, and
receives a test CV and letter in that design, each one A4 page, with the letter
filling at least three quarters of it. Every later application renders in that
design. A template outside the CV category is refused with a clear reason.
Asking to go back restores the previous design.

## What the category contains

From the package index (`https://packages.typst.org/preview/index.json`,
entries with `template` set and `"cv"` in `categories`), on 2026-09-29:

- **Licences**: mostly MIT, MIT-0, Unlicense and Apache-2.0; a few GPL-3.0,
  AGPL-3.0, MPL-2.0 or LPPL. Vendoring any of them into a person's own project
  to produce their own PDFs is fine; the licence file travels with the source.
- **Not all are CVs for a general job search**: letter-only templates
  (`modernpro-coverletter`, `aspirationally`), national forms
  (`hadronic-rirekisho`, `rirekisho-ofa`, `rasko-europass`), and templates
  written for Chinese. These stay choosable (they are in the category) but are
  confirmed with the person first.
- **Most are CV only.** A minority ship a matching letter (`brilliant-cv`,
  `grotesk-cv`, `coral-cv`, `toy-cv`, `polycv`, `chuli-cv` and others).
- **Many expect fonts Typst does not bundle**, commonly Font Awesome.
- **Each reads content its own way**: YAML, JSON Resume, or content written in
  Typst directly.

## Design

### 1. The content model does not change

Every design reads the project's existing yaml: `render/templates/configuration.yaml`
defines the CV fields, each application's `cv.yaml` and `cover-letter.yaml`
fill them, and `render.sh` passes the file in via `sys.inputs.config`. A new
design is adapted to that model, never the reverse. This keeps:

- every existing application's yaml valid, so re-renders need no data changes;
- ChatGPT drafting working, since `bin/chatgpt-draft` returns CV sections named
  after the fields in `configuration.yaml`;
- the hard rules in `render/README.md` (one page, letter fill) enforceable the
  same way for every design.

If a template's layout has a section the content model lacks (a photo, a
languages grid), the adaptation leaves it out or maps it onto an existing
field. It does not add fields.

### 2. Fetching: `render/fetch-template.py <name-or-url>`

A new script in the project template, Python 3 standard library only (the
render pipeline already needs Python 3), so no `curl` dependency.

1. Accepts a package name (`brilliant-cv`, optionally `brilliant-cv:4.1.0`)
   or a Universe page URL (`https://typst.app/universe/package/brilliant-cv`),
   and extracts the name.
2. Reads the package index and **refuses anything that is not a template in
   the `cv` category**, printing why. This is where the "only that list" rule
   lives, in code rather than only in a prompt.
3. Downloads the latest version (or the one named) from
   `https://packages.typst.org/preview/<name>-<version>.tar.gz` and unpacks it
   to `render/template-source/<name>-<version>/`, refusing archive members that
   would land outside that folder.
4. Prints a short report: name, version, licence, whether the package ships a
   letter (a file or entrypoint whose name mentions letter), and any font
   families its source references that neither Typst nor `render/fonts/`
   provides.

Exit status is non-zero on refusal or download failure, with the reason on
stderr, so the agent can relay it plainly.

### 3. Adapting and proving: `render/try-design.sh <candidate-dir>`

Claude builds the candidate in `render/templates-candidate/`: `main.typ` and
`cover-letter.typ` reading the yaml as today, the template's own letter if it
ships one or else the default letter restyled with the CV's fonts, colours and
header, any fonts the licence allows bundled into `render/fonts/`, icons dropped
where their font cannot be bundled, and the `<letter-end>` marker check from
`render/README.md` kept in the letter.

`try-design.sh` renders the candidate against two inputs and fails unless both
pass:

- a **shipped sample** in `render/sample/` (a fictional person, realistic
  length: a full CV and a four-paragraph letter), so every design is proven
  against the same content;
- the **person's own test application** from session C, when it exists.

Pass means: the CV is exactly one page and the letter compiles (its own marker
check already fails a letter that is under 66% of the page or over one page).
Pages are counted by compiling to PNG with a `{p}` output pattern and counting
the files, which needs nothing beyond Typst itself.
To support this, `render.sh` gains two environment overrides,
`JAWBS_TEMPLATES_DIR` and `JAWBS_OUT_DIR`, so a candidate renders into a scratch
folder without touching the live design or the application folder.

### 4. Switching

Only after `try-design.sh` passes:

1. The current `render/templates/` moves to
   `render/templates-previous/<YYYY-MM-DD>-<design>/`.
2. The candidate becomes `render/templates/`.
3. `render/templates/SOURCE.md` records the package, version, licence, date
   adopted, and what the adaptation changed (letter matched or restyled, icons
   dropped, fonts bundled). The template's licence file sits beside it.

**Going back**: asked to restore a previous design, the agent moves the current
one aside the same way and restores the chosen folder from
`render/templates-previous/`.

**What changes for existing work**: already-sent PDFs never change (they are
the immutable record). Re-renders and new applications use the new design.

**Failure**: if the candidate cannot be made to pass, the live design stays
exactly as it was, the candidate folder is removed, and the agent says plainly
what went wrong and offers another pick. Nothing is half-switched.

### 5. Where the person is offered it

**Setup, session C** (task 10 in `SETUP.md.tmpl`, which both the portal and
terminal sessions follow):

- *Before the test CV*: share the category link and ask whether they would like
  to pick a design now or see Jawbs' default first.
- *After the test CV*: deliver the PDF, then ask whether they are happy with the
  look or would like to pick another from the link.

A pick at either point runs sections 2 to 4, then renders the test CV in the new
design. `setupPrompt` drops "do not offer to browse Typst Universe here" and
gains the flow; `render/README.md` "Choosing your template" is rewritten around
the two scripts, keeping the "measure the PDF, not eyeball renders" advice for
someone replicating their existing CV instead.

**After setup, the cog menu**: a "Change CV design" item on the main page. It
opens (or reopens, if one exists and is not archived) a session with
`kind = 'design'`, titled "CV design", via `POST /api/design/start`, mirroring
`/api/setup/start`. The title has no " at ", so `stageFor` never matches it to a
tracker row. The session runs with a new `designPrompt` in `agent.js` (the same
shape as `setupPrompt`: chat-window rules, the protocol, and this flow). Its
opening turn shares the link, names the current design from `SOURCE.md`, and
mentions that earlier designs can be restored. The item is hidden while setup is
pending, since session C covers it then.

**Picking**: the person types a name or pastes a Universe link. For a letter-only
template or a national form, the agent says what it is and checks they mean it
before fetching. Before starting, it says that adapting takes a few minutes and
that they can close the window; the existing `working` state covers the wait.

### 6. Failure handling in the portal

The design session uses the existing machinery: a usage limit or signed-out
Claude shows the existing notices with Retry. A fetch refusal or an adaptation
that cannot pass is not an error state: the agent replies normally with the
reason and asks for another pick.

## Out of scope

- A gallery or previews inside Jawbs. The link goes to Universe, which has them.
- Templates outside the CV category, or from outside Typst Universe.
- Adding fields to the content model to suit a template (photos, language grids).
- A separate letter picker.
- Offering design changes during an application's CV review.

## Testing

- `fetch-template.py`: unit tests against a fixture index and fixture tarballs
  (no network): accepts a CV template by name, by name and version, and by
  Universe URL; refuses a non-template package, a template outside `cv`, and an
  unknown name; refuses a tarball member that escapes the target folder; reports
  licence, letter presence and missing fonts.
- `try-design.sh` and the `render.sh` overrides: the default design passes
  against the sample; a deliberately two-page candidate fails; a failing
  candidate leaves `render/templates/` byte-identical. Skipped with a note when
  Typst is not installed.
- Setup tests: the new scripts and `render/sample/` are copied into a new
  project; SETUP.md task 10 contains the category link and both offers.
- Portal: `POST /api/design/start` creates one design session and returns the
  same one on a second call; it is refused while setup is pending; a design
  session gets `designPrompt`; the cog menu shows the item only once setup is
  done; `setupPrompt` no longer forbids Universe and contains the link.
- One live run before calling it done: pick a CV-only template and a template
  with its own letter, in a scratch project, and check both PDFs by eye and by
  the page checks.
