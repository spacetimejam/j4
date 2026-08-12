# Portal single-answer replies implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a portal turn return one confident answer as a schema-enforced field, so the reply can never be empty and process narration can never reach the user.

**Architecture:** Declare a JSON schema for the whole turn and pass it to the agent SDK as `outputFormat`. The runner reads `structured_output` from the result message and returns it alongside the accumulated text, which stays as a fallback. The queue prefers the structured fields and falls back to the existing fenced-directive parsing for runners that cannot enforce a schema.

**Tech Stack:** Node 18+, ES modules, `@anthropic-ai/claude-agent-sdk` 0.3.207, `node:test`, better-sqlite3.

**Spec:** `docs/superpowers/specs/2026-08-12-portal-single-answer-replies-design.md`

## Global Constraints

- Docs in British English; no em dashes or en dashes as sentence punctuation.
- `portal/` is Node 18+ ES modules. Tests are `node:test`, run with `cd portal && npm test`.
- Setup scripts are untouched by this plan, but `bash setup/test/run-tests.sh` must still pass (109 tests).
- Existing tests must stay green. In particular, `portal/test/agent.test.js` asserts on the exact wording of the fenced-block prompt (`/followed by an email-to-user block[\s\S]{0,80}attaching the prep file/` and `/session-title/`). The fenced variant's wording must be preserved character-for-character, including the absence of backticks around `email-to-user`.
- `runCli` and `runCodex` are not modified by any task in this plan.
- The live service runs from `~/j4/portal`. All work happens in this worktree; do not touch the live checkout, and do not restart the service.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `portal/src/agent.js` | Owns `REPLY_SCHEMA`, the portal prompt in both protocol variants, the directive parsers (unchanged), and runner dispatch | 1, 3 |
| `portal/src/runners/claude-sdk.js` | Passes the schema as `outputFormat`, returns `{ sessionId, structured, text }` | 1 |
| `portal/src/queue.js` | Prefers `turn.structured`, falls back to directive parsing, fails loudly on an empty reply | 2 |
| `portal/test/claude-sdk.test.js` | Runner tests through the injected `queryImpl` | 1 |
| `portal/test/queue.test.js` | Queue tests with a fake `runTurn` | 2 |
| `portal/test/agent.test.js` | Prompt and dispatch tests | 3 |
| `CLAUDE.md` | Records the decision | 4 |

---

### Task 1: Reply schema and structured output from the claude-sdk runner

**Files:**
- Modify: `portal/src/agent.js` (add `REPLY_SCHEMA` export near the top, after the imports)
- Modify: `portal/src/runners/claude-sdk.js`
- Test: `portal/test/claude-sdk.test.js` (add to the existing file; the six existing tests stay unchanged and must remain green)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `REPLY_SCHEMA` exported from `portal/src/agent.js`: a plain object, the JSON Schema below.
  - `runClaudeSdk({ prompt, systemPrompt, resumeSessionId, cwd, model }, { queryImpl } = {})` now resolves to `{ sessionId: string|null, structured: object|null, text: string }`. Task 2 reads `structured` and `text`.

Note for the implementer: the six existing tests in `claude-sdk.test.js` build result messages with no `structured_output` field, so they exercise the fallback path and need no changes. Do not rewrite them.

- [ ] **Step 1: Write the failing tests**

Add to the top of `portal/test/claude-sdk.test.js`, alongside the existing import:

```js
const { REPLY_SCHEMA } = await import('../src/agent.js');
```

Add these helpers next to the existing `success` helper:

```js
const structuredSuccess = (output, text = '') => ({
  type: 'result', subtype: 'success', result: text, structured_output: output,
});
const REPLY = { reply: 'One more chase tonight.', title: 'Director at Acme', awaiting_user: false, email: null };
```

Append these tests:

```js
test('declares the reply schema as the output format', async () => {
  let seen;
  const capture = (args) => {
    seen = args;
    return (async function* () { yield init; yield success('hi'); })();
  };
  await runClaudeSdk(
    { prompt: 'p', systemPrompt: 's', resumeSessionId: null, cwd: '/tmp', model: 'm' },
    { queryImpl: capture },
  );
  assert.equal(seen.options.outputFormat.type, 'json_schema');
  assert.deepEqual(seen.options.outputFormat.schema, REPLY_SCHEMA);
});

test('returns the structured reply when the SDK supplies one', async () => {
  const { structured } = await run([init, assistantText('narration'), structuredSuccess(REPLY)]);
  assert.deepEqual(structured, REPLY);
});

test('returns no structured output when the SDK supplies none', async () => {
  const { structured, text } = await run([init, assistantText('plain answer'), success('plain answer')]);
  assert.equal(structured, null);
  assert.equal(text, 'plain answer');
});

test('throws naming the subtype when structured output retries are exhausted', async () => {
  await assert.rejects(
    run([init, { type: 'result', subtype: 'error_max_structured_output_retries' }]),
    /error_max_structured_output_retries/,
  );
});
```

The last test guards the alert path: `queue.js` puts this message into the admin email, so the subtype has to survive into it. It passes against the current throw and exists to stop that regressing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd portal && node --test test/claude-sdk.test.js`

Expected: the schema test and both structured tests FAIL. The schema test fails with `Cannot read properties of undefined (reading 'type')` because `options.outputFormat` is not set. The structured tests fail with `undefined` for `structured` because the runner does not return that key. The retries test PASSES (see note above), as do the six existing tests.

- [ ] **Step 3: Add the schema to `portal/src/agent.js`**

Insert after the `import` lines and before `portalPrompt`:

```js
// The whole shape of a portal turn, enforced by the agent SDK rather than
// recovered from prose. Every field is required and the nullable ones use
// anyOf, so the agent makes an explicit choice instead of omitting one.
// `reply` carries no minLength because structured outputs do not support
// string constraints; queue.js rejects an empty reply instead.
export const REPLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'title', 'awaiting_user', 'email'],
  properties: {
    reply: { type: 'string' },
    title: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    awaiting_user: { type: 'boolean' },
    email: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['subject', 'body', 'attachments'],
          properties: {
            subject: { type: 'string' },
            body: { type: 'string' },
            attachments: { type: 'array', items: { type: 'string' } },
          },
        },
        { type: 'null' },
      ],
    },
  },
};
```

- [ ] **Step 4: Pass the schema and read the field in `portal/src/runners/claude-sdk.js`**

Add `REPLY_SCHEMA` to the imports:

```js
import { REPLY_SCHEMA } from '../agent.js';
```

Add to the `options` object passed to `queryImpl`, after `settingSources`:

```js
      outputFormat: { type: 'json_schema', schema: REPLY_SCHEMA },
```

Replace the message loop and return with:

```js
  let sessionId = resumeSessionId || null;
  const parts = [];
  let result = '';
  let structured = null;
  for await (const msg of q) {
    if (msg.type === 'system' && msg.subtype === 'init') sessionId = msg.session_id;
    // Every text block the agent addressed to the user, in order. This is now
    // the fallback for a build that ignores outputFormat; the structured field
    // below is the real answer. Reading msg.result instead loses everything
    // said before a tool call, because result is only the final assistant
    // message. A subagent's text is working-out rather than an answer, so it
    // stays out.
    if (msg.type === 'assistant' && !msg.parent_tool_use_id) {
      for (const block of msg.message?.content || []) {
        if (block.type === 'text' && block.text.trim()) parts.push(block.text.trim());
      }
    }
    if (msg.type === 'result') {
      if (msg.subtype !== 'success') throw new Error(`agent turn failed: ${msg.subtype}`);
      result = msg.result || '';
      structured = msg.structured_output ?? null;
    }
  }
  return { sessionId, structured, text: parts.length ? parts.join('\n\n') : result };
```

Check for an import cycle before moving on: `agent.js` imports the runners and the runners now import `agent.js`. Node's ES module loader handles this because `REPLY_SCHEMA` is only read at call time, not at module evaluation time. If the test run reports `REPLY_SCHEMA` as undefined, move the schema into a new `portal/src/reply-schema.js` imported by both, and re-run.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd portal && node --test test/claude-sdk.test.js`

Expected: PASS, 10 tests, 0 failures.

- [ ] **Step 6: Run the full suite**

Run: `cd portal && npm test`

Expected: PASS, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add portal/src/agent.js portal/src/runners/claude-sdk.js portal/test/claude-sdk.test.js
git commit -m "Declare the reply schema and return the SDK's structured output"
```

---

### Task 2: Queue consumes structured turns

**Files:**
- Modify: `portal/src/queue.js:69-101` (the body of the `try` block in `processOneJob`, from the destructure through the status update)
- Test: `portal/test/queue.test.js` (append; every existing test stays unchanged and green)

**Interfaces:**
- Consumes: `runClaudeSdk`'s `{ sessionId, structured, text }` from Task 1. In tests this is a fake `runTurn` returning the same shape.
- Produces: no new exports. Behaviour other tasks rely on: a turn whose `structured.reply` is empty or whitespace throws, so the session goes to `needs_attention` and the job to `failed`.

- [ ] **Step 1: Write the failing tests**

Append to `portal/test/queue.test.js`:

```js
test('a structured turn stores the reply, title and status without parsing prose', async () => {
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'reply' });
  const runTurn = async () => ({
    sessionId: 'c-struct',
    structured: {
      reply: 'One more chase tonight, then let them come to you.',
      title: 'Social Strategy Director at M+C Saatchi',
      awaiting_user: false,
      email: null,
    },
    text: 'narration that must not reach the user',
  });
  await processOneJob({ runTurn, send: async () => {} });
  const s = getDb().prepare('select * from sessions where id = ?').get(sid);
  assert.equal(s.title, 'Social Strategy Director at M+C Saatchi');
  assert.equal(s.status, 'active');
  assert.equal(s.claude_session_id, 'c-struct');
  const msgs = getDb().prepare("select body from messages where session_id = ? and role = 'claude'").all(sid);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].body, 'One more chase tonight, then let them come to you.');
});

test('a structured email is delivered and recorded', async () => {
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'reply' });
  const prepPath = join(tmpdir(), `prep-${newId()}.md`);
  writeFileSync(prepPath, '# prep');
  let sent;
  const runTurn = async () => ({
    sessionId: 'c-mail',
    structured: {
      reply: 'Prep attached.',
      title: 'Director at Acme',
      awaiting_user: false,
      email: { subject: 'Interview prep', body: 'Here you go', attachments: [prepPath] },
    },
    text: '',
  });
  await processOneJob({ runTurn, send: async e => { sent = e; } });
  assert.equal(sent.subject, 'Interview prep');
  assert.equal(sent.attachments[0].filename, basename(prepPath));
  assert.equal(getDb().prepare('select status from sessions where id = ?').get(sid).status, 'done');
  const docs = getDb().prepare('select path from documents where session_id = ?').all(sid);
  assert.deepEqual(docs.map(d => d.path), [prepPath]);
});

test('an empty structured reply fails the job instead of storing a blank message', async () => {
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'reply' });
  await processOneJob({
    runTurn: async () => ({
      sessionId: 'c-empty',
      structured: { reply: '   ', title: null, awaiting_user: false, email: null },
      text: '',
    }),
    send: async () => {},
  });
  assert.equal(getDb().prepare('select status from sessions where id = ?').get(sid).status, 'needs_attention');
  assert.equal(getDb().prepare('select status from jobs where session_id = ?').get(sid).status, 'failed');
  assert.equal(
    getDb().prepare("select count(*) c from messages where session_id = ? and role = 'claude'").get(sid).c,
    0,
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd portal && node --test test/queue.test.js`

Expected: the first two FAIL because `processOneJob` still reads `turn.text` and finds no directives, so the stored body is the narration string and the title and email are never applied. The third FAILS because a blank message is stored and the session ends `active` rather than `needs_attention`.

- [ ] **Step 3: Implement in `portal/src/queue.js`**

Replace these three lines:

```js
    const { sessionId: claudeId, text } = turn;
    const { clean: afterEmail, email } = parseEmailDirective(text);
    const { clean, title, awaitingUser } = parseTitleDirective(afterEmail);
```

with:

```js
    const { sessionId: claudeId, structured, text } = turn;
    // A schema-enforced turn says which text is the answer, so there is nothing
    // to parse out of prose and nothing the agent narrates can leak into the
    // reply. Runners that cannot enforce a schema still use the fenced blocks.
    let clean, title, awaitingUser, email;
    if (structured) {
      ({ reply: clean, title, awaiting_user: awaitingUser, email } = structured);
      if (!clean || !clean.trim()) throw new Error('agent returned an empty reply');
      // The schema guarantees this shape; the guard mirrors parseEmailDirective
      // so a malformed field degrades to "no email" rather than throwing here.
      if (email && (!email.subject || !email.body || !Array.isArray(email.attachments))) email = null;
    } else {
      const { clean: afterEmail, email: parsedEmail } = parseEmailDirective(text);
      ({ clean, title, awaitingUser } = parseTitleDirective(afterEmail));
      email = parsedEmail;
    }
```

Leave everything after that point unchanged: `clean` is still what gets inserted as the message body, `title` still goes through the trim-and-truncate, `awaitingUser` still feeds `sessionStatus`, and `email` still drives the delivery path.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd portal && node --test test/queue.test.js`

Expected: PASS, 0 failures. Confirm the pre-existing directive tests ("email directive marks session done and sends", "attachments are passed through with their original filenames") are still passing, since they exercise the fallback branch.

- [ ] **Step 5: Run the full suite**

Run: `cd portal && npm test`

Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add portal/src/queue.js portal/test/queue.test.js
git commit -m "Take the reply from the schema when the runner enforces one"
```

---

### Task 3: Structured reply prompt and runner wiring

**Files:**
- Modify: `portal/src/agent.js:6-108` (`portalPrompt`) and `portal/src/agent.js:168-178` (`runAgentTurn`)
- Test: `portal/test/agent.test.js` (append; the eight existing `portalPrompt` tests stay unchanged and green)

**Interfaces:**
- Consumes: `REPLY_SCHEMA` field names from Task 1 (`reply`, `title`, `awaiting_user`, `email`).
- Produces: `portalPrompt(userName, { structured = false } = {})`. The default is `false`, which is why every existing test that calls `portalPrompt('Test')` keeps passing.

- [ ] **Step 1: Write the failing tests**

Append to `portal/test/agent.test.js`:

```js
test('the structured prompt describes the fields and drops the fenced blocks', () => {
  const p = portalPrompt('Sam', { structured: true });
  assert.match(p, /"reply"/);
  assert.match(p, /"awaiting_user"/);
  assert.doesNotMatch(p, /```email-to-user/);
  assert.doesNotMatch(p, /```session-title/);
});

test('the structured prompt asks for one answer after the work, not narration', () => {
  const p = portalPrompt('Sam', { structured: true });
  assert.match(p, /Do all the work first/);
  assert.match(p, /No thinking aloud/);
});

test('the default prompt keeps the fenced protocol for the CLI runners', () => {
  const p = portalPrompt('Sam');
  assert.match(p, /```email-to-user/);
  assert.match(p, /```session-title/);
});

test('runAgentTurn gives the claude-sdk runner the structured prompt', async () => {
  let seen;
  const runners = { 'claude-sdk': async args => { seen = args; return { sessionId: 's', text: '' }; } };
  await runAgentTurn(
    { prompt: 'p', resumeSessionId: null, user: { name: 'Sam', projectDir: '/tmp' } },
    { runners, runnerName: 'claude-sdk' },
  );
  assert.doesNotMatch(seen.systemPrompt, /```session-title/);
  assert.match(seen.systemPrompt, /"awaiting_user"/);
});
```

The last test passes `runnerName` explicitly rather than mutating `process.env.AGENT_RUNNER`, because `config.js` reads the environment once at import time and this test file already imported it with `AGENT_RUNNER=cli`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd portal && node --test test/agent.test.js`

Expected: the three structured tests FAIL (the second argument is ignored, so the fenced blocks are still present and the field names are absent). The default-prompt test PASSES. The `runAgentTurn` test FAILS with `unknown agent runner: cli`, because `runnerName` is not a supported option yet.

- [ ] **Step 3: Parameterise the prompt in `portal/src/agent.js`**

Change the signature and add the protocol pieces. Above `portalPrompt`, add:

```js
// Runners that can enforce REPLY_SCHEMA get the structured protocol; the rest
// keep the fenced blocks. Kept as a set rather than a comparison so adding a
// schema-capable runner is a one-line change.
const STRUCTURED_RUNNERS = new Set(['claude-sdk']);
```

`portalPrompt` is currently an arrow function with an implicit template return (`export const portalPrompt = (userName) => \`...\`;`). Convert it to a block body:

```js
export const portalPrompt = (userName, { structured = false } = {}) => {
  const emailPhrase = structured ? 'the email field' : 'an email-to-user block';
  const protocol = structured ? structuredProtocol(userName) : fencedProtocol(userName);
  return `
<existing template body, minus the protocol section, unchanged>

${protocol}
`;
};
```

Note the three changes that turns into: the `{` and `return` at the top, and the `\`;\n};` at the bottom in place of the current `\`;`.

Inside the template body, replace each mention of the email mechanism with `${emailPhrase}`:

- stage 1: `and do NOT emit ${emailPhrase}, at this stage.`
- stage 3 interviews: `followed by ${emailPhrase} (the exact format below) attaching the prep file`
- stage 3 revisions: `end your turn with a fresh ${emailPhrase}`
- the redraft paragraph: `end your turn with\na fresh ${emailPhrase} so they receive the redrafted PDFs.`

Leave `No email block unless you produced a document worth attaching.` and `No email block.` exactly as they are; they read correctly under both protocols.

Now extract the protocol section. In the current file that is `portal/src/agent.js:72-105`: it starts at the line `(the hard rule in render/README.md), and re-render. Then end your final message with exactly` and runs to the end of the `awaiting_user` paragraph, ending `...leaving "title" out until you do.` Move those lines verbatim into a new function declared above `portalPrompt`:

```js
const fencedProtocol = (userName) => `<lines 72-105 of the current template, pasted unchanged>`;
```

Two rules for this move. Keep the text character-for-character, including `${userName}` interpolations, which is why the function takes `userName`. Do not reflow or reword it: `agent.test.js` matches `/followed by an email-to-user block[\s\S]{0,80}attaching the prep file/` and `/session-title/` against this text, and the sentence about the one-page CV rule at the start of line 72 belongs to the render paragraph, so leave that fragment in the main body and start the extraction at `Then end your final message with exactly`.

Add the new variant:

```js
const structuredProtocol = (userName) => `
YOUR REPLY IS STRUCTURED DATA. The portal reads four fields from you, not prose:

- "reply": everything ${userName} should read, as markdown. This is the only text
  they see; anything you write outside this field is discarded.
- "title": "<role> at <company>" once you know both, otherwise null.
- "awaiting_user": true only when you have asked ${userName} something that is
  still outstanding, so the portal can show a Reply badge. If you have finished
  the exchange, or the next move is waiting on an employer rather than on
  ${userName}, set it to false.
- "email": null, or {"subject": ..., "body": ..., "attachments": [absolute paths]}
  when you have documents to deliver.

Do all the work first. Write nothing to ${userName} until every file is written
and every check is done. Then reply once, in "reply":

- Lead with the recommendation or verdict, stated plainly.
- Follow it with a short paragraph of why.
- Close with a brief line confirming what you recorded in the tracker or log.

No thinking aloud, no weighing one option against another in front of
${userName}, and no narrating what you are about to do. They want one confident
answer, not your working.
`;
```

- [ ] **Step 4: Wire it up in `runAgentTurn`**

Replace the body of `runAgentTurn` with:

```js
export async function runAgentTurn(
  { prompt, resumeSessionId, user },
  { runners = RUNNERS, runnerName = config.agentRunner } = {},
) {
  const runner = runners[runnerName];
  if (!runner) throw new Error(`unknown agent runner: ${runnerName}`);
  return runner({
    prompt,
    systemPrompt: portalPrompt(user.name, { structured: STRUCTURED_RUNNERS.has(runnerName) }),
    resumeSessionId: resumeSessionId || null,
    cwd: user.projectDir,
    model: config.agentModel,
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd portal && node --test test/agent.test.js`

Expected: PASS, 0 failures. If the pre-existing test `runAgentTurn selects the configured runner and passes the contract fields` fails on `seen.systemPrompt.includes('email-to-user')`, the fenced wording was altered during the extraction; restore it exactly.

- [ ] **Step 6: Run both suites**

Run: `cd portal && npm test` then `cd .. && bash setup/test/run-tests.sh`

Expected: portal PASS with 0 failures; setup `Passed: 109  Failed: 0`.

- [ ] **Step 7: Commit**

```bash
git add portal/src/agent.js portal/test/agent.test.js
git commit -m "Give schema-capable runners a structured reply prompt"
```

---

### Task 4: Record the decision in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (the "Key decisions: don't re-litigate" list)

**Interfaces:**
- Consumes: the finished behaviour from Tasks 1 to 3.
- Produces: nothing code depends on.

- [ ] **Step 1: Replace the runner entry**

Task 1 of the earlier branch added an entry beginning `- **The reply is every assistant text block, not the SDK's \`result\`.**`. Replace that whole bullet with:

```markdown
- **The reply is a schema field, not text the portal has to identify.** `runClaudeSdk` passes `REPLY_SCHEMA` (in `agent.js`) as the SDK's `outputFormat`, and the turn returns `{reply, title, awaiting_user, email}` in `structured_output`. `queue.js` reads those fields directly, so nothing the agent narrates while working can reach the user and there is no rule for deciding which text is the answer. An empty `reply` throws, which routes to `needs_attention` plus an admin email, because the failure this replaced was silent: on 2026-08-12 the agent answered Sam, edited the tracker, closed with a bare `session-title` block, and the portal stored an empty message while marking the job `done`. The runner still accumulates every non-subagent assistant text block and returns it as `text`, which `queue.js` falls back to with the fenced-directive parsers when a runner supplies no `structured_output`; `runCli` and `runCodex` stay on that path, and `portalPrompt` gives them the fenced protocol while schema-capable runners in `STRUCTURED_RUNNERS` get the field descriptions. The remaining risk is that the whole markdown reply travels as an escaped JSON string, so watch the first live turns for flattening. Spec: `docs/superpowers/specs/2026-08-12-portal-single-answer-replies-design.md`.
```

- [ ] **Step 2: Check the constraints**

Run: `grep -n '—\|–' CLAUDE.md`

Expected: no output for the lines you added. British English throughout.

- [ ] **Step 3: Run both suites one final time**

Run: `cd portal && npm test` then `cd .. && bash setup/test/run-tests.sh`

Expected: portal PASS with 0 failures; setup `Passed: 109  Failed: 0`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record the schema-enforced reply decision"
```

---

## Not in this plan

- Deploying. Merging to master and restarting `job-search-portal.service` is the owner's call and happens outside this worktree.
- Bringing `runCli` and `runCodex` onto the schema. Neither can enforce one, and Codex has its own runner spec queued.
- Any frontend change. Replies still arrive as markdown and render unchanged.
