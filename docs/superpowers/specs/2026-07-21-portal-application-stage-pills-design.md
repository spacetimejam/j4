# Portal application stage pills design

Date: 2026-07-21

## Problem

The portal's status pill shows conversation state, and the labels are long
prose: `Claude is working`, `Your turn`, `Sent to your inbox, reply here with
any notes`. Three faults follow.

1. **It breaks the layout.** On the list card the pill is `float: right` beside
   the title, and `.card strong` carries `overflow-wrap: anywhere`, so the title
   wraps around the float and splits words mid-word. In the chat bar the pill is
   `flex: none` with `white-space: nowrap`, so a long label cannot shrink: on an
   iPhone 12 mini it covers the job title and pushes the page wider than the
   viewport.
2. **It answers the wrong question.** Conversation state tells you whose turn it
   is in a chat. What the list needs to tell you is where each application
   stands, which is what `tracker/applications.csv` already records in its
   `Status` column.
3. **The tracker vocabulary is too fine to scan.** Nine documented values
   (`template/tracker/tracker.md:13`), of which five are in live use, spread
   across two projects.

## Decisions taken

- The pill shows **application stage**, from the tracker, not conversation
  state. The one exception is that a session mid-turn shows `Jawbs is working`,
  which overrides the stage.
- Whether a chat wants a reply moves to a **separate red corner badge** on the
  list card, so the two axes stop competing for one element.
- `Turned down` covers both an employer rejection and the user withdrawing.
  The owner accepts that a withdrawal reads as a rejection.
- `Inactive` is **derived at display time**, never stored, so nothing has to be
  maintained and it clears itself on the next reply.

## Vocabulary

Six pills, plus one derived seventh.

| Pill | Source | Meaning | Colour |
| --- | --- | --- | --- |
| `Jawbs is working` | portal `status` | a turn is running, overrides the stage | amber, pulsing |
| `Researching` | tracker | reading the role, before drafting | `--ink-soft` |
| `Applying` | tracker | drafting, and sent but not yet answered | `--accent` |
| `Interviewing` | tracker | invited to a first interview, through to an offer | `--amber` |
| `Hired` | tracker | they took you on | `--green` |
| `Turned down` | tracker | they rejected you, or you withdrew | `--red` |
| `Inactive` | derived | `Applying` and quiet for 28 days | `--ink-soft` |

Legacy tracker values map in, so no CSV has to be rewritten for the portal to
read correctly and hand-written rows keep working:

| Tracker value | Pill |
| --- | --- |
| `Sourced`, `Researching` | Researching |
| `Drafting`, `Applied` | Applying |
| `Interviewing`, `Offer` | Interviewing |
| `Hired` | Hired |
| `Rejected`, `Withdrawn`, `Turned down` | Turned down |

Matching is case-insensitive and trimmed. `On hold` is dropped from the
documented vocabulary: no row uses it and it has no pill. An unrecognised value
shows **no pill**, rather than rendering unknown text into a fixed-width bar.

## Components

### 1. `portal/src/tracker.js` (new)

Three exported functions, no dependencies.

`parseCsv(text)` returns an array of row objects keyed by the header row. It
must handle quoted fields containing commas, escaped `""` quotes, and `CRLF`,
because the `Notes` column is long prose full of commas. Roughly 30 lines of
character-wise scanning. A dependency is not warranted for one file read.

`readTracker(projectDir)` reads `<projectDir>/tracker/applications.csv` and
returns parsed rows, or `[]` if the file is missing or unreadable. It is read on
every request rather than cached, matching how `users.json` is handled: a
job seeker editing the CSV should see the change without a restart.

`stageFor(title, rows)` returns a pill key (`researching`, `applying`,
`interviewing`, `hired`, `turned_down`) or `null`.

Matching keys off the session title, which the agent writes through the
`session-title` directive in the shape `<Role> at <Org>`. All twelve live
sessions have that shape. The title is split on the **last** occurrence of
` at `, since a role can contain the word. `Role` must match a row's `Role`
exactly once trimmed and lowercased. `Org` matches when either value is a
prefix of the other, which is what lets a session titled `... at M+C Saatchi`
find the tracker's `M+C Saatchi UK`. Where several rows match, an exact `Org`
match wins, otherwise the first.

A title without ` at ` returns `null`, and so does a session whose role matches
nothing. No pill is the honest answer; a wrong pill is worse than none.

### 2. `portal/src/server.js`

`GET /api/sessions` and `GET /api/sessions/:id` gain a `stage` field, computed
once per request from one `readTracker` call, so a list of twelve sessions reads
the CSV once rather than twelve times.

`stage` is `working` when `session.status` is `working`, overriding everything
else. Otherwise it is `stageFor(...)`, except that a stage of `applying` whose
`updated_at` is more than 28 days old becomes `inactive`. The threshold lives in
one exported constant, `INACTIVE_DAYS = 28`.

The age comparison parses `updated_at` as UTC, appending the `Z` that SQLite's
`YYYY-MM-DD HH:MM:SS` lacks, for the same reason `formatLondon` does: without
it, `Date` reads the value as local time.

`status` stays on the response unchanged, because the red badge needs it.

### 3. `portal/public/app.js`

`LABELS` is replaced by a stage map:

```js
const STAGES = {
  working: 'Jawbs is working', researching: 'Researching', applying: 'Applying',
  interviewing: 'Interviewing', hired: 'Hired', turned_down: 'Turned down',
  inactive: 'Inactive',
};
```

The pill renders only when `STAGES[s.stage]` exists, and carries
`class="pill ${s.stage}"` so the colour rules key off the stage rather than the
old conversation status.

On the list card the pill moves out of the title line and onto the timestamp
line, right-aligned. The card gains a red corner badge when `s.status` is
`awaiting_reply` or `needs_attention`, reading `Reply`, with an `aria-label`
naming the application so the list is comprehensible to a screen reader. `done`
gets no badge: a delivered pack does not need an answer.

The chat bar keeps the pill inline and unchanged in meaning.

The archived view is untouched. Its cards show a title and a timestamp with no
pill today, and an archived application is by definition one you have stopped
tracking, so neither the stage nor the reply badge belongs there.

### 4. `portal/public/style.css`

- `.card .meta`: a flex row holding the timestamp and the pill, `justify-content:
  space-between`, replacing the pill's `float: right`. With the float gone the
  title no longer wraps around it, which is the actual cause of the mid-word
  breaking, so `.card strong` can drop back from `overflow-wrap: anywhere` to
  `overflow-wrap: break-word`. `anywhere` stays on the chat bar title, which is
  a single truncated line and still needs it for a pasted URL.
- `.chat-title`: `font-size` from `1.05rem` to `0.93rem`, the 2px the owner
  asked for at a 16px root.
- `.chat-bar .pill`: gains `min-width: 0`, `overflow: hidden` and
  `text-overflow: ellipsis`. `Jawbs is working` is short enough not to need it,
  but no future label should be able to widen the page again. This is the
  structural fix; the shorter vocabulary is the cosmetic one.
- `.pill.researching`, `.applying`, `.interviewing`, `.hired`, `.turned_down`,
  `.inactive`, `.working`: dot colours per the vocabulary table. The pulsing
  animation stays on `working` alone.
- `.badge-reply`: absolutely positioned over the card's top-right corner,
  `--red` background, white text, small and uppercase. The card is already
  `position: relative` for its overflow menu.

### 5. Agent prompt and templates

`portal/src/agent.js` writes tracker statuses in eight places. They become the
new vocabulary: `Researching` at line 18, `Turned down` at line 30 (was
`Withdrawn`), `Interviewing` at 38, `Turned down` at 52 (was `Rejected`), and
`Interviewing` at 56 (was `Offer`).

Line 33 is the subtle one. Stage 3 currently triggers on "tracker Status is
`Applied` or later", a test that no longer works once `Drafting` and `Applied`
collapse into one `Applying` value. It becomes **`Date_Applied` is filled in**,
which is what the condition always meant and which the column already records.

`template/tracker/tracker.md:13` lists the choices; it becomes the five tracker
values. `template/WORKFLOW.md:19` says `Status = Sourced` (or `Researching`);
it becomes `Researching`.

Two documents are deliberately **not** updated:
`docs/superpowers/specs/2026-07-15-portal-post-application-stage-design.md` and
its plan are dated historical records of a decision taken on 2026-07-15, and the
repo's convention is not to rewrite those for later changes.

## Live data migration

`s/`, `n/` and `jc/` are untracked personal folders, so this is an operational
step, not a commit: eleven rows across `s/tracker/applications.csv` and
`n/tracker/applications.csv` get their `Status` rewritten through the legacy
map above. The portal reads correctly either way thanks to that map, so this is
tidiness rather than a prerequisite, and it must preserve the CSV's quoting.

## Tests

`portal/test/tracker.test.js` (new)

- `parseCsv` handles quoted commas, escaped `""`, `CRLF`, and a trailing newline.
- `parseCsv` on the real `template/tracker/applications.csv` header returns the
  expected column names.
- `stageFor` matches `Role at Org` exactly, and case-insensitively.
- `stageFor` matches `... at M+C Saatchi` against a row whose `Org` is
  `M+C Saatchi UK`, and the reverse direction.
- `stageFor` splits on the last ` at `, so `Analyst at Home at Acme` matches
  role `Analyst at Home`.
- Every legacy value maps to the right pill, and an unknown value returns
  `null`.
- A title with no ` at `, and a role matching nothing, both return `null`.
- `readTracker` returns `[]` for a missing file rather than throwing.

`portal/test/server.test.js`

- A session whose title matches a tracker row reports that stage in the list and
  in the detail response.
- `status = 'working'` reports `stage: 'working'` regardless of the tracker.
- An `applying` session with `updated_at` 29 days old reports `inactive`; at 27
  days it still reports `applying`.
- A session with no tracker match reports `stage: null`.

Reading the CSV once per request rather than once per session is a property of
where the `readTracker` call sits, not something a test can assert without
mocking `fs`, so it is left to review rather than covered by a test.

The list card and chat bar are DOM code and are not unit-tested, following the
precedent set for `bindSubmit` and the documents panel.

## Verification

- `cd portal && npm test`
- `bash setup/test/run-tests.sh`
- Manual, on a phone-width window: the list card title no longer breaks
  mid-word, the pill sits right-aligned on the timestamp line, the red badge
  appears on the sessions awaiting a reply, and the chat bar fits the viewport
  with no horizontal scroll.
