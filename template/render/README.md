# Render pipeline

Typst rendering for send-ready CV and cover letter PDFs. A default design is
included in `render/templates/` (derived from the MIT-licensed vantage-cv
layout, using fonts that ship with Typst), so rendering works as soon as
Typst is installed. You can change it for any Typst Universe CV template: see "Choosing your template" below. The content model and the hard
rules stay the same whichever template you use.

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

If a template file goes missing, `render.sh` will stop with a message pointing
back here: it expects `templates/main.typ` (the CV) and
`templates/cover-letter.typ` (the letter) to exist.

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
   - Paper is A4 whatever the template's default, since the Hard rules count
     A4 pages.
   - Fonts: bundle any the template needs into `render/fonts/` if their licence
     permits (OFL, Apache, MIT); variable fonts are fine. Check every `#import`
     in the template: the candidate must compile offline, so drop another
     package's features (usually icons) rather than vendor the package.
     Contacts are plain lines; never render missing glyphs.
   - Mapping is by meaning, not by adding fields: the yaml `position` goes in
     the template's headline or quote slot (a plain line under the name if it
     has none), key skills become tags or a plain list, and a multi-line
     `recipient` splits into name then address. Keep the current section
     order rather than the template's. Leave
     out photos, logos, and anything hidden from the reader (invisible keyword
     or prompt text aimed at screening software).
   - `theme:` keys (`accent`, `body_font`, `heading_font`) must keep working,
     so existing yamls render.
   - Aim for the 75% letter fill with the design itself (spacing, margins the
     template already uses), not by shrinking type.
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
   and make the candidate live. Fix what it reports and run it again. The
   script checks page count and fill only, so before switching, render the
   candidate and look at it: every yaml field should appear where a reader
   expects it.
4. **If it cannot be made to pass**, delete `render/templates-candidate/`, say
   plainly what went wrong, and offer another pick. The live design is untouched.
5. **Going back:** `render/switch-design.sh render/templates-previous/<folder>`.

Letters already sent never change. Re-renders and new applications use the
live design.

## Hard rules

- **One page.** Each document must fit a single A4 page. If content overflows,
  cut or tighten the content; do not shrink the type or margins to force a fit.
- **Cover letters fill the page.** As rendered, a letter must end at least three
  quarters of the way down the page; below 66% of the page it must not ship, and
  it must not run to a second page either. Enforce this in your vendored
  `cover-letter.typ` by emitting a `<letter-end>` marker after the sign-off and
  panicking below 66% or past page one:

  ```typst
  #context [
    #metadata((
      page: here().position().page,
      fill-pct: calc.round(here().position().y / 297mm * 100, digits: 1),
    )) <letter-end>
  ]
  #context {
    let pos = locate(<letter-end>).position()
    if pos.page == 1 and pos.y < 297mm * 0.66 {
      panic("cover letter too short: it must reach at least 66% of the page (aim for 75%).")
    }
    if pos.page > 1 {
      panic("cover letter too long: it runs to " + str(pos.page) + " pages. It must fit one A4 page.")
    }
  }
  ```

  `render.sh` reads the marker back after each render, prints the page-fill
  percentage and warns below the 75% target (it skips the check, with a note,
  if the template has no marker).
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
