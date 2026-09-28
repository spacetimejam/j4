// Layout helpers for the kit's default CV and cover letter. Derived from
// @preview/vantage-cv:1.0.0 (see VANTAGE-LICENSE), vendored so rendering needs
// no network. Fonts default to ones bundled with Typst itself, so nothing has
// to be installed; override them in the yaml `theme:` block.

#let default-accent = rgb("#2b4c6f")
#let default-body-font = "New Computer Modern"
#let default-heading-font = "Libertinus Serif"

// Theme dials from a loaded yaml, with the defaults above.
#let theme-of(cfg) = {
  let t = cfg.at("theme", default: (:))
  if t == none { t = (:) }
  (
    accent: rgb(t.at("accent", default: default-accent.to-hex())),
    body-font: t.at("body_font", default: default-body-font),
    heading-font: t.at("heading_font", default: default-heading-font),
  )
}

// Contact row built only from the fields actually present, so nothing is
// invented. Links are real links; location is plain text.
#let contact-row(contacts) = {
  let parts = ()
  if "email" in contacts and contacts.email != "" { parts.push(link("mailto:" + contacts.email, contacts.email)) }
  if "phone" in contacts and contacts.phone != "" { parts.push(contacts.phone) }
  if "location" in contacts and contacts.location != "" { parts.push(contacts.location) }
  if "website" in contacts { parts.push(link(contacts.website.url, contacts.website.displayText)) }
  if "linkedin" in contacts { parts.push(link(contacts.linkedin.url, contacts.linkedin.displayText)) }
  text(8.5pt, parts.join(h(6pt) + sym.dot.c + h(6pt)))
}

#let cv-page(name: "", position: "", contacts: (:), role: "", theme: (:), left-side, right-side) = {
  set document(title: "CV - " + name + if role != "" { " - " + role } else { "" }, author: name)
  set text(9.8pt, font: theme.body-font, lang: "en", region: "gb")
  set page(paper: "a4", margin: (x: 1.2cm, y: 1.2cm))
  set list(tight: false, spacing: 1.1em)

  show heading.where(level: 2): it => block(above: 1.1em, below: 0.6em, text(
    fill: theme.accent, font: theme.heading-font, weight: "semibold", size: 11pt,
    [#it.body #v(-7pt) #line(length: 100%, stroke: 0.5pt + theme.accent)],
  ))
  show heading.where(level: 3): it => text(weight: "bold", it.body)

  text(20pt, font: theme.heading-font, weight: "bold")[#name]
  v(-6pt)
  text(12pt, fill: luma(60))[#position]
  v(2pt)
  contact-row(contacts)
  v(0.9em)

  grid(columns: (7fr, 4fr), column-gutter: 2em, left-side, right-side)
}
