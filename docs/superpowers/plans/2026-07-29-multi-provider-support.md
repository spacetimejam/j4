# Multi-Provider Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the j4 kit genuinely usable from Codex, Gemini CLI and Cursor, by adding a root `AGENTS.md`, a real Codex portal runner with a calibration step that verifies it against a live binary, and an honest provider chapter in the getting-started guide.

**Architecture:** The Codex runner is one file, `portal/src/runners/codex.js`, satisfying the existing runner contract in `portal/src/agent.js`. It splits into three exported pieces so that each unverified assumption about the Codex CLI has exactly one place to be corrected: `buildCodexArgs` (the command line), `parseCodexEvents` (the JSON Lines event stream), and `runCodex` (the spawn wrapper that joins them). A new `portal/scripts/calibrate.js` probes a real `codex` install using those same two pure functions and reports which assumptions hold.

**Tech Stack:** Node 18+, ES modules, `node:test` and `node:assert` (no test framework), `node:child_process`, Typst for the getting-started PDF, git symlinks.

**Spec:** `docs/superpowers/specs/2026-07-29-multi-provider-support-design.md`

## Global Constraints

- **Docs in British English.** No em dashes or en dashes as sentence punctuation, anywhere, including code comments and commit messages.
- **Setup scripts stay bash 3.2 compatible:** no associative arrays, no `readarray`, no `sed -i`, no `${var,,}`, no GNU-only flags. This plan adds no bash to `setup/`; `calibrate.js` is Node specifically so this constraint never applies to it. Test fixture shell scripts use `#!/bin/sh` and POSIX syntax only.
- **The development machine runs bash 5.2**, which silently accepts bash 4+ syntax that breaks on macOS bash 3.2. Do not add bash beyond the one POSIX `sh` fixture in Task 5.
- **A live portal listens on port 8710 on this machine.** No test may bind a fixed port. `portal/test/server.test.js` uses `app.listen(0)` and must stay that way. Nothing in this plan binds any port.
- **Never write the real portal registry in tests:** always set `PORTAL_REGISTRY` / `PORTAL_USERS_FILE` when a test could touch it. No task here touches the registry.
- **Every portal test file is ESM** and sets any `process.env` it needs *before* a dynamic `await import(...)` of the module under test, because `src/config.js` reads `process.env` at import time.
- **Verification commands** for every task: `cd portal && npm test` and `bash setup/test/run-tests.sh`.
- **Exact literal values used across tasks:**
  - Sandbox flag pair: `--sandbox danger-full-access`
  - Repo check flag: `--skip-git-repo-check`
  - Calibration sentinel: `CALIBRATION-OK-7391`
  - Valid `AGENT_RUNNER` values: `claude-sdk`, `cli`, `codex`

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `AGENTS.md` | Create (symlink) | Points at `CLAUDE.md` so non-Claude agents can work on the kit |
| `README.md` | Modify | Records the Windows symlink caveat |
| `portal/.gitignore` | Modify | Ignore `.env.*` backups, keep `.env.example` tracked |
| `portal/src/preflight.js` | Modify | Case-insensitive `EXPOSURE`; three new agent-runner checks |
| `portal/src/config.js` | Modify | Add `agentModelExplicit` |
| `portal/src/runners/codex.js` | Create | Codex runner: sink, parser, argv builder, spawn wrapper |
| `portal/src/runners/cli.js` | Modify | Narrow its header comment to what it actually supports |
| `portal/src/agent.js` | Modify | Register `codex` in `RUNNERS` |
| `portal/scripts/calibrate.js` | Create | Portal calibration: verify a runner against the installed binary |
| `portal/package.json` | Modify | Add the `calibrate` script |
| `portal/test/codex.test.js` | Create | Parser, argv and spawn-wrapper tests |
| `portal/test/fixtures/bin/codex` | Create | POSIX `sh` stand-in for the Codex CLI, emits real-shaped JSONL |
| `portal/test/preflight.test.js` | Modify | Exposure case and agent-runner check cases |
| `portal/test/agent.test.js` | Modify | `codex` resolves in the `RUNNERS` map |
| `portal/.env.example` | Modify | Document `AGENT_RUNNER=codex`, drop the false template claim |
| `docs/portal.md` | Modify | Correct "Using a different LLM"; add "Portal calibration" |
| `docs/getting-started/guide.typ` | Modify | Provider chapter; correct the "What you need" over-promise |
| `docs/getting-started/Job Search Kit - Getting Started.pdf` | Modify | Recompiled output |

---

### Task 1: Root `AGENTS.md` symlink

**Files:**
- Create: `AGENTS.md` (symlink to `CLAUDE.md`)
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks depend on. This task is fully independent and can be done first or last.

- [ ] **Step 1: Create the symlink**

It must be relative (`CLAUDE.md`, not an absolute path) so the checkout is portable.

```bash
cd /home/spacetimejam/j4dev
ln -s CLAUDE.md AGENTS.md
```

- [ ] **Step 2: Verify it is a symlink and that it resolves**

```bash
ls -l AGENTS.md
head -1 AGENTS.md
```

Expected: `ls -l` shows `AGENTS.md -> CLAUDE.md`, and `head -1` prints `# j4: job-search kit`.

- [ ] **Step 3: Stage it and verify git records it as a symlink, not a file**

Git mode `120000` means symlink. Mode `100644` would mean git stored the file contents instead, which would silently create a second copy of `CLAUDE.md` that drifts.

```bash
git add AGENTS.md
git ls-files -s AGENTS.md
```

Expected: output begins `120000`.

- [ ] **Step 4: Add the Windows caveat to `README.md`**

Find the existing line in `README.md` that reads:

```
See the `CLAUDE.md` (or `AGENTS.md`) inside your generated project for operating conventions, `WORKFLOW.md` for the day-to-day process, and the docs in `docs/` for deeper guidance.
```

Add this paragraph immediately after it:

```markdown
The kit checkout itself carries a root `AGENTS.md`, which is a symlink to
`CLAUDE.md`, so Codex, Gemini CLI and Cursor can work on the kit as well as
Claude Code. One caveat: a Windows checkout made without symlink support
(git's default when it is not running elevated and Developer Mode is off)
turns that symlink into a one-line text file containing the words
`CLAUDE.md`. It is inert rather than harmful, and the kit's documented
Windows path is WSL, where symlinks behave normally. Gemini CLI needs one
extra setting before it reads `AGENTS.md` at all; see the "Using a different
AI assistant" section of the getting-started guide.
```

- [ ] **Step 5: Verify the setup tests are undisturbed**

The wizard writes its own `AGENTS.md` into generated project folders, and `setup/test/run-tests.sh` asserts it. A root symlink is a different file and must not affect that.

Run: `bash setup/test/run-tests.sh`
Expected: `Failed: 0`.

- [ ] **Step 6: Commit**

```bash
git add AGENTS.md README.md
git commit -m "feat: add a root AGENTS.md symlink for non-Claude agents"
```

---

### Task 2: Case-insensitive `EXPOSURE`, and `.env.*` gitignore

**Files:**
- Modify: `portal/src/preflight.js:44-53`
- Modify: `portal/.gitignore`
- Test: `portal/test/preflight.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks depend on. Independent of Tasks 1 and 3 to 9.

Two three-line fixes, done together because they are both one-shot hardening of the remote-access work and neither justifies its own review cycle.

- [ ] **Step 1: Write the failing tests**

Add these to `portal/test/preflight.test.js`, immediately after the existing test named `unrecognised EXPOSURE also applies the stricter public secret bar`:

```javascript
test('EXPOSURE is matched case-insensitively', () => {
  for (const exposure of ['PUBLIC', 'Public', 'PRIVATE', 'Private']) {
    const issues = checkConfig(valid({ exposure }), { exists: alwaysExists });
    assert.deepEqual(errors(issues), [], `expected no errors for ${exposure}`);
  }
});

test('EXPOSURE tolerates surrounding whitespace', () => {
  const issues = checkConfig(valid({ exposure: '  private  ' }), { exists: alwaysExists });
  assert.deepEqual(errors(issues), []);
});

test('uppercase PUBLIC still applies the stricter public secret bar', () => {
  const issues = checkConfig(
    valid({ exposure: 'PUBLIC', cookieSecret: OK_PRIVATE_SECRET }), { exists: alwaysExists });
  assert.equal(errors(issues).length, 1);
  assert.match(errors(issues)[0].message, /EXPOSURE=public requires at least 64/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd portal && node --test test/preflight.test.js`
Expected: FAIL. `EXPOSURE is matched case-insensitively` reports an unexpected error whose message is `EXPOSURE is "PUBLIC", which is not one of: private, public.`

- [ ] **Step 3: Normalise the value in `checkConfig`**

In `portal/src/preflight.js`, change the one line that reads:

```javascript
  let exposure = cfg.exposure || '';
```

to:

```javascript
  // Normalised here rather than in config.js because this is where the
  // vocabulary is defined, and because it also covers the plain objects the
  // tests inject. EXPOSURE=PUBLIC used to stop the service with a message
  // that named the value without hinting that case was the culprit.
  let exposure = (cfg.exposure || '').trim().toLowerCase();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd portal && node --test test/preflight.test.js`
Expected: PASS, with no regressions in the existing exposure tests.

- [ ] **Step 5: Widen `portal/.gitignore`**

Replace the whole file with:

```
node_modules/
data/
.env
.env.*
!.env.example
```

The negation is required: `.env.example` is tracked and shipped, and `.env.*` would otherwise match it.

- [ ] **Step 6: Verify the ignore rules do what they claim**

```bash
cd /home/spacetimejam/j4dev/portal
touch .env.backup .env.2026-07-29
git check-ignore -v .env.backup .env.2026-07-29
git check-ignore -v .env.example || echo "env.example NOT ignored (correct)"
rm .env.backup .env.2026-07-29
```

Expected: both `.env.backup` and `.env.2026-07-29` are reported as ignored by the `.env.*` rule; `.env.example` is not ignored and the fallback message prints.

- [ ] **Step 7: Run the full suite and commit**

```bash
cd portal && npm test
```

Expected: all tests pass.

```bash
cd /home/spacetimejam/j4dev
git add portal/src/preflight.js portal/test/preflight.test.js portal/.gitignore
git commit -m "fix(portal): match EXPOSURE case-insensitively and ignore .env backups"
```

---

### Task 3: `parseCodexEvents`, the pure event-stream parser

**Files:**
- Create: `portal/src/runners/codex.js`
- Test: `portal/test/codex.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces, both relied on by Tasks 4, 5 and 7:
  - `createCodexEventSink() => { push(line: string): void, result(): { threadId: string|null, text: string|null, failure: string|null } }`
  - `parseCodexEvents(lines: Iterable<string>) => { threadId: string|null, text: string|null, failure: string|null }`

The sink exists so that `runCodex` (Task 5) can consume a long stream without holding it in memory, while `parseCodexEvents` stays a pure function that tests can drive with plain arrays. `command_execution` events carry an `aggregated_output` field that for a render or a research-heavy turn can be large, and none of it is needed.

- [ ] **Step 1: Write the failing tests**

Create `portal/test/codex.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert';
import { parseCodexEvents } from '../src/runners/codex.js';

// Real-shaped events, taken from the documented codex exec --json stream.
const THREAD = '{"type":"thread.started","thread_id":"th_abc123"}';
const TURN_STARTED = '{"type":"turn.started"}';
const CMD = '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls","aggregated_output":"","exit_code":null,"status":"in_progress"}}';
const MSG = '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"Fit assessment ready."}}';
const TURN_DONE = '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":3}}';

test('reads the thread id from thread.started.thread_id', () => {
  const { threadId } = parseCodexEvents([THREAD, TURN_STARTED, MSG, TURN_DONE]);
  assert.equal(threadId, 'th_abc123');
});

test('falls back to thread.started.id when thread_id is absent', () => {
  const { threadId } = parseCodexEvents(['{"type":"thread.started","id":"th_legacy"}', MSG]);
  assert.equal(threadId, 'th_legacy');
});

test('reads the reply from an agent_message item', () => {
  const { text } = parseCodexEvents([THREAD, CMD, MSG, TURN_DONE]);
  assert.equal(text, 'Fit assessment ready.');
});

test('the last agent_message wins', () => {
  const first = '{"type":"item.completed","item":{"id":"a","type":"agent_message","text":"first"}}';
  const second = '{"type":"item.completed","item":{"id":"b","type":"agent_message","text":"second"}}';
  assert.equal(parseCodexEvents([first, second]).text, 'second');
});

test('item.completed of another item type never becomes the reply', () => {
  const fileChange = '{"type":"item.completed","item":{"id":"c","type":"file_change","changes":[{"path":"cv.yaml","kind":"update"}],"status":"completed"}}';
  const { text } = parseCodexEvents([THREAD, fileChange, TURN_DONE]);
  assert.equal(text, null);
});

test('turn.failed sets failure from error.message', () => {
  const failed = '{"type":"turn.failed","error":{"message":"model response stream ended unexpectedly"}}';
  const { failure } = parseCodexEvents([THREAD, failed]);
  assert.equal(failure, 'model response stream ended unexpectedly');
});

test('a bare error event sets failure from message', () => {
  const { failure } = parseCodexEvents([THREAD, '{"type":"error","message":"stream error: broken pipe"}']);
  assert.equal(failure, 'stream error: broken pipe');
});

test('turn.failed takes precedence over an earlier bare error', () => {
  const bare = '{"type":"error","message":"transient hiccup"}';
  const failed = '{"type":"turn.failed","error":{"message":"the real reason"}}';
  assert.equal(parseCodexEvents([bare, failed]).failure, 'the real reason');
});

test('a bare error after turn.failed does not overwrite it', () => {
  const failed = '{"type":"turn.failed","error":{"message":"the real reason"}}';
  const bare = '{"type":"error","message":"noise afterwards"}';
  assert.equal(parseCodexEvents([failed, bare]).failure, 'the real reason');
});

test('a non-JSON line is discarded and does not stop a later success', () => {
  const noise = 'warning: config key `foo` is deprecated';
  const { text, failure } = parseCodexEvents([noise, THREAD, MSG, TURN_DONE]);
  assert.equal(text, 'Fit assessment ready.');
  assert.equal(failure, null);
});

test('blank lines are ignored', () => {
  const { text } = parseCodexEvents(['', '   ', THREAD, MSG]);
  assert.equal(text, 'Fit assessment ready.');
});

test('an empty stream yields nothing at all', () => {
  assert.deepEqual(parseCodexEvents([]), { threadId: null, text: null, failure: null });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd portal && node --test test/codex.test.js`
Expected: FAIL, with a module-not-found error for `../src/runners/codex.js`.

- [ ] **Step 3: Write the parser**

Create `portal/src/runners/codex.js`:

```javascript
// Runner for the Codex CLI (`codex exec --json`), which writes a JSON Lines
// event stream: one JSON object per line. This is why the generic `cli`
// runner cannot drive it. That runner JSON.parses the whole of stdout, which
// throws on the second line, falls back to treating the raw stream as the
// reply text, and never finds a session id, so every turn started cold.
//
// Written to the documented event shape and NOT verified against a live
// binary. `npm run calibrate` probes a real install and reports which of the
// assumptions below hold. There are exactly two places to correct:
// parseCodexEvents for field names, buildCodexArgs for the command line.

// Accumulates the only three things a turn produces that the portal needs,
// discarding everything else as it arrives. Kept separate from
// parseCodexEvents so runCodex can feed it line by line without holding a
// whole stream in memory: command_execution events carry an
// aggregated_output field that a render or research-heavy turn makes large.
export function createCodexEventSink() {
  let threadId = null;
  let text = null;
  let failure = null;
  return {
    push(line) {
      const trimmed = String(line).trim();
      if (!trimmed) return;
      let event;
      // Some builds write plain warnings to stdout. One stray line must not
      // fail a turn that otherwise succeeded.
      try { event = JSON.parse(trimmed); } catch { return; }
      if (!event || typeof event !== 'object') return;
      switch (event.type) {
        case 'thread.started':
          // thread_id is the documented field; id is cheap tolerance for a
          // name that has moved before.
          threadId = event.thread_id ?? event.id ?? threadId;
          break;
        case 'item.completed':
          if (event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
            text = event.item.text;
          }
          break;
        case 'turn.failed':
          // A real turn outcome, so it overwrites a bare error.
          failure = event.error?.message || 'codex reported a failed turn';
          break;
        case 'error':
          // A transport-level hiccup, which may be recoverable and may be
          // followed by a real outcome, so it never overwrites one.
          if (!failure) failure = event.message || 'codex reported an error';
          break;
        default:
          break;
      }
    },
    result() {
      return { threadId, text, failure };
    },
  };
}

// Pure convenience over the sink, for tests and for calibration replaying a
// saved stream from disk.
export function parseCodexEvents(lines) {
  const sink = createCodexEventSink();
  for (const line of lines) sink.push(line);
  return sink.result();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd portal && node --test test/codex.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add portal/src/runners/codex.js portal/test/codex.test.js
git commit -m "feat(portal): parse the codex exec --json event stream"
```

---

### Task 4: `buildCodexArgs` and `config.agentModelExplicit`

**Files:**
- Modify: `portal/src/runners/codex.js`
- Modify: `portal/src/config.js:21`
- Test: `portal/test/codex.test.js`

**Interfaces:**
- Consumes: `portal/src/runners/codex.js` from Task 3.
- Produces, relied on by Tasks 5 and 7:
  - `buildCodexArgs({ resumeSessionId: string|null, model: string, modelExplicit: boolean, fullPrompt: string }) => string[]`
  - `config.agentModelExplicit: boolean`

`AGENT_MODEL` defaults to `claude-opus-5`, which is meaningless to Codex. Rather than a per-runner default table that ages badly every time a model is renamed, `--model` is omitted entirely unless the operator set one, and Codex picks its own default.

- [ ] **Step 1: Write the failing tests**

Append to `portal/test/codex.test.js`, and extend the import at the top of that file to `import { parseCodexEvents, buildCodexArgs } from '../src/runners/codex.js';`:

```javascript
const PROMPT = 'system rules\n\njob advert text';

test('a new session builds the documented exec argv', () => {
  const args = buildCodexArgs({
    resumeSessionId: null, model: 'gpt-5-codex', modelExplicit: false, fullPrompt: PROMPT,
  });
  assert.deepEqual(args, [
    'exec', '--json',
    '--sandbox', 'danger-full-access',
    '--skip-git-repo-check',
    PROMPT,
  ]);
});

test('an explicit model adds --model, in that position', () => {
  const args = buildCodexArgs({
    resumeSessionId: null, model: 'gpt-5-codex', modelExplicit: true, fullPrompt: PROMPT,
  });
  assert.deepEqual(args, [
    'exec', '--json',
    '--sandbox', 'danger-full-access',
    '--skip-git-repo-check',
    '--model', 'gpt-5-codex',
    PROMPT,
  ]);
});

test('no --model anywhere when the model was not set explicitly', () => {
  const args = buildCodexArgs({
    resumeSessionId: null, model: 'claude-opus-5', modelExplicit: false, fullPrompt: PROMPT,
  });
  assert.equal(args.includes('--model'), false);
  assert.equal(args.includes('claude-opus-5'), false);
});

test('resuming uses the exec resume subcommand with the id in third position', () => {
  const args = buildCodexArgs({
    resumeSessionId: 'th_abc123', model: 'gpt-5-codex', modelExplicit: false, fullPrompt: PROMPT,
  });
  assert.deepEqual(args, [
    'exec', 'resume', 'th_abc123', '--json',
    '--sandbox', 'danger-full-access',
    '--skip-git-repo-check',
    PROMPT,
  ]);
});

test('the prompt is always the final argument, on both paths', () => {
  for (const resumeSessionId of [null, 'th_abc123']) {
    const args = buildCodexArgs({
      resumeSessionId, model: 'gpt-5-codex', modelExplicit: true, fullPrompt: PROMPT,
    });
    assert.equal(args[args.length - 1], PROMPT);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd portal && node --test test/codex.test.js`
Expected: FAIL with `buildCodexArgs is not a function`.

- [ ] **Step 3: Write `buildCodexArgs`**

Append to `portal/src/runners/codex.js`:

```javascript
// Matches the bypassPermissions posture the claude-sdk runner already runs
// with, and which docs/portal.md documents. Hardcoded rather than exposed as
// an env var because the only other values break the workflow: workspace-write
// blocks network access, which silently guts the salary, company and
// interviewer research the portal agent depends on.
const SANDBOX = ['--sandbox', 'danger-full-access'];

// A project folder created outside the kit checkout need not be a git
// repository, and codex refuses to run in one without this.
const SKIP_REPO_CHECK = '--skip-git-repo-check';

// The prompt goes on argv rather than through the documented `-` stdin
// sentinel. It is the form the docs lead with, there is no quoting hazard
// because runCodex spawns without a shell, and a portal prompt plus a job
// advert is tens of kilobytes, far inside ARG_MAX on macOS and Linux. The
// resume path is a subcommand whose composition with the stdin sentinel is
// not documented at all, and one unverified assumption about resume is
// enough.
//
// CALIBRATION FIX POINT: if `npm run calibrate` reports that the argv is
// wrong, this function is the only place to change it.
export function buildCodexArgs({ resumeSessionId, model, modelExplicit, fullPrompt }) {
  const head = resumeSessionId ? ['exec', 'resume', resumeSessionId] : ['exec'];
  const modelArgs = modelExplicit ? ['--model', model] : [];
  return [...head, '--json', ...SANDBOX, SKIP_REPO_CHECK, ...modelArgs, fullPrompt];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd portal && node --test test/codex.test.js`
Expected: PASS, 17 tests.

- [ ] **Step 5: Add `agentModelExplicit` to config**

In `portal/src/config.js`, find the line:

```javascript
  agentModel: process.env.AGENT_MODEL || 'claude-opus-5',
```

and replace it with:

```javascript
  agentModel: process.env.AGENT_MODEL || 'claude-opus-5',
  // Whether the fallback above is in play. The codex runner omits --model
  // entirely when it is not, so the Claude default can never leak into a
  // codex command line. Same pattern as emailProviderExplicit below.
  agentModelExplicit: Boolean(process.env.AGENT_MODEL),
```

- [ ] **Step 6: Verify config exposes it**

Add this test to `portal/test/preflight.test.js`, immediately after the existing test named `config exposes bindHost, exposure and emailProviderExplicit`:

```javascript
test('config exposes agentModelExplicit', async () => {
  const { config } = await import('../src/config.js');
  assert.equal(typeof config.agentModelExplicit, 'boolean');
});
```

Run: `cd portal && npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add portal/src/runners/codex.js portal/src/config.js portal/test/codex.test.js portal/test/preflight.test.js
git commit -m "feat(portal): build codex argv, and omit --model unless set"
```

---

### Task 5: `runCodex`, the spawn wrapper, and registration

**Files:**
- Modify: `portal/src/runners/codex.js`
- Modify: `portal/src/agent.js:161-166` (the `RUNNERS` map and imports)
- Create: `portal/test/fixtures/bin/codex`
- Test: `portal/test/codex.test.js`, `portal/test/agent.test.js`

**Interfaces:**
- Consumes: `createCodexEventSink` and `buildCodexArgs` from Tasks 3 and 4, and `config.agentModelExplicit` from Task 4.
- Produces: `runCodex({ prompt, systemPrompt, resumeSessionId, cwd, model }, { spawnImpl }) => Promise<{ sessionId: string|null, text: string }>`, registered as `codex` in `agent.js`'s `RUNNERS` map. This satisfies the runner contract already documented above that map, unchanged.

Every failure path throws, so that the existing recovery in `portal/src/queue.js` takes over: one retry in a fresh session carrying `buildRecoveryPrompt` context. That is the whole point of the task. A broken resume degrades to a cold session with a visible failure, instead of today's silent amnesia.

- [ ] **Step 1: Write the fixture binary**

Create `portal/test/fixtures/bin/codex`. It stands in for the real CLI on `PATH`, so the spawn plumbing is exercised for real without a fake `spawnImpl`.

```sh
#!/bin/sh
# Stand-in for the codex CLI in tests. Emits a real-shaped JSON Lines event
# stream on stdout and exits 0. POSIX sh only: the kit supports macOS, whose
# system bash is 3.2, and the development box's bash 5.2 would hide the
# difference. Argv is echoed to stderr so a test can inspect what was passed.
echo "argv: $*" >&2
printf '%s\n' '{"type":"thread.started","thread_id":"th_fixture_1"}'
printf '%s\n' '{"type":"turn.started"}'
printf '%s\n' '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls","aggregated_output":"","exit_code":null,"status":"in_progress"}}'
printf '%s\n' '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"Fixture reply."}}'
printf '%s\n' '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":3}}'
```

Make it executable, and confirm git will record the bit:

```bash
chmod +x portal/test/fixtures/bin/codex
git add portal/test/fixtures/bin/codex
git ls-files -s portal/test/fixtures/bin/codex
```

Expected: output begins `100755`. If it begins `100644` the fixture test will fail with `EACCES`.

- [ ] **Step 2: Write the failing tests**

Replace the import block at the top of `portal/test/codex.test.js` with the following, and append the tests below to the end of the file. The env vars must be set before the dynamic import because `src/config.js` reads `process.env` at import time.

```javascript
import test from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, join, delimiter } from 'node:path';

process.env.DB_PATH = ':memory:';
process.env.AGENT_RUNNER = 'codex';
delete process.env.AGENT_MODEL;
const { parseCodexEvents, buildCodexArgs, runCodex } =
  await import('../src/runners/codex.js');

const FIXTURE_BIN = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bin');

// A fake child process. `chunks` are written to stdout in order, so a test
// can split a JSON line across two of them.
function fakeSpawn({ chunks = [], stderr = '', exitCode = 0, spawnError = null } = {}) {
  const calls = [];
  const impl = (bin, args, opts) => {
    calls.push({ bin, args, opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      if (spawnError) { child.emit('error', spawnError); return; }
      for (const chunk of chunks) child.stdout.emit('data', Buffer.from(chunk));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', exitCode);
    });
    return impl.child = child;
  };
  impl.calls = calls;
  return impl;
}

const TURN = { prompt: 'job advert', systemPrompt: 'portal rules', resumeSessionId: null, cwd: '/tmp', model: 'gpt-5-codex' };

test('a well-formed stream yields the session id and the reply', async () => {
  const spawnImpl = fakeSpawn({ chunks: [[THREAD, TURN_STARTED, CMD, MSG, TURN_DONE].join('\n') + '\n'] });
  const out = await runCodex(TURN, { spawnImpl });
  assert.equal(out.sessionId, 'th_abc123');
  assert.equal(out.text, 'Fit assessment ready.');
});

test('the system prompt is prepended to the prompt', async () => {
  const spawnImpl = fakeSpawn({ chunks: [[THREAD, MSG].join('\n') + '\n'] });
  await runCodex(TURN, { spawnImpl });
  const args = spawnImpl.calls[0].args;
  assert.equal(args[args.length - 1], 'portal rules\n\njob advert');
});

test('it spawns codex in the session cwd', async () => {
  const spawnImpl = fakeSpawn({ chunks: [[THREAD, MSG].join('\n') + '\n'] });
  await runCodex(TURN, { spawnImpl });
  assert.equal(spawnImpl.calls[0].bin, 'codex');
  assert.equal(spawnImpl.calls[0].opts.cwd, '/tmp');
});

test('a JSON line split across two chunks still parses', async () => {
  const line = MSG + '\n';
  const spawnImpl = fakeSpawn({
    chunks: [THREAD + '\n' + line.slice(0, 40), line.slice(40)],
  });
  const out = await runCodex(TURN, { spawnImpl });
  assert.equal(out.text, 'Fit assessment ready.');
});

test('a final line with no trailing newline is not dropped', async () => {
  const spawnImpl = fakeSpawn({ chunks: [THREAD + '\n' + MSG] });
  const out = await runCodex(TURN, { spawnImpl });
  assert.equal(out.text, 'Fit assessment ready.');
});

test('resuming carries the previous session id when no thread.started arrives', async () => {
  const spawnImpl = fakeSpawn({ chunks: [MSG + '\n'] });
  const out = await runCodex({ ...TURN, resumeSessionId: 'th_old' }, { spawnImpl });
  assert.equal(out.sessionId, 'th_old');
  assert.deepEqual(spawnImpl.calls[0].args.slice(0, 3), ['exec', 'resume', 'th_old']);
});

test('ENOENT throws an error naming codex and PATH', async () => {
  const spawnError = Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
  const spawnImpl = fakeSpawn({ spawnError });
  await assert.rejects(() => runCodex(TURN, { spawnImpl }), /codex was not found on PATH/);
});

test('a non-zero exit throws with the stderr text included', async () => {
  const spawnImpl = fakeSpawn({ chunks: [], stderr: 'not logged in', exitCode: 1 });
  await assert.rejects(() => runCodex(TURN, { spawnImpl }), /codex exited 1: not logged in/);
});

test('turn.failed throws rather than returning an empty reply', async () => {
  const failed = '{"type":"turn.failed","error":{"message":"context window exceeded"}}';
  const spawnImpl = fakeSpawn({ chunks: [[THREAD, failed].join('\n') + '\n'] });
  await assert.rejects(() => runCodex(TURN, { spawnImpl }), /context window exceeded/);
});

test('exit 0 with no agent_message throws rather than storing empty text', async () => {
  const spawnImpl = fakeSpawn({ chunks: [[THREAD, TURN_STARTED, TURN_DONE].join('\n') + '\n'] });
  await assert.rejects(() => runCodex(TURN, { spawnImpl }), /no agent_message/);
});

test('fixture: a real spawn of a codex stand-in on PATH works end to end', async () => {
  const originalPath = process.env.PATH;
  process.env.PATH = `${FIXTURE_BIN}${delimiter}${originalPath}`;
  try {
    const out = await runCodex(TURN);
    assert.equal(out.sessionId, 'th_fixture_1');
    assert.equal(out.text, 'Fixture reply.');
  } finally {
    process.env.PATH = originalPath;
  }
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd portal && node --test test/codex.test.js`
Expected: FAIL with `runCodex is not a function`.

- [ ] **Step 4: Write `runCodex`**

Append to `portal/src/runners/codex.js`, and add `import { spawn } from 'node:child_process';` and `import { config } from '../config.js';` at the very top of the file:

```javascript
// Satisfies the runner contract documented in src/agent.js. spawnImpl is
// injected so tests need no child process.
//
// The system prompt is re-sent on every turn including resumes, matching the
// claude-sdk runner, which passes options.systemPrompt on each query(). This
// costs tokens and is deliberate: the session-title and email-to-user
// directive formats are load-bearing for the portal, codex compacts long
// threads, and an instruction that had aged out of a compacted context would
// produce a session that silently stopped naming itself and stopped
// delivering documents.
export async function runCodex(
  { prompt, systemPrompt, resumeSessionId, cwd, model },
  { spawnImpl = spawn } = {},
) {
  const fullPrompt = `${systemPrompt}\n\n${prompt}`;
  const args = buildCodexArgs({
    resumeSessionId: resumeSessionId || null,
    model,
    modelExplicit: config.agentModelExplicit,
    fullPrompt,
  });

  const sink = createCodexEventSink();
  let partial = '';
  let errOut = '';

  await new Promise((resolve, reject) => {
    const child = spawnImpl('codex', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => {
      partial += data;
      const lines = partial.split('\n');
      // The last element is either an incomplete line or an empty string, and
      // is held back until the next chunk completes it.
      partial = lines.pop();
      for (const line of lines) sink.push(line);
    });
    child.stderr.on('data', data => { errOut += data; });
    child.on('error', error => reject(
      error.code === 'ENOENT'
        ? new Error('codex was not found on PATH. Install the Codex CLI, or set AGENT_RUNNER to a runner you have.')
        : error));
    child.on('close', code => {
      if (partial.trim()) sink.push(partial);
      if (code !== 0) reject(new Error(`codex exited ${code}: ${errOut.trim()}`));
      else resolve();
    });
  });

  const { threadId, text, failure } = sink.result();
  // Everything below throws, so queue.js's existing recovery takes over: one
  // retry in a fresh session carrying buildRecoveryPrompt context. That is
  // strictly better than storing a raw event stream as the reply, which is
  // what the generic cli runner did.
  if (failure) throw new Error(`codex turn failed: ${failure}`);
  if (text === null) {
    throw new Error('codex exited cleanly but emitted no agent_message, so there is no reply to store.');
  }
  return { sessionId: threadId ?? resumeSessionId ?? null, text };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd portal && node --test test/codex.test.js`
Expected: PASS, 28 tests.

- [ ] **Step 6: Register the runner in `agent.js`, and export the names**

`RUNNER_NAMES` is exported so that `preflight.js` (Task 6) can be tested against it. Two hand-maintained lists of runner names in two files would drift; one exported list plus a test that pins them together cannot.

In `portal/src/agent.js`, add to the imports at the top:

```javascript
import { runCodex } from './runners/codex.js';
```

change the `RUNNERS` map from:

```javascript
const RUNNERS = { 'claude-sdk': runClaudeSdk, cli: runCli };
```

to:

```javascript
const RUNNERS = { 'claude-sdk': runClaudeSdk, cli: runCli, codex: runCodex };

// The vocabulary of valid AGENT_RUNNER values, exported so preflight.js can
// be checked against it rather than repeating the list.
export const RUNNER_NAMES = Object.keys(RUNNERS);
```

- [ ] **Step 7: Add the registration test**

Append to `portal/test/agent.test.js`:

```javascript
test('codex is a registered runner', async () => {
  const { RUNNER_NAMES } = await import('../src/agent.js');
  assert.ok(RUNNER_NAMES.includes('codex'), `expected codex in ${RUNNER_NAMES.join(', ')}`);
});
```

- [ ] **Step 8: Run the full suite**

Run: `cd portal && npm test`
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add portal/src/runners/codex.js portal/src/agent.js portal/test/codex.test.js portal/test/agent.test.js portal/test/fixtures/bin/codex
git commit -m "feat(portal): add a real codex runner with session resume"
```

---

### Task 6: Preflight checks for the agent runner

**Files:**
- Modify: `portal/src/preflight.js`
- Test: `portal/test/preflight.test.js`

**Interfaces:**
- Consumes: `config.agentModelExplicit` from Task 4; `RUNNER_NAMES` exported from `portal/src/agent.js` in Task 5.
- Produces: `checkConfig(cfg, { exists, lookupBin })`, a second injection point alongside the existing `exists`, with `lookupBin(bin: string) => boolean`; and `AGENT_RUNNERS: string[]`, exported so the drift test in Step 7 can pin it against `RUNNER_NAMES`.

Today an unknown `AGENT_RUNNER` throws from `runAgentTurn` at the first job, long after startup, and surfaces to the user as a failed session rather than as a configuration problem.

- [ ] **Step 1: Update the shared `valid()` helper**

`checkConfig` is about to read three fields the test helper does not supply, which would make the existing `a valid config produces no issues` test fail for the wrong reason. In `portal/test/preflight.test.js`, add these three lines to the object returned by `valid()`, immediately after `projectDir`:

```javascript
    agentRunner: 'claude-sdk',
    agentModel: 'claude-opus-5',
    agentModelExplicit: false,
```

- [ ] **Step 2: Write the failing tests**

Append to `portal/test/preflight.test.js`:

```javascript
const binPresent = () => true;
const binAbsent = () => false;

test('an unknown AGENT_RUNNER is an error naming the valid values', () => {
  const issues = checkConfig(valid({ agentRunner: 'gemini' }), { exists: alwaysExists });
  assert.equal(errors(issues).length, 1);
  assert.match(errors(issues)[0].message, /AGENT_RUNNER/);
  assert.match(errors(issues)[0].message, /claude-sdk, cli, codex/);
});

test('an empty AGENT_RUNNER is an error', () => {
  const issues = checkConfig(valid({ agentRunner: '' }), { exists: alwaysExists });
  assert.equal(errors(issues).length, 1);
  assert.match(errors(issues)[0].message, /AGENT_RUNNER/);
});

test('each valid AGENT_RUNNER passes', () => {
  for (const agentRunner of ['claude-sdk', 'cli', 'codex']) {
    const issues = checkConfig(
      valid({ agentRunner }), { exists: alwaysExists, lookupBin: binPresent });
    assert.deepEqual(errors(issues), [], `expected no errors for ${agentRunner}`);
  }
});

test('AGENT_RUNNER=codex with no codex on PATH is an error', () => {
  const issues = checkConfig(
    valid({ agentRunner: 'codex' }), { exists: alwaysExists, lookupBin: binAbsent });
  assert.equal(errors(issues).length, 1);
  assert.match(errors(issues)[0].message, /codex/);
  assert.match(errors(issues)[0].message, /PATH/);
});

test('the PATH check applies only to the codex runner', () => {
  for (const agentRunner of ['claude-sdk', 'cli']) {
    const issues = checkConfig(
      valid({ agentRunner }), { exists: alwaysExists, lookupBin: binAbsent });
    assert.deepEqual(errors(issues), [], `expected no errors for ${agentRunner}`);
  }
});

test('AGENT_RUNNER=codex with an explicit Claude AGENT_MODEL is an error', () => {
  const issues = checkConfig(
    valid({ agentRunner: 'codex', agentModel: 'claude-opus-5', agentModelExplicit: true }),
    { exists: alwaysExists, lookupBin: binPresent });
  assert.equal(errors(issues).length, 1);
  assert.match(errors(issues)[0].message, /AGENT_MODEL/);
});

test('AGENT_RUNNER=codex with an unset AGENT_MODEL is fine, even though the default is a Claude id', () => {
  const issues = checkConfig(
    valid({ agentRunner: 'codex', agentModel: 'claude-opus-5', agentModelExplicit: false }),
    { exists: alwaysExists, lookupBin: binPresent });
  assert.deepEqual(errors(issues), []);
});

test('AGENT_RUNNER=codex with an explicit codex model is fine', () => {
  const issues = checkConfig(
    valid({ agentRunner: 'codex', agentModel: 'gpt-5-codex', agentModelExplicit: true }),
    { exists: alwaysExists, lookupBin: binPresent });
  assert.deepEqual(errors(issues), []);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd portal && node --test test/preflight.test.js`
Expected: FAIL. `an unknown AGENT_RUNNER is an error naming the valid values` reports 0 errors where 1 was expected.

- [ ] **Step 4: Implement the checks**

In `portal/src/preflight.js`, change the first import line from:

```javascript
import { existsSync } from 'node:fs';
```

to:

```javascript
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
```

Add these two blocks just after the `PROVIDERS_NEEDING_FROM` constant:

```javascript
// Every value agent.js's RUNNERS map accepts. Kept here so a bad AGENT_RUNNER
// fails at startup rather than at the first job, where it currently surfaces
// to the user as a failed session rather than a configuration problem. Not
// imported from agent.js, because that would pull the Claude SDK into a
// module whose whole point is to run cheaply before anything else loads;
// agent.test.js pins the two lists together instead.
export const AGENT_RUNNERS = ['claude-sdk', 'cli', 'codex'];

// Is `bin` executable somewhere on PATH? A plain scan rather than a
// subprocess, so preflight stays synchronous and cheap. Injected as
// `lookupBin` so tests need no real binary.
function onPath(bin) {
  return (process.env.PATH || '')
    .split(delimiter)
    .some(dir => dir && existsSync(join(dir, bin)));
}
```

Change the `checkConfig` signature from:

```javascript
export function checkConfig(cfg, { exists = existsSync } = {}) {
```

to:

```javascript
export function checkConfig(cfg, { exists = existsSync, lookupBin = onPath } = {}) {
```

Then add this section immediately before the `// --- Bind ---` section near the end of the function:

```javascript
  // --- Agent runner --------------------------------------------------------
  const runner = cfg.agentRunner || '';
  if (!AGENT_RUNNERS.includes(runner)) {
    err(`AGENT_RUNNER is "${runner}", which is not one of: ${AGENT_RUNNERS.join(', ')}.`);
  } else if (runner === 'codex') {
    if (!lookupBin('codex')) {
      err('AGENT_RUNNER is "codex" but no codex binary is on PATH. Install the Codex CLI, or set AGENT_RUNNER=claude-sdk in .env.');
    }
    // AGENT_MODEL defaults to a Claude id, so only an explicit setting is a
    // mistake. Left unset, the codex runner omits --model and codex chooses.
    if (cfg.agentModelExplicit && /^claude-/.test(cfg.agentModel || '')) {
      err(`AGENT_RUNNER is "codex" but AGENT_MODEL is "${cfg.agentModel}", which is a Claude model id. Leave AGENT_MODEL unset to let codex choose its own default, or set a codex model.`);
    }
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd portal && node --test test/preflight.test.js`
Expected: PASS.

- [ ] **Step 6: Pin the two runner lists together**

`AGENT_RUNNERS` in `preflight.js` and `RUNNER_NAMES` in `agent.js` are separate lists by design (see the comment added in Step 4). This test is what stops them drifting: adding a fourth runner to one and not the other now fails immediately, rather than producing a runner that preflight rejects or one it waves through into a runtime crash.

Append to `portal/test/agent.test.js`:

```javascript
test('the preflight runner vocabulary matches the runners that actually exist', async () => {
  const { RUNNER_NAMES } = await import('../src/agent.js');
  const { AGENT_RUNNERS } = await import('../src/preflight.js');
  assert.deepEqual([...AGENT_RUNNERS].sort(), [...RUNNER_NAMES].sort());
});
```

Run: `cd portal && node --test test/agent.test.js`
Expected: PASS.

- [ ] **Step 7: Run the full suite and commit**

Run: `cd portal && npm test`
Expected: all tests pass.

```bash
git add portal/src/preflight.js portal/test/preflight.test.js portal/test/agent.test.js
git commit -m "feat(portal): validate AGENT_RUNNER and the codex binary at startup"
```

---

### Task 7: Portal calibration

**Files:**
- Create: `portal/scripts/calibrate.js`
- Modify: `portal/package.json`

**Interfaces:**
- Consumes: `buildCodexArgs` and `createCodexEventSink` from Tasks 3 and 4; `config.agentRunner`, `config.agentModel`, `config.agentModelExplicit`.
- Produces: `npm run calibrate` in `portal/`. No module exports; this is a script.

The handover step. The Codex runner was written to the documented event stream and has never met a live binary. Calibration probes the binary the user actually has, using the same two pure functions the runner uses, and reports which assumptions hold. It is required before first use of a non-Claude runner, not an optional check.

It writes only inside `portal/data/` (gitignored) and a throwaway temp directory. It never touches a real project folder, because step 3 runs an agent with `danger-full-access`.

- [ ] **Step 1: Create the script**

Create `portal/scripts/calibrate.js`:

```javascript
#!/usr/bin/env node
// Portal calibration. The codex runner is written to the documented
// `codex exec --json` event stream and has never been exercised against a
// live binary. This script probes the binary actually installed, using the
// same pure functions the runner uses, and reports which assumptions hold.
//
// Run it before using a non-Claude runner for the first time:
//   cd portal && npm run calibrate
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../src/config.js';
import { buildCodexArgs, createCodexEventSink } from '../src/runners/codex.js';

const SENTINEL = 'CALIBRATION-OK-7391';
const DATA_DIR = new URL('../data/', import.meta.url).pathname;

const verdicts = [];
function record(name, ok, detail) {
  verdicts.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
}

function heading(text) {
  console.log(`\n== ${text}`);
}

// Run codex with the given argv, collecting raw stdout and feeding the runner's
// own sink, so calibration and the runner can never disagree about parsing.
function runCodex(args, cwd) {
  return new Promise(resolve => {
    const child = spawn('codex', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const sink = createCodexEventSink();
    let raw = '';
    let partial = '';
    let errOut = '';
    child.stdout.on('data', data => {
      raw += data;
      partial += data;
      const lines = partial.split('\n');
      partial = lines.pop();
      for (const line of lines) sink.push(line);
    });
    child.stderr.on('data', data => { errOut += data; });
    child.on('error', error => resolve({ spawnError: error, raw, errOut, ...sink.result() }));
    child.on('close', code => {
      if (partial.trim()) sink.push(partial);
      resolve({ code, raw, errOut, ...sink.result() });
    });
  });
}

async function calibrateCodex() {
  heading('Step 1: is codex installed?');
  const version = spawnSync('codex', ['--version'], { encoding: 'utf8' });
  if (version.error || version.status !== 0) {
    record('codex is on PATH', false, 'not found, or --version failed');
    console.log('\nInstall the Codex CLI first: npm install -g @openai/codex');
    return 1;
  }
  record('codex is on PATH', true, version.stdout.trim());

  heading('Step 2: capturing help output as evidence');
  for (const args of [['exec', '--help'], ['exec', 'resume', '--help']]) {
    const help = spawnSync('codex', args, { encoding: 'utf8' });
    console.log(`--- codex ${args.join(' ')} ---`);
    console.log((help.stdout || help.stderr || '(no output)').trim());
  }

  heading('Step 3: one real turn in a throwaway directory');
  const scratch = mkdtempSync(join(tmpdir(), 'portal-calibrate-'));
  console.log(`Working directory: ${scratch}`);
  const newArgs = buildCodexArgs({
    resumeSessionId: null,
    model: config.agentModel,
    modelExplicit: config.agentModelExplicit,
    fullPrompt: `Reply with exactly this token and nothing else: ${SENTINEL}`,
  });
  console.log(`argv: codex ${newArgs.slice(0, -1).join(' ')} <prompt>`);
  const first = await runCodex(newArgs, scratch);

  mkdirSync(DATA_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const rawPath = join(DATA_DIR, `calibration-${stamp}.jsonl`);
  writeFileSync(rawPath, first.raw);
  console.log(`Raw stream saved to ${rawPath}`);

  if (first.spawnError) {
    record('the new-session argv is accepted', false, first.spawnError.message);
    return 1;
  }
  record('the new-session argv is accepted', first.code === 0,
    first.code === 0 ? 'exit 0' : `exit ${first.code}: ${first.errOut.trim()}`);

  heading('Step 4: does the parser find what the runner needs?');
  record('a thread id was found', Boolean(first.threadId), first.threadId || 'none, so resume can never work');
  record('an agent_message was found', first.text !== null, first.text === null ? 'none' : 'yes');
  record('the reply contains the sentinel', Boolean(first.text?.includes(SENTINEL)),
    first.text ? first.text.slice(0, 120) : 'no reply');

  if (!first.threadId) {
    console.log('\nNo thread id, so the resume path cannot be tested. Fix parseCodexEvents');
    console.log('first: compare the thread.started line in the saved stream against the');
    console.log('field names it reads.');
    return 1;
  }

  heading('Step 5: does resume work, and does the thread carry?');
  const resumeArgs = buildCodexArgs({
    resumeSessionId: first.threadId,
    model: config.agentModel,
    modelExplicit: config.agentModelExplicit,
    fullPrompt: 'What was the exact token I asked you to reply with in my previous message? Reply with just that token.',
  });
  console.log(`argv: codex ${resumeArgs.slice(0, -1).join(' ')} <prompt>`);
  const second = await runCodex(resumeArgs, scratch);

  // Two separate questions, deliberately reported separately: whether the
  // command line was accepted at all, and whether the thread remembered.
  record('the resume argv is accepted', !second.spawnError && second.code === 0,
    second.spawnError ? second.spawnError.message
      : second.code === 0 ? 'exit 0' : `exit ${second.code}: ${second.errOut.trim()}`);
  record('the resumed thread remembered turn 1', Boolean(second.text?.includes(SENTINEL)),
    second.text ? second.text.slice(0, 120) : 'no reply');

  heading('Verdict');
  const failed = verdicts.filter(v => !v.ok);
  if (failed.length === 0) {
    console.log('All assumptions hold. AGENT_RUNNER=codex is ready to use.');
    return 0;
  }
  console.log(`${failed.length} assumption(s) did not hold:`);
  for (const v of failed) console.log(`  - ${v.name}`);
  console.log('\nWhat to change, from docs/portal.md "Portal calibration":');
  console.log('  argv wrong          -> buildCodexArgs in src/runners/codex.js');
  console.log('  resume argv wrong   -> the resume branch of buildCodexArgs');
  console.log('  fields not found    -> createCodexEventSink in src/runners/codex.js');
  console.log(`\nCompare against the raw stream in ${rawPath}, and update`);
  console.log('test/codex.test.js in the same commit so the two cannot drift.');
  return 1;
}

async function main() {
  console.log(`Portal calibration, AGENT_RUNNER=${config.agentRunner}\n`);
  switch (config.agentRunner) {
    case 'claude-sdk':
      console.log('The claude-sdk runner talks to @anthropic-ai/claude-agent-sdk in process.');
      console.log('There is no external command line to calibrate. Nothing to do.');
      return 0;
    case 'cli':
      console.log('The cli runner is driven entirely by your own AGENT_CMD and');
      console.log('AGENT_CMD_RESUME templates, so there is no fixed shape to calibrate.');
      console.log('Nothing to do.');
      return 0;
    case 'codex':
      return calibrateCodex();
    default:
      console.log(`Unknown AGENT_RUNNER "${config.agentRunner}". Valid values: claude-sdk, cli, codex.`);
      return 1;
  }
}

process.exit(await main());
```

- [ ] **Step 2: Add the npm script**

In `portal/package.json`, change the `scripts` block from:

```json
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test test/"
  },
```

to:

```json
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test test/",
    "calibrate": "node scripts/calibrate.js"
  },
```

Note that `npm test` runs `node --test test/`, so `scripts/` is not picked up as a test directory.

- [ ] **Step 3: Verify the claude-sdk path**

This is the only calibration path verifiable on a machine with no `codex` installed, and it must not crash.

```bash
cd portal && AGENT_RUNNER=claude-sdk npm run calibrate; echo "exit: $?"
```

Expected: prints the "nothing to do" message for `claude-sdk` and `exit: 0`.

- [ ] **Step 4: Verify the cli and unknown paths**

```bash
cd portal && AGENT_RUNNER=cli npm run calibrate; echo "exit: $?"
cd portal && AGENT_RUNNER=nonsense npm run calibrate; echo "exit: $?"
```

Expected: the `cli` run prints its message and `exit: 0`; the `nonsense` run names the valid values and `exit: 1`.

- [ ] **Step 5: Verify the codex path fails cleanly with no binary installed**

`codex` is not installed on this machine, so this exercises step 1's early exit.

```bash
cd portal && AGENT_RUNNER=codex npm run calibrate; echo "exit: $?"
```

Expected: `FAIL  codex is on PATH: not found, or --version failed`, the install hint, and `exit: 1`. It must not throw an unhandled exception or write anything to `portal/data/`.

- [ ] **Step 6: Run the full suite and commit**

Run: `cd portal && npm test`
Expected: all tests pass, unchanged in number from Task 6.

```bash
git add portal/scripts/calibrate.js portal/package.json
git commit -m "feat(portal): add npm run calibrate to verify a runner against its binary"
```

---

### Task 8: Correct the runner claims in config and docs

**Files:**
- Modify: `portal/src/runners/cli.js:1-13` (the header comment)
- Modify: `portal/.env.example`
- Modify: `docs/portal.md:261-293` ("Using a different LLM"), and add a "Portal calibration" section

**Interfaces:**
- Consumes: everything from Tasks 3 to 7. Documentation only; no code behaviour changes.
- Produces: nothing other tasks depend on.

The claim that other CLIs "can be wired via these templates" is what produced the original bug. Three files repeat it, and all three stop.

- [ ] **Step 1: Narrow the `cli.js` header comment**

In `portal/src/runners/cli.js`, replace the entire comment block above `export async function runCli` with:

```javascript
// Runner for CLIs that emit a single JSON object of the Claude Code
// `-p --output-format json` shape, configured by env (see .env.example):
//   AGENT_CMD        command template for a new session
//   AGENT_CMD_RESUME command template for resuming an existing session
// {model} and {sessionId} placeholders are substituted; the prompt (with the
// portal system prompt prepended) is written to the process stdin. Stdout is
// parsed as JSON when it carries result/session_id fields; otherwise it is
// treated as the raw final text and the previous sessionId is carried over.
//
// This does NOT generalise to every CLI, and used to claim that it did.
// Codex emits newline-delimited events rather than one object, so this
// runner's JSON.parse throws, the raw event stream is stored as the reply,
// and no session id is ever found, which makes every turn start cold. Codex
// has its own runner in runners/codex.js. A CLI whose output is not a single
// JSON object needs one too: the contract is in src/agent.js.
```

- [ ] **Step 2: Update `.env.example`**

In `portal/.env.example`, replace the block that currently runs from `# Claude model for portal agent sessions` down to the line ending `runner file in src/runners/ satisfying the runner contract in src/agent.js.` with:

```
# Model for portal agent sessions. Leave unset with AGENT_RUNNER=codex: the
# codex runner then omits --model entirely and lets codex pick its own
# default, rather than passing it a Claude model id.
AGENT_MODEL=claude-opus-5
# Agent runner: claude-sdk (default, uses @anthropic-ai/claude-agent-sdk)
#             | codex      (uses `codex exec --json`; run `npm run calibrate` first)
#             | cli        (a CLI that emits one Claude-Code-shaped JSON object)
AGENT_RUNNER=claude-sdk
# CLI runner command templates (if AGENT_RUNNER=cli). {model} and {sessionId}
# are substituted; the prompt is piped to stdin. Claude Code example:
#AGENT_CMD=claude -p --output-format json --model {model}
#AGENT_CMD_RESUME=claude -p --output-format json --resume {sessionId}
# These templates suit CLIs that print a single JSON object. They do not suit
# codex, which streams newline-delimited events and needs AGENT_RUNNER=codex.
# Gemini CLI and Cursor have no runner; see docs/portal.md.
```

- [ ] **Step 3: Rewrite "Using a different LLM" in `docs/portal.md`**

Replace the whole section from the `## Using a different LLM` heading down to the line immediately before `## Security` with:

````markdown
## Using a different LLM

The portal is Claude-first but not Claude-only. `AGENT_RUNNER` selects how
sessions run:

- **`claude-sdk`** (the default) uses `@anthropic-ai/claude-agent-sdk` in
  process. This is the tested path.
- **`codex`** shells out to `codex exec --json`. New, and calibration is
  required before first use; see the next section.
- **`cli`** shells out to a command-line tool using the templates below. It
  suits a CLI that prints a single JSON object of the Claude Code
  `-p --output-format json` shape, and nothing else.

Gemini CLI and Cursor have no runner. They work well on a project folder
through `AGENTS.md`, but they cannot drive the portal.

### The runner contract

Adding first-class support for another LLM means writing one file under
`src/runners/` that exports a single async function taking
`{ prompt, systemPrompt, resumeSessionId, cwd, model }` and returning
`{ sessionId, text }` (the contract is documented in `src/agent.js`), then
adding it to the `RUNNERS` map there and to `AGENT_RUNNERS` in
`src/preflight.js`.

Write a runner, rather than reaching for `AGENT_RUNNER=cli`, whenever the
tool's output is not a single JSON object. `cli` used to claim it could wire
up any CLI. It cannot, and the failure is silent and expensive: with a
streaming tool its `JSON.parse` throws, the raw event stream gets stored as
the assistant's reply and shown to the user, and no session id is ever found,
so every turn starts a fresh session with no memory. The portal's core loop
(fit assessment, then apply, then notes, then interview prep) depends
entirely on the session remembering the turn before.

### CLI templates

For a CLI that does print one JSON object, set `AGENT_RUNNER=cli` and provide:

- `AGENT_CMD`: the command for a fresh session. `{model}` is substituted.
- `AGENT_CMD_RESUME`: the command for resuming a session. `{sessionId}` is
  substituted.

The prompt is piped to the command's stdin. A worked Claude Code CLI example:

```bash
AGENT_RUNNER=cli
AGENT_CMD=claude -p --output-format json --model {model}
AGENT_CMD_RESUME=claude -p --output-format json --resume {sessionId}
```

Two limitations: command templates are split on whitespace, so quoted
arguments containing spaces are not supported (wrap the invocation in a small
shell script instead), and a resume mechanism that is a subcommand rather
than a flag cannot be expressed at all.

### Using Codex

Install the Codex CLI and log in per its own instructions, then:

```bash
AGENT_RUNNER=codex
# AGENT_MODEL left unset on purpose: see below
```

Leave `AGENT_MODEL` unset unless you want a specific Codex model. It defaults
to a Claude model id, and the codex runner omits `--model` altogether when it
was not set explicitly, so Codex chooses its own default. Preflight treats an
explicitly set `claude-*` model with this runner as an error.

The runner runs Codex with `--sandbox danger-full-access`. That matches the
`bypassPermissions` posture the `claude-sdk` runner already uses, described
under Security below, so the portal's risk profile does not change with the
runner. The weaker `workspace-write` was not used because it blocks network
access, which would silently gut the salary, company and interviewer research
the portal agent depends on, while the agent carried on and returned thinner
work with no sign of why.

## Portal calibration

**The codex runner was written to the documented `codex exec --json` event
stream and has never been exercised against a live binary.** Codex is not
installed on the machine the kit is developed on. Rather than claim tested
support, the portal ships a calibration step that verifies the assumptions
against the binary you actually have.

Run it once before using a non-Claude runner for the first time:

```bash
cd portal && npm run calibrate
```

It confirms `codex` is installed, captures `codex exec --help` and
`codex exec resume --help` as evidence, runs one real turn in a throwaway
directory using exactly the argv the runner builds, saves the raw event
stream to `portal/data/calibration-<date>.jsonl`, feeds it through exactly the
parser the runner uses, and then resumes that thread with a question only
answerable from the first turn. It prints a pass or fail line per assumption.

It never touches a real project folder, because that turn runs an agent with
full access.

If something fails, there is exactly one place to change for each case:

| What failed | What to change |
| --- | --- |
| The new-session argv was rejected | `buildCodexArgs` in `src/runners/codex.js`, the non-resume branch |
| The resume argv was rejected | `buildCodexArgs`, the resume branch |
| No thread id, or no `agent_message`, was found | `createCodexEventSink` in `src/runners/codex.js` |
| Resume was accepted but the thread did not remember | the resume argv is being accepted and ignored; compare `codex exec resume --help` against what calibration printed |

Compare against the saved `.jsonl` to see what the real events look like, and
update `test/codex.test.js` in the same commit. Those tests pin the exact argv
and event field names on purpose, so that a correction cannot be applied to
the runner and missed in the tests.
````

- [ ] **Step 4: Check the docs against the house style**

British English, and no em or en dashes as sentence punctuation.

```bash
cd /home/spacetimejam/j4dev
grep -n '[—–]' docs/portal.md portal/.env.example portal/src/runners/cli.js || echo "no long dashes (correct)"
```

Expected: `no long dashes (correct)`.

- [ ] **Step 5: Verify nothing broke**

The `.env.example` value `AGENT_RUNNER=claude-sdk` is read by nothing at test time, but `preflight.test.js` asserts on `PLACEHOLDER_SECRET`, which is still present in the file, and `setup/test/run-tests.sh` greps SETUP.md text that this task does not touch.

```bash
cd portal && npm test
cd /home/spacetimejam/j4dev && bash setup/test/run-tests.sh
```

Expected: all portal tests pass; `Failed: 0` from the setup tests.

- [ ] **Step 6: Commit**

```bash
git add portal/src/runners/cli.js portal/.env.example docs/portal.md
git commit -m "docs(portal): correct the runner claims and document calibration"
```

---

### Task 9: The getting-started guide's provider chapter

**Files:**
- Modify: `docs/getting-started/guide.typ`
- Modify: `docs/getting-started/Job Search Kit - Getting Started.pdf`

**Interfaces:**
- Consumes: the support position established in Tasks 1, 5 and 8. Nothing depends on this task.
- Produces: nothing other tasks depend on. This is the last task.

The guide's audience has not opened a terminal before. It gets the practical instruction and one sentence pointing at `docs/portal.md`; the calibration detail stays there.

- [ ] **Step 1: Correct the over-promise under "What you need"**

In `docs/getting-started/guide.typ`, find the bullet:

```
- An *AI coding assistant*. The kit is built for *Claude Code* and works best with it; a paid Claude plan (Pro or Max) is required. Other tools that read AGENTS.md files (Codex, Gemini CLI, Cursor) also work.
```

Replace it with:

```
- An *AI coding assistant*. The kit is built for *Claude Code* and works best with it; a paid Claude plan (Pro or Max) is required. Codex, Gemini CLI and Cursor can also run your search, with some differences worth knowing about before you choose. See "Using a different AI assistant" near the end of this guide.
```

- [ ] **Step 2: Add the provider chapter**

Insert this new section into `docs/getting-started/guide.typ` between the end of `== Step 5: fetch the kit and hand over to the wizard` and the `== Good to know` heading. Note the outer fence below is four backticks because the content itself contains three-backtick code blocks; insert the inner content only.

````typst
== Using a different AI assistant

The kit is built for Claude Code and that is the smoothest path. Three other
assistants can run your search too. What differs is not the quality of the
help you get day to day, but whether the optional web portal works with them.

*Claude Code.* Everything works: your project folder and the portal. Nothing
extra to do.

*Codex.* Your project folder works straight away. Portal support is new. To
install it (Node.js from step 4 is needed first):

```
npm install -g @openai/codex
codex
```

The first launch walks you through signing in. To use it with the portal, set
`AGENT_RUNNER=codex` in the portal's configuration, and ask whoever runs the
portal to run its calibration check first. That check is described in
`docs/portal.md`; it takes a couple of minutes and confirms the kit and your
version of Codex agree with each other.

*Gemini CLI.* Your project folder works, after one setting. To install it:

```
npm install -g @google/gemini-cli
gemini
```

Gemini looks for a file called `GEMINI.md`, while the kit writes `AGENTS.md`.
Point it at the right file by creating `.gemini/settings.json` in your project
folder containing:

```
{ "contextFileName": ["AGENTS.md", "GEMINI.md"] }
```

On newer versions that setting is nested instead, as
`{ "context": { "fileName": ["AGENTS.md", "GEMINI.md"] } }`. If one form is
ignored, try the other. There is no portal support for Gemini CLI.

*Cursor.* Your project folder works straight away: Cursor reads `AGENTS.md`
without configuration. There is no portal support for Cursor.

The portal is optional in all cases. Without it you submit job adverts by
talking to your assistant in the terminal, which is how the kit is designed to
work anyway; the portal exists so you can also do it from your phone.
````

- [ ] **Step 3: Check style**

```bash
cd /home/spacetimejam/j4dev
grep -n '[—–]' docs/getting-started/guide.typ || echo "no long dashes (correct)"
```

Expected: `no long dashes (correct)`.

- [ ] **Step 4: Recompile the PDF**

The compile command is in the file's own header comment. `typst` 0.15.1 is installed at `~/.local/bin/typst` on this machine.

```bash
cd docs/getting-started
typst compile guide.typ "Job Search Kit - Getting Started.pdf"
```

Expected: no output, exit 0, and the PDF's modification time updates. A Typst syntax error in the inserted section will fail loudly here. If it does, the most likely cause is the triple-backtick raw blocks inside the new section: check they are balanced.

- [ ] **Step 5: Verify the new section is in the PDF**

`pdftotext` is **not** installed on this machine, so verify by reading the PDF directly with the Read tool, which renders PDF pages:

Read `docs/getting-started/Job Search Kit - Getting Started.pdf` and confirm by eye that the "Using a different AI assistant" section is present, that its four provider paragraphs are there, and that the `contextFileName` JSON snippet has rendered as a code block rather than as run-on prose.

Also confirm the file actually changed:

```bash
cd /home/spacetimejam/j4dev
git status --short "docs/getting-started/Job Search Kit - Getting Started.pdf"
```

Expected: the PDF shows as modified.

- [ ] **Step 6: Commit**

```bash
cd /home/spacetimejam/j4dev
git add docs/getting-started/guide.typ "docs/getting-started/Job Search Kit - Getting Started.pdf"
git commit -m "docs: add an honest multi-provider chapter to the getting-started guide"
```

---

## Final Verification

Run all of these from `/home/spacetimejam/j4dev` after Task 9.

- [ ] `cd portal && npm test` passes with no failures
- [ ] `bash setup/test/run-tests.sh` reports `Failed: 0`
- [ ] `git ls-files -s AGENTS.md` shows mode `120000`
- [ ] `git ls-files -s portal/test/fixtures/bin/codex` shows mode `100755`
- [ ] `cd portal && AGENT_RUNNER=claude-sdk npm run calibrate` exits 0
- [ ] `cd portal && AGENT_RUNNER=codex npm run calibrate` exits 1 with the "not found" message and writes nothing to `portal/data/`
- [ ] `git check-ignore -v portal/.env.backup` reports the `.env.*` rule; `.env.example` is not ignored
- [ ] `grep -rn '[—–]' AGENTS.md README.md docs/ portal/src portal/.env.example` finds nothing
- [ ] No test binds a fixed port: `grep -rn "listen(" portal/test portal/src/server.js` shows only `listen(0)` in tests and `config.port` in `server.js`
