// Cover letter - shares the CV's identity: the letterhead from lib.typ and the
// same body font. Content lives in a per-role cover-letter.yaml; render with
//   typst compile --input config=/applications/<slug>/cover-letter.yaml render/templates/cover-letter.typ <out.pdf>

#import "lib.typ": letterhead, accent-default, ink

#let cfg = yaml(sys.inputs.at("config", default: "/render/templates/cover-letter.yaml"))

#let theme = cfg.at("theme", default: (:))
#let accent = rgb(theme.at("accent", default: accent-default.to-hex()))
#let body-font = theme.at("body_font", default: "Inter")

#let links = {
  let l = ()
  if "phone" in cfg.contacts { l.push((label: "Phone", link: "tel:" + cfg.contacts.phone.replace(" ", ""), display: cfg.contacts.phone)) }
  if "email" in cfg.contacts { l.push((label: "Email", link: "mailto:" + cfg.contacts.email, display: cfg.contacts.email)) }
  if "website" in cfg.contacts { l.push((label: "Web", link: cfg.contacts.website.url, display: cfg.contacts.website.displayText)) }
  if "linkedin" in cfg.contacts { l.push((label: "LinkedIn", link: cfg.contacts.linkedin.url, display: cfg.contacts.linkedin.displayText)) }
  if "location" in cfg.contacts { l.push((label: "Location", display: cfg.contacts.location)) }
  l
}

#let role-part = if "role" in cfg { " - " + cfg.role } else { "" }
#set document(title: "Cover Letter - " + cfg.contacts.name + role-part, author: cfg.contacts.name)
#set text(9.5pt, font: body-font, fill: ink, weight: 400)
#set page(margin: (x: 0.8cm, top: 0.75cm, bottom: 1.2cm))
#set par(justify: false, leading: 0.8em, spacing: 1.6em)

// Letterhead identical to the CV's.
#letterhead(cfg.contacts.name, cfg.position, links, accent: accent)

// The letter body sits on a narrower measure than the full-width letterhead.
#pad(x: 1.1cm, top: 6pt)[
  #align(right)[#text(weight: 600, fill: accent)[#cfg.date]]

  #if "recipient" in cfg [ #cfg.recipient #parbreak() ]

  #if "subject" in cfg { text(weight: 700)[#cfg.subject]; parbreak() }

  #cfg.greeting

  #for p in cfg.paragraphs {
    par[#p]
  }

  #v(4pt)
  #cfg.signoff \
  #text(weight: 700)[#cfg.contacts.name]
]
