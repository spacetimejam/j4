# Render pipeline

Typst rendering for send-ready CV and cover letter PDFs. Layout is derived from
the cobalt-cv Typst template (MIT, see `templates/COBALT-LICENSE`), restyled to
a neutral single-page design: name and position letterhead, tinted sidebar
(About / Key skills / Education), main experience column. The bundled font is
Inter (SIL Open Font License).

## Usage

Install Typst once (Linux):

```bash
render/install-typst.sh    # puts a static binary in ~/.local/bin
```

On macOS: `brew install typst`.

Render an application's documents:

```bash
render/render.sh <role-slug>
```

This reads `applications/<slug>/cv.yaml` and `applications/<slug>/cover-letter.yaml`
and writes, alongside them:

- `CV - <Name> - <Role>.pdf`
- `Cover Letter - <Name> - <Role>.pdf`

Name comes from `contacts.name`, Role from the top-level `role:` field. A
missing yaml is skipped with a note, so you can render a CV before the letter
is drafted.

`render/build.sh <input.typ> [output.pdf]` compiles any Typst file with the
bundled fonts, for one-off proofs.

## Hard rules

- **One page.** Each document must fit a single A4 page. If content overflows,
  cut or tighten the content; do not shrink the type or margins to force a fit.
- **Nothing invented.** Every line in a yaml must trace back to the owner's
  real material (master CV, stories bank, their own words). The skeleton
  content in `templates/*.yaml` is obviously fictional filler for layout
  proofing; replace it, never send it.
- **Sent files are the record.** Once a PDF has been sent, its yaml is
  immutable; re-tailoring creates new files.

## Theme dials

Defaults are a teal accent (`#2b6777`), a pale sidebar (`#f2f5f5`) and Inter.
Override any of them per role in the yaml `theme:` block:

```yaml
theme:
  accent: "#7c3aed"
  sidebar_fill: "#f5f3ff"
  body_font: "Inter"
```

An alternative `body_font` must be available to Typst; drop the .ttf into
`render/fonts/` (bundle only fonts whose licence permits it, e.g. OFL).

## Yaml schema

Both documents share `theme{}`, `contacts{}`, `position` and `role`.

`configuration.yaml` (the CV):

```yaml
theme: {}                 # optional overrides, see above
contacts:
  name: ...
  phone: ...              # each contact field is optional; only present
  email: ...              # fields are rendered, as plain labelled lines
  location: ...
  website:   { url: ..., displayText: ... }
  linkedin:  { url: ..., displayText: ... }
position: ...             # headline under the name in the letterhead
role: ...                 # the job applied for; PDF title and filename
about: [ ... ]            # sidebar paragraphs
key_skills: [ ... ]       # sidebar bullet list
education:                # sidebar entries
  - { qualification: ..., course: ..., institution: ..., dates: ... }
jobs:                     # main column, newest first
  - position: ...
    company: ...
    from: ...
    to: ...
    intro: ...            # one-line bold summary
    description: [ ... ]  # bullets
```

`cover-letter.yaml` adds: `date`, optional `recipient` (multi-line), optional
`subject`, `greeting`, `paragraphs[]`, `signoff`.

The `{{USER_NAME}}`, `{{USER_EMAIL}}`, `{{USER_PHONE}}` and `{{USER_LOCATION}}`
placeholders in the skeleton `contacts{}` blocks are filled in by the setup
wizard; a yaml still containing them will not render sensibly, so substitute
them first.
