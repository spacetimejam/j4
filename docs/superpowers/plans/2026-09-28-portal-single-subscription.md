# Portal on one subscription: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a portal host with only one of Claude or ChatGPT run on that one alone, as an explicit `.env` choice checked at startup.

**Architecture:** A new `SUBSCRIPTIONS` setting (`both` default, `claude-only`, `chatgpt-only`) is read by `config.js`. `preflight.js` checks it against `AGENT_RUNNER` and the Codex install. A single predicate, `draftingEnabled` in `agent.js`, decides whether the ChatGPT drafting route is on; the system prompt and the queue's provenance alert both use it.

**Tech Stack:** Node 22 ESM, node:test, Express 5 (untouched here).

**Spec:** `docs/superpowers/specs/2026-09-28-portal-single-subscription-design.md`

## Global Constraints

- Default behaviour (setting unset) must be byte-for-byte today's: `both`, drafting on for `claude-sdk`.
- Signed out of ChatGPT is a warning, never an error.
- The Codex path checked is `CODEX_BIN` from `portal/src/drafting.js`, not a `PATH` lookup.
- The login probe runs `codex login status` with stdin closed and a 5 second timeout; a timeout counts as signed out.
- Tests must not hit port 8710, and must not run the real `codex` (inject the probes).
- Docs: British English, no em or en dashes as sentence punctuation.
- Work in a worktree of `~/j4dev` (`git worktree add` from HEAD); `~/j4/portal` is the live service. Push only from `~/j4dev`.
- `~/j4dev/CLAUDE.md` carries the owner's uncommitted edits: commit only your own hunk and leave theirs in the working tree.

## Review Focus

1. `SUBSCRIPTIONS=Claude-Only` or with stray spaces: expected to be accepted as `claude-only` (normalised in `config.js`). Pinned in Task 1.
2. `SUBSCRIPTIONS=claude-only` still leaves a `drafting_blocked` field in the schema: the prompt must tell Claude to set it to null, not point at a section that is not there. Pinned in Task 2.
3. `AGENT_RUNNER=cli` with the default `both`: no Codex check, no new error or warning, since cli runners never draft through ChatGPT. Pinned in Task 1.
4. An unknown `AGENT_RUNNER` with the default setting: exactly one error (the runner one), no stacked subscriptions error. Pinned in Task 1 (existing test keeps its `length === 1`).
5. Under `claude-only`, a Claude-written CV delivered with no provenance: the user gets it and no admin alert goes out. Pinned in Task 2.

---

### Task 1: The setting and the startup check

**Files:**
- Modify: `portal/src/config.js` (add `subscriptions`)
- Modify: `portal/src/preflight.js` (imports, `SUBSCRIPTIONS`, `codexLoggedIn`, new section in `checkConfig`)
- Test: `portal/test/preflight.test.js`

**Interfaces:**
- Produces: `config.subscriptions: string` (lowercased, trimmed, default `'both'`); `SUBSCRIPTIONS = ['both', 'claude-only', 'chatgpt-only']` exported from `preflight.js`; `codexLoggedIn(bin: string): boolean`; `checkConfig(cfg, { exists, lookupBin, codexBin, codexSignedIn })`.

- [ ] **Step 1: Make the existing tests hermetic and runner-aware**

In `portal/test/preflight.test.js`:

1. Replace the `valid()` helper's return so the codex runner is confirmed by default (existing codex tests stay meaningful):

```js
function valid(overrides = {}) {
  return {
    baseUrl: 'https://box.tail1234.ts.net',
    cookieSecret: GOOD_SECRET,
    exposure: 'private',
    bindHost: '127.0.0.1',
    emailProvider: 'smtp',
    emailProviderExplicit: true,
    smtpUrl: 'smtps://u%40e.com:pw@smtp.e.com:465',
    emailFrom: 'Job Search Portal <portal@example.com>',
    brevoApiKey: '',
    webhookUrl: '',
    usersFile: '/portal/data/users.json',
    allowedEmails: [],
    projectDir: '/home/u/job-search',
    agentRunner: 'claude-sdk',
    agentModel: 'claude-opus-5',
    agentModelExplicit: false,
    // The codex runner has to be confirmed as ChatGPT-only, so the valid
    // baseline for it says so; the subscriptions tests below break this.
    subscriptions: overrides.agentRunner === 'codex' ? 'chatgpt-only' : 'both',
    ...overrides,
  };
}
```

2. Below `const alwaysExists = () => true;` add:

```js
const CODEX = '/opt/test/codex';
const signedIn = () => true;
const signedOut = () => false;
// Every call goes through these so no test runs the real codex binary.
const ok = { exists: alwaysExists, codexBin: CODEX, codexSignedIn: signedIn };
```

3. Replace every `exists: alwaysExists` inside a `checkConfig(...)` options object with `...ok`:

```bash
sed -i 's/{ exists: alwaysExists/{ ...ok/' portal/test/preflight.test.js
```

Then add `codexBin: CODEX, codexSignedIn: signedIn` to the three calls that pass their own `exists` (the `exists: () => false` and two `exists: p => p !== '/home/u/job-search'` calls), for example:

```js
const issues = checkConfig(valid(), { exists: () => false, codexBin: CODEX, codexSignedIn: signedIn });
```

- [ ] **Step 2: Write the failing tests**

Append to `portal/test/preflight.test.js`:

```js
// --- Subscriptions ---------------------------------------------------------

const onlyCodexMissing = p => p !== CODEX;

test('beep: both, claude-sdk, Codex installed and signed in, adds nothing', () => {
  assert.deepEqual(checkConfig(valid(), ok), []);
});

test('an unknown SUBSCRIPTIONS value is an error naming the valid values', () => {
  const issues = checkConfig(valid({ subscriptions: 'openai' }), ok);
  assert.equal(errors(issues).length, 1);
  assert.match(errors(issues)[0].message, /both, claude-only, chatgpt-only/);
});

test('both with the Claude runner and no Codex installed refuses to start and names both ways out', () => {
  const issues = checkConfig(valid(), { ...ok, exists: onlyCodexMissing });
  assert.equal(errors(issues).length, 1);
  assert.match(errors(issues)[0].message, new RegExp(CODEX));
  assert.match(errors(issues)[0].message, /codex login/);
  assert.match(errors(issues)[0].message, /SUBSCRIPTIONS=claude-only/);
});

test('both with Codex installed but signed out only warns', () => {
  const issues = checkConfig(valid(), { ...ok, codexSignedIn: signedOut });
  assert.deepEqual(errors(issues), []);
  const w = warns(issues).filter(i => /codex login/.test(i.message));
  assert.equal(w.length, 1);
});

test('the sign-in probe is given the configured Codex path', () => {
  let asked;
  checkConfig(valid(), { ...ok, codexSignedIn: bin => { asked = bin; return true; } });
  assert.equal(asked, CODEX);
});

test('claude-only needs no Codex at all', () => {
  let probed = false;
  const issues = checkConfig(valid({ subscriptions: 'claude-only' }),
    { ...ok, exists: onlyCodexMissing, codexSignedIn: () => { probed = true; return false; } });
  assert.deepEqual(issues, []);
  assert.equal(probed, false);
});

test('claude-only with the codex runner contradicts itself', () => {
  const issues = checkConfig(valid({ agentRunner: 'codex', subscriptions: 'claude-only' }),
    { ...ok, lookupBin: binPresent });
  assert.equal(errors(issues).length, 1);
  assert.match(errors(issues)[0].message, /claude-only/);
  assert.match(errors(issues)[0].message, /AGENT_RUNNER/);
});

test('the codex runner must be confirmed with chatgpt-only', () => {
  const issues = checkConfig(valid({ agentRunner: 'codex', subscriptions: 'both' }),
    { ...ok, lookupBin: binPresent });
  assert.equal(errors(issues).length, 1);
  assert.match(errors(issues)[0].message, /SUBSCRIPTIONS=chatgpt-only/);
});

test('chatgpt-only needs the codex runner', () => {
  for (const agentRunner of ['claude-sdk', 'cli']) {
    const issues = checkConfig(valid({ agentRunner, subscriptions: 'chatgpt-only' }), ok);
    assert.equal(errors(issues).length, 1, agentRunner);
    assert.match(errors(issues)[0].message, /AGENT_RUNNER=codex/);
  }
});

test('the cli runner under both is not checked for Codex', () => {
  const issues = checkConfig(valid({ agentRunner: 'cli' }),
    { ...ok, exists: onlyCodexMissing, codexSignedIn: signedOut });
  assert.deepEqual(errors(issues), []);
  assert.equal(warns(issues).filter(i => /codex|Codex/.test(i.message)).length, 0);
});

test('codexLoggedIn is false for a binary that does not exist', async () => {
  const { codexLoggedIn } = await import('../src/preflight.js');
  assert.equal(codexLoggedIn('/nonexistent/codex'), false);
});
```

And config tests, each in a child process, since `config.js` reads the environment once at import. An empty `SUBSCRIPTIONS` stands for unset: dotenv never overrides a variable that already exists, so a host `.env` cannot leak in. Append:

```js
async function configSubscriptions(value) {
  const { execFileSync } = await import('node:child_process');
  return String(execFileSync(process.execPath, ['--input-type=module', '-e',
    "import('./src/config.js').then(m => process.stdout.write(m.config.subscriptions))"],
    { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, SUBSCRIPTIONS: value } }));
}

test('SUBSCRIPTIONS defaults to both', async () => {
  assert.equal(await configSubscriptions(''), 'both');
});

test('SUBSCRIPTIONS is trimmed and lowercased', async () => {
  assert.equal(await configSubscriptions(' Claude-Only '), 'claude-only');
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `cd portal && node --test test/preflight.test.js`
Expected: the new subscriptions tests FAIL (no `subscriptions` in config, no errors raised, `codexLoggedIn` not exported); the pre-existing tests still pass.

- [ ] **Step 4: Add the setting to `config.js`**

After the `agentRunner` line:

```js
  // Which subscriptions this host has: both (Claude runs the portal, ChatGPT
  // writes the CV and letter copy), claude-only or chatgpt-only. An explicit
  // opt-in; preflight.js checks it against AGENT_RUNNER and the Codex install.
  subscriptions: (process.env.SUBSCRIPTIONS || 'both').trim().toLowerCase(),
```

- [ ] **Step 5: Add the check to `preflight.js`**

Imports at the top:

```js
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { CODEX_BIN } from './drafting.js';
```

After `onPath`:

```js
// The values SUBSCRIPTIONS accepts. `both` is the default when it is unset.
export const SUBSCRIPTIONS = ['both', 'claude-only', 'chatgpt-only'];

// Is Codex signed in? `codex login status` exits 0 when it is, in about 50 ms.
// stdin is closed because codex waits on an open one, and the timeout keeps a
// wedged binary from holding up startup; either failure reads as signed out.
export function codexLoggedIn(bin) {
  const r = spawnSync(bin, ['login', 'status'], { stdio: 'ignore', timeout: 5000 });
  return r.status === 0;
}
```

Change the signature:

```js
export function checkConfig(cfg, {
  exists = existsSync, lookupBin = onPath, codexBin = CODEX_BIN, codexSignedIn = codexLoggedIn,
} = {}) {
```

After the `// --- Agent runner ---` block, before `// --- Bind ---`:

```js
  // --- Subscriptions -------------------------------------------------------
  // Opting down to one subscription is always explicit: nothing here falls
  // back on its own. Only claude-sdk drafts through ChatGPT (it is the one
  // runner in agent.js's STRUCTURED_RUNNERS; agent.test.js pins the two), so
  // only it needs Codex. Signed out is a warning because logins lapse on their
  // own, and refusing to start would turn a routine restart into an outage.
  const subs = cfg.subscriptions || 'both';
  if (!SUBSCRIPTIONS.includes(subs)) {
    err(`SUBSCRIPTIONS is "${subs}", which is not one of: ${SUBSCRIPTIONS.join(', ')}.`);
  } else if (runner === 'codex' && subs === 'claude-only') {
    err('SUBSCRIPTIONS is "claude-only" but AGENT_RUNNER is "codex", which runs the portal on ChatGPT. Set AGENT_RUNNER=claude-sdk, or SUBSCRIPTIONS=chatgpt-only if ChatGPT is the one you have.');
  } else if (runner === 'codex' && subs === 'both') {
    err('AGENT_RUNNER is "codex", which runs the whole portal on ChatGPT alone. Confirm that with SUBSCRIPTIONS=chatgpt-only in .env.');
  } else if (subs === 'chatgpt-only' && runner !== 'codex' && AGENT_RUNNERS.includes(runner)) {
    err(`SUBSCRIPTIONS is "chatgpt-only" but AGENT_RUNNER is "${runner}". Running on ChatGPT alone needs AGENT_RUNNER=codex (run \`npm run calibrate\` before first use).`);
  } else if (subs === 'both' && runner === 'claude-sdk') {
    if (!exists(codexBin)) {
      err(`SUBSCRIPTIONS is "both" (the default), so ChatGPT writes the CV and cover letter copy, but Codex is not installed at ${codexBin}. Install the Codex CLI and sign in with \`codex login\` (or set CODEX_BIN to where it lives). If you only have a Claude subscription, set SUBSCRIPTIONS=claude-only in .env and Claude will write the copy itself.`);
    } else if (!codexSignedIn(codexBin)) {
      warn(`Codex is installed at ${codexBin} but not signed in to ChatGPT, so CV and cover letter drafts will wait until someone runs \`codex login\` as the user this portal runs as.`);
    }
  }
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd portal && node --test test/preflight.test.js`
Expected: all PASS. Then `npm test`: all PASS.

- [ ] **Step 7: Commit**

```bash
git add portal/src/config.js portal/src/preflight.js portal/test/preflight.test.js
git commit -m "Check the SUBSCRIPTIONS setting against the runner and Codex at startup"
```

---

### Task 2: One switch for the drafting route

**Files:**
- Modify: `portal/src/agent.js` (`structuredProtocol`, `portalPrompt`, new `draftingEnabled`, `runAgentTurn`)
- Modify: `portal/src/queue.js` (`processOneJob` gains a `drafting` option gating the provenance alert)
- Test: `portal/test/agent.test.js`, `portal/test/queue.test.js`

**Interfaces:**
- Consumes: `config.subscriptions` (Task 1).
- Produces: `draftingEnabled({ subscriptions, runnerName }): boolean` exported from `agent.js`; `portalPrompt(userName, { structured, drafting })` with `drafting` defaulting to `false`; `runAgentTurn(args, { runners, runnerName, subscriptions })`; `processOneJob({ runTurn, send, drafting })`.

- [ ] **Step 1: Write the failing agent tests**

In `portal/test/agent.test.js`, change the existing test `'the structured prompt hands the copy to the drafting script with a long enough timeout'` to pass `{ structured: true, drafting: true }`. Then append:

```js
test('draftingEnabled is on only for both with the structured runner', async () => {
  const { draftingEnabled } = await import('../src/agent.js');
  assert.equal(draftingEnabled({ subscriptions: 'both', runnerName: 'claude-sdk' }), true);
  assert.equal(draftingEnabled({ subscriptions: 'claude-only', runnerName: 'claude-sdk' }), false);
  assert.equal(draftingEnabled({ subscriptions: 'both', runnerName: 'cli' }), false);
  assert.equal(draftingEnabled({ subscriptions: 'chatgpt-only', runnerName: 'codex' }), false);
});

test('the structured prompt without drafting leaves Claude to write, and drafting_blocked null', () => {
  const p = portalPrompt('Sam', { structured: true });
  assert.doesNotMatch(p, /chatgpt-draft|WRITING THE CV AND COVER LETTER COPY/);
  assert.match(p, /"drafting_blocked": always null/);
});

test('runAgentTurn drafts through ChatGPT under both and not under claude-only', async () => {
  const seen = {};
  const runners = { 'claude-sdk': async a => { seen.p = a.systemPrompt; return { sessionId: 's', text: '' }; } };
  const args = { prompt: 'x', resumeSessionId: null, user: { name: 'Sam', projectDir: '/tmp' } };
  await runAgentTurn(args, { runners, runnerName: 'claude-sdk', subscriptions: 'both' });
  assert.match(seen.p, /chatgpt-draft/);
  await runAgentTurn(args, { runners, runnerName: 'claude-sdk', subscriptions: 'claude-only' });
  assert.doesNotMatch(seen.p, /chatgpt-draft/);
});
```

- [ ] **Step 2: Write the failing queue test**

In `portal/test/queue.test.js`, change the existing test `'delivering a CV with no ChatGPT draft behind it alerts the admins but still delivers'` to pass `drafting: true` in its `processOneJob({...})` call (so it does not depend on the host's `.env`). Then append:

```js
test('under claude-only a CV with no ChatGPT draft is delivered with no admin alert', async () => {
  const { mkdtempSync, mkdirSync } = await import('node:fs');
  const dir = join(mkdtempSync(join(tmpdir(), 'prov-')), 'applications', 'acme');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'brief.md'), 'brief');
  const cv = join(dir, 'CV - Test - Designer.pdf');
  writeFileSync(cv, 'pdf');
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'yes, apply' });
  const sent = [];
  await processOneJob({
    runTurn: async () => ({
      sessionId: 'c-solo',
      structured: { reply: 'Here it is.', title: 'Designer at Acme', awaiting_user: false,
        email: { subject: 'Your CV', body: 'b', attachments: [cv] }, drafting_blocked: null },
      text: '',
    }),
    send: async e => { sent.push(e); },
    drafting: false,
  });
  assert.ok(sent.some(e => e.subject === 'Your CV'), 'the user still gets the CV');
  assert.equal(sent.filter(e => /without a ChatGPT draft/.test(e.subject)).length, 0);
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `cd portal && node --test test/agent.test.js test/queue.test.js`
Expected: the three new agent tests and the new queue test FAIL.

- [ ] **Step 4: Implement in `agent.js`**

Make `structuredProtocol` take the flag and change only the `drafting_blocked` bullet:

```js
const structuredProtocol = (userName, drafting) => `
...
- "email": null, or {"subject": ..., "body": ..., "attachments": [absolute paths]}
  when you have documents to deliver.
${drafting
    ? `- "drafting_blocked": null, except when the drafting script could not run (see
  WRITING THE CV AND COVER LETTER COPY).`
    : '- "drafting_blocked": always null.'}
...
`;
```

(The `...` lines are the existing text, unchanged.)

Add after `STRUCTURED_RUNNERS`:

```js
// Whether ChatGPT writes the CV and cover letter copy: only when the host has
// both subscriptions and the runner is Claude with the schema. The prompt and
// queue.js's provenance alert both ask this, so they cannot disagree.
export function draftingEnabled({ subscriptions = config.subscriptions, runnerName = config.agentRunner } = {}) {
  return subscriptions === 'both' && STRUCTURED_RUNNERS.has(runnerName);
}
```

In `portalPrompt`:

```js
export const portalPrompt = (userName, { structured = false, drafting = false } = {}) => {
  ...
  const protocol = !structured
    ? fencedProtocol(userName)
    : drafting
      ? `${structuredProtocol(userName, true)}\n${draftingProtocol(userName)}`
      : structuredProtocol(userName, false);
```

In `runAgentTurn`:

```js
export async function runAgentTurn(
  { prompt, resumeSessionId, user },
  { runners = RUNNERS, runnerName = config.agentRunner, subscriptions = config.subscriptions } = {},
) {
  const runner = runners[runnerName];
  if (!runner) throw new Error(`unknown agent runner: ${runnerName}`);
  return runner({
    prompt,
    systemPrompt: portalPrompt(user.name, {
      structured: STRUCTURED_RUNNERS.has(runnerName),
      drafting: draftingEnabled({ subscriptions, runnerName }),
    }),
    resumeSessionId: resumeSessionId || null,
    cwd: user.projectDir,
    model: config.agentModel,
  });
}
```

- [ ] **Step 5: Implement in `queue.js`**

Import: `import { runAgentTurn, parseEmailDirective, parseTitleDirective, draftingEnabled } from './agent.js';`

Signature: `export async function processOneJob({ runTurn = runAgentTurn, send = sendEmail, drafting = draftingEnabled() } = {}) {`

Wrap the provenance block after the user's email:

```js
      // The writer's provenance is how the owner knows ChatGPT wrote the copy.
      // Delivery has already happened; this only makes a bypass visible. With
      // one subscription Claude writes the copy, so there is nothing to bypass.
      const unproven = drafting ? unprovenancedDeliveries(email.attachments) : [];
```

- [ ] **Step 6: Run the tests**

Run: `cd portal && npm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add portal/src/agent.js portal/src/queue.js portal/test/agent.test.js portal/test/queue.test.js
git commit -m "Draft through ChatGPT only when the host has both subscriptions"
```

---

### Task 3: Docs, decision record and live check

**Files:**
- Modify: `portal/.env.example`, `docs/portal.md`, `CLAUDE.md` (one hunk only)

- [ ] **Step 1: `.env.example`**

After the `AGENT_RUNNER=claude-sdk` line and its comment block, before the CLI templates comment, add:

```
# Which subscriptions this portal runs on. Opting down to one is deliberate:
#   both          Claude runs the portal and ChatGPT writes the CV and cover
#                 letter copy. Needs Codex installed and signed in
#                 (`codex login`); the portal will not start without Codex.
#   claude-only   Claude writes everything. Codex is never used.
#   chatgpt-only  ChatGPT runs everything. Needs AGENT_RUNNER=codex.
#SUBSCRIPTIONS=both
```

- [ ] **Step 2: `docs/portal.md`**

In `## Requirements`, replace the "API access for your AI tool" bullet with:

```markdown
- **Claude and ChatGPT, or one of them.** By default the portal drives Claude
  via the Claude Agent SDK (a logged-in Claude Code install or an
  `ANTHROPIC_API_KEY`) and has ChatGPT write the CV and cover letter copy
  through the Codex CLI, signed in with `codex login`. If you have only one of
  the two, say so with `SUBSCRIPTIONS`; see "Running on one subscription"
  below.
```

In the settings list, after the `AGENT_RUNNER, AGENT_CMD, AGENT_CMD_RESUME` bullet, add:

```markdown
- `SUBSCRIPTIONS`: `both` (the default), `claude-only` or `chatgpt-only`. See
  "Running on one subscription" below.
```

Insert a new section immediately before `## Using a different LLM`:

```markdown
## Running on one subscription

Out of the box the portal uses two subscriptions: Claude runs the
conversation, and ChatGPT (through the Codex CLI) writes the prose in each CV
and cover letter, which Claude then fits and checks. If you only have one,
tell the portal so in `.env`. It never switches on its own.

| `SUBSCRIPTIONS` | Who does what | Needs |
|---|---|---|
| `both` (default) | Claude runs the portal; ChatGPT writes the CV and letter copy | Claude, plus Codex installed and signed in |
| `claude-only` | Claude writes everything | Claude only |
| `chatgpt-only` | ChatGPT runs everything | `AGENT_RUNNER=codex` (see "Using Codex") |

At startup the portal checks the setting. With `both` and no Codex installed
it refuses to start and says so, rather than leaving every draft waiting.
Codex installed but signed out only prints a warning, because logins lapse on
their own: drafts then wait with a Retry button, and admins are emailed, until
someone runs `codex login` as the user the portal runs as. Settings that
contradict `AGENT_RUNNER` also stop startup.

ChatGPT cannot be used without an account: `codex login` accepts a ChatGPT
login, an API key or an access token, and nothing else.
```

In `### Using Codex`, change the example block to:

```bash
AGENT_RUNNER=codex
SUBSCRIPTIONS=chatgpt-only
# AGENT_MODEL left unset on purpose: see below
```

and add after it: `` `SUBSCRIPTIONS=chatgpt-only` confirms the portal runs on ChatGPT alone; preflight refuses the codex runner without it. ``

- [ ] **Step 3: `CLAUDE.md`, your hunk only**

Append to the end of the "ChatGPT writes the CV and cover letter copy" Key-decisions bullet (same line):

` This is the `SUBSCRIPTIONS=both` default. A host with one subscription opts out explicitly in `.env` (`claude-only`, where Claude drafts as before and the provenance alert is off, or `chatgpt-only`, which needs `AGENT_RUNNER=codex`); nothing falls back on its own. Preflight refuses to start under `both` when Codex is not installed, but only warns when it is signed out, since logins lapse and a refusal would turn a restart into an outage (owner decision, 2026-09-28). `draftingEnabled` in `agent.js` is the one switch the prompt and queue share. Spec: `docs/superpowers/specs/2026-09-28-portal-single-subscription-design.md`.`

Commit it without the owner's uncommitted edit: in the worktree `CLAUDE.md` is clean, so edit and commit there normally. (The owner's edit lives only in `~/j4dev`'s and `~/j4`'s working trees; a fast-forward merge touching the same line will be refused, so on merge back stash `CLAUDE.md`, pull or merge, pop, and check the result line by line, as last time.)

- [ ] **Step 4: Check the docs for dashes**

Run: `grep -nP '[—–]' docs/portal.md portal/.env.example | head`
Expected: no new matches in lines you added.

- [ ] **Step 5: Commit**

```bash
git add portal/.env.example docs/portal.md CLAUDE.md
git commit -m "docs: running the portal on one subscription"
```

- [ ] **Step 6: Live check against a scratch portal**

From the worktree's `portal/`, on a spare port (never 8710), with a throwaway env (32+ char `COOKIE_SECRET`, `EMAIL_PROVIDER=log`, `ALLOWED_EMAILS` and `PROJECT_DIR` pointing at a scratch folder, `BASE_URL=http://localhost:<port>`, `DB_PATH` in the scratchpad, `PORTAL_USERS_FILE` pointing at a missing file):

1. `SUBSCRIPTIONS=claude-only CODEX_BIN=/nonexistent/codex node src/server.js`: starts and listens. Stop it by the PID from `ss -ltnp` on that port, never `pkill -f`.
2. Same without `SUBSCRIPTIONS`: exits 1 with the "Codex is not installed at /nonexistent/codex" error.
3. Without `SUBSCRIPTIONS` and without `CODEX_BIN` (real Codex, signed in): starts with no Codex warning.

Record the three outcomes in the handoff.

- [ ] **Step 7: Full verification**

Run: `cd portal && npm test` and `bash setup/test/run-tests.sh` from the worktree root.
Expected: all pass; setup harness `Failed: 0`.
