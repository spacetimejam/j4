# Portal ChatGPT Drafting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portal-produced CV and cover letter copy is written by a ChatGPT subagent (GPT-6 Astra, low effort, via the Codex CLI on the owner's ChatGPT subscription), and a ChatGPT failure leaves the draft visibly waiting with a Retry button.

**Architecture:** A kit script `bin/chatgpt-draft` (logic in `portal/src/drafting.js`) runs `codex exec` read-only in the user's project folder and writes `draft.json` plus `draft-provenance.json`. The portal prompt tells Claude to brief it, map its copy into the YAML, and on failure fill a new `drafting_blocked` field in `REPLY_SCHEMA`; `queue.js` turns that into a `drafting_blocked` session that reuses the usage-limit notice and retry.

**Tech Stack:** Node 22 (ESM), node:test, better-sqlite3, Express 5, Codex CLI 0.158.0.

**Spec:** `docs/superpowers/specs/2026-09-28-portal-chatgpt-drafting-design.md`

## Global Constraints

- Model `gpt-6-astra`, effort `low`; overridable only by `DRAFT_MODEL` / `DRAFT_EFFORT` env vars.
- Codex flags: `exec --json --ephemeral --ignore-user-config --sandbox read-only --skip-git-repo-check -m <model> -c model_reasoning_effort="<effort>" --output-schema <file> <prompt>`, stdin closed.
- Codex binary: `CODEX_BIN` env var, else `$HOME/.local/bin/codex`.
- Script timeout 9 minutes; Claude runs the script with a 600000 ms Bash timeout.
- Exit codes: 0 ok, 2 usage, 3 `usage_limit`, 4 `auth`, 5 `error`.
- User-facing text never says "Codex", "GPT" or "ChatGPT"; it says "the writing service Jawbs uses".
- Docs and comments: British English, no em/en dashes as sentence punctuation.
- Only runners in `STRUCTURED_RUNNERS` get the drafting instruction.
- Work in a worktree of `~/j4dev`, never in `~/j4` (the live service runs `~/j4/portal`). Commit in the worktree; do not push, merge into `~/j4`, or restart the service without the owner's go-ahead.

## Review Focus

1. Claude's Bash tool kills a long draft at its 2-minute default: the prompt must name the 600000 ms timeout, and the script's own timeout must be below 600000 (Task 3 test).
2. Reconnect `error` events before a successful final message must not turn a good draft into a failure (Task 2 test).
3. A limit or auth message whose request id happens to contain `401` or `429` must classify by the real status (Task 1 test).
4. An agent that sets both `drafting_blocked` and `email` must not send the email (Task 4 test).
5. Retry on a drafting-blocked session after the user has sent a newer message must be refused, and a drafting retry must prefix the prompt exactly once (Task 5 test).

---

## Setup (before Task 1)

```bash
cd ~/j4dev && git worktree add ../j4dev-drafting -b chatgpt-drafting
cd ../j4dev-drafting/portal && ln -s ~/j4dev/portal/node_modules node_modules
npm test   # baseline: all pass
```

`node_modules` is symlinked rather than reinstalled because `better-sqlite3` builds natively. Remove the symlink before any commit touches `portal/` (it is gitignored, but check `git status`).

---

### Task 1: Pure drafting helpers

**Files:**
- Create: `portal/src/drafting.js`
- Test: `portal/test/drafting.test.js`

**Interfaces:**
- Produces: `DRAFT_MODEL`, `DRAFT_EFFORT` (strings), `DRAFT_TIMEOUT_MS` (number), `CODEX_BIN` (string), `EXIT` (`{ok:0, usage:2, usage_limit:3, auth:4, error:5}`), `DRAFT_SCHEMA` (object), `buildDraftArgs({schemaPath, prompt, model?, effort?}) => string[]`, `buildDraftPrompt({slug, redraft}) => string`, `classifyFailure(text, now?) => {kind, detail, resets_at}`, `parseDraft(text) => object | null`.

- [ ] **Step 1: Write the failing tests**

```js
// portal/test/drafting.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
const {
  DRAFT_MODEL, DRAFT_EFFORT, DRAFT_TIMEOUT_MS, EXIT, DRAFT_SCHEMA,
  buildDraftArgs, buildDraftPrompt, classifyFailure, parseDraft,
} = await import('../src/drafting.js');

const GOOD = {
  cv: {
    position: 'Strategy, made measurable',
    tagline: 'A strategist of fourteen years.',
    jobs: [{ company: 'Purpose', position: 'Associate Director', bullets: ['Led the programme.'] }],
    capabilities: [{ name: 'Strategy', note: 'Setting strategy.' }],
  },
  cover_letter: { paragraphs: ['First.', 'Second.'] },
  gaps: [],
};

test('defaults are GPT-6 Astra at low effort with a timeout under the Bash tool ceiling', () => {
  assert.equal(DRAFT_MODEL, 'gpt-6-astra');
  assert.equal(DRAFT_EFFORT, 'low');
  assert.ok(DRAFT_TIMEOUT_MS < 600000);
  assert.deepEqual(EXIT, { ok: 0, usage: 2, usage_limit: 3, auth: 4, error: 5 });
});

test('args pin model, effort, read-only sandbox and keep the user config out', () => {
  const args = buildDraftArgs({ schemaPath: '/tmp/s.json', prompt: 'P' });
  assert.deepEqual(args, [
    'exec', '--json', '--ephemeral', '--ignore-user-config', '--sandbox', 'read-only',
    '--skip-git-repo-check', '-m', 'gpt-6-astra', '-c', 'model_reasoning_effort="low"',
    '--output-schema', '/tmp/s.json', 'P',
  ]);
});

test('prompt names the files to read and the redraft input only on a redraft', () => {
  const first = buildDraftPrompt({ slug: 'acme-designer', redraft: false });
  for (const f of ['applications/acme-designer/brief.md', 'core/voice.md', 'core/profile.md',
    'applications/acme-designer/spec.md', 'applications/acme-designer/fit.md',
    'templates/cover-letters/README.md']) assert.ok(first.includes(f), f);
  assert.ok(!first.includes('draft.json'));
  assert.match(first, /no fabrication/i);
  assert.ok(buildDraftPrompt({ slug: 'acme-designer', redraft: true }).includes('applications/acme-designer/draft.json'));
});

test('schema is strict: every object closed and every property required', () => {
  const walk = node => {
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
      Object.values(node.properties).forEach(walk);
    }
    if (node.type === 'array') walk(node.items);
  };
  walk(DRAFT_SCHEMA);
});

test('parseDraft accepts the schema shape and rejects anything else', () => {
  assert.deepEqual(parseDraft(JSON.stringify(GOOD)), GOOD);
  assert.equal(parseDraft('not json'), null);
  assert.equal(parseDraft(JSON.stringify({ ...GOOD, gaps: 'none' })), null);
  assert.equal(parseDraft(JSON.stringify({ ...GOOD, cover_letter: { paragraphs: [] } })), null);
  assert.equal(parseDraft(JSON.stringify({ ...GOOD, cv: { ...GOOD.cv, jobs: [{ company: 'X' }] } })), null);
});

test('a 401 is auth', () => {
  const f = classifyFailure('unexpected status 401 Unauthorized: Missing bearer or basic authentication in header');
  assert.equal(f.kind, 'auth');
  assert.equal(f.resets_at, null);
});

test('a usage limit is usage_limit, with a reset when codex gives a relative one', () => {
  const now = new Date('2026-09-28T10:00:00Z');
  const f = classifyFailure("You've hit your usage limit. Try again in 45 minutes.", now);
  assert.equal(f.kind, 'usage_limit');
  assert.equal(f.resets_at, '2026-09-28T10:45:00.000Z');
  assert.equal(classifyFailure('usage_limit_reached', now).resets_at, null);
});

test('status digits inside a request id do not decide the kind', () => {
  assert.equal(classifyFailure('stream disconnected, request id: req_7ed401c82d7429a').kind, 'error');
  assert.equal(classifyFailure("You've hit your usage limit (request id: req_a401b)").kind, 'usage_limit');
});

test('anything unrecognised is error, and an empty reason still says something', () => {
  assert.equal(classifyFailure('model overloaded').kind, 'error');
  assert.ok(classifyFailure('').detail.length > 0);
  assert.ok(classifyFailure('x'.repeat(2000)).detail.length <= 500);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd portal && node --test test/drafting.test.js`
Expected: FAIL, `Cannot find module '../src/drafting.js'`.

- [ ] **Step 3: Implement**

```js
// portal/src/drafting.js
import { join } from 'node:path';

// The ChatGPT subagent that writes CV and cover letter copy for portal
// applications. Claude briefs it and checks the result; this module only runs
// it. Spec: docs/superpowers/specs/2026-09-28-portal-chatgpt-drafting-design.md

export const DRAFT_MODEL = process.env.DRAFT_MODEL || 'gpt-6-astra';
export const DRAFT_EFFORT = process.env.DRAFT_EFFORT || 'low';
// Claude's Bash tool stops any command at 10 minutes, so the draft gives up
// first and says why, rather than vanishing with the tool's own timeout.
export const DRAFT_TIMEOUT_MS = 9 * 60 * 1000;
// systemd user units do not reliably have ~/.local/bin on PATH.
export const CODEX_BIN = process.env.CODEX_BIN || join(process.env.HOME || '', '.local/bin/codex');

export const EXIT = { ok: 0, usage: 2, usage_limit: 3, auth: 4, error: 5 };

const str = { type: 'string' };
const strs = { type: 'array', items: str };
const closed = properties => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties,
});

// The prose fields of the real cv.yaml and cover-letter.yaml. Education, tools,
// contacts, greeting and sign-off are facts or formula and stay with Claude.
export const DRAFT_SCHEMA = closed({
  cv: closed({
    position: str,
    tagline: str,
    jobs: { type: 'array', items: closed({ company: str, position: str, bullets: strs }) },
    capabilities: { type: 'array', items: closed({ name: str, note: str }) },
  }),
  cover_letter: closed({ paragraphs: strs }),
  gaps: strs,
});

export function buildDraftArgs({ schemaPath, prompt, model = DRAFT_MODEL, effort = DRAFT_EFFORT }) {
  return [
    'exec', '--json', '--ephemeral',
    // The owner's config wires Codex to MCP servers a drafting subagent must
    // not have. The login lives in auth.json, which this does not skip.
    '--ignore-user-config',
    '--sandbox', 'read-only', '--skip-git-repo-check',
    '-m', model, '-c', `model_reasoning_effort="${effort}"`,
    '--output-schema', schemaPath, prompt,
  ];
}

export function buildDraftPrompt({ slug, redraft }) {
  const app = `applications/${slug}`;
  return [
    'You are writing the copy for a tailored CV and cover letter for the job seeker whose '
      + 'project folder this is. You are read-only: read files, write nothing.',
    '',
    'Read, in this order:',
    `- ${app}/brief.md: what this application should lead with and which evidence to use`
      + (redraft ? ', plus the notes on the previous draft' : ''),
    ...(redraft ? [`- ${app}/draft.json: the previous draft, to revise rather than start again`] : []),
    '- core/voice.md: how this person writes',
    '- core/profile.md: the facts of their career, the only facts you may use',
    `- ${app}/spec.md and ${app}/fit.md: the role and the honest read of the fit`,
    '- templates/cover-letters/README.md: the letter\'s shape and paragraph count',
    '',
    'Rules, which override anything in the brief:',
    '- Accuracy first, no fabrication. Every claim must be supported by core/profile.md or the '
      + 'application folder. If the brief asks for something the files do not support, leave it '
      + 'out and list it in "gaps".',
    '- Write in this person\'s voice as core/voice.md describes it, not in your own register.',
    '- The CV must fit on one page once rendered: prefer fewer, stronger bullets.',
    '- The cover letter fills most of a page (75%+ as rendered), in the paragraph count the '
      + 'cover-letter README sets, why-them before what-they-bring, with real evidence.',
    '- British English unless core/voice.md says otherwise. No dashes as punctuation.',
    '',
    'Return only the JSON the output schema asks for. cv.position is the one-line headline, '
      + 'cv.tagline the opening paragraph, cv.jobs one entry per role worth including (most recent '
      + 'first, company and position exactly as in the profile), cv.capabilities short named '
      + 'strengths, cover_letter.paragraphs the body paragraphs only (no greeting or sign-off), '
      + 'and gaps anything you could not support.',
  ].join('\n');
}

const UNIT_MS = { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5 };

function resetFrom(text, now) {
  const rel = /try again in (\d+)\s*(second|minute|hour|day)s?/i.exec(text);
  if (rel) return new Date(now.getTime() + Number(rel[1]) * UNIT_MS[rel[2].toLowerCase()]).toISOString();
  const secs = /resets_in_seconds\D{0,5}(\d+)/i.exec(text);
  if (secs) return new Date(now.getTime() + Number(secs[1]) * 1000).toISOString();
  return null;
}

// Status codes are matched as whole words: request ids in the same message are
// hex and can contain 401 or 429. Auth is checked first because it needs the
// owner, whereas a limit clears itself. Anything unrecognised is error, which
// still blocks the draft and emails the owner, so a wrong guess fails safe.
export function classifyFailure(text, now = new Date()) {
  const detail = String(text || '').trim().slice(0, 500) || 'the writer failed without saying why';
  if (/\b401\b|unauthori[sz]ed|not logged in|log ?in again|refresh token/i.test(detail)) {
    return { kind: 'auth', detail, resets_at: null };
  }
  if (/usage limit|usage_limit|rate limit|\b429\b|quota/i.test(detail)) {
    return { kind: 'usage_limit', detail, resets_at: resetFrom(detail, now) };
  }
  return { kind: 'error', detail, resets_at: null };
}

const isStrings = a => Array.isArray(a) && a.every(s => typeof s === 'string');

// --output-schema constrains the model, but the portal still checks: a draft
// that does not fit would otherwise reach cv.yaml as undefined fields.
export function parseDraft(text) {
  let d;
  try { d = JSON.parse(text); } catch { return null; }
  const cv = d?.cv;
  if (!cv || typeof cv.position !== 'string' || typeof cv.tagline !== 'string') return null;
  if (!Array.isArray(cv.jobs) || !cv.jobs.every(j => j && typeof j.company === 'string'
    && typeof j.position === 'string' && isStrings(j.bullets))) return null;
  if (!Array.isArray(cv.capabilities) || !cv.capabilities.every(c => c && typeof c.name === 'string'
    && typeof c.note === 'string')) return null;
  if (!isStrings(d.cover_letter?.paragraphs) || d.cover_letter.paragraphs.length === 0) return null;
  if (!isStrings(d.gaps)) return null;
  return d;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd portal && node --test test/drafting.test.js`
Expected: PASS, all 9 tests.

- [ ] **Step 5: Commit**

```bash
git add portal/src/drafting.js portal/test/drafting.test.js
git commit -m "Add the pure helpers for the ChatGPT drafting subagent"
```

---

### Task 2: Running a draft, and the `chatgpt-draft` script

**Files:**
- Modify: `portal/src/drafting.js` (append)
- Create: `bin/chatgpt-draft`
- Create: `portal/test/fixtures/codex-draft-auth.jsonl`
- Test: `portal/test/drafting.test.js` (append)

**Interfaces:**
- Consumes: everything from Task 1; `createCodexEventSink()` from `portal/src/runners/codex.js` (`push(line)`, `result() => {threadId, text, failure}`).
- Produces: `runDraft({appDir}, deps?) => Promise<{draft, provenance} | {failure:{kind, detail, resets_at}} | {usage: string}>`; `main(argv, deps?) => Promise<number>` (exit code). `deps`: `{spawnImpl, now, codexBin, timeoutMs, codexVersion, stdout}`. Files written on success: `<appDir>/draft.json`, `<appDir>/draft-provenance.json` with keys `model, effort, codex_version, drafted_at, brief_sha256, thread_id`.

- [ ] **Step 1: Add the auth fixture** (captured live on 2026-09-28 with `CODEX_HOME` pointing at an empty directory, trimmed)

```
{"type":"thread.started","thread_id":"01a0e770-5111-7423-b59f-c949922350f3"}
{"type":"turn.started"}
{"type":"error","message":"Reconnecting... 2/5 (unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: wss://api.openai.com/v1/responses)"}
{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Falling back from WebSockets to HTTPS transport. unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: wss://api.openai.com/v1/responses"}}
{"type":"error","message":"unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses, request id: req_d7c7334bef944b17a40db8cee65fa302"}
{"type":"turn.failed","error":{"message":"unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses, request id: req_d7c7334bef944b17a40db8cee65fa302"}}
```

Save as `portal/test/fixtures/codex-draft-auth.jsonl`. It exits 1.

- [ ] **Step 2: Write the failing tests** (append to `portal/test/drafting.test.js`)

```js
import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { runDraft, main } = await import('../src/drafting.js');

// Same shape as the fake in codex.test.js, plus a kill() that closes the child.
function fakeSpawn({ lines = [], exitCode = 0, stderr = '', spawnError = null, hang = false } = {}) {
  const calls = [];
  const impl = (bin, args, opts) => {
    calls.push({ bin, args, opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    let decoder = null;
    child.stdout.setEncoding = enc => { decoder = new StringDecoder(enc); };
    child.stderr = new EventEmitter();
    child.kill = () => setImmediate(() => child.emit('close', null));
    setImmediate(() => {
      if (spawnError) { child.emit('error', spawnError); return; }
      const buf = Buffer.from(lines.map(l => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
      child.stdout.emit('data', decoder ? decoder.write(buf) : buf);
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      if (!hang) child.emit('close', exitCode);
    });
    return child;
  };
  impl.calls = calls;
  return impl;
}

const okLines = draft => [
  { type: 'thread.started', thread_id: 'thread-1' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: JSON.stringify(draft) } },
  { type: 'turn.completed', usage: {} },
];

function mkApp({ brief = true, draft = false } = {}) {
  const project = mkdtempSync(join(tmpdir(), 'draft-proj-'));
  const appDir = join(project, 'applications', 'acme-designer');
  mkdirSync(appDir, { recursive: true });
  if (brief) writeFileSync(join(appDir, 'brief.md'), 'Lead with measurement.');
  if (draft) writeFileSync(join(appDir, 'draft.json'), JSON.stringify(GOOD));
  return { project, appDir };
}

const deps = extra => ({
  now: () => new Date('2026-09-28T10:00:00Z'),
  codexBin: '/fake/codex',
  codexVersion: async () => 'codex-cli 0.158.0',
  ...extra,
});

test('a successful draft writes draft.json and provenance, run read-only in the project', async () => {
  const { project, appDir } = mkApp();
  const spawnImpl = fakeSpawn({ lines: okLines(GOOD) });
  const r = await runDraft({ appDir }, deps({ spawnImpl }));
  assert.deepEqual(r.draft, GOOD);
  assert.deepEqual(JSON.parse(readFileSync(join(appDir, 'draft.json'), 'utf8')), GOOD);
  const prov = JSON.parse(readFileSync(join(appDir, 'draft-provenance.json'), 'utf8'));
  assert.equal(prov.model, 'gpt-6-astra');
  assert.equal(prov.effort, 'low');
  assert.equal(prov.codex_version, 'codex-cli 0.158.0');
  assert.equal(prov.drafted_at, '2026-09-28T10:00:00.000Z');
  assert.equal(prov.thread_id, 'thread-1');
  assert.match(prov.brief_sha256, /^[0-9a-f]{64}$/);
  const [call] = spawnImpl.calls;
  assert.equal(call.bin, '/fake/codex');
  assert.equal(call.opts.cwd, project);
  assert.equal(call.opts.stdio[0], 'ignore');
  assert.ok(!call.args.at(-1).includes('draft.json'), 'first draft is not a redraft');
});

test('an existing draft.json makes it a redraft', async () => {
  const { appDir } = mkApp({ draft: true });
  const spawnImpl = fakeSpawn({ lines: okLines(GOOD) });
  await runDraft({ appDir }, deps({ spawnImpl }));
  assert.ok(spawnImpl.calls[0].args.at(-1).includes('applications/acme-designer/draft.json'));
});

test('reconnect errors before a good final message do not fail the draft', async () => {
  const { appDir } = mkApp();
  const lines = [{ type: 'error', message: 'Reconnecting... 1/5 (stream disconnected)' }, ...okLines(GOOD)];
  const r = await runDraft({ appDir }, deps({ spawnImpl: fakeSpawn({ lines }) }));
  assert.deepEqual(r.draft, GOOD);
});

test('the captured auth failure is auth and writes no draft', async () => {
  const { appDir } = mkApp();
  const lines = readFileSync(new URL('./fixtures/codex-draft-auth.jsonl', import.meta.url), 'utf8').trim().split('\n');
  const r = await runDraft({ appDir }, deps({ spawnImpl: fakeSpawn({ lines, exitCode: 1 }) }));
  assert.equal(r.failure.kind, 'auth');
  assert.ok(!existsSync(join(appDir, 'draft.json')));
});

test('copy that does not fit the schema is an error, not a draft', async () => {
  const { appDir } = mkApp();
  const r = await runDraft({ appDir }, deps({ spawnImpl: fakeSpawn({ lines: okLines({ nope: true }) }) }));
  assert.equal(r.failure.kind, 'error');
  assert.ok(!existsSync(join(appDir, 'draft.json')));
});

test('a missing codex binary is an error naming CODEX_BIN', async () => {
  const { appDir } = mkApp();
  const spawnError = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
  const r = await runDraft({ appDir }, deps({ spawnImpl: fakeSpawn({ spawnError }) }));
  assert.equal(r.failure.kind, 'error');
  assert.match(r.failure.detail, /CODEX_BIN/);
});

test('a draft that runs past the timeout is stopped and reported', async () => {
  const { appDir } = mkApp();
  const r = await runDraft({ appDir }, deps({ spawnImpl: fakeSpawn({ hang: true }), timeoutMs: 20 }));
  assert.equal(r.failure.kind, 'error');
  assert.match(r.failure.detail, /longer than/);
});

test('a folder outside applications/ or without brief.md is a usage error', async () => {
  const { project, appDir } = mkApp({ brief: false });
  assert.match((await runDraft({ appDir }, deps({ spawnImpl: fakeSpawn() }))).usage, /brief\.md/);
  assert.match((await runDraft({ appDir: project }, deps({ spawnImpl: fakeSpawn() }))).usage, /application folder/);
});

test('main maps outcomes to exit codes and prints one JSON document', async () => {
  const out = [];
  const stdout = s => out.push(s);
  assert.equal(await main([], deps({ stdout })), 2);
  const { appDir } = mkApp();
  assert.equal(await main([appDir], deps({ stdout, spawnImpl: fakeSpawn({ lines: okLines(GOOD) }) })), 0);
  assert.deepEqual(JSON.parse(out.at(-1)), GOOD);
  const lines = readFileSync(new URL('./fixtures/codex-draft-auth.jsonl', import.meta.url), 'utf8').trim().split('\n');
  assert.equal(await main([appDir], deps({ stdout, spawnImpl: fakeSpawn({ lines, exitCode: 1 }) })), 4);
  assert.equal(JSON.parse(out.at(-1)).kind, 'auth');
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd portal && node --test test/drafting.test.js`
Expected: FAIL, `runDraft` / `main` not exported.

- [ ] **Step 4: Implement** (change the `node:path` import at the top of `drafting.js` to the fuller set below and add the other imports; append the functions)

```js
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createCodexEventSink } from './runners/codex.js';
```

```js
function locate(appDir) {
  const abs = resolve(appDir);
  if (basename(dirname(abs)) !== 'applications') return null;
  return { abs, slug: basename(abs), projectDir: dirname(dirname(abs)) };
}

// Resolves, never rejects: every outcome is data the caller maps to an exit code.
function runCodexProcess(args, cwd, { spawnImpl, timeoutMs, codexBin }) {
  return new Promise(done => {
    const sink = createCodexEventSink();
    let partial = '';
    let errOut = '';
    let timedOut = false;
    let settled = false;
    let timer = null;
    const finish = extra => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done({ ...sink.result(), stderr: errOut, timedOut, ...extra });
    };
    let child;
    try {
      // stdin closed: with it open, codex exec waits for more prompt and never starts.
      child = spawnImpl(codexBin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      finish({ code: null, spawnError: err });
      return;
    }
    timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      const lines = (partial + chunk).split('\n');
      partial = lines.pop();
      for (const line of lines) sink.push(line);
    });
    child.stderr.on('data', d => { errOut = (errOut + d).slice(-4000); });
    child.on('error', err => finish({ code: null, spawnError: err }));
    child.on('close', code => {
      if (partial.trim()) sink.push(partial);
      finish({ code });
    });
  });
}

function readCodexVersion(codexBin, spawnImpl) {
  return new Promise(done => {
    let out = '';
    let child;
    try { child = spawnImpl(codexBin, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] }); } catch { done(null); return; }
    const timer = setTimeout(() => { child.kill('SIGTERM'); done(null); }, 10000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', d => { out += d; });
    child.on('error', () => { clearTimeout(timer); done(null); });
    child.on('close', code => { clearTimeout(timer); done(code === 0 ? out.trim() || null : null); });
  });
}

const sha256 = buf => createHash('sha256').update(buf).digest('hex');

export async function runDraft({ appDir }, deps = {}) {
  const {
    spawnImpl = spawn, now = () => new Date(), codexBin = CODEX_BIN,
    timeoutMs = DRAFT_TIMEOUT_MS, codexVersion = readCodexVersion,
  } = deps;
  const where = locate(appDir);
  if (!where) return { usage: `${appDir} is not an application folder (expected <project>/applications/<slug>)` };
  const briefPath = join(where.abs, 'brief.md');
  if (!existsSync(briefPath)) return { usage: `write the brief to ${briefPath} first` };
  const redraft = existsSync(join(where.abs, 'draft.json'));
  const tmp = mkdtempSync(join(tmpdir(), 'chatgpt-draft-'));
  try {
    const schemaPath = join(tmp, 'schema.json');
    writeFileSync(schemaPath, JSON.stringify(DRAFT_SCHEMA));
    const args = buildDraftArgs({ schemaPath, prompt: buildDraftPrompt({ slug: where.slug, redraft }) });
    const r = await runCodexProcess(args, where.projectDir, { spawnImpl, timeoutMs, codexBin });
    if (r.spawnError) {
      const detail = r.spawnError.code === 'ENOENT'
        ? `codex was not found at ${codexBin}; install it or set CODEX_BIN`
        : String(r.spawnError.message || r.spawnError);
      return { failure: { kind: 'error', detail, resets_at: null } };
    }
    if (r.timedOut) {
      const mins = Math.max(1, Math.round(timeoutMs / 60000));
      return { failure: { kind: 'error', detail: `the draft took longer than ${mins} minutes and was stopped`, resets_at: null } };
    }
    // Success is a clean exit with a final message. Reconnect errors earlier in
    // the stream land in `failure` too, so it is consulted only when this fails.
    if (r.code !== 0 || r.text === null) {
      return { failure: classifyFailure(r.failure || r.stderr.trim() || `codex exited ${r.code}`, now()) };
    }
    const draft = parseDraft(r.text);
    if (!draft) {
      return { failure: { kind: 'error', detail: 'the writer returned copy that did not match the draft schema', resets_at: null } };
    }
    const provenance = {
      model: DRAFT_MODEL,
      effort: DRAFT_EFFORT,
      codex_version: await codexVersion(codexBin, spawnImpl),
      drafted_at: now().toISOString(),
      brief_sha256: sha256(readFileSync(briefPath)),
      thread_id: r.threadId,
    };
    writeFileSync(join(where.abs, 'draft.json'), `${JSON.stringify(draft, null, 2)}\n`);
    writeFileSync(join(where.abs, 'draft-provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
    return { draft, provenance };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export async function main(argv, deps = {}) {
  const out = deps.stdout ?? (s => process.stdout.write(s));
  const print = obj => out(`${JSON.stringify(obj, null, 2)}\n`);
  if (argv.length !== 1) { print({ usage: 'usage: chatgpt-draft <application folder>' }); return EXIT.usage; }
  const r = await runDraft({ appDir: argv[0] }, deps);
  if (r.usage) { print({ usage: r.usage }); return EXIT.usage; }
  if (r.failure) { out(`${JSON.stringify(r.failure)}\n`); return EXIT[r.failure.kind]; }
  print(r.draft);
  return EXIT.ok;
}
```

Create `bin/chatgpt-draft` (CommonJS: there is no package.json at the kit root), then `chmod +x bin/chatgpt-draft`:

```js
#!/usr/bin/env node
// Writes CV and cover letter copy with the ChatGPT subagent, for Claude to fit
// into cv.yaml and cover-letter.yaml. Usage: chatgpt-draft <application folder>
// The logic lives in portal/src/drafting.js; exit codes are documented there.
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

import(pathToFileURL(join(__dirname, '..', 'portal', 'src', 'drafting.js')).href)
  .then(m => m.main(process.argv.slice(2)))
  .then(code => { process.exitCode = code; });
```

- [ ] **Step 5: Run to verify pass**

Run: `cd portal && node --test test/drafting.test.js && node ../bin/chatgpt-draft; echo "exit $?"`
Expected: PASS; then the script prints `{"usage": "usage: chatgpt-draft <application folder>"}` and `exit 2`.

- [ ] **Step 6: Commit**

```bash
git add portal/src/drafting.js portal/test/drafting.test.js portal/test/fixtures/codex-draft-auth.jsonl bin/chatgpt-draft
git commit -m "Run the ChatGPT drafting subagent from a kit script"
```

---

### Task 3: Schema field, portal prompt and WORKFLOW note

**Files:**
- Modify: `portal/src/reply-schema.js`
- Modify: `portal/src/agent.js` (`structuredProtocol` area and `portalPrompt`)
- Modify: `template/WORKFLOW.md` (section 4)
- Test: `portal/test/agent.test.js`, `portal/test/claude-sdk.test.js` (existing deepEqual still holds; no edit expected)

**Interfaces:**
- Consumes: `DRAFT_TIMEOUT_MS` from Task 1 (test only).
- Produces: `REPLY_SCHEMA.properties.drafting_blocked` (nullable `{kind, detail, resets_at}`), required. `portalPrompt(name, {structured:true})` contains the section headed `WRITING THE CV AND COVER LETTER COPY`.

- [ ] **Step 1: Write the failing tests** (append to `portal/test/agent.test.js`)

```js
test('the reply schema requires a nullable drafting_blocked with the three kinds', async () => {
  const { REPLY_SCHEMA } = await import('../src/reply-schema.js');
  assert.ok(REPLY_SCHEMA.required.includes('drafting_blocked'));
  const [obj, nul] = REPLY_SCHEMA.properties.drafting_blocked.anyOf;
  assert.deepEqual(nul, { type: 'null' });
  assert.deepEqual(obj.properties.kind.enum, ['usage_limit', 'auth', 'error']);
  assert.deepEqual([...obj.required].sort(), ['detail', 'kind', 'resets_at']);
  assert.equal(obj.additionalProperties, false);
});

test('the structured prompt hands the copy to the drafting script with a long enough timeout', async () => {
  const { DRAFT_TIMEOUT_MS } = await import('../src/drafting.js');
  const p = portalPrompt('Sam', { structured: true });
  assert.match(p, /WRITING THE CV AND COVER LETTER COPY/);
  assert.match(p, /bin\/chatgpt-draft/);
  assert.match(p, /600000/);
  assert.ok(DRAFT_TIMEOUT_MS < 600000);
  assert.match(p, /drafting_blocked/);
  assert.match(p, /do not rewrite the prose/i);
  assert.match(p, /gaps/);
});

test('the fenced prompt, for runners that are not Claude, has no drafting subagent', () => {
  assert.doesNotMatch(portalPrompt('Sam'), /chatgpt-draft|drafting_blocked/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd portal && node --test test/agent.test.js`
Expected: FAIL on the three new tests.

- [ ] **Step 3: Implement the schema** (in `REPLY_SCHEMA`: add `'drafting_blocked'` to the end of `required`, and this property after `email`)

```js
    // Set only when the ChatGPT drafting subagent could not write the copy, so
    // queue.js can hold the session with a Retry button instead of a draft.
    drafting_blocked: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'detail', 'resets_at'],
          properties: {
            kind: { type: 'string', enum: ['usage_limit', 'auth', 'error'] },
            detail: { type: 'string' },
            resets_at: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          },
        },
        { type: 'null' },
      ],
    },
```

Update the comment at the top of the file from "four fields" to "five fields" if it counts them (it does not today; check).

- [ ] **Step 4: Implement the prompt** (in `agent.js`: add the import and the section, and include it only in the structured variant)

```js
import { fileURLToPath } from 'node:url';
```

```js
// The kit checkout's copy of the script, resolved from this file so a project
// created outside the kit root still finds it.
const DRAFT_SCRIPT = fileURLToPath(new URL('../../bin/chatgpt-draft', import.meta.url));

const draftingProtocol = (userName) => `
WRITING THE CV AND COVER LETTER COPY. The prose in cv.yaml and cover-letter.yaml is
written by a separate writer, not by you. Whenever stage 2 or a redraft needs CV or
cover letter copy:

1. Decide the emphasis as WORKFLOW.md section 3 describes, then write the brief to
   brief.md in the application folder: what to lead with, which evidence to use, the
   role's key asks, and on a redraft ${userName}'s notes, quoted.
2. Run, with the Bash tool's timeout set to 600000:
   node "${DRAFT_SCRIPT}" <absolute path to the application folder>
3. On exit 0 it prints the copy and saves it as draft.json. Put it into cv.yaml
   (position, tagline, each job's description, capabilities) and cover-letter.yaml
   (paragraphs). You may fit it to the YAML structure, cut to meet the one-page rule,
   and correct a claim that contradicts core/profile.md, noting each correction in
   log.md. Do not rewrite the prose. If it needs more than that, sharpen brief.md and
   run the script once more; if it is still unusable, ask ${userName} instead of
   writing it yourself. Every entry in the draft's "gaps" becomes a numbered question
   for ${userName}, never something you fill in.
4. Exit 2 means you called it wrongly: fix the call and run it again.
5. Exit 3, 4 or 5 means the writer is unavailable. Write no copy yourself. Set
   "drafting_blocked" to the JSON line the script printed ({"kind", "detail",
   "resets_at"}), leave "email" null, and tell ${userName} in a sentence or two that
   the draft is waiting on the writing service and will carry on when they press
   Retry. In every other turn "drafting_blocked" is null.
`;
```

In `portalPrompt`, change the protocol line to:

```js
  const protocol = structured
    ? `${structuredProtocol(userName)}\n${draftingProtocol(userName)}`
    : fencedProtocol(userName);
```

and add the field to the list in `structuredProtocol`, after the `"email"` bullet:

```js
- "drafting_blocked": null, except when the drafting script could not run (see
  WRITING THE CV AND COVER LETTER COPY).
```

(`structuredProtocol` currently says "The portal reads four fields"; change "four" to "five".)

- [ ] **Step 5: Add the WORKFLOW note** (`template/WORKFLOW.md`, first line of section 4, after the heading `## 4. Tailor the CV  →  \`cv.yaml\`  →  named PDF`)

```markdown
Through the portal, the CV and cover letter prose is written by a ChatGPT subagent (`bin/chatgpt-draft` in the kit) from a brief Claude writes; Claude fits, trims and fact-checks it rather than rewriting it. In a Claude Code session in this folder, Claude drafts as below.
```

- [ ] **Step 6: Run to verify pass**

Run: `cd portal && npm test && cd .. && bash setup/test/run-tests.sh`
Expected: all portal tests PASS (including `claude-sdk.test.js`'s schema identity checks); setup harness `Failed: 0`.

- [ ] **Step 7: Commit**

```bash
git add portal/src/reply-schema.js portal/src/agent.js portal/test/agent.test.js template/WORKFLOW.md
git commit -m "Brief the ChatGPT writer from the portal prompt and report when it is blocked"
```

---

### Task 4: Queue: a blocked draft holds the session

**Files:**
- Modify: `portal/src/queue.js`
- Modify: `portal/src/db.js:17` (status comment)
- Test: `portal/test/queue.test.js` (append)

**Interfaces:**
- Consumes: `drafting_blocked` field from Task 3; `toSqlUtc(date|null)` from `usage-limit.js`.
- Produces: on a blocked turn, job row `{status:'failed', failure_kind:'drafting_blocked', limit_type:<kind>, error:<detail>, resets_at:<sql utc|null>, resets_at_exact:1|0}`, session `status = 'drafting_blocked'`, Claude's reply stored as a message.

- [ ] **Step 1: Write the failing tests** (append to `portal/test/queue.test.js`)

```js
const blockedTurn = (blocked, extra = {}) => async () => ({
  sessionId: 'claude-draft',
  structured: {
    reply: 'Your draft is waiting on the writing service.',
    title: 'Designer at Acme', awaiting_user: false, email: null,
    drafting_blocked: blocked, ...extra,
  },
  text: '',
});

for (const [kind, emailsAdmin] of [['usage_limit', false], ['auth', true], ['error', true]]) {
  test(`a ${kind} drafting block stores the reply, holds the session, ${emailsAdmin ? 'and' : 'but does not'} email admins`, async () => {
    const sid = mkSession();
    enqueue({ sessionId: sid, prompt: 'yes, apply' });
    const sent = [];
    await processOneJob({
      runTurn: blockedTurn({ kind, detail: `${kind} detail`, resets_at: kind === 'usage_limit' ? '2026-09-28T10:45:00Z' : null }),
      send: async e => { sent.push(e); },
    });
    const db = getDb();
    const s = db.prepare('select * from sessions where id = ?').get(sid);
    assert.equal(s.status, 'drafting_blocked');
    assert.equal(s.claude_session_id, 'claude-draft');
    assert.equal(s.title, 'Designer at Acme');
    const msgs = db.prepare("select body from messages where session_id = ? and role = 'claude'").all(sid);
    assert.deepEqual(msgs.map(m => m.body), ['Your draft is waiting on the writing service.']);
    const job = db.prepare('select * from jobs where session_id = ?').get(sid);
    assert.equal(job.status, 'failed');
    assert.equal(job.failure_kind, 'drafting_blocked');
    assert.equal(job.limit_type, kind);
    assert.equal(job.error, `${kind} detail`);
    assert.equal(job.resets_at, kind === 'usage_limit' ? '2026-09-28 10:45:00' : null);
    assert.equal(job.resets_at_exact, kind === 'usage_limit' ? 1 : 0);
    assert.equal(sent.length > 0, emailsAdmin);
    if (emailsAdmin) assert.match(sent[0].text, new RegExp(`${kind} detail`));
  });
}

test('a blocked draft sends no email even if the agent also set one', async () => {
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'yes, apply' });
  const sent = [];
  await processOneJob({
    runTurn: blockedTurn({ kind: 'usage_limit', detail: 'limit', resets_at: null },
      { email: { subject: 'CV', body: 'b', attachments: [] } }),
    send: async e => { sent.push(e); },
  });
  assert.equal(sent.length, 0);
  assert.equal(getDb().prepare('select status from sessions where id = ?').get(sid).status, 'drafting_blocked');
});

test('an unknown kind or unreadable reset degrades to error with no reset', async () => {
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'yes, apply' });
  await processOneJob({ runTurn: blockedTurn({ kind: 'weird', detail: 'x', resets_at: 'soon' }), send: async () => {} });
  const job = getDb().prepare('select * from jobs where session_id = ?').get(sid);
  assert.equal(job.limit_type, 'error');
  assert.equal(job.resets_at, null);
});

test('a null drafting_blocked leaves an ordinary turn untouched', async () => {
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'JD' });
  await processOneJob({ runTurn: blockedTurn(null), send: async () => {} });
  assert.equal(getDb().prepare('select status from jobs where session_id = ?').get(sid).status, 'done');
  assert.equal(getDb().prepare('select status from sessions where id = ?').get(sid).status, 'active');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd portal && node --test test/queue.test.js`
Expected: FAIL, session status is `active`/`done` rather than `drafting_blocked`.

- [ ] **Step 3: Implement**

In `queue.js`, add above `processOneJob`:

```js
const DRAFTING_KINDS = new Set(['usage_limit', 'auth', 'error']);

// The agent copies this from the drafting script's failure line, so it is
// checked rather than trusted: an unknown kind becomes error, which still
// blocks and alerts, and an unreadable reset time is dropped rather than stored.
function readDraftingBlocked(value) {
  if (!value || typeof value !== 'object') return null;
  const resetsAt = value.resets_at ? new Date(value.resets_at) : null;
  return {
    kind: DRAFTING_KINDS.has(value.kind) ? value.kind : 'error',
    detail: String(value.detail || 'the writing service was unavailable'),
    resetsAt: resetsAt && !Number.isNaN(resetsAt.getTime()) ? resetsAt : null,
  };
}

async function alertAdmins(send, subject, text) {
  for (const admin of adminEmails()) {
    try {
      await send({ to: admin, subject, text, attachments: [] });
    } catch { /* alert is best-effort */ }
  }
}
```

In `processOneJob`, declare `let clean, title, awaitingUser, email, blocked = null;` and in the structured branch destructure `drafting_blocked: rawBlocked` alongside the other fields, then `blocked = readDraftingBlocked(rawBlocked);`. Directly after the `if (newTitle) { ... }` block and before `if (email)`, add:

```js
    // The writer could not draft, so there is nothing to deliver: hold the
    // session on a Retry button. The reply above is already stored, so the
    // conversation resumes intact. A limit clears itself; anything else needs
    // the owner, typically `codex login` on the host.
    if (blocked) {
      db.prepare(`update jobs set status = 'failed', error = ?, failure_kind = 'drafting_blocked',
          resets_at = ?, resets_at_exact = ?, limit_type = ? where id = ?`)
        .run(blocked.detail, toSqlUtc(blocked.resetsAt), blocked.resetsAt ? 1 : 0, blocked.kind, job.id);
      db.prepare("update sessions set status = 'drafting_blocked', updated_at = datetime('now') where id = ?")
        .run(job.session_id);
      if (blocked.kind !== 'usage_limit') {
        await alertAdmins(send,
          `${config.portalTitle}: drafting blocked on "${newTitle || session.title}"`,
          `The ChatGPT writer could not draft (${blocked.kind}): ${blocked.detail}\n\n`
          + 'The session shows a Retry button. If this is "auth", sign Codex in again on the host with: codex login');
      }
      return true;
    }
```

Replace the admin loop in the `catch` block with:

```js
    await alertAdmins(send, `${config.portalTitle}: session "${session.title}" needs attention`, String(err));
```

In `db.js:17` extend the status comment to `-- active | working | awaiting_reply | done | needs_attention | usage_limited | drafting_blocked`.

- [ ] **Step 4: Run to verify pass**

Run: `cd portal && npm test`
Expected: PASS, including the existing needs-attention email tests.

- [ ] **Step 5: Commit**

```bash
git add portal/src/queue.js portal/src/db.js portal/test/queue.test.js
git commit -m "Hold a session on Retry when the ChatGPT writer is blocked"
```

---

### Task 5: Retry and the waiting-draft notice

**Files:**
- Modify: `portal/src/server.js` (`delayedFor`, retry route)
- Create: `portal/public/notices.js`
- Modify: `portal/public/app.js` (import the notice, badge condition)
- Test: `portal/test/server.test.js` (update one assertion, append), `portal/test/notices.test.js`

**Interfaces:**
- Consumes: job rows from Task 4.
- Produces: `delayed` in session detail gains `kind: 'usage_limit' | 'drafting'` and, for drafting, `draftingKind`; `delayedNotice(d, now?) => string` exported from `public/notices.js`; `DRAFT_RETRY_PREFIX` exported from `server.js`.

- [ ] **Step 1: Write the failing tests**

In `server.test.js`, change the existing `deepEqual` in "session detail reports the delay only while usage-limited" to include `kind: 'usage_limit'`, then append:

```js
function mkDraftBlocked(email = 'owner@test.com', kind = 'auth') {
  const db = getDb();
  const sid = `drb-${Math.random().toString(16).slice(2)}`;
  const jid = `job-${sid}`;
  db.prepare("insert into sessions (id, user_email, title, status) values (?, ?, 'Designer at Acme', 'drafting_blocked')").run(sid, email);
  db.prepare("insert into messages (id, session_id, role, body) values (?, ?, 'user', 'yes, apply')").run(`m-${sid}`, sid);
  db.prepare(`insert into jobs (id, session_id, prompt, status, error, failure_kind, resets_at, resets_at_exact, limit_type)
    values (?, ?, 'the prompt', 'failed', 'detail', 'drafting_blocked', null, 0, ?)`).run(jid, sid, kind);
  return { sid, jid };
}

test('a drafting-blocked session reports a drafting delay', async () => {
  const { sid, jid } = mkDraftBlocked();
  assert.deepEqual((await detail(sid)).delayed, {
    jobId: jid, kind: 'drafting', draftingKind: 'auth', resetsAt: null, exact: false, limitType: 'unknown',
  });
});

test('retrying a blocked draft requeues it once with the carry-on prefix', async () => {
  const { DRAFT_RETRY_PREFIX } = await import('../src/server.js');
  const { sid, jid } = mkDraftBlocked();
  assert.equal((await post(`/api/sessions/${sid}/retry`, ownerCookie)).status, 200);
  const job = getDb().prepare('select * from jobs where id = ?').get(jid);
  assert.equal(job.status, 'queued');
  assert.equal(job.prompt, `${DRAFT_RETRY_PREFIX}the prompt`);
  assert.equal(getDb().prepare('select status from sessions where id = ?').get(sid).status, 'working');
  assert.equal((await post(`/api/sessions/${sid}/retry`, ownerCookie)).status, 409);
  assert.equal(getDb().prepare('select prompt from jobs where id = ?').get(jid).prompt, `${DRAFT_RETRY_PREFIX}the prompt`);
});

test('a blocked draft cannot be retried once a newer message was sent', async () => {
  const { sid, jid } = mkDraftBlocked();
  getDb().prepare("insert into jobs (id, session_id, prompt, status, created_at) values (?, ?, 'newer', 'queued', datetime('now', '+1 minute'))")
    .run(`newer-${sid}`, sid);
  assert.equal((await post(`/api/sessions/${sid}/retry`, ownerCookie)).status, 409);
  assert.equal(getDb().prepare('select status from jobs where id = ?').get(jid).status, 'failed');
});
```

Create `portal/test/notices.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { delayedNotice } = await import('../public/notices.js');

test('the usage-limit notice is unchanged', () => {
  const html = delayedNotice({ kind: 'usage_limit', resetsAt: null, exact: false, limitType: 'session' });
  assert.match(html, /Your reply is delayed/);
  assert.match(html, /id="retry"/);
});

test('a drafting limit says the draft is waiting on the writing service', () => {
  const html = delayedNotice({ kind: 'drafting', draftingKind: 'usage_limit', resetsAt: null, exact: false, limitType: 'unknown' });
  assert.match(html, /Your draft is waiting/);
  assert.match(html, /has reached its limit/);
  assert.match(html, /id="retry"/);
});

test('any other drafting block says the service is not available, and never names the vendor', () => {
  for (const draftingKind of ['auth', 'error']) {
    const html = delayedNotice({ kind: 'drafting', draftingKind, resetsAt: null, exact: false, limitType: 'unknown' });
    assert.match(html, /isn't available right now/);
    assert.doesNotMatch(html, /codex|gpt|chatgpt|openai/i);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd portal && node --test test/server.test.js test/notices.test.js`
Expected: FAIL (`kind` missing, `notices.js` not found).

- [ ] **Step 3: Implement the server side**

Replace `delayedFor` in `server.js`:

```js
// Prepended once when a blocked draft is retried, so Claude resumes the draft
// rather than reading the repeated message as new.
export const DRAFT_RETRY_PREFIX = 'Retrying after the writer was unavailable: carry on with the draft.\n\n';

// Which session status each retryable failure leaves behind.
const RETRYABLE = { usage_limited: 'usage_limit', drafting_blocked: 'drafting_blocked' };

// The failed turn a delayed session is waiting on, or null. Only the latest
// job counts: once the user sends something newer, the notice is stale.
// rowid breaks ties between jobs created in the same second.
function delayedFor(db, session) {
  const kind = RETRYABLE[session.status];
  if (!kind) return null;
  const job = db.prepare('select * from jobs where session_id = ? order by created_at desc, rowid desc limit 1')
    .get(session.id);
  if (!job || job.status !== 'failed' || job.failure_kind !== kind) return null;
  if (kind === 'drafting_blocked') {
    return {
      jobId: job.id, kind: 'drafting', draftingKind: job.limit_type || 'error',
      resetsAt: job.resets_at, exact: job.resets_at_exact === 1, limitType: 'unknown',
    };
  }
  return {
    jobId: job.id,
    kind: 'usage_limit',
    resetsAt: job.resets_at,
    exact: job.resets_at_exact === 1,
    limitType: job.limit_type || 'unknown',
  };
}
```

In the retry route, replace the job update with:

```js
      const prompt = db.prepare('select prompt from jobs where id = ?').get(delayed.jobId).prompt;
      const next = delayed.kind === 'drafting' && !prompt.startsWith(DRAFT_RETRY_PREFIX)
        ? DRAFT_RETRY_PREFIX + prompt : prompt;
      db.prepare(`update jobs set status = 'queued', prompt = ?, error = null, failure_kind = null,
          resets_at = null, resets_at_exact = null, limit_type = null where id = ?`).run(next, delayed.jobId);
```

- [ ] **Step 4: Implement the notice**

Create `portal/public/notices.js`, moving `delayedNotice` out of `app.js` so it can be tested:

```js
import { formatResetLondon, resetHasPassed } from './time.js';

const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Shown when a turn is waiting on a limit or on the writing service. Built
   only from fixed strings and the formatted time, never from the error text.
   User-facing copy never names the vendor. */
export function delayedNotice(d, now = new Date()) {
  let when = '';
  if (resetHasPassed(d.resetsAt, d, now)) {
    when = ' The limit should have reset by now, so a retry should work.';
  } else {
    const at = formatResetLondon(d.resetsAt, d, now);
    if (at) when = ` The limit should reset at about ${esc(at)}.`;
  }
  if (d.kind === 'drafting') {
    const why = d.draftingKind === 'usage_limit' ? 'has reached its limit' : "isn't available right now";
    return `<div class="notice-delayed" role="status">
    <p><strong>Your draft is waiting.</strong> The writing service Jawbs uses ${why}, so the CV and cover letter haven't been written yet.${d.draftingKind === 'usage_limit' ? when : ''}</p>
    <button id="retry" class="secondary">Retry draft</button></div>`;
  }
  return `<div class="notice-delayed" role="status">
    <p><strong>Your reply is delayed.</strong> The Claude account behind Jawbs has reached its usage limit, so Jawbs couldn't answer this message yet.${when}</p>
    <button id="retry" class="secondary">Retry message</button></div>`;
}
```

In `app.js`: delete the local `delayedNotice` and its comment, change the `time.js` import to `import { formatLondon } from './time.js';` (keep any other names it still uses; check with `grep -n "formatResetLondon\|resetHasPassed" public/app.js`), add `import { delayedNotice } from './notices.js';`, and change the badge condition at the session list line (currently `s.status === 'usage_limited'`) to:

```js
      ${s.status === 'usage_limited' || s.status === 'drafting_blocked' ? `<span class="badge-delayed" aria-label="${esc(s.title)}: ${s.status === 'drafting_blocked' ? 'draft waiting' : 'reply delayed by the usage limit'}">Delayed</span>` : ''}
```

- [ ] **Step 5: Run to verify pass**

Run: `cd portal && npm test`
Expected: PASS.

- [ ] **Step 6: Check the page in a browser against a throwaway portal**

Run a second portal on a spare port with a scratch database (never 8710):

```bash
cd portal && PORT=8799 DB_PATH=/tmp/claude-1000/drafting-ui.db PORTAL_USERS_FILE=/nonexistent ALLOWED_EMAILS=test@example.com node src/server.js
```

Insert a `drafting_blocked` session and job for `test@example.com` into the scratch DB with `sqlite3` (the same rows as `mkDraftBlocked`), log in, and confirm the Delayed badge, the "Your draft is waiting" notice and that Retry flips the session to working. Stop the server afterwards.

- [ ] **Step 7: Commit**

```bash
git add portal/src/server.js portal/public/notices.js portal/public/app.js portal/test/server.test.js portal/test/notices.test.js
git commit -m "Show a waiting draft with a Retry button that resumes it"
```

---

### Task 6: Live verification

**Files:** none committed, except fixtures if a new real failure shape is captured.

- [ ] **Step 1: Real draft against a copy of a real application**

```bash
S=/tmp/claude-1000/-home-spacetimejam-j4/660e7108-f20e-4e4d-a9ee-10b20359397f/scratchpad/live
mkdir -p $S/proj/applications && cp -r ~/j4/s/core ~/j4/s/templates $S/proj/
cp -r ~/j4/s/applications/mc-saatchi-social-strategy-director $S/proj/applications/
printf 'Lead with measurement and creator strategy. Keep the letter to the agreed paragraph count.\n' \
  > $S/proj/applications/mc-saatchi-social-strategy-director/brief.md
node bin/chatgpt-draft $S/proj/applications/mc-saatchi-social-strategy-director; echo "exit $?"
cat $S/proj/applications/mc-saatchi-social-strategy-director/draft-provenance.json
```

Expected: exit 0, a draft with populated `cv` and `cover_letter`, provenance with `gpt-6-astra`, `low` and a Codex version. Read the copy: check it is in Sam's voice and makes no claim absent from `core/profile.md`. Report both to the owner.

- [ ] **Step 2: Real auth failure**

```bash
mkdir -p ~/.cache/j4-draft-noauth
CODEX_HOME=~/.cache/j4-draft-noauth node bin/chatgpt-draft $S/proj/applications/mc-saatchi-social-strategy-director; echo "exit $?"
rm -rf ~/.cache/j4-draft-noauth
```

Expected: exit 4 and a one-line JSON with `"kind":"auth"`. (`CODEX_HOME` must not sit under `/tmp`: Codex refuses to create its helpers there.)

- [ ] **Step 3: Full suites**

Run: `cd portal && npm test && cd .. && bash setup/test/run-tests.sh`
Expected: all pass, `Failed: 0`.

- [ ] **Step 4: Clean up** `rm -rf $S/proj` (it holds a copy of Sam's personal files).

---

### Task 7: Rollout (only with the owner's go-ahead)

- [ ] **Step 1:** Ask the owner to approve merging and restarting. Do not proceed without a yes.
- [ ] **Step 2:** Merge `chatgpt-drafting` into `master` in `~/j4dev`, push from `~/j4dev`, then `git -C ~/j4 pull` (the live checkout is pull-only).
- [ ] **Step 3:** `systemctl --user restart job-search-portal && systemctl --user status job-search-portal`; confirm it is active and `journalctl --user -u job-search-portal -n 20` is clean.
- [ ] **Step 4:** Add a Key-decisions entry to the kit `CLAUDE.md` (owner has uncommitted edits in both checkouts: add the entry without disturbing them, and show the owner the diff):

```markdown
- **ChatGPT writes the CV and cover letter copy; Claude briefs and checks it.** In the portal, stage 2 and redrafts run `bin/chatgpt-draft` (logic in `portal/src/drafting.js`), which calls `codex exec` read-only in the project folder with GPT-6 Astra at low effort on the ChatGPT subscription signed in on beep, and writes `draft.json` plus `draft-provenance.json`. Claude may fit, cut and fact-correct the copy but not rewrite it. When the writer is unavailable the draft waits (owner decision, 2026-09-28): the agent sets `drafting_blocked`, the session goes to `drafting_blocked` with a Retry button, and admins are emailed for `auth` and `error` but not a limit. Fix an `auth` block with `codex login` as the service user. `--ignore-user-config` keeps the owner's MCP servers away from the writer; stdin must be closed or `codex exec` hangs. Spec: `docs/superpowers/specs/2026-09-28-portal-chatgpt-drafting-design.md`.
```

- [ ] **Step 5:** Watch the first live stage 2 turn: confirm `draft-provenance.json` appears in the application folder and the delivered PDFs carry the drafted copy.
