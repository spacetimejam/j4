# Portal minimal restyle

Date: 2026-07-14
Status: approved

## Goal

Make the portal UI feel cooler and less stiff. The owner asked for an
understated, minimalist look: "not too moody, not trying too hard". The
airmail metaphor (red and blue stripes, postal framing) goes entirely.

## Scope

`portal/public/style.css` only, plus deletion of the vendored Zilla Slab
fonts in `portal/public/fonts/`. No HTML, JS, or server changes. Server
tests are unaffected.

## Design

- **Colour:** near-monochrome. Soft off-white background, near-black ink,
  one muted slate-blue accent for links, buttons and focus rings, used
  sparingly. Dark mode kept with the same restraint.
- **Cards:** no visible borders; subtle shadow or faint hairline, generous
  padding, slightly larger radius, more whitespace throughout.
- **Type:** retire Zilla Slab and its `@font-face` blocks; one clean sans
  stack throughout. Headings distinguished by size and weight only. Delete
  the woff2 files.
- **Status pills:** no borders, no uppercase; small lowercase label with a
  coloured dot (amber working, blue awaiting reply, green done, red needs
  attention). Keep the subtle "breathe" animation on working, behind
  `prefers-reduced-motion` as now.
- **Buttons:** flat accent fill, normal letter-spacing, hover darkens
  slightly.
- **Thread view:** keep left/right indents for user vs Claude messages;
  differentiate by background tint only, no border-left bar.

## Verification

- `cd portal && npm test` still passes.
- Load the portal in a browser (light and dark) and check the login, list
  and session views.
