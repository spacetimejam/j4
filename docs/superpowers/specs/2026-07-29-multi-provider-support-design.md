# Multi-provider support design

Date: 2026-07-29

Sequenced second after `2026-07-28-portal-remote-access-design.md`, which
deferred this work by name so that the guide chapter here could describe the
portal path that spec defined.

## Problem

The kit says it supports AI assistants other than Claude Code. In three
different places that claim is either unbacked or actively false.

1. **The kit checkout itself is Claude-only.** `CLAUDE.md` carries the
   operating conventions for working on the kit: the layout, the decisions not
   to re-litigate, the bash 3.2 constraints, the verification commands. Codex,
   Gemini CLI and Cursor look for `AGENTS.md` and find nothing, so an agent
   asked to work on the kit under any of them starts blind. The wizard already
   handles this correctly for generated project folders (`setup/setup.sh`
   renames `CLAUDE.md.tmpl` to `AGENTS.md` when `AI_TOOL` is not
   `claude-code`), which makes the gap at the kit root the odd one out.

2. **The portal's generic CLI runner cannot drive Codex, and fails
   silently in the worst possible way.** `portal/src/runners/cli.js` and
   `portal/.env.example` both say other CLIs "can be wired via these
   templates". For Codex they cannot. `codex exec --json` writes a JSON Lines
   event stream, one object per line. `cli.js` takes the whole of stdout,
   checks whether it starts with `{`, and calls `JSON.parse` on all of it. With
   JSONL that parse throws on the second line's opening brace, the `catch`
   falls through to the raw-text branch, and the consequences compound:

   - The entire raw event stream is stored as the assistant's reply and
     rendered to the user as Claude's message. The person submitting a job
     advert receives a wall of JSON.
   - The `session-title` and `email-to-user` directives are never parsed out
     of it, because they are buried inside `item.text` rather than at the end
     of a reply. Sessions are never named, and deliverables are never emailed.
   - `sessionId` falls back to `resumeSessionId`, which is `null` on a new
     session and stays `null` for ever. Every turn therefore starts a cold
     session with no memory of the previous one.

   That last point breaks the portal's core loop specifically. The loop is
   fit assessment, then the user's yes-apply, then notes on the drafts, then
   interview prep, and every stage after the first depends on the thread
   remembering the one before. The stage boundaries in `portalPrompt` are
   defined in terms of conversation history and tracker state, so a cold
   session re-enters stage 1 on a reply that was meant to advance to stage 2.

   The command templates cannot express Codex's shape either. Resuming is
   `codex exec resume <SESSION_ID>`, a subcommand, whereas `AGENT_CMD_RESUME`
   assumes a flag can be substituted into an otherwise identical command line.

3. **The getting-started guide over-promises.** `docs/getting-started/guide.typ`
   tells a beginner, under "What you need", that "Other tools that read
   AGENTS.md files (Codex, Gemini CLI, Cursor) also work", with no
   qualification and no distinction between working on the project and working
   with the portal. Gemini CLI does not read `AGENTS.md` at all without a
   settings change. No runner exists for Gemini CLI or Cursor, so for those two
   the portal does not work at any level.

## Scope

- A root `AGENTS.md` symlink to `CLAUDE.md`.
- A real Codex runner at `portal/src/runners/codex.js`, plus the config and
  preflight changes it needs.
- Portal calibration: a runnable handover step that verifies a non-Claude
  runner against the binary actually installed, and reports what to change.
- A provider chapter in `docs/getting-started/guide.typ`, and the correction to
  the existing claim in "What you need".
- Two folded-in follow-ups: case-insensitive `EXPOSURE`, and widening
  `portal/.gitignore` to cover `.env.*`.

Out of scope, deliberately:

- **A Gemini CLI runner and a Cursor runner.** Neither exists, so neither is
  promised. The guide chapter says so plainly rather than implying a runner is
  coming.
- **Renaming `sessions.claude_session_id`.** The column holds whatever session
  identifier the active runner returns and is already provider-agnostic in
  practice. Renaming it buys a migration and no behaviour.
- **Retiring `cli.js`.** It works as a Claude Code CLI runner and somebody may
  be running it. Its claims are narrowed to what it actually does.

## Approach

### Three providers, three different levels of support

The honest position, and the one every artifact in this spec states
consistently:

| Provider | Works on the kit | Works in a project folder | Portal runner |
| --- | --- | --- | --- |
| Claude Code | yes, `CLAUDE.md` | yes, `CLAUDE.md` | yes, `claude-sdk` (default) and `cli` |
| Codex | yes, `AGENTS.md` read natively | yes, wizard writes `AGENTS.md` | yes, `codex`, new and requiring calibration |
| Gemini CLI | only with a `contextFileName` setting | same, plus the setting | no |
| Cursor | yes, `AGENTS.md` read natively | yes, wizard writes `AGENTS.md` | no |

Gemini CLI's default context file is `GEMINI.md`. It reads `AGENTS.md` only
when `contextFileName` in `.gemini/settings.json` names it. That is a real
instruction we can give, so the guide gives it rather than glossing over it.

### Written to the documented stream, calibrated against the binary

Codex is not installed on the development machine, and will not be as part of
this work. Everything the runner does with the event stream comes from the
Codex documentation, not from observing a live process. Pretending otherwise
would be the same class of error as the claim in `cli.js` that started this.

So the runner is written to the documented shape, and a **calibration** step
verifies that shape against whatever binary the user has actually installed.
Calibration is a required first step before using a non-Claude provider with
the portal, not an optional check.

This is what makes the handover reasonable. Three assumptions could be wrong,
and each one is fixable in exactly one named, exported, unit-tested place:

| Assumption | Fix location |
| --- | --- |
| The argv we pass for a new session | `buildCodexArgs`, new-session branch |
| The argv we pass to resume a thread | `buildCodexArgs`, resume branch |
| The event field names we read | `parseCodexEvents` |

The fixture tests pin the exact argv and the exact event shapes. Their purpose
is not to assert that the shape is correct, because they cannot know that.
Their purpose is to lock the code to precisely what calibration probes and
reports on, so that a correction cannot be applied to the runner and missed in
the tests, or the reverse.

### Why the prompt goes on argv, not stdin

Codex documents both a prompt positional (`codex exec "summarise the repo"`)
and a `-` sentinel for piped stdin (`cat prompt.txt | codex exec -`). We use
the positional. Two reasons: it is the form the documentation leads with, and
the resume path is a subcommand whose composition with the stdin sentinel is
not documented at all. We are already carrying one unverified assumption about
resume; adding a second, unverified in the same direction, would make a failure
harder to diagnose. There is no quoting hazard because the runner spawns
without a shell, and a portal prompt plus a job advert is on the order of tens
of kilobytes, far inside `ARG_MAX` on both macOS and Linux.

### Why the system prompt is re-sent on every turn

`claude-sdk` passes `options.systemPrompt` on every `query()`, including
resumes, so the portal instructions are present in full on each turn. The
Codex runner matches that: `systemPrompt` is prepended to the prompt on new
sessions and on resumes alike.

This costs tokens on every turn and is deliberate. The `session-title` and
`email-to-user` directive formats are load-bearing for the portal, and Codex
compacts long threads. An instruction that has aged out of a compacted context
would produce a session that silently stops naming itself and stops delivering
documents, which is exactly the failure mode this spec exists to remove.

### Why `danger-full-access`

The portal agent already runs with `permissionMode: 'bypassPermissions'` under
`claude-sdk`, a risk `docs/portal.md` documents. `--sandbox
danger-full-access` is the matching posture for Codex, so the portal's risk
profile stays one documented fact rather than two that differ by runner.

The weaker `workspace-write` was rejected on behaviour, not just consistency:
it blocks network access, which would silently gut the stage 1 salary and
company research and the stage 3 interviewer research. The agent would keep
working and return visibly thinner assessments with no indication why. It is
hardcoded rather than exposed as an env var, because the only values other than
the one we set are known to break the workflow.

## Components

### 1. `AGENTS.md` at the kit root

A relative symlink to `CLAUDE.md`, committed as a symlink (git mode 120000):

```
ln -s CLAUDE.md AGENTS.md
```

A symlink rather than a copy so the two can never drift, and rather than a
stub that says "see CLAUDE.md" so that agents which read only `AGENTS.md` get
the actual content rather than a redirection they may or may not follow.

Caveat, recorded in `README.md`: a Windows checkout without symlink support
(`core.symlinks=false`, the default when git is not running elevated and
Developer Mode is off) materialises the link as a one-line text file containing
the string `CLAUDE.md`. That is inert rather than harmful, and the kit's
documented Windows path is WSL, where symlinks work normally. macOS and Linux
are unaffected.

No change to `setup/setup.sh`. Generated project folders already get an
`AGENTS.md` when `AI_TOOL` is not `claude-code`, and `setup/test/run-tests.sh`
already asserts it.

### 2. `portal/src/runners/codex.js`

Three exports. The two pure ones are the calibration fix locations.

**`parseCodexEvents(lines)`** takes an iterable of stdout lines and returns
`{ threadId, text, failure }`. It is pure, with no process and no I/O, in the
same spirit as `parseEmailDirective` and `parseTitleDirective` in `agent.js`.

| Event | Field read | Effect |
| --- | --- | --- |
| `thread.started` | `thread_id`, falling back to `id` | sets `threadId` |
| `item.completed` with `item.type === 'agent_message'` | `item.text` | sets `text`, last one wins |
| `turn.failed` | `error.message` | sets `failure` |
| `error` | `message` | sets `failure` only if none already set |
| anything else | | discarded |
| line that is not valid JSON | | discarded |

The `thread_id` fallback to `id` is cheap tolerance for a field name that has
moved before. Discarding unparseable lines is deliberate: some Codex builds
write warnings to stdout, and one stray line must not fail a turn that
otherwise succeeded. `turn.failed` takes precedence over a bare `error`
because the former is a real turn outcome and the latter can be a recoverable
transport hiccup emitted mid-stream.

**`buildCodexArgs({ resumeSessionId, model, modelExplicit, fullPrompt })`**
returns the argv array, with no spawning:

```
new:    exec --json --sandbox danger-full-access --skip-git-repo-check
        [--model M] <fullPrompt>
resume: exec resume <ID> --json --sandbox danger-full-access
        --skip-git-repo-check [--model M] <fullPrompt>
```

`--model` is present only when `modelExplicit` is true (see component 3).
`--skip-git-repo-check` is included because a project folder created outside
the kit checkout need not be a git repository, and Codex refuses to run in a
non-repo directory without it.

**`runCodex({ prompt, systemPrompt, resumeSessionId, cwd, model }, { spawnImpl })`**
satisfies the existing runner contract in `agent.js` unchanged and returns
`{ sessionId, text }`. It builds `fullPrompt` as
`` `${systemPrompt}\n\n${prompt}` ``, spawns `codex` with `cwd`, splits stdout
into lines incrementally rather than buffering the whole stream, and feeds
them to the parser. Incremental splitting matters because
`command_execution` events carry `aggregated_output`, which for a render or a
research-heavy turn can be large, and none of it is needed. On resume,
`sessionId` falls back to `resumeSessionId` when no `thread.started` arrives.

Error handling, all of it throwing so that the existing recovery path in
`queue.js` takes over (one retry in a fresh session with `buildRecoveryPrompt`
context):

| Condition | Message |
| --- | --- |
| spawn error with `code === 'ENOENT'` | names `codex` as not found on PATH, not a raw errno |
| non-zero exit | exit code plus trimmed stderr |
| `failure` set by the parser | that message |
| exit 0 but no `agent_message` | explicit "no reply" error |

The last row is the point of the whole component. A broken resume now degrades
to a cold session carrying recovery context and a visible failure, instead of
today's silent amnesia.

### 3. `portal/src/config.js`

One added field, mirroring the existing `emailProviderExplicit` pattern:

```js
agentModel: process.env.AGENT_MODEL || 'claude-opus-5',
agentModelExplicit: Boolean(process.env.AGENT_MODEL),
```

`AGENT_MODEL` defaults to `claude-opus-5`, which is meaningless to Codex.
Rather than teach `config.js` a table of per-runner defaults that would age
badly every time a model is renamed, the Codex runner omits `--model`
altogether unless the operator set one, and lets Codex choose its own default.

### 4. `portal/src/agent.js`

One line: `codex: runCodex` in the `RUNNERS` map, and the import. The runner
contract comment above it already describes exactly what `codex.js` implements,
and needs no change.

### 5. `portal/src/preflight.js`

Three new checks, plus one fix.

- Unknown `AGENT_RUNNER` is an **error**, listing the valid values. Today an
  unknown runner throws from `runAgentTurn` at the first job, long after
  startup, and surfaces as a failed session rather than a config problem.
- `AGENT_RUNNER=codex` with no `codex` on PATH is an **error**. This needs a
  `lookupBin` injection alongside the existing injected `exists`, so tests need
  no real binary.
- `AGENT_RUNNER=codex` with an explicitly set `AGENT_MODEL` beginning
  `claude-` is an **error**. That configuration cannot work, and the failure it
  produces otherwise is an opaque model-not-found from the CLI.

The fix, which is follow-up 1: `EXPOSURE` is trimmed and lowercased before it
is compared against `private` and `public`. Today `EXPOSURE=PUBLIC` is an
error that stops the service, and the message names the value without hinting
that case is the culprit. Normalising in `checkConfig` rather than `config.js`
puts it where the vocabulary is defined, and covers both the real config and
the objects the tests inject.

### 6. `portal/scripts/calibrate.js` and `npm run calibrate`

The handover step. Node rather than bash, so the kit's bash 3.2 constraint
never comes into it and Node 18 is already a portal requirement.

It reads `AGENT_RUNNER`. For `claude-sdk` it says calibration is not needed and
exits 0. For `cli` it says the runner is operator-configured and cannot be
calibrated generically, and exits 0. For `codex` it runs six steps:

1. Confirm `codex` is on PATH; print its version. Stop here if absent.
2. Capture `codex exec --help` and `codex exec resume --help` as evidence.
3. Run one real turn in a throwaway directory, using the exact argv
   `buildCodexArgs` produces for a new session, with a prompt asking for a
   fixed sentinel reply. Save raw stdout to
   `portal/data/calibration-<date>.jsonl`.
4. Feed that raw stream through the real `parseCodexEvents` and report whether
   a thread id and an `agent_message` were found, and whether the text contains
   the sentinel.
5. If a thread id came back, run the resume path with the exact resume argv and
   a prompt answerable only from memory of turn 1. This separates two questions
   that would otherwise be confounded: whether resume accepts our argv, and
   whether the thread actually carried its history.
6. Print a verdict line per assumption, and point at the `docs/portal.md`
   section describing what to change for each failure.

It writes only inside `portal/data/`, which is gitignored, and a throwaway
directory. It never touches a real project folder, because step 3 runs an agent
with `danger-full-access`.

The dispatch on `AGENT_RUNNER` is the extension point for a future runner. No
abstraction is built for that now; a second calibrator is a second branch.

### 7. `portal/src/runners/cli.js` and `portal/.env.example`

Narrow the claims that caused the bug. The header comment in `cli.js` and the
`AGENT_RUNNER` comments in `.env.example` currently say Codex and Gemini "can
be wired the same way". They stop saying it. `cli.js` is described as what it
is: a runner for CLIs that emit a single JSON object of the Claude Code
`-p --output-format json` shape.

`.env.example` gains `codex` as an `AGENT_RUNNER` value, a note that
`AGENT_MODEL` should be left unset unless a specific Codex model is wanted, and
a pointer to `npm run calibrate`.

### 8. `portal/.gitignore`

Follow-up 2:

```
.env
.env.*
!.env.example
```

Anyone taking a backup of a live `.env`, human or agent, currently leaves a
secret sitting untracked and one `git add -A` away from being committed. The
negation is required because `.env.example` is tracked and shipped, and
`.env.*` would otherwise match it.

### 9. `docs/portal.md`

A "Portal calibration" section: what calibration is, when it is required
(before first use of any non-Claude runner), how to run it, and a table mapping
each possible failure to the one function to change. Plus the plain statement
that the Codex runner is written to the documented event stream and has not
been exercised against a live binary, and the note that `AGENT_RUNNER=codex`
runs with `--sandbox danger-full-access`, alongside the existing
`bypassPermissions` warning rather than in a separate place.

### 10. `docs/getting-started/guide.typ`

A `== Using a different AI assistant` section, after step 5 and before "Good to
know", carrying the support table from the Approach section in prose a
non-technical reader can act on, plus install commands for Codex and Gemini
CLI and the `.gemini/settings.json` snippet.

The existing line under "What you need" is corrected. "Other tools that read
AGENTS.md files (Codex, Gemini CLI, Cursor) also work" becomes an accurate
sentence that points at the new section instead of flattening three different
levels of support into one word.

The beginner PDF gets one plain sentence on calibration pointing at
`docs/portal.md`. The detail stays there; this document's audience is someone
who has not yet opened a terminal.

The guide is a Typst source compiled to a tracked PDF. Both are updated, with
the compile command already in the file's header comment.

## Tests

Two hazards from the development machine shape this section. A live portal
listens on port 8710, so nothing here may bind a fixed port. And the box runs
bash 5.2, which hides bash 3.2 incompatibilities that would break on macOS,
which is why `calibrate.js` is Node.

**`portal/test/codex.test.js`**, new.

`parseCodexEvents`, all as plain data with no process:

- thread id read from `thread.started.thread_id`
- thread id read from `thread.started.id` when `thread_id` is absent
- text read from `item.completed` with `item.type === 'agent_message'`
- the last `agent_message` wins when several arrive
- `item.completed` of other item types does not become the reply
- `turn.failed` sets `failure` from `error.message`
- a bare `error` event sets `failure` from `message`
- `turn.failed` takes precedence over an earlier bare `error`
- a non-JSON line is discarded and does not prevent a later success
- an empty stream yields no thread id, no text and no failure

`buildCodexArgs`, pinning the exact argv:

- new session, no model: exact array asserted element by element
- new session with `modelExplicit`: `--model` and its value present
- new session without `modelExplicit`: no `--model` anywhere
- resume: `exec resume <ID>` in that order, with the same flags and prompt

`runCodex`, through an injected `spawnImpl`:

- a well-formed stream yields `{ sessionId, text }`
- resume with no `thread.started` carries `resumeSessionId` through
- spawn `ENOENT` throws an error naming `codex` and PATH
- non-zero exit throws with the stderr text included
- exit 0 with no `agent_message` throws rather than returning empty text
- a stream split across chunk boundaries mid-line parses correctly, since the
  runner splits incrementally

That last one is the test most likely to catch a real bug in our own code, as
opposed to a wrong assumption about Codex.

**One fixture test.** A small executable script standing in for the `codex`
binary, emitting a recorded real-shaped JSONL stream and exiting 0, spawned for
real. It proves the spawn plumbing, the incremental line splitting and the
parser work together end to end without a fake `spawnImpl`. It binds nothing.

**`portal/test/preflight.test.js`**, added cases:

- `EXPOSURE=PUBLIC` is accepted and applies the 64-character secret rule
- `EXPOSURE=" private "` is accepted
- an unknown `AGENT_RUNNER` is an error naming the valid values
- `AGENT_RUNNER=codex` with `codex` absent from PATH is an error
- `AGENT_RUNNER=codex` with `codex` present is not an error
- `AGENT_RUNNER=codex` with `AGENT_MODEL=claude-opus-5` set explicitly is an
  error
- `AGENT_RUNNER=codex` with `AGENT_MODEL` unset is not an error

**`portal/test/agent.test.js`**, one added case: `codex` resolves to a runner
in the `RUNNERS` map, so the map and the config vocabulary cannot drift apart.

No `setup/` changes and no new setup tests. `bash setup/test/run-tests.sh` is
still run, to confirm the root symlink has not disturbed it.

## Rollout

1. Root `AGENTS.md` symlink and the `README.md` caveat. Independent of
   everything else and immediately useful.
2. Follow-up 1 (`EXPOSURE` case) and follow-up 2 (`.gitignore`). Three lines
   each, independent, done early so they cannot be lost behind the larger work.
3. `config.js` `agentModelExplicit`, then `codex.js` with its tests, then the
   `agent.js` registration. Tests before implementation.
4. `preflight.js` checks and tests.
5. `calibrate.js` and the `npm run calibrate` script entry.
6. `cli.js` and `.env.example` claim narrowing.
7. `docs/portal.md` calibration section.
8. `guide.typ` chapter, then recompile the tracked PDF.

## Verification

- `cd portal && npm test`
- `bash setup/test/run-tests.sh`
- `ls -l AGENTS.md` shows a symlink, and `git ls-files -s AGENTS.md` shows mode
  120000
- `cd portal && npm run calibrate` with `AGENT_RUNNER=claude-sdk` exits 0 with
  the not-needed message, which is the only calibration path verifiable here
- `typst compile guide.typ "Job Search Kit - Getting Started.pdf"` succeeds and
  the PDF contains the new section

## Known limitations, documented not solved

- **The Codex runner has never run against a real `codex` binary.** That is the
  reason calibration exists, and both `docs/portal.md` and the spec say it
  outright rather than implying tested support. The first user with Codex
  installed is doing the verification, and calibration is what makes that a
  ten-minute task with a clear report rather than a debugging session.
- **The resume argv is the weakest assumption.** Codex documents a prompt
  positional on `codex exec resume --last "..."` but shows the session-id form
  without one. If it is wrong, every Codex turn starts cold, which is exactly
  today's bug, so calibration step 5 tests resume separately from step 3 and
  reports it as its own verdict line.
- **No Gemini CLI or Cursor portal runner.** Stated as a fact in the guide, not
  as a roadmap.
- **Claude Code may read both `CLAUDE.md` and the `AGENTS.md` symlink.** They
  are the same inode, so the worst case is the same content counted twice in a
  context window. Harmless, and not worth a workaround that would break the
  symlink's whole purpose.
