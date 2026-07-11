# Render pipeline

Typst rendering for send-ready CV and cover letter PDFs. The kit deliberately
does not ship a finished CV design: you choose a Typst template yourself (see
"Choosing your template" below), vendor it into `render/templates/`, and adapt it with
your AI assistant to read the yaml content model described here. The design is
yours; the content model and the hard rules stay the same regardless of which
template you pick.

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

Until you have set up a template, `render.sh` will stop with a message pointing
back here: it expects `templates/main.typ` (the CV) and
`templates/cover-letter.typ` (the letter) to exist.

## Choosing your template

1. **Browse Typst Universe** at https://typst.app/universe and search its CV
   templates; any of the currently popular CV packages is a fine starting
   point. Pick a design you would be happy to send.
2. **Vendor it into `render/templates/`.** Copy the template's source files in (do not
   rely on a package import that can change under you), and keep its licence
   file alongside the source.
3. **Adapt it to the content model.** With your AI assistant, rework the
   template so it is driven by the yaml schema below: an entry file
   `templates/main.typ` for the CV and `templates/cover-letter.typ` for the
   letter, each reading its yaml via `sys.inputs.config` (that is how
   `render.sh` passes the per-role file in).
4. **Bundle fonts.** Any fonts the template needs go in `render/fonts/`
   (bundle only fonts whose licence permits it, e.g. OFL). `render.sh` and
   `build.sh` pass this directory to Typst as the font path.
5. **Verify** with a real render of a dummy application slug before using it
   in anger.

If you already have a designed CV you like, the assistant should replicate it
by **measuring the PDF, not eyeballing renders**: extract the colours, type
sizes and baseline positions programmatically (for example with PyMuPDF) and
match those numbers in the Typst template. Iterating by visual comparison of
screenshots is slow and inaccurate.

## Hard rules

- **One page.** Each document must fit a single A4 page. If content overflows,
  cut or tighten the content; do not shrink the type or margins to force a fit.
- **Nothing invented.** Every line in a yaml must trace back to the owner's
  real material (master CV, stories bank, their own words). The skeleton
  content in `templates/*.yaml` is obviously fictional filler for layout
  proofing; replace it, never send it.
- **Sent files are the record.** Once a PDF has been sent, its yaml is
  immutable; re-tailoring creates new files.

## Yaml schema (the content model)

Both documents share `theme{}`, `contacts{}`, `position` and `role`. Your
template defines what the `theme:` block accepts (accent colour, fonts, and so
on); keep it as the single place where per-role visual overrides live.

`configuration.yaml` (the CV):

```yaml
theme: {}                 # optional per-role overrides, defined by your template
contacts:
  name: ...
  phone: ...              # each contact field is optional; only present
  email: ...              # fields are rendered, as plain labelled lines
  location: ...
  website:   { url: ..., displayText: ... }
  linkedin:  { url: ..., displayText: ... }
position: ...             # headline under the name
role: ...                 # the job applied for; PDF title and filename
about: [ ... ]            # short paragraphs
key_skills: [ ... ]       # bullet list
education:
  - { qualification: ..., course: ..., institution: ..., dates: ... }
jobs:                     # newest first
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
