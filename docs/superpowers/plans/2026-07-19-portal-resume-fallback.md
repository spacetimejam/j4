# Portal Resume Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When resuming a portal session fails (pruned Claude transcript), retry the turn once in a fresh session with context rebuilt from the portal's own message history, permanently healing the session.

**Architecture:** `buildRecoveryPrompt(session, messages, prompt)` in `portal/src/queue.js` renders the stored conversation into a re-orientation prompt; `processOneJob` catches a failed resumed turn and retries once with `resumeSessionId: null`. A retention setting ships in the template so new projects stop pruning transcripts.

**Tech Stack:** Node 20+, Express, better-sqlite3, node:test; bash 3.2 for setup. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-19-portal-resume-fallback-design.md`

## Global Constraints

- Work in `/home/spacetimejam/j4dev`; portal tests via `cd /home/spacetimejam/j4dev/portal && npm test`; setup tests via `bash /home/spacetimejam/j4dev/setup/test/run-tests.sh` (prints `Passed: N  Failed: N`).
- No new dependencies; no change to the runner contract or `portal/src/runners/*`.
- Retry exactly once, and only when the failed attempt used a non-null `resumeSessionId`; a retry failure falls through to the existing failure path.
- Message bodies in the recovery prompt are truncated to 2,000 characters; roles are labelled `[User]`, `[Claude]`, `[Portal]` (for `system`).
- Setup scripts stay bash 3.2 compatible.
- Prompt copy in British English; no em/en dashes as sentence punctuation.

---

### Task 1: `buildRecoveryPrompt`

**Files:**
- Modify: `portal/src/queue.js` (new export, above `processOneJob`)
- Test: `portal/test/queue.test.js`

**Interfaces:**
- Produces: `buildRecoveryPrompt(session, messages, prompt)` → string. `session` needs `.title`; `messages` is an array of `{ role, body }` already ordered oldest first; `prompt` is the original job prompt, appended last. Task 2 consumes it inside the same file.

- [ ] **Step 1: Write the failing tests**

Append to `portal/test/queue.test.js` (add `buildRecoveryPrompt` to the existing import from `../src/queue.js`):

```js
test('buildRecoveryPrompt renders title, ordered labelled history, and the prompt last', () => {
  const out = buildRecoveryPrompt(
    { title: 'Designer at Acme' },
    [
      { role: 'user', body: 'the JD' },
      { role: 'claude', body: 'my assessment' },
      { role: 'system', body: 'housekeeping note' },
    ],
    'New reply from the portal.',
  );
  assert.match(out, /Portal session title: Designer at Acme/);
  const iUser = out.indexOf('[User] the JD');
  const iClaude = out.indexOf('[Claude] my assessment');
  const iPortal = out.indexOf('[Portal] housekeeping note');
  const iPrompt = out.indexOf('New reply from the portal.');
  assert.ok(iUser >= 0 && iClaude > iUser && iPortal > iClaude && iPrompt > iPortal);
  assert.ok(out.endsWith('New reply from the portal.'));
});

test('buildRecoveryPrompt truncates each message body to 2000 characters', () => {
  const out = buildRecoveryPrompt(
    { title: 'T' },
    [{ role: 'user', body: 'x'.repeat(2001) }],
    'p',
  );
  assert.ok(out.includes('x'.repeat(2000)));
  assert.ok(!out.includes('x'.repeat(2001)));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/spacetimejam/j4dev/portal && npm test`
Expected: FAIL (`buildRecoveryPrompt` not exported).

- [ ] **Step 3: Implement**

In `portal/src/queue.js`, above `processOneJob`:

```js
// When a resumed turn fails (the Claude transcript may have been pruned), the
// retry runs in a fresh session that has no memory of the conversation. This
// prompt rebuilds that context from the portal's own message history.
export function buildRecoveryPrompt(session, messages, prompt) {
  const LABELS = { user: '[User]', claude: '[Claude]', system: '[Portal]' };
  const history = messages
    .map(m => `${LABELS[m.role] || `[${m.role}]`} ${m.body.slice(0, 2000)}`)
    .join('\n\n');
  return 'This is a resumed conversation whose earlier Claude session was lost. '
    + `Portal session title: ${session.title}. The conversation so far, oldest first:\n\n`
    + `${history}\n\n`
    + 'Re-orient yourself from the project tracker and the matching application folder '
    + 'before acting. Then handle the new message below as normal.\n\n'
    + prompt;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/spacetimejam/j4dev/portal && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/spacetimejam/j4dev && git add portal/src/queue.js portal/test/queue.test.js
git commit -m "feat(portal): recovery prompt builder for lost claude sessions"
```

---

### Task 2: retry-once-fresh in `processOneJob`

**Files:**
- Modify: `portal/src/queue.js` (the `runTurn` call inside `processOneJob`, currently `const { sessionId: claudeId, text } = await runTurn({...})`)
- Test: `portal/test/queue.test.js`

**Interfaces:**
- Consumes: `buildRecoveryPrompt(session, messages, prompt)` from Task 1 (same file).
- Produces: behaviour only.

- [ ] **Step 1: Write the failing tests**

Append to `portal/test/queue.test.js`. Note `mkSession()` (defined at the top of the file) creates a session titled 'Test role'; sessions get a `claude_session_id` only after a successful turn, so the tests set one directly where a resume is needed:

```js
test('failed resumed turn retries once fresh with a recovery prompt and heals the session', async () => {
  const sid = mkSession();
  getDb().prepare("update sessions set claude_session_id = 'stale-id' where id = ?").run(sid);
  getDb().prepare('insert into messages (id, session_id, role, body) values (?, ?, ?, ?)')
    .run(newId(), sid, 'user', 'original JD text');
  enqueue({ sessionId: sid, prompt: 'Nat replies via the portal:\n\nany news?' });
  const calls = [];
  const runTurn = async args => {
    calls.push(args);
    if (args.resumeSessionId) throw new Error('agent turn failed: error_during_execution');
    return { sessionId: 'fresh-id', text: 'Re-oriented and replied.' };
  };
  await processOneJob({ runTurn, send: async () => {} });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].resumeSessionId, 'stale-id');
  assert.equal(calls[1].resumeSessionId, null);
  assert.match(calls[1].prompt, /Portal session title: Test role/);
  assert.match(calls[1].prompt, /\[User\] original JD text/);
  assert.match(calls[1].prompt, /any news\?$/);
  const s = getDb().prepare('select * from sessions where id = ?').get(sid);
  assert.equal(s.claude_session_id, 'fresh-id');
  assert.equal(s.status, 'awaiting_reply');
  assert.equal(getDb().prepare('select status from jobs where session_id = ?').get(sid).status, 'done');
});

test('failed resumed turn whose fresh retry also fails goes to needs_attention', async () => {
  const sid = mkSession();
  getDb().prepare("update sessions set claude_session_id = 'stale-id' where id = ?").run(sid);
  enqueue({ sessionId: sid, prompt: 'x' });
  let count = 0;
  const runTurn = async () => { count++; throw new Error('boom'); };
  await processOneJob({ runTurn, send: async () => {} });
  assert.equal(count, 2);
  assert.equal(getDb().prepare('select status from sessions where id = ?').get(sid).status, 'needs_attention');
  assert.equal(getDb().prepare('select status from jobs where session_id = ?').get(sid).status, 'failed');
});

test('failed fresh turn is not retried', async () => {
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'x' });
  let count = 0;
  const runTurn = async () => { count++; throw new Error('boom'); };
  await processOneJob({ runTurn, send: async () => {} });
  assert.equal(count, 1);
  assert.equal(getDb().prepare('select status from sessions where id = ?').get(sid).status, 'needs_attention');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/spacetimejam/j4dev/portal && npm test`
Expected: the three new tests FAIL (single call, no retry; first test's session goes needs_attention).

- [ ] **Step 3: Implement**

In `portal/src/queue.js`, inside `processOneJob`, replace:

```js
    const { sessionId: claudeId, text } = await runTurn({
      prompt: job.prompt,
      resumeSessionId: session.claude_session_id || null,
      user,
    });
```

with:

```js
    let turn;
    try {
      turn = await runTurn({
        prompt: job.prompt,
        resumeSessionId: session.claude_session_id || null,
        user,
      });
    } catch (err) {
      // A resumed turn can fail because the Claude transcript was pruned.
      // Retry once in a fresh session with context rebuilt from our own
      // history; a fresh turn's failure is not retryable this way.
      if (!session.claude_session_id) throw err;
      const history = db.prepare('select role, body from messages where session_id = ? order by created_at')
        .all(session.id);
      turn = await runTurn({
        prompt: buildRecoveryPrompt(session, history, job.prompt),
        resumeSessionId: null,
        user,
      });
    }
    const { sessionId: claudeId, text } = turn;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/spacetimejam/j4dev/portal && npm test`
Expected: all PASS (existing tests unaffected: their sessions have no `claude_session_id` when turns fail, so the old single-attempt behaviour holds).

- [ ] **Step 5: Commit**

```bash
cd /home/spacetimejam/j4dev && git add portal/src/queue.js portal/test/queue.test.js
git commit -m "feat(portal): retry failed resumes once in a fresh session"
```

---

### Task 3: transcript retention in the template

**Files:**
- Create: `template/.claude/settings.json`
- Test: `setup/test/run-tests.sh` (one `check` line in the full-run section)

**Interfaces:** none beyond the file landing in new projects.

- [ ] **Step 1: Create the settings file**

Create `template/.claude/settings.json`:

```json
{
  "cleanupPeriodDays": 3650
}
```

- [ ] **Step 2: Add the regression check**

In `setup/test/run-tests.sh`, after the line `check "render/render.sh exists" test -f "$TARGET1/render/render.sh"`, add:

```bash
check ".claude/settings.json ships transcript retention" grep -q "cleanupPeriodDays" "$TARGET1/.claude/settings.json"
```

(The wizard copies with `cp -R "$TEMPLATE_DIR/." "$TARGET_DIR/"`, which includes dot-directories; this check pins that behaviour. Bash 3.2 compatible: plain `check`/`grep`.)

- [ ] **Step 3: Run the setup tests**

Run: `bash /home/spacetimejam/j4dev/setup/test/run-tests.sh`
Expected: output ends `Failed: 0`, with the pass count one higher than before the change.

- [ ] **Step 4: Run the portal tests too (no interference expected)**

Run: `cd /home/spacetimejam/j4dev/portal && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/spacetimejam/j4dev && git add template/.claude/settings.json setup/test/run-tests.sh
git commit -m "feat(setup): ship ten-year transcript retention in new projects"
```

---

### Task 4: rollout

**Files:** none in-repo (operational).

- [ ] **Step 1: Push, pull, restart**

```bash
cd /home/spacetimejam/j4dev && git push origin master
cd /home/spacetimejam/j4 && git pull --ff-only origin master
systemctl --user restart job-search-portal
```

- [ ] **Step 2: Apply retention to the existing project folders**

For each of `/home/spacetimejam/j4/s`, `/home/spacetimejam/j4/n`, `/home/spacetimejam/j4/jc`: create `.claude/settings.json` containing `{"cleanupPeriodDays": 3650}` if absent; if the file exists, merge the key in without disturbing other keys. (`~/j4/s/.claude/` exists with other files but no `settings.json` as of 2026-07-19.)

- [ ] **Step 3: Live check**

`systemctl --user is-active job-search-portal` returns `active`; `curl -s -o /dev/null -w '%{http_code}' http://localhost:8710/` returns 200. The fallback itself is exercised the next time a pruned session gets a reply; no synthetic live test needed given the queue tests cover both paths.
