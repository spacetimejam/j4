# Portal single-answer replies design

Date: 2026-08-12

## Problem

On 2026-08-12 the portal stored an empty reply for Sam's M+C Saatchi session.
The agent answered his question, then edited `log.md` and the tracker, then
closed the turn with a message containing only a `session-title` block.
`runClaudeSdk` read `msg.result`, which is the final assistant message alone, so
the runner returned just that block; `parseTitleDirective` stripped it as a
directive, and what reached the chat was an empty string. The job was marked
`done` and nothing alerted, because from the queue's point of view the turn had
succeeded.

Reading every assistant message instead of the last one removes the empty reply,
but it exposes the underlying problem: nothing tells the portal which text is the
answer. A turn that narrates as it works ("let me check the tracker") and then
answers produces two candidate replies, and any rule for choosing between them is
a heuristic.

The owner's requirement is that a portal chat delivers one confident answer once
all the work is done, with no commentary on process or reasoning-in-progress.

## Scope

- The `claude-sdk` runner, the queue's handling of a completed turn, and the
  portal system prompt.
- `runCli` and `runCodex` are untouched and keep the fenced-directive protocol.
  Neither is in production use (`AGENT_RUNNER=claude-sdk`) and Codex has its own
  runner spec queued.
- The frontend is untouched. Replies still arrive as markdown and render through
  `portal/public/markdown.js` exactly as now.

## Approach

Declare a JSON schema for the whole turn and let the SDK enforce it, rather than
recovering structure from prose after the fact.

`@anthropic-ai/claude-agent-sdk` (0.3.207, the installed version) supports this
directly:

- `Options.outputFormat` accepts `{ type: 'json_schema', schema }`
  (`JsonSchemaOutputFormat`, sdk.d.ts:898).
- The result message carries `structured_output` (sdk.d.ts:4187).
- Failure is typed rather than silent: result subtype
  `error_max_structured_output_retries`, terminal reason
  `structured_output_retry_exhausted`. The SDK validates and retries, and when it
  cannot comply it says so.

This removes the class of bug entirely rather than narrowing it. The answer is a
named field, so there is nothing to choose between; anything the agent narrates
outside the schema is discarded by construction rather than by instruction; and a
turn that cannot produce a valid reply fails loudly instead of storing a blank
message.

It also retires the fenced-block protocol on this path. `session-title` and
`email-to-user` were always JSON; they were smuggled through markdown because
there was no other channel. As schema fields they stop being parsed out of prose.

## Components

### 1. `portal/src/agent.js`: the schema

One exported constant, `REPLY_SCHEMA`. Every field is required. Nullable fields
use `anyOf` rather than being optional, so the agent makes an explicit choice
instead of silently omitting one:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["reply", "title", "awaiting_user", "email"],
  "properties": {
    "reply":         { "type": "string" },
    "title":         { "anyOf": [{ "type": "string" }, { "type": "null" }] },
    "awaiting_user": { "type": "boolean" },
    "email": {
      "anyOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["subject", "body", "attachments"],
          "properties": {
            "subject":     { "type": "string" },
            "body":        { "type": "string" },
            "attachments": { "type": "array", "items": { "type": "string" } }
          }
        },
        { "type": "null" }
      ]
    }
  }
}
```

`reply` deliberately carries no `minLength`. String constraints are not supported
by structured outputs, so the empty-reply check lives in `queue.js` (component 3)
where it can be raised as an error.

`additionalProperties: false` is set on every object, as structured outputs
require.

### 2. `portal/src/runners/claude-sdk.js`: pass the schema, read the field

Pass `outputFormat: { type: 'json_schema', schema: REPLY_SCHEMA }` in the query
options, and return `{ sessionId, structured, text }`:

- `structured` is `msg.structured_output` from the result message, or `null` when
  the SDK did not supply one.
- `text` stays as the accumulated assistant text introduced in commit 199ffc9. It
  is now a fallback for an SDK or CLI build that ignores `outputFormat`, so the
  runner can never return less than it does today.

A non-success result subtype still throws. The message includes the subtype
verbatim, so `error_max_structured_output_retries` reaches the admin alert as
itself rather than as a generic failure.

The injectable `queryImpl` second argument stays; it is what makes the stream
shapes testable without a live agent.

### 3. `portal/src/queue.js`: prefer structured, fall back to directives

In `processOneJob`, when `turn.structured` is present:

- `reply` is stored as the Claude message body.
- `title` is applied when non-null, trimmed and truncated to 80 characters as now.
- `awaiting_user` feeds `sessionStatus` unchanged.
- `email` drives the existing delivery path unchanged: `sessions.files`, the
  `documents` upsert keyed on `(session_id, path)`, and `sendEmail`.

An empty or whitespace-only `reply` throws. That routes through the existing
catch, marking the session `needs_attention` and emailing the admins, which is
the behaviour the 2026-08-12 turn should have had.

When `turn.structured` is absent, the existing path runs unchanged:
`parseEmailDirective` then `parseTitleDirective` on `turn.text`. Those functions
stay in `agent.js` for the CLI and Codex runners.

### 4. `portal/src/agent.js`: the prompt

`portalPrompt` gains a parameter selecting the reply protocol, chosen by
`runAgentTurn` from `config.agentRunner`.

On the structured path, the two fenced-block format sections are dropped and
replaced by a short description of the fields, plus the reply-shape rules:

- Do all the work first. Write nothing to the user until every file is written
  and every check is done.
- Then reply once: the recommendation or verdict stated plainly up front, a short
  paragraph of why after it, and a brief line confirming what was recorded in the
  tracker or log.
- No thinking aloud, no weighing one option against another in front of the user,
  no narrating what you are about to do.

The confirmations stay deliberately (owner decision, 2026-08-12): they tell the
user the tracker is current. What goes is running commentary and
reasoning-in-progress.

The non-structured path keeps today's prompt text verbatim, so the CLI and Codex
runners see no change.

## Testing

Runner, through the injected `queryImpl`:

- structured output present, returned as `structured`
- structured output absent, `text` returned as the fallback
- `error_max_structured_output_retries` throws, naming the subtype
- session id still read from the init message

Queue, with a fake runner:

- a structured turn stores the reply, applies the title, derives status from
  `awaiting_user`, and delivers email plus `documents` rows
- an empty `reply` marks the session `needs_attention` and alerts admins
- a turn with no `structured` still parses fenced directives from `text`

The existing directive tests in `agent.test.js` and `queue.test.js` stay green,
because that path is unchanged.

Verification: `cd portal && npm test` and `bash setup/test/run-tests.sh`.

## Risks

**The reply travels as an escaped JSON string.** A multi-paragraph markdown
answer with quotes, newlines, and fenced code becomes a string field. The SDK
validates and retries, so a failure is visible rather than silent, but this is
the plausible place for a long reply to come back flattened or truncated. Watch
the first few real turns after deploy.

**The portal is more tied to the claude-sdk runner.** Schema enforcement is not
something `runCli` or `runCodex` can offer, so the runner contract now carries an
optional structured field that only one runner populates. Accepted: that runner
is the only one in production.

**Mid-flight sessions are unaffected.** `outputFormat` is a per-turn option, so a
resumed session picks up the new protocol on its next turn with no migration.
