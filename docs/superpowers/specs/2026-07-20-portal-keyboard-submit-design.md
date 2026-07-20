# Portal keyboard submit design

Date: 2026-07-20

## Problem

Both portal textareas require a mouse click on their button to submit: the new
application box (`#jd` plus `#submit`) and the per-application chat box
(`#reply` plus `#send`), both in `public/app.js`. On desktop this breaks the
flow of typing, since the hands have to leave the keyboard for every send. We
want Cmd+Enter on macOS and Ctrl+Enter on Windows and Linux to submit whichever
box has focus.

## Scope

- Applies to the two textareas named above, and to nothing else.
- Plain Enter continues to insert a newline in both boxes. Bare-Enter-to-send is
  deliberately not adopted, even though many chat interfaces use it, because the
  new application box exists to receive multi-line pasted job descriptions and
  the reply box is often used for multi-line notes.
- The login form is untouched. It is a real `<form>` with a single `<input>`, so
  Enter already submits it.

## Approach

Extract each textarea's submit logic into a named function, then bind both the
button click and the textarea keydown to it through one shared helper. The chord
test itself lives in a new dependency-free module so it can be unit-tested.

Two alternatives were rejected. Inline keydown handlers at both call sites would
be the smallest diff, but they duplicate the chord logic and leave it
untestable, because importing `app.js` from a test would run `main()` against a
non-existent DOM. A single document-level keydown listener would need fewer
bindings, but it couples the shortcut to DOM structure and would fire inside any
textarea added later.

## Components

### 1. `portal/public/keys.js` (new)

A pure ES module exporting `isSubmitChord(e) -> boolean`. No DOM calls, so
`node:test` can import it unchanged, matching the `markdown.js` pattern.

```js
export function isSubmitChord(e) {
  return e.key === 'Enter' && (e.metaKey || e.ctrlKey)
    && !e.altKey && !e.shiftKey && !e.repeat && !e.isComposing;
}
```

Each clause earns its place:

- `metaKey || ctrlKey` accepts Cmd on macOS and Ctrl elsewhere without platform
  sniffing. Accepting both on every platform is harmless: Ctrl+Enter on a Mac is
  not bound to anything else here.
- `!altKey && !shiftKey` keeps Cmd+Shift+Enter and similar from counting as a
  send.
- `!repeat` stops a held chord firing a burst of submissions.
- `!isComposing` stops the shortcut hijacking Enter while an IME candidate
  window is open.

### 2. `portal/public/app.js`

Add `import { isSubmitChord } from './keys.js'` and a module-level helper:

`bindSubmit(textarea, button, run)` attaches `button.onclick` and
`textarea.onkeydown` to the same `run`. On a matching chord it calls
`preventDefault()` so no newline is inserted before submitting. It also holds an
in-flight flag, so a rapid second chord cannot fire a second POST while the
first is still in flight. Both submit paths share that guard, which also fixes
the pre-existing double-click case on the buttons.

Both call sites change the same way: the body of today's inline `onclick`
becomes a local `run` function, followed by one `bindSubmit(...)` call.
`renderList` and `renderSession` rewrite `app.innerHTML` on every render, so
handlers are re-attached each time and no listener cleanup is needed.

### 3. Tooltips

Each button gains a `title` giving the shortcut: `Send to Claude (Cmd+Enter)`
and `Send (Cmd+Enter)` on macOS, `(Ctrl+Enter)` elsewhere, from one
module-level constant in `app.js`:

```js
const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
```

`navigator.platform` is deprecated but still populated in every current browser,
and the `userAgent` fallback covers its eventual removal. Getting this wrong
only mislabels a tooltip, since `isSubmitChord` accepts both modifiers
regardless of platform.

A tooltip was chosen over visible hint text because it costs no layout and stays
invisible on mobile, where the shortcut is useless.

### 4. Tests: `portal/test/keys.test.js` (new, `node:test`)

Imports `isSubmitChord` from `../public/keys.js` and calls it with plain object
literals standing in for keyboard events. Covers:

- Cmd+Enter is true; Ctrl+Enter is true.
- Plain Enter, Shift+Enter, Alt+Enter and Cmd+Shift+Enter are all false.
- A non-Enter key with the modifier held, such as Cmd+K, is false.
- `repeat: true` and `isComposing: true` are each false despite a valid chord.

The `bindSubmit` wiring is not unit-tested. Verifying it needs a real DOM, and
adding jsdom for two bindings is not worth the dependency. It is covered by the
manual check below instead.

## Rollout

Author and test in `~/j4dev`, commit code plus this spec, push to the public
remote, then `git pull` in `~/j4` (the live checkout). Both checkouts currently
sit on `6eb55e1`, so the pull is a clean fast-forward. No service restart is
needed: the change is frontend-only static files, which `express.static` serves
fresh from disk on each request, so a browser reload picks them up.

## Verification

- `cd portal && npm test` (existing suite plus the new keys tests).
- Manual, in a desktop browser: Ctrl+Enter sends from the new application box
  and from a session reply box; plain Enter still inserts a newline in both; the
  buttons still work by click; hovering a button shows the shortcut.
