// The kit's default cover letter, sharing the CV's letterhead and theme.
// Content lives in a per-role cover-letter.yaml.
#import "lib.typ": contact-row, theme-of

#let cfg = yaml(sys.inputs.at("config", default: "/render/templates/cover-letter.yaml"))
#let theme = theme-of(cfg)

#let role-part = if "role" in cfg { " - " + cfg.role } else { "" }
#set document(title: "Cover Letter - " + cfg.contacts.name + role-part, author: cfg.contacts.name)
#set text(10.5pt, font: theme.body-font, lang: "en", region: "gb")
#set page(paper: "a4", margin: (x: 1.9cm, y: 1.4cm))
#set par(justify: false, leading: 0.95em, spacing: 1.85em)

#stack(
  spacing: 18pt,
  text(20pt, font: theme.heading-font, weight: "bold")[#cfg.contacts.name],
  contact-row(cfg.contacts),
  line(length: 100%, stroke: 0.5pt + theme.accent),
)

#v(14pt)
#align(right)[#emph(str(cfg.date))]
#parbreak()
#if "recipient" in cfg [ #cfg.recipient #parbreak() ]
#if "subject" in cfg { text(weight: "bold")[#cfg.subject]; parbreak() }
#cfg.greeting
#parbreak()
#for p in cfg.paragraphs { p; parbreak() }
#v(4pt)
#cfg.signoff
#linebreak()
#cfg.contacts.name

// Length guard (render/README.md, "Cover letters fill the page"): a letter
// must end at least 66% of the way down and should reach 75%. render.sh reads
// the marker back and reports the fill after every render.
#context [
  #metadata((
    page: here().position().page,
    fill-pct: calc.round(here().position().y / 297mm * 100, digits: 1),
  )) <letter-end>
]
#context {
  let pos = query(<letter-end>).last().location().position()
  if pos.page == 1 and pos.y < 297mm * 0.66 {
    panic("cover letter too short: it ends " + repr(calc.round(pos.y / 297mm * 100, digits: 1))
      + "% down the page. It must reach at least 66% (aim for 75%). Extend or add paragraphs in cover-letter.yaml.")
  }
}
