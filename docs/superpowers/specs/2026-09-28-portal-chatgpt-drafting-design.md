# Portal: ChatGPT writes the CV and cover letter copy

Date: 2026-09-28. Status: design approved in conversation, awaiting spec review.

## Intent

The owner wants the prose in portal-produced CVs and cover letters written by a
ChatGPT subagent (GPT-6 Astra, low reasoning effort), using the ChatGPT
subscription already signed in to Codex on beep. Claude stays the portal agent:
it runs the conversation, the fit assessment, the tracker, interview prep and
rendering, and it briefs and checks the subagent.

Agreed in conversation:

1. Stage 1 (assess), stage 3 (after applying, including interview prep) and the
   tracker stay with Claude. Only the CV and cover letter copy moves.
2. Redrafts after the user's notes also go through ChatGPT, so the voice stays
   consistent across rounds.
3. It applies to every portal user.
4. Each user's profile, voice notes and job material are now sent to OpenAI as
   well as Anthropic. The owner accepted this.
5. When ChatGPT cannot write (usage limit, expired login, any fault), the draft
   **waits**: no copy is produced by Claude instead, the session shows a notice
   with a Retry button, and the owner is emailed when the fix is theirs.

Success: every CV and cover letter delivered through the portal carries a
provenance record showing GPT-6 Astra wrote its copy, and a ChatGPT outage
produces a visible, retryable wait rather than a silent substitute.

## Environment facts this relies on

- `~/.local/bin/codex` is codex-cli 0.158.0, signed in with `auth_mode: chatgpt`
  (subscription, not an API key). `gpt-6-astra` is in the account's model list.
- The portal service runs as the same user, so it can read `~/.codex/auth.json`.
  systemd user units do not reliably have `~/.local/bin` on `PATH`, so the
  script resolves Codex by absolute path (overridable with `CODEX_BIN`).
- `codex exec` supports `--json`, `--ephemeral`, `--ignore-user-config`,
  `--sandbox read-only`, `--skip-git-repo-check`, `-m`, `-c key=value`,
  `--output-schema` and `-o`.

## Approach

Claude runs a small kit script, `bin/chatgpt-draft`, through its Bash tool.
Rejected alternatives: Codex as an MCP tool (harder to pin model, effort and
sandbox; harder to tell a limit from a fault; long tool calls risk timeouts),
and having the portal split the turn around a Codex call (most control, but
substantial surgery on `queue.js` and resume for one step).

## 1. The `chatgpt-draft` script

`bin/chatgpt-draft` at the kit root is a thin Node entry point. The logic lives
in `portal/src/drafting.js` so `node:test` can import it.

**Usage:** `chatgpt-draft <application folder>`. Claude first writes the brief as
`brief.md` in that folder: what to lead with, which evidence to use, the role's
key asks, and on a redraft the user's notes. The brief always lives there, so the
script takes no second argument. A folder that is not `<project>/applications/<slug>`,
or has no `brief.md`, is a usage error (exit 2), not a blocked draft.

**Call**, with the user's project folder as working directory:

```
codex exec --json --ephemeral --ignore-user-config --sandbox read-only \
  --skip-git-repo-check -m gpt-6-astra -c model_reasoning_effort="low" \
  --output-schema <schema file> <prompt>
```

- `--ignore-user-config` keeps the owner's personal config out: it wires Codex to
  the Claude Code and n8n MCP servers, which a drafting subagent must not have.
  Auth lives in `auth.json`, not the config, so login should survive; this is
  verified live before being relied on.
- `--ephemeral` keeps drafts out of the owner's Codex session history.
- Model and effort are explicit so the portal does not depend on personal
  defaults. They are constants in `drafting.js`, overridable by
  `DRAFT_MODEL` / `DRAFT_EFFORT` env vars.
- Read-only sandbox: ChatGPT reads the project files but writes nothing. The
  script writes the output files itself.
- Codex is spawned with stdin closed: with an open stdin `codex exec` waits for
  more prompt and never starts (found in the live probe).
- Timeout: 9 minutes, after which the child is killed and the run is an `error`.
  Claude's Bash tool stops any command at 10 minutes, so the script must give up
  first and say why; the prompt tells Claude to run it with a 600000 ms timeout.

**Prompt** directs ChatGPT to read `core/voice.md`, `core/profile.md`, the
application's `spec.md` and `fit.md`, `templates/cover-letters/README.md` and the
brief, and, on a redraft, the previous `draft.json`. It quotes the WORKFLOW rules
verbatim: accuracy first and no invented facts, the user's voice, the CV fits one
page, the letter fills most of a page with the user's agreed paragraph count.

**Output schema** (JSON, via `--output-schema`):

- `cv`: `sections`, an array of `{target, text[]}`. CV layouts differ between
  projects (one has `tagline` and `capabilities`, others `about`, `key_skills` and
  per-job `intro`), so each section's `target` names a field in that project's own
  `render/templates/configuration.yaml` (for a role, `jobs: <company>: intro` or
  `jobs: <company>: description`), and Claude maps it into `cv.yaml`. (Amended
  during implementation: the first version fixed one project's fields.)
- `cover_letter`: `paragraphs` (the body paragraphs; greeting, sign-off, dates
  and contacts stay with Claude, since they are formulaic or factual).

Education, tools and contact details are facts, not copy, and stay with Claude.
- `gaps`: array of strings, anything the brief asked for that the files could
  not support.

The script writes the result to `draft.json` in the application folder
(overwriting the previous round, whose content has already been used), prints
it to stdout, and writes `draft-provenance.json`: model, effort, Codex version,
UTC timestamp, SHA-256 of the brief.

**Exit codes and failure line:**

| Exit | Kind | Meaning |
|---|---|---|
| 0 | | success |
| 2 | | usage error: wrong arguments, not an application folder, no `brief.md` |
| 3 | `usage_limit` | subscription limit reached |
| 4 | `auth` | not signed in, or the login has expired |
| 5 | `error` | anything else, including timeout and malformed output |

On failure the script prints one JSON line to stdout,
`{"kind", "detail", "resets_at"}` (`resets_at` an ISO UTC string or null),
and writes no `draft.json`.

**Parsing** reuses `createCodexEventSink` from `runners/codex.js` for the thread
and final message. Success is exit 0 with a final message that parses
against the schema; reconnect `error` events earlier in a successful stream are
ignored. Classification is written from real captured output: with no login,
Codex retries for about 30 seconds and ends in `turn.failed` carrying
`401 Unauthorized`, exit 1 (captured 2026-09-28). Status codes are matched as
whole words, because request ids in the same message are hex and can contain
`401` or `429`. A usage limit cannot be produced on demand, so
its detection matches the documented wording; anything unrecognised is `error`,
which still blocks and emails the owner, so a wrong guess fails safe.

## 2. Prompt, schema and WORKFLOW

**`portalPrompt`** carries the instruction, not WORKFLOW.md: each project's
WORKFLOW.md is a copy taken at setup, so a template change would not reach
existing projects, whereas the portal prompt applies to every user on restart.
Claude Code sessions in project folders (the helper route) keep drafting as
before, matching the "the portal" scope. Only runners in `STRUCTURED_RUNNERS`
(today `claude-sdk`) get the instruction; the fenced `cli`/`codex` runners are
unchanged, since with Codex as the whole agent a ChatGPT subagent is pointless.
The script path is substituted from the kit checkout's location.

In stage 2 and on redrafts Claude:

1. does WORKFLOW step 3 (deciding emphasis), then writes `brief.md` and runs
   `chatgpt-draft`;
2. maps the copy into `cv.yaml` and `cover-letter.yaml`, and may only fit it to
   the YAML structure, **cut** to meet the one-page rule, or correct a factual
   claim that contradicts the profile (noting the correction in `log.md`). It
   does not rewrite the prose;
3. if the draft needs more than that, sharpens the brief and calls once more;
   if it is still unusable, asks the user rather than writing it itself;
4. turns every `gaps` entry into a numbered question for the user rather than
   filling it.

The render-failure fallback (`cv-tailored.md`, `cover-letter.md`) uses the same
ChatGPT copy.

**`REPLY_SCHEMA`** gains a required, nullable field:

```
drafting_blocked: null | {kind: "usage_limit" | "auth" | "error",
                          detail: string, resets_at: string | null}
```

The prompt says: if `chatgpt-draft` exits non-zero, write no copy, copy its JSON
line into `drafting_blocked`, leave `email` null, and give the user a short plain
reply saying the draft is waiting.

**Template WORKFLOW.md** gets one sentence in section 4 noting that through the
portal the prose is written by a ChatGPT subagent and Claude only fits, trims and
fact-checks it.

## 3. Portal blocked state

**Queue.** When `drafting_blocked` is non-null the turn itself succeeded, so
`queue.js`:

- stores Claude's reply and the Claude session id as normal, so the conversation
  resumes intact;
- marks the job `failed` with `failure_kind = 'drafting_blocked'`, `limit_type`
  holding the kind, `error` the detail, and `resets_at` / `resets_at_exact` set
  when a reset time came back (exact when the script reported one);
- sets the session status to `drafting_blocked` (added to the status comment in
  `db.js`);
- emails the admins for `auth` and `error` only, with the kind and detail. A
  `usage_limit` sends no email.

**Retry.** `/api/sessions/:id/retry` and its lookup in `server.js` accept
`failure_kind` of either `usage_limit` or `drafting_blocked` (with the matching
session status). A drafting retry requeues the same job with the prompt prefixed
by "Retrying after the writer was unavailable: carry on with the draft.", so
Claude resumes rather than restarts, and no second user message appears. Retry
is manual and always pressable, as with the usage limit.

**UI.** A blocked session shows the existing Delayed badge. The notice reads:
"Your draft is waiting. The writing service Jawbs uses has reached its limit
(or: isn't available right now), so the CV and cover letter haven't been written
yet." It adds the reset in UK time via the existing formatter when known, and a
Retry button. No "Codex" or "GPT" in user-facing text.

## Testing

`npm test` (node:test):

- `drafting.js`: argument building (model, effort, sandbox, ignore-user-config,
  ephemeral), failure classification per kind from recorded event fixtures,
  timeout, malformed output, `draft.json` and provenance writing with an injected
  spawn.
- `REPLY_SCHEMA` includes `drafting_blocked`; `portalPrompt` includes the
  drafting instruction for structured runners only.
- `queue.js`: blocked path for each kind, including reply stored, statuses set,
  and who is emailed.
- `server.js`: retry for a drafting-blocked session, including the prompt prefix.

Live checks, in a worktree (the service runs `~/j4/portal` directly):

- run the script for real against a copy of a project's application folder,
  confirming login under `--ignore-user-config` and that GPT-6 Astra returns the
  schema;
- capture a real auth failure with `CODEX_HOME` pointed at an empty directory.

## Rollout

Merging into `~/j4`, restarting `job-search-portal`, and adding the CLAUDE.md
Key-decisions entry each wait on the owner's go-ahead. Watch the first live
drafts for voice, factual accuracy and one-page fit.

## Out of scope

ChatGPT for interview prep or fit assessments; a Claude fallback writer;
per-user opt-out; changing the drafting route for Claude Code CLI sessions.
