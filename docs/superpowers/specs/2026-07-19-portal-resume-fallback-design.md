# Portal: fresh-session fallback when resuming a pruned Claude session

Date: 2026-07-19. Status: approved design, pending implementation.

## Purpose

Claude Code prunes old transcripts; resuming a portal session whose transcript is
gone fails the whole turn (`agent turn failed: error_during_execution`), flips the
card to "Needs attention" and emails the admins. This happened to four of Nat's
dormant sessions on 2026-07-19. The portal must instead recover: retry the turn in
a fresh session, rebuilding context from its own message history.

## Behaviour

In `processOneJob` (`portal/src/queue.js`):

- Attempt the turn as today. If it throws AND the attempt used a non-null
  `resumeSessionId`, retry exactly once with `resumeSessionId: null` and the
  recovery prompt described below. The retry's result is then handled exactly as
  a normal turn (message stored, `claude_session_id` overwritten with the fresh
  session's id, so the session is permanently healed).
- If the retry also throws, fall through to the existing failure path
  (job failed, session `needs_attention`, admin alert). The alert carries the
  retry's error.
- A turn that failed with no `resumeSessionId` is not retried; existing failure
  path unchanged.

## Recovery prompt

New helper in `portal/src/queue.js`:

`buildRecoveryPrompt(session, messages, prompt)` returns a string of the form:

```
This is a resumed conversation whose earlier Claude session was lost. Portal
session title: <title>. The conversation so far, oldest first:

[User] <body>
[Claude] <body>
...

Re-orient yourself from the project tracker and the matching application folder
before acting. Then handle the new message below as normal.

<original prompt>
```

- `messages` is the session's messages ordered by `created_at` (all roles; the
  `system` role is labelled `[Portal]`).
- Each message body is truncated to 2,000 characters.
- The helper is exported for tests.

## Non-goals

- No change to the runner contract or `portal/src/runners/*` (the fallback works
  identically for the claude-sdk and cli runners).
- No attempt to distinguish "transcript missing" from other failure causes: any
  failure of a resumed turn earns one fresh retry. Worst case is one wasted
  agent attempt on a genuinely broken turn.

## Retention tweak (belt and braces)

- The template ships no `.claude/settings.json` today. Create
  `template/.claude/settings.json` containing `{"cleanupPeriodDays": 3650}` so
  new projects keep transcripts for ten years, and verify the setup wizard's
  copy step includes the `.claude` dot-directory (fix it if it copies only
  visible entries; setup tests must cover whichever behaviour is corrected).
- Apply the same setting to the three existing project folders (`~/j4/s`,
  `~/j4/n`, `~/j4/jc`) as an operational rollout step, merging into any
  existing `.claude/settings.json` rather than overwriting (`~/j4/s` has other
  files under `.claude/` but no `settings.json` today).

## Testing (`portal/test/queue.test.js`, node:test)

- Resumed turn fails, fresh retry succeeds: reply stored, `claude_session_id`
  updated to the fresh id, session status normal, job done; the runner saw
  exactly two calls, the second with `resumeSessionId: null` and a prompt
  containing the session title and prior message bodies.
- Resumed turn fails, retry fails: job failed, session `needs_attention`.
- Fresh turn (no `resumeSessionId`) fails: runner called once, no retry.
- `buildRecoveryPrompt`: includes title, orders messages oldest first, labels
  roles ([User]/[Claude]/[Portal]), truncates a 2,001-character body to 2,000,
  appends the original prompt last.

## Rollout

Implement and commit in `~/j4dev`, push, pull into `~/j4`, restart
`job-search-portal`, then add the retention setting to the three project folders.
