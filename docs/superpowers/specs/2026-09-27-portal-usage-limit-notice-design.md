# Portal usage-limit notice design

Date: 2026-09-27

## Problem

The portal runs every turn on one Claude subscription, and that subscription has
usage limits: a rolling session limit and a weekly limit. When a limit is
reached, the agent SDK ends the turn with an error such as:

```
Claude Code returned an error result: You've hit your session limit · resets 12:10am (UTC)
```

The live database holds 15 such failures between 2026-08-05 and 2026-09-27,
three of them on the evening of 2026-09-27. Today each one is handled as a
generic fault:

- the job is marked `failed` and the session `needs_attention`, which shows the
  red Reply badge, as if Claude had asked the user something;
- nothing appears in the conversation, so the user's message sits unanswered
  with no explanation;
- a resumed turn is retried once in a fresh session (the pruned-transcript
  recovery), which hits the same limit and fails again;
- every admin gets an error email for what is an expected condition.

The owner wants the user told plainly that the reply is delayed by the usage
limit, given an approximate reset time in UK time, and offered a way to send the
message again.

## Decisions

- **Retry is manual.** A "Retry message" button sends the waiting message again.
  The portal does not retry by itself after the reset (owner decision,
  2026-09-27).
- **The button is always pressable.** The reset time is approximate and the
  limit is shared by everyone on the account, so an early retry is allowed. If
  it fails, the user sees the notice again with the new reset time.
- **No admin email for this case.** Admin emails stay for real faults.
- **The notice is job state, not conversation.** It is derived from the failed
  job rather than written into `messages`, so it disappears once the retry
  starts, and it never reaches `buildRecoveryPrompt`.

## Scope

- The `claude-sdk` runner, the queue's failure path, the `jobs` table, the
  session detail route, a new retry route, `public/app.js` and
  `public/time.js`.
- `runCli` and `runCodex` are unchanged. They never raise the new error, so
  their failures still go to `needs_attention`.

## Design

### 1. Detection (`runners/claude-sdk.js`)

The runner watches the message stream for two signals before a failure:

- an `SDKRateLimitEvent` (`type: 'rate_limit_event'`) whose
  `rate_limit_info.status` is `'rejected'`. The runner keeps the last one seen,
  for its `resetsAt` (Unix seconds) and `rateLimitType`;
- an assistant message with `error: 'rate_limit'`.

If the turn then fails, either by the SDK throwing or by a non-success result,
the runner throws a `UsageLimitError` instead of the original error when either
signal was seen, or when the error text matches the usage-limit pattern below.
`UsageLimitError` is exported from a small module of its own (the same reason
`reply-schema.js` exists: `queue.js` and the runner must not import each other),
and carries:

| Field | Meaning |
|---|---|
| `resetsAt` | a `Date`, or `null` when nothing could be worked out |
| `exact` | `true` when `resetsAt` came from the event, `false` when estimated |
| `limitType` | `'session'`, `'weekly'` or `'unknown'` |
| `message` | the original error text, for logs |

`rateLimitType` maps as follows: `five_hour` goes to `session`, and every
`seven_day*` value goes to `weekly`. Anything else is `unknown`.

**Text fallback.** When no event carried `resetsAt`, the runner parses the error
text with a pattern for `hit your (session|weekly) limit · resets <time> (<zone>)`,
where `<time>` is shaped like `12:10am` or `7am`. It resolves the next moment
after now at which that wall-clock time occurs in `<zone>`. The zone is an IANA
name or `UTC`, and an unknown zone counts as a failed parse. The result has
`exact: false`. For a session limit, the next occurrence is right, because the
window is five hours. For a weekly limit the text names no day, so the time of
day is kept but the day is unknown. The UI says so (section 3). If the text does
not parse at all, `resetsAt` is `null` and the notice leaves the time out.

### 2. Storage and retry

**Schema (`db.js`).** Guarded migrations, in the same pattern as `files` and
`archived`, add four columns to `jobs`:

- `failure_kind text`: `'usage_limit'`, or null for any other failure;
- `resets_at text`: UTC as `YYYY-MM-DD HH:MM:SS`, matching every other
  timestamp, or null;
- `resets_at_exact integer`: 1 when exact, 0 when estimated;
- `limit_type text`: `session`, `weekly` or `unknown`, so the notice can word a
  weekly estimate correctly.

`sessions.status` gains the value `usage_limited`, and the comment in `SCHEMA`
lists it.

**Queue (`queue.js`).**

- The pruned-transcript recovery does not run when the first attempt threw a
  `UsageLimitError`. The error is rethrown straight to the outer handler.
- The outer handler checks for `UsageLimitError` first. It marks the job
  `failed` with `error`, `failure_kind`, `resets_at`, `resets_at_exact` and
  `limit_type`, sets the session to `usage_limited`, and sends no admin email.
  Every other error takes the existing path unchanged.

**Session detail (`GET /api/sessions/:id`).** The response gains `delayed`. When
the session is `usage_limited` and its most recent job failed with
`failure_kind = 'usage_limit'`, `delayed` is
`{ jobId, resetsAt, exact, limitType }`. Otherwise it is `null`.

**Retry (`POST /api/sessions/:id/retry`).** Behind `requireAuth` and
`getOwnSession`, like every session route:

- if the session is not `usage_limited`, or its latest job is not a usage-limit
  failure, it returns 409 and changes nothing. This covers a double click and a
  stale page;
- otherwise, in one transaction, it sets that job back to `queued`, clears
  `error`, `failure_kind`, `resets_at`, `resets_at_exact` and `limit_type`, and
  sets the session to `working`. The prompt is unchanged, and no user message is
  added.

It returns `{ ok: true }`. The worker picks the job up on its next poll.

**A new message while delayed.** The reply route is unchanged. A new message is
queued as usual and the session goes to `working`. The failed job stays failed,
and its message stays unanswered in the history. Merging the two is out of
scope.

### 3. Display

**Time (`public/time.js`).** A new `formatResetLondon(stored, { exact, limitType }, now = new Date())`
returns the phrase that follows "at about". It uses `Europe/London`, a 24-hour
clock, and the short zone name from `Intl.DateTimeFormat` with
`timeZoneName: 'short'`, so it reads `BST` or `GMT` from the zone data.

| Case | Example output |
|---|---|
| same London day as `now` | `01:10 BST today` |
| next London day | `01:10 BST tomorrow (Monday)` |
| later | `08:00 BST on Thursday 1 October` |
| weekly and not exact | `08:00 BST on a day within the next week` |

It returns an empty string for a null or unparseable value, and the notice then
leaves out the sentence about timing. The stored value is parsed with the same
trailing-`Z` rule as `formatLondon`.

**Notice (`public/app.js`).** When `session.delayed` is set, `renderSession`
shows this under the messages, where the "working" line sits today:

> **Your reply is delayed.** The Claude account behind Jawbs has reached its
> usage limit, so Jawbs couldn't answer this message yet. The limit should reset
> at about 01:10 BST tomorrow (Monday).
>
> [Retry message]

The text is built by the portal from fixed strings and the formatted time,
through `esc()`. None of the error text reaches the page.

**Button.** A click disables the button, calls the retry route, then re-renders
the session. That shows the existing "working" line and starts the existing
ten-second poll. On 409 or a network error, it re-renders too, so the page shows
the real state. The disabled-while-pending guard follows `bindSubmit`.

**Session list.** `usage_limited` is not in `NEEDS_REPLY`, so there is no red
Reply badge. The row shows a muted "Delayed" label, with an `aria-label` naming
the session, as the Reply badge does. The status pill is unchanged: it still
shows the application stage.

## Testing

`node:test`, in the existing test files where they exist:

- **Runner:** a stubbed `queryImpl` that yields a rejected `rate_limit_event`
  then throws, which gives an exact `UsageLimitError` with the mapped
  `limitType`; one that throws only the usage-limit text, for session and weekly,
  which gives an estimated error with the right next occurrence; unparseable
  usage-limit text, which gives `resetsAt: null`; and an unrelated failure,
  which is rethrown unchanged.
- **Queue:** a resumed session whose turn throws `UsageLimitError` calls
  `runTurn` once (no recovery attempt) and sends no admin email; the job columns
  and the `usage_limited` status are written; an ordinary error still goes to
  `needs_attention` and emails admins.
- **Routes:** session detail returns `delayed` only in the usage-limited state.
  Retry requeues the same job with the same prompt, adds no message and sets
  `working`. A second retry returns 409, and another user's session returns 404.
- **Migration:** the new columns are added to an existing database without them.
- **`formatResetLondon`:** a BST date, a GMT date, today, tomorrow, a later
  weekday, the inexact weekly case, and null input. `now` is injected, so the
  tests do not depend on the clock.

## Out of scope

- Retrying by itself after the reset.
- Warning users before the limit is reached (`allowed_warning`).
- Pausing the whole queue while the limit is in force. Queued jobs still run
  and fail one by one, each with its own notice.
- The `cli` and `codex` runners.
