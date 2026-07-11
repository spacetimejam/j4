// CV template. Layout derived from @preview/cobalt-cv:0.1.0 (MIT, see
// COBALT-LICENSE), reshaped into a neutral single-page CV: tinted sidebar,
// teal accents, Inter throughout. Presentation lives here; content lives in a
// per-role configuration.yaml, and the palette is overridable via its theme: block.

// Neutral default palette.
#let accent-default = rgb("#2b6777")       // headings, dates, bullet dots
#let sidebar-default = rgb("#f2f5f5")      // sidebar panel
#let ink = rgb("#1a1a1a")                  // body text

// A pale hairline derived from the accent, for dividers.
#let hairline(accent) = accent.lighten(55%)

// Contact block, one row per service: a small bold label followed by the value.
// Plain labelled text lines, no icons or image assets.
#let find-me(services, colour: accent-default) = {
  set text(8pt, weight: 600)
  services.map(service => {
    text(fill: colour, weight: 700, tracking: 0.04em)[#upper(service.label) #h(4pt)]
    if service.at("link", default: "") == "" {
      service.at("display", default: "")
    } else if "display" in service.keys() {
      link(service.link)[#{service.display}]
    } else {
      link(service.link)
    }
  }).join(linebreak() + v(9pt, weak: true))
}

// Uppercase accent section heading.
#let section(title, accent: accent-default) = {
  par(text(12.5pt, weight: 800, tracking: 0.03em, fill: accent)[#upper(title)])
  v(5pt)
}

// Short divider used between sidebar sections.
#let side-rule(accent: accent-default) = {
  v(10pt)
  line(length: 32%, stroke: 0.9pt + hairline(accent))
  v(10pt)
}

// Letterhead, shared by the CV and the cover letter: name and position left,
// labelled contacts right, accent rule underneath. The <sidebar-top> anchor
// marks the rule's position for the CV's sidebar painter; it is inert in
// documents without that background hook.
#let letterhead(name, position, links, accent: accent-default) = {
  // Pin the header's own leading and spacing so it renders identically
  // regardless of the host document's par settings (CV vs letter).
  set par(leading: 0.64em, spacing: 0.9em)
  set text(8pt, fill: ink, weight: 500)
  grid(
    columns: (1fr, auto),
    column-gutter: 14pt,
    align: (horizon, horizon),
    [
      #text(21pt, weight: 600, tracking: 0.05em, fill: accent)[#upper(name)] \
      #v(-2pt)
      #text(12.5pt, weight: 700, tracking: 0.08em)[#upper(position)]
    ],
    find-me(links, colour: accent),
  )
  v(3pt)
  [#metadata(none) <sidebar-top>#line(length: 100%, stroke: 0.9pt + hairline(accent))]
}

// One experience entry: ROLE • EMPLOYER, accent dates right, bold intro, bullets.
#let experience(role, employer, dates, intro, bullets, accent: accent-default) = {
  grid(
    columns: (1fr, auto),
    align: (left, right),
    column-gutter: 8pt,
    text(8.5pt, weight: 700)[#upper(role) #h(1pt) • #h(1pt) #upper(employer)],
    text(8pt, weight: 700, fill: accent)[#upper(dates)],
  )
  v(4pt)
  par(leading: 0.85em, text(weight: 600)[#intro])
  v(4.5pt)
  list(..bullets.map(b => [#b]))
}

#let cv(
  name: "",
  position: "",
  links: (),
  about: (),          // array of paragraphs
  key-skills: (),     // flat array of strings
  education: (),      // array of (qualification, course, institution, dates) dicts
  role: "",           // job applied for, used in the PDF title
  // Theme dials (overridable from the per-role yaml theme: block).
  accent: accent-default,
  sidebar-fill: sidebar-default,
  body-font: "Inter",
  main-content,
) = {
  set document(
    title: "CV - " + name + if role != "" { " - " + role } else { "" },
    author: name,
  )
  set text(8pt, font: body-font, fill: ink, weight: 400)
  // The sidebar panel is painted from the page background so it runs unbroken
  // from the header rule to the physical bottom edge of the page.
  // Width mirrors the body grid's first column exactly.
  let margin-x = 0.8cm
  let gutter = 0.4cm
  let sidebar-w = (210mm - 2 * margin-x - gutter) * 3 / 9.6
  set page(
    margin: (x: margin-x, top: 0.75cm, bottom: 0.7cm),
    background: context {
      let anchor = query(<sidebar-top>)
      if anchor.len() > 0 {
        let y = anchor.first().location().position().y
        place(top + left, dx: margin-x, dy: y,
          rect(width: sidebar-w, height: 100% - y, fill: sidebar-fill))
        // The rect butts against the underside of the accent rule; the rule
        // itself is drawn by the flow so it stays on top of the panel.
      }
    },
  )
  set list(
    tight: false, spacing: 0.9em, indent: 4pt, body-indent: 7pt,
    marker: text(fill: accent, size: 1.15em, baseline: -0.1em)[#sym.circle.filled],
  )
  set par(leading: 0.64em, spacing: 0.9em)

  // ── Header: name/title left, contacts right ──
  letterhead(name, position, links, accent: accent)

  // ── Body: tinted sidebar (painted by the page background) + main column ──
  grid(
    columns: (sidebar-w, 1fr),
    column-gutter: gutter,
    inset: ((x: 12pt, top: 20pt, bottom: 10pt), (x: 10pt, top: 20pt, bottom: 10pt)),
    [
      // The sidebar carries looser leading; the generous block gaps are
      // explicit v()s so they don't compound with par spacing.
      #set par(leading: 0.89em, spacing: 0.89em)
      #set list(spacing: 1.3em)
      #section("About me", accent: accent)
      #for para in about {
        par(text(weight: 500)[#para])
        v(12pt)
      }
      #v(-12pt)
      #side-rule(accent: accent)
      #section("Key skills", accent: accent)
      #list(..key-skills.map(s => text(weight: 500)[#s]))
      #side-rule(accent: accent)
      #section("Education", accent: accent)
      #for edu in education [
        #text(weight: 700)[#edu.qualification \ #edu.course] \
        #edu.institution \
        #edu.dates
        #v(13pt)
      ]
    ],
    main-content,
  )
}
