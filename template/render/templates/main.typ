// CV entry point. Layout derived from @preview/cobalt-cv:0.1.0 (see
// COBALT-LICENSE). Presentation lives in lib.typ; content lives in a per-role
// configuration.yaml.
//
// Config path is selectable at render time:
//   typst compile --input config=/applications/<slug>/cv.yaml
// Paths are repo-root-relative (render.sh sets --root). Defaults to the skeleton.

#import "lib.typ": cv, experience, section, accent-default, sidebar-default, hairline

#let cfg = yaml(sys.inputs.at("config", default: "/render/templates/configuration.yaml"))

// Theme dials, read from the yaml theme: block; neutral defaults from lib.typ.
#let theme = cfg.at("theme", default: (:))
#let accent = rgb(theme.at("accent", default: accent-default.to-hex()))
#let sidebar-fill = rgb(theme.at("sidebar_fill", default: sidebar-default.to-hex()))
#let body-font = theme.at("body_font", default: "Inter")

// Build the contact rows from whatever fields are present (no fabricated handles).
#let links = {
  let l = ()
  if "phone" in cfg.contacts { l.push((label: "Phone", link: "tel:" + cfg.contacts.phone.replace(" ", ""), display: cfg.contacts.phone)) }
  if "email" in cfg.contacts { l.push((label: "Email", link: "mailto:" + cfg.contacts.email, display: cfg.contacts.email)) }
  if "website" in cfg.contacts { l.push((label: "Web", link: cfg.contacts.website.url, display: cfg.contacts.website.displayText)) }
  if "linkedin" in cfg.contacts { l.push((label: "LinkedIn", link: cfg.contacts.linkedin.url, display: cfg.contacts.linkedin.displayText)) }
  if "location" in cfg.contacts { l.push((label: "Location", display: cfg.contacts.location)) }
  l
}

#cv(
  name: cfg.contacts.name,
  position: cfg.position,
  links: links,
  about: cfg.about,
  key-skills: cfg.key_skills,
  education: cfg.education,
  role: cfg.at("role", default: ""),
  accent: accent,
  sidebar-fill: sidebar-fill,
  body-font: body-font,
)[
  #section("Experience", accent: accent)
  #for (i, job) in cfg.jobs.enumerate() [
    #experience(job.position, job.company, job.from + " - " + job.to, job.intro, job.description, accent: accent)
    #if i < cfg.jobs.len() - 1 {
      v(4pt); line(length: 100%, stroke: 0.6pt + hairline(accent)); v(4pt)
    }
  ]
]
