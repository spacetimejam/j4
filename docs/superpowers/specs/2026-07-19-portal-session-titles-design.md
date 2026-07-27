# Portal: agent-set session titles and card title overflow fixes

Date: 2026-07-19. Status: approved design, pending implementation.

## Purpose

Sessions submitted as bare URLs (LinkedIn links) currently take the URL as their
title, which is undescriptive and indistinguishable card to card, and long
unbroken titles overflow the card into the space reserved for the three-dot menu.
Fix both: titles become the actual job title supplied by the agent, and card text
can never invade the dots strip.

## Title directive

- The portal system prompt in `portal/src/agent.js` instructs the agent: in every
  portal reply where it knows the role and company (true from the stage 1
  assessment onwards), end the reply with this fenced block. When an
  `email-to-user` block is also present, the `session-title` block comes
  immediately before it; otherwise it is last.

  ```session-title
  {"title": "<role> at <company>", "awaiting_user": false}
  ```

- `awaiting_user` says whether the agent has left the user a question that is
  still outstanding. The agent sets it false when it has finished the exchange
  or the next move belongs to an employer. It sends the block in every reply,
  including replies from before it knows the role and company, leaving `title`
  out until it does.

- New export `parseTitleDirective(text)` in `portal/src/agent.js`, same pattern
  as `parseEmailDirective`: returns `{ clean, title, awaitingUser }` where
  `clean` is the text with the trailing block removed. `title` is the string, or
  `null` when the block is absent, its JSON malformed, or `title` missing/not a
  string. `awaitingUser` is the boolean, or `null` on the same conditions, so a
  block carrying only `awaiting_user` still yields it. `null` means the agent
  did not say, which is deliberately distinct from `false`.

## Queue integration (`portal/src/queue.js`)

- In `processOneJob`, parse order is: `parseEmailDirective(text)` first (strips a
  trailing email block), then `parseTitleDirective` on the resulting clean text.
- The stored `claude` message body is the text with both blocks removed, so the
  directive never appears in the chat.
- When a title is present: trim it, and if non-empty, update the session's title
  truncated to 80 characters (matching creation-time titles). Empty or absent
  titles leave the existing title untouched.
- The update runs on every turn that carries the directive. This makes the fix
  self-healing: existing URL-titled sessions get a proper title the next time
  the agent replies in them. No data migration.
- `sessionStatus({ email, awaitingUser })` derives the session status the turn
  ends on, since the Reply badge follows `awaiting_reply` and so that status has
  to mean "Claude asked something still open" rather than "Claude stopped
  talking". `awaitingUser` true gives `awaiting_reply` even alongside a
  delivery, because a question asked with the documents still wants an answer;
  otherwise a delivery gives `done` and a plain turn gives `active`. When
  `awaitingUser` is `null` the old behaviour stands (`awaiting_reply`, or `done`
  with an email), because a silently missing badge hides a real question.

## Card layout fixes (`portal/public/style.css`)

- List and archived cards: card titles get `overflow-wrap: anywhere` so unbroken
  strings (URLs) wrap inside the card instead of running past its edge. The
  existing 44px `padding-right` on `.card.has-menu` remains the reserved strip
  for the three-dot button; with wrapping in place, text can no longer enter it.
- The archived page's cards and the session view `h1` get the same
  `overflow-wrap: anywhere` treatment, since both render the raw title.

## Error handling

- Malformed or missing directive: reply passes through untouched and the title
  stays as it is, mirroring `email-to-user` behaviour.
- A title that trims to the empty string is ignored.

## Testing (`portal/test`, node:test)

- `parseTitleDirective`: valid block, malformed JSON, absent block, block not at
  the end of the text, title missing from the JSON.
- Queue: a turn carrying the directive updates the session title and stores the
  cleaned message; an 81+ character title is truncated to 80; a turn with both
  email and title blocks applies both and strips both; a turn without the
  directive leaves the title unchanged.
- CSS changes are verified visually on the live portal after rollout.

## Rollout

Implement and commit in `~/j4dev`, push, pull into `~/j4`, restart
`job-search-portal`.
