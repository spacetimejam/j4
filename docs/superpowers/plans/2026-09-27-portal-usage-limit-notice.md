# Portal Usage-Limit Notice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a portal turn fails because the Claude account's usage limit is reached, tell the user in the conversation, show roughly when the limit resets in UK time, and give them a "Retry message" button.

**Architecture:** The `claude-sdk` runner turns a usage-limit failure into a `UsageLimitError` carrying the reset time. The queue records it on the failed job (four new `jobs` columns) and sets the session to `usage_limited`, with no recovery attempt and no admin email. The session detail route exposes a `delayed` object, a new retry route requeues the same job, and `app.js` renders the notice and button.

**Tech Stack:** Node 18+ ES modules, Express, better-sqlite3, `node:test`, `@anthropic-ai/claude-agent-sdk` 0.3.283, plain browser JS with `Intl.DateTimeFormat`.

**Spec:** `docs/superpowers/specs/2026-09-27-portal-usage-limit-notice-design.md`

## Global Constraints

- Work in `~/j4dev`, never `~/j4` (the live portal runs from `~/j4/portal`).
- Retry is manual only; the portal never requeues by itself.
- The Retry button is always pressable, before or after the reset time.
- No admin email for a usage-limit failure; every other failure keeps the existing path and email.
- `runCli` and `runCodex` are unchanged.
- Timestamps are stored as UTC `YYYY-MM-DD HH:MM:SS` and shown in `Europe/London`, 24-hour, with the `BST`/`GMT` label taken from the zone data.
- No error text from the SDK reaches the page; the notice is built from fixed strings through `esc()`.
- Docs and comments in British English, with no em or en dashes as sentence punctuation.
- Run the tests with `cd ~/j4dev/portal && node --test 'test/**/*.test.js'`. `npm test` runs `node --test test/`, which this machine's Node 22 rejects ("Cannot find module .../test") before any test runs; that is a known, separate issue.
- Tests never touch port 8710; server tests already listen on port 0.

## Review Focus

1. **A retry after the reset time has passed.** A user coming back the next morning sees "should reset at about 01:10 BST today" for a time already gone. Expected: the notice says the limit should have reset by now, so retrying should work. Pinned by the `resetHasPassed` tests in Task 5 and used in Task 6.
2. **A new message sent while delayed, then Retry pressed on a stale page.** Expected: 409, nothing requeued, the new message's job untouched. Pinned in Task 4.
3. **`resetsAt` in milliseconds rather than seconds.** The SDK types it only as `number`. Expected: a value above 1e12 is read as milliseconds, not as a date thousands of years away. Pinned in Task 1.
4. **The night the clocks go back.** A reset at 00:30 UTC on 25 October 2026 is 01:30 BST, and one at 01:30 UTC is 01:30 GMT. Expected: the label changes with the zone. Pinned in Task 5.
5. **Several queued turns hitting the limit together**, as happened with five jobs on 2026-09-27. Expected: each session gets its own notice, and none emails admins. Pinned in Task 3.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `portal/src/usage-limit.js` | Create | `UsageLimitError`, parsing the SDK's limit text, turning a failure plus stream signals into the error, `toSqlUtc` |
| `portal/src/runners/claude-sdk.js` | Modify | Watch the stream for limit signals; rethrow failures as `UsageLimitError` |
| `portal/src/db.js` | Modify | Four guarded `jobs` columns; `usage_limited` in the status comment |
| `portal/src/queue.js` | Modify | Skip recovery and admin email for `UsageLimitError`; record it |
| `portal/src/server.js` | Modify | `delayedFor`, `delayed` on session detail, `POST /api/sessions/:id/retry` |
| `portal/public/time.js` | Modify | `formatResetLondon`, `resetHasPassed` |
| `portal/public/app.js` | Modify | Notice, Retry button, "Delayed" label |
| `portal/public/style.css` | Modify | `.notice-delayed`, `.badge-delayed` |
| `CLAUDE.md` | Modify | Key-decisions entry |
| `portal/test/usage-limit.test.js` | Create | Unit tests for the new module |
| `portal/test/usage-limit-migration.test.js` | Create | Migration against a pre-existing `jobs` table |
| `portal/test/claude-sdk.test.js`, `queue.test.js`, `server.test.js`, `time.test.js` | Modify | Tests per task |

---

### Task 1: The usage-limit module

**Files:**
- Create: `portal/src/usage-limit.js`
- Test: `portal/test/usage-limit.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class UsageLimitError extends Error` with `name = 'UsageLimitError'`, `resetsAt: Date | null`, `exact: boolean`, `limitType: 'session' | 'weekly' | 'unknown'`.
  - `parseUsageLimitText(text: string, now?: Date) => { limitType, resetsAt: Date | null } | null`. It returns `null` when the text is not a usage-limit message.
  - `toUsageLimitError(err: unknown, signals: { rejected: object | null, rateLimited: boolean }, now?: Date) => UsageLimitError | null`
  - `toSqlUtc(date: Date | null) => string | null`

- [ ] **Step 1: Write the failing tests**

Create `portal/test/usage-limit.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert';
import {
  UsageLimitError, parseUsageLimitText, toUsageLimitError, toSqlUtc,
} from '../src/usage-limit.js';

// Real error text from the live jobs table, 2026-08 and 2026-09.
const SESSION_TEXT = "Error: Claude Code returned an error result: You've hit your session limit · resets 12:10am (UTC)";
const WEEKLY_TEXT = "Error: Claude Code returned an error result: You've hit your weekly limit · resets 7am (UTC)";
const NOW = new Date('2026-09-27T19:39:07Z');

test('a session limit resolves to the next occurrence of the stated time', () => {
  const r = parseUsageLimitText(SESSION_TEXT, NOW);
  assert.equal(r.limitType, 'session');
  assert.equal(r.resetsAt.toISOString(), '2026-09-28T00:10:00.000Z');
});

test('a reset later the same day stays on the same day', () => {
  const r = parseUsageLimitText("You've hit your session limit · resets 8:40pm (UTC)", new Date('2026-08-05T17:40:44Z'));
  assert.equal(r.resetsAt.toISOString(), '2026-08-05T20:40:00.000Z');
});

test('a weekly limit with an hour only parses, as weekly', () => {
  const r = parseUsageLimitText(WEEKLY_TEXT, new Date('2026-09-07T13:01:49Z'));
  assert.equal(r.limitType, 'weekly');
  assert.equal(r.resetsAt.toISOString(), '2026-09-08T07:00:00.000Z');
});

test('a named zone is honoured, including summer time', () => {
  // 1am London on 28 Sep 2026 is 00:00 UTC, because London is on BST.
  const r = parseUsageLimitText("You've hit your session limit · resets 1am (Europe/London)", NOW);
  assert.equal(r.resetsAt.toISOString(), '2026-09-28T00:00:00.000Z');
});

test('12am is midnight and 12pm is noon', () => {
  const am = parseUsageLimitText("You've hit your session limit · resets 12am (UTC)", NOW);
  const pm = parseUsageLimitText("You've hit your session limit · resets 12pm (UTC)", new Date('2026-09-27T09:00:00Z'));
  assert.equal(am.resetsAt.toISOString(), '2026-09-28T00:00:00.000Z');
  assert.equal(pm.resetsAt.toISOString(), '2026-09-27T12:00:00.000Z');
});

test('a usage-limit message with no readable time keeps the kind and drops the time', () => {
  const r = parseUsageLimitText("You've hit your session limit · resets soon (Mars/Base)", NOW);
  assert.deepEqual(r, { limitType: 'session', resetsAt: null });
});

test('unrelated errors are not usage limits', () => {
  assert.equal(parseUsageLimitText('agent turn failed: error_during_execution', NOW), null);
  assert.equal(parseUsageLimitText('', NOW), null);
});

test('a rejected rate_limit_event gives an exact reset and a mapped type', () => {
  const err = toUsageLimitError(new Error('Claude Code returned an error result: whatever'), {
    rejected: { status: 'rejected', resetsAt: 1790554200, rateLimitType: 'five_hour' },
    rateLimited: false,
  }, NOW);
  assert.ok(err instanceof UsageLimitError);
  assert.equal(err.name, 'UsageLimitError');
  assert.equal(err.exact, true);
  assert.equal(err.limitType, 'session');
  assert.equal(err.resetsAt.getTime(), 1790554200 * 1000);
  assert.match(err.message, /whatever/);
});

test('every seven_day type maps to weekly', () => {
  for (const t of ['seven_day', 'seven_day_opus', 'seven_day_sonnet', 'seven_day_overage_included']) {
    const err = toUsageLimitError(new Error('x'), { rejected: { status: 'rejected', resetsAt: 1790554200, rateLimitType: t }, rateLimited: false }, NOW);
    assert.equal(err.limitType, 'weekly', t);
  }
});

test('a resetsAt already in milliseconds is not multiplied again', () => {
  const err = toUsageLimitError(new Error('x'), {
    rejected: { status: 'rejected', resetsAt: 1790554200000, rateLimitType: 'five_hour' }, rateLimited: false,
  }, NOW);
  assert.equal(err.resetsAt.getTime(), 1790554200000);
});

test('without an event, the text gives an estimated reset', () => {
  const err = toUsageLimitError(new Error(SESSION_TEXT), { rejected: null, rateLimited: false }, NOW);
  assert.equal(err.exact, false);
  assert.equal(err.limitType, 'session');
  assert.equal(err.resetsAt.toISOString(), '2026-09-28T00:10:00.000Z');
});

test('an assistant rate_limit error alone still counts, with no time', () => {
  const err = toUsageLimitError(new Error('agent turn failed: error_during_execution'), { rejected: null, rateLimited: true }, NOW);
  assert.ok(err instanceof UsageLimitError);
  assert.equal(err.resetsAt, null);
  assert.equal(err.limitType, 'unknown');
});

test('an ordinary failure with no signals is not converted', () => {
  assert.equal(toUsageLimitError(new Error('boom'), { rejected: null, rateLimited: false }, NOW), null);
});

test('toSqlUtc writes the SQLite shape and passes null through', () => {
  assert.equal(toSqlUtc(new Date('2026-09-28T00:10:00.000Z')), '2026-09-28 00:10:00');
  assert.equal(toSqlUtc(null), null);
});
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `cd ~/j4dev/portal && node --test test/usage-limit.test.js`
Expected: FAIL with `Cannot find module '.../src/usage-limit.js'`.

- [ ] **Step 3: Write the module**

Create `portal/src/usage-limit.js`:

```js
/* A turn that fails because the Claude subscription's usage limit is reached
   is expected, not a fault: the user should be told and offered a retry, and
   no admin needs an email. This module lives on its own so that queue.js and
   the runner can both import it without importing each other, the same reason
   reply-schema.js exists. */

export class UsageLimitError extends Error {
  constructor(message, { resetsAt = null, exact = false, limitType = 'unknown' } = {}) {
    super(message);
    this.name = 'UsageLimitError';
    this.resetsAt = resetsAt;
    this.exact = exact;
    this.limitType = limitType;
  }
}

// "You've hit your session limit · resets 12:10am (UTC)", as the SDK words it.
// The kind is matched separately from the time so that a message whose time
// cannot be read is still recognised as a usage limit.
const KIND = /hit your (session|weekly) limit/i;
const RESET = /resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)/i;

function zoneOffsetMs(date, zone) {
  const part = {};
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  for (const { type, value } of fmt.formatToParts(date)) part[type] = value;
  const asUtc = Date.UTC(+part.year, +part.month - 1, +part.day, +part.hour, +part.minute, +part.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// The UTC instant at which the wall clock in `zone` reads the given time. The
// second pass corrects the guess when it lands on the other side of a clock
// change from the answer.
function wallClockToUtc(year, monthIndex, day, hour, minute, zone) {
  const guess = Date.UTC(year, monthIndex, day, hour, minute);
  let t = guess - zoneOffsetMs(new Date(guess), zone);
  t = guess - zoneOffsetMs(new Date(t), zone);
  return new Date(t);
}

function nextOccurrence(hour, minute, zone, now) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
  } catch {
    return null; // an unknown zone name
  }
  const part = {};
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  for (const { type, value } of fmt.formatToParts(now)) part[type] = value;
  for (const offset of [0, 1]) {
    const candidate = wallClockToUtc(+part.year, +part.month - 1, +part.day + offset, hour, minute, zone);
    if (candidate > now) return candidate;
  }
  return null;
}

export function parseUsageLimitText(text, now = new Date()) {
  const kind = KIND.exec(String(text || ''));
  if (!kind) return null;
  const limitType = kind[1].toLowerCase();
  const reset = RESET.exec(text);
  if (!reset) return { limitType, resetsAt: null };
  let hour = Number(reset[1]) % 12;
  if (reset[3].toLowerCase() === 'pm') hour += 12;
  const minute = reset[2] ? Number(reset[2]) : 0;
  return { limitType, resetsAt: nextOccurrence(hour, minute, reset[4].trim(), now) };
}

function limitTypeFromEvent(rateLimitType) {
  if (rateLimitType === 'five_hour') return 'session';
  if (String(rateLimitType || '').startsWith('seven_day')) return 'weekly';
  return null;
}

// The SDK types resetsAt only as a number. It has been Unix seconds, but a
// millisecond value would otherwise land thousands of years out.
function eventResetDate(resetsAt) {
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) return null;
  return new Date(resetsAt > 1e12 ? resetsAt : resetsAt * 1000);
}

export function toUsageLimitError(err, { rejected = null, rateLimited = false } = {}, now = new Date()) {
  const message = String(err?.message ?? err ?? '');
  const parsed = parseUsageLimitText(message, now);
  if (!rejected && !rateLimited && !parsed) return null;
  const exactReset = eventResetDate(rejected?.resetsAt);
  return new UsageLimitError(message, {
    resetsAt: exactReset ?? parsed?.resetsAt ?? null,
    exact: Boolean(exactReset),
    limitType: limitTypeFromEvent(rejected?.rateLimitType) ?? parsed?.limitType ?? 'unknown',
  });
}

export function toSqlUtc(date) {
  return date ? date.toISOString().slice(0, 19).replace('T', ' ') : null;
}
```

- [ ] **Step 4: Run the tests to check they pass**

Run: `cd ~/j4dev/portal && node --test test/usage-limit.test.js`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/j4dev && git add portal/src/usage-limit.js portal/test/usage-limit.test.js
git commit -m "Recognise usage-limit failures and work out when the limit resets"
```

---

### Task 2: Detect the limit in the SDK runner

**Files:**
- Modify: `portal/src/runners/claude-sdk.js`
- Test: `portal/test/claude-sdk.test.js`

**Interfaces:**
- Consumes: `toUsageLimitError`, `UsageLimitError` from `../usage-limit.js` (Task 1).
- Produces: `runClaudeSdk` throws `UsageLimitError` for a usage-limit failure and rethrows every other failure unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `portal/test/claude-sdk.test.js`:

```js
const { UsageLimitError } = await import('../src/usage-limit.js');

// A stream that yields some messages and then fails the way the SDK does when
// the account limit is hit: by throwing from the iterator.
const failingQuery = (messages, error) => () => (async function* () {
  for (const m of messages) yield m;
  throw error;
})();
const runFailing = (messages, error) =>
  runClaudeSdk(
    { prompt: 'p', systemPrompt: 's', resumeSessionId: null, cwd: '/tmp', model: 'm' },
    { queryImpl: failingQuery(messages, error) },
  );

test('a rejected rate_limit_event before the failure gives an exact UsageLimitError', async () => {
  const event = {
    type: 'rate_limit_event', session_id: 'sess-1', uuid: 'u1',
    rate_limit_info: { status: 'rejected', resetsAt: 1790554200, rateLimitType: 'five_hour' },
  };
  await assert.rejects(
    runFailing([init, event], new Error("Claude Code returned an error result: You've hit your session limit · resets 12:10am (UTC)")),
    err => err instanceof UsageLimitError && err.exact === true && err.limitType === 'session'
      && err.resetsAt.getTime() === 1790554200 * 1000,
  );
});

test('an allowed rate_limit_event does not by itself make a failure a usage limit', async () => {
  const event = {
    type: 'rate_limit_event', session_id: 'sess-1', uuid: 'u1',
    rate_limit_info: { status: 'allowed_warning', resetsAt: 1790554200, rateLimitType: 'five_hour' },
  };
  await assert.rejects(
    runFailing([init, event], new Error('boom')),
    err => !(err instanceof UsageLimitError) && err.message === 'boom',
  );
});

test('the limit text alone gives an estimated UsageLimitError', async () => {
  await assert.rejects(
    runFailing([init], new Error("Claude Code returned an error result: You've hit your weekly limit · resets 7am (UTC)")),
    err => err instanceof UsageLimitError && err.exact === false && err.limitType === 'weekly'
      && err.resetsAt instanceof Date,
  );
});

test('an assistant rate_limit error then a failed result is a usage limit', async () => {
  await assert.rejects(
    run([init, assistantText('API Error', { error: 'rate_limit' }), { type: 'result', subtype: 'error_during_execution' }]),
    err => err instanceof UsageLimitError && err.resetsAt === null,
  );
});

test('an unrelated failure is rethrown unchanged', async () => {
  const original = new Error('socket hang up');
  await assert.rejects(runFailing([init], original), err => err === original);
});
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `cd ~/j4dev/portal && node --test test/claude-sdk.test.js`
Expected: the four usage-limit tests FAIL (the errors are plain `Error`), and "unrelated failure" passes.

- [ ] **Step 3: Implement**

In `portal/src/runners/claude-sdk.js`, add the import under the existing one:

```js
import { toUsageLimitError } from '../usage-limit.js';
```

Replace the whole `for await (const msg of q) { ... }` loop with the version below. The body inside stays the same apart from the two new signal checks at the top.

```js
  // The account's usage limit announces itself before the turn fails: a
  // rejected rate_limit_event carries the exact reset time, and the assistant
  // message that could not be produced is marked error: 'rate_limit'. Both are
  // kept so the failure can be reported as a usage limit rather than a fault.
  let rejected = null;
  let rateLimited = false;
  try {
    for await (const msg of q) {
      if (msg.type === 'rate_limit_event' && msg.rate_limit_info?.status === 'rejected') rejected = msg.rate_limit_info;
      if (msg.type === 'assistant' && msg.error === 'rate_limit') rateLimited = true;
      if (msg.type === 'system' && msg.subtype === 'init') sessionId = msg.session_id;
      // Every text block the agent addressed to the user, in order. The
      // structured field below is the answer; this satisfies the shared runner
      // contract and gives a failing turn something to show. Reading msg.result
      // instead loses everything said before a tool call, because result is only
      // the final assistant message. A subagent's text is working-out rather than
      // an answer, so it stays out.
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
  } catch (err) {
    throw toUsageLimitError(err, { rejected, rateLimited }) ?? err;
  }
```

- [ ] **Step 4: Run the tests to check they pass**

Run: `cd ~/j4dev/portal && node --test test/claude-sdk.test.js`
Expected: PASS, including every test that was already in the file.

- [ ] **Step 5: Commit**

```bash
cd ~/j4dev && git add portal/src/runners/claude-sdk.js portal/test/claude-sdk.test.js
git commit -m "Report a usage-limit failure from the SDK runner as UsageLimitError"
```

---

### Task 3: Record the limit on the job and skip recovery and the admin email

**Files:**
- Modify: `portal/src/db.js` (schema comment near line 17, migrations after the `archived` migration)
- Modify: `portal/src/queue.js` (inner catch near line 60, outer catch near line 130)
- Create: `portal/test/usage-limit-migration.test.js`
- Test: `portal/test/queue.test.js`

**Interfaces:**
- Consumes: `UsageLimitError`, `toSqlUtc` from `./usage-limit.js`.
- Produces: `jobs.failure_kind`, `jobs.resets_at`, `jobs.resets_at_exact`, `jobs.limit_type`; session status `usage_limited`.

- [ ] **Step 1: Write the failing migration test**

Create `portal/test/usage-limit-migration.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// A real file, so a jobs table in its old shape exists before getDb() runs.
const dbPath = join(mkdtempSync(join(tmpdir(), 'limitmig-')), 'portal.db');
process.env.DB_PATH = dbPath;
const seed = new Database(dbPath);
seed.exec(`
  create table jobs (
    id text primary key,
    session_id text not null,
    prompt text not null,
    status text not null default 'queued',
    error text,
    created_at text not null default (datetime('now'))
  );
  insert into jobs (id, session_id, prompt, status, error) values ('j1', 's1', 'p', 'failed', 'boom');
`);
seed.close();

const { getDb } = await import('../src/db.js');

test('usage-limit columns are added to an existing jobs table, leaving rows intact', () => {
  const cols = getDb().prepare('pragma table_info(jobs)').all().map(c => c.name);
  for (const c of ['failure_kind', 'resets_at', 'resets_at_exact', 'limit_type']) assert.ok(cols.includes(c), c);
  const row = getDb().prepare("select * from jobs where id = 'j1'").get();
  assert.equal(row.error, 'boom');
  assert.equal(row.failure_kind, null);
});
```

- [ ] **Step 2: Write the failing queue tests**

In `portal/test/queue.test.js`, add this import after the existing `queue.js` import:

```js
const { UsageLimitError } = await import('../src/usage-limit.js');
```

Append:

```js
const limitError = () => new UsageLimitError(
  "Claude Code returned an error result: You've hit your session limit · resets 12:10am (UTC)",
  { resetsAt: new Date('2026-09-28T00:10:00Z'), exact: true, limitType: 'session' },
);

test('a usage limit marks the session usage_limited and records the reset on the job', async () => {
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'x' });
  const sent = [];
  await processOneJob({ runTurn: async () => { throw limitError(); }, send: async e => sent.push(e) });
  assert.equal(getDb().prepare('select status from sessions where id = ?').get(sid).status, 'usage_limited');
  const job = getDb().prepare('select * from jobs where session_id = ?').get(sid);
  assert.equal(job.status, 'failed');
  assert.equal(job.failure_kind, 'usage_limit');
  assert.equal(job.resets_at, '2026-09-28 00:10:00');
  assert.equal(job.resets_at_exact, 1);
  assert.equal(job.limit_type, 'session');
  assert.match(job.error, /session limit/);
  assert.equal(sent.length, 0, 'no admin email for an expected limit');
});

test('a usage limit on a resumed turn is not retried in a fresh session', async () => {
  const sid = mkSession();
  getDb().prepare("update sessions set claude_session_id = 'live-id' where id = ?").run(sid);
  enqueue({ sessionId: sid, prompt: 'x' });
  let count = 0;
  await processOneJob({ runTurn: async () => { count++; throw limitError(); }, send: async () => {} });
  assert.equal(count, 1);
  assert.equal(getDb().prepare('select claude_session_id from sessions where id = ?').get(sid).claude_session_id, 'live-id');
});

test('a usage limit with no known reset stores nulls, not a bad date', async () => {
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'x' });
  const err = new UsageLimitError('limit', { resetsAt: null, exact: false, limitType: 'unknown' });
  await processOneJob({ runTurn: async () => { throw err; }, send: async () => {} });
  const job = getDb().prepare('select * from jobs where session_id = ?').get(sid);
  assert.equal(job.resets_at, null);
  assert.equal(job.resets_at_exact, 0);
  assert.equal(job.limit_type, 'unknown');
});

test('several queued turns hitting the limit each get their own notice and no email', async () => {
  const sids = [mkSession(), mkSession(), mkSession()];
  for (const sid of sids) enqueue({ sessionId: sid, prompt: 'x' });
  const sent = [];
  for (let i = 0; i < 3; i++) {
    await processOneJob({ runTurn: async () => { throw limitError(); }, send: async e => sent.push(e) });
  }
  for (const sid of sids) {
    assert.equal(getDb().prepare('select status from sessions where id = ?').get(sid).status, 'usage_limited');
  }
  assert.equal(sent.length, 0);
});

test('an ordinary failure still goes to needs_attention and emails admins', async () => {
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'x' });
  const sent = [];
  await processOneJob({ runTurn: async () => { throw new Error('boom'); }, send: async e => sent.push(e) });
  assert.equal(getDb().prepare('select status from sessions where id = ?').get(sid).status, 'needs_attention');
  assert.equal(getDb().prepare('select failure_kind from jobs where session_id = ?').get(sid).failure_kind, null);
  assert.ok(sent.length >= 1);
});
```

The "ordinary failure" test relies on `adminEmails()` returning at least one address. It does here: with no `admin` flags set, it falls back to every registered user, and `ALLOWED_EMAILS` gives two.

- [ ] **Step 3: Run the tests to check they fail**

Run: `cd ~/j4dev/portal && node --test test/usage-limit-migration.test.js test/queue.test.js`
Expected: the migration test FAILS (columns missing), and the usage-limit queue tests FAIL with `no such column: failure_kind` or a status of `needs_attention`.

- [ ] **Step 4: Add the migration**

In `portal/src/db.js`, change the `sessions.status` comment in `SCHEMA` to:

```js
  status text not null default 'active', -- active | working | awaiting_reply | done | needs_attention | usage_limited
```

After the `archived` migration block (the `if (!cols.some(c => c.name === 'archived'))` block), add:

```js
    // Usage-limit failures are recorded on the job so the notice and the retry
    // both read from the one row that holds the waiting prompt.
    const jobCols = db.prepare('pragma table_info(jobs)').all();
    for (const [name, type] of [
      ['failure_kind', 'text'], ['resets_at', 'text'], ['resets_at_exact', 'integer'], ['limit_type', 'text'],
    ]) {
      if (!jobCols.some(c => c.name === name)) db.exec(`alter table jobs add column ${name} ${type}`);
    }
```

- [ ] **Step 5: Handle the error in the queue**

In `portal/src/queue.js`, add the import:

```js
import { UsageLimitError, toSqlUtc } from './usage-limit.js';
```

In the inner `catch (err)`, replace:

```js
      if (!session.claude_session_id) throw err;
```

with:

```js
      // A usage limit is not a pruned transcript: a fresh session would hit
      // the same limit, so it goes straight to the handler below.
      if (err instanceof UsageLimitError || !session.claude_session_id) throw err;
```

At the top of the outer `catch (err) {`, before the existing `update jobs set status = 'failed'` line, add:

```js
    // An expected condition the user can act on: record when the limit resets
    // so the page can say so and offer a retry, and leave admins alone.
    if (err instanceof UsageLimitError) {
      db.prepare(`update jobs set status = 'failed', error = ?, failure_kind = 'usage_limit',
          resets_at = ?, resets_at_exact = ?, limit_type = ? where id = ?`)
        .run(String(err.message), toSqlUtc(err.resetsAt), err.exact ? 1 : 0, err.limitType, job.id);
      db.prepare("update sessions set status = 'usage_limited', updated_at = datetime('now') where id = ?")
        .run(job.session_id);
      return true;
    }
```

- [ ] **Step 6: Run the tests to check they pass**

Run: `cd ~/j4dev/portal && node --test test/usage-limit-migration.test.js test/queue.test.js test/db.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd ~/j4dev && git add portal/src/db.js portal/src/queue.js portal/test/usage-limit-migration.test.js portal/test/queue.test.js
git commit -m "Record usage-limit failures on the job without recovery or admin email"
```

---

### Task 4: Expose the delay and add the retry route

**Files:**
- Modify: `portal/src/server.js` (session detail near line 159, new route after `/reply` near line 238)
- Test: `portal/test/server.test.js`

**Interfaces:**
- Consumes: the `jobs` columns and the `usage_limited` status from Task 3.
- Produces:
  - `GET /api/sessions/:id` includes `delayed: { jobId: string, resetsAt: string | null, exact: boolean, limitType: string } | null`.
  - `POST /api/sessions/:id/retry` gives 200 `{ ok: true }`, 404 `{ error: 'not found' }` or 409 `{ error: 'nothing to retry' }`.

- [ ] **Step 1: Write the failing tests**

Append to `portal/test/server.test.js`:

```js
// A session whose latest turn failed on the usage limit, as queue.js leaves it.
function mkLimited(email = 'owner@test.com') {
  const db = getDb();
  const sid = `lim-${Math.random().toString(16).slice(2)}`;
  const jid = `job-${sid}`;
  db.prepare("insert into sessions (id, user_email, title, status) values (?, ?, 'Designer at Lush', 'usage_limited')").run(sid, email);
  db.prepare("insert into messages (id, session_id, role, body) values (?, ?, 'user', 'JD text')").run(`m-${sid}`, sid);
  db.prepare(`insert into jobs (id, session_id, prompt, status, error, failure_kind, resets_at, resets_at_exact, limit_type)
    values (?, ?, 'the prompt', 'failed', 'limit', 'usage_limit', '2026-09-28 00:10:00', 1, 'session')`).run(jid, sid);
  return { sid, jid };
}
const post = (path, cookie) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie } });
const detail = async (sid, cookie = ownerCookie) => (await fetch(`${base}/api/sessions/${sid}`, { headers: { cookie } })).json();

test('session detail reports the delay only while usage-limited', async () => {
  const { sid, jid } = mkLimited();
  assert.deepEqual((await detail(sid)).delayed, {
    jobId: jid, resetsAt: '2026-09-28 00:10:00', exact: true, limitType: 'session',
  });
  getDb().prepare("update sessions set status = 'active' where id = ?").run(sid);
  assert.equal((await detail(sid)).delayed, null);
});

test('retry requeues the same job, adds no message and sets working', async () => {
  const { sid, jid } = mkLimited();
  const r = await post(`/api/sessions/${sid}/retry`, ownerCookie);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  const job = getDb().prepare('select * from jobs where id = ?').get(jid);
  assert.equal(job.status, 'queued');
  assert.equal(job.prompt, 'the prompt');
  for (const c of ['error', 'failure_kind', 'resets_at', 'resets_at_exact', 'limit_type']) assert.equal(job[c], null, c);
  assert.equal(getDb().prepare('select status from sessions where id = ?').get(sid).status, 'working');
  assert.equal(getDb().prepare('select count(*) c from messages where session_id = ?').get(sid).c, 1);
  assert.equal(getDb().prepare('select count(*) c from jobs where session_id = ?').get(sid).c, 1);
});

test('a second retry, as from a double click, is refused and changes nothing', async () => {
  const { sid } = mkLimited();
  assert.equal((await post(`/api/sessions/${sid}/retry`, ownerCookie)).status, 200);
  const again = await post(`/api/sessions/${sid}/retry`, ownerCookie);
  assert.equal(again.status, 409);
  assert.equal(getDb().prepare("select count(*) c from jobs where session_id = ? and status = 'queued'").get(sid).c, 1);
});

test('retry after a newer message was sent is refused and leaves the new job alone', async () => {
  const { sid, jid } = mkLimited();
  const reply = await fetch(`${base}/api/sessions/${sid}/reply`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ body: 'any news?' }),
  });
  assert.equal(reply.status, 200);
  const r = await post(`/api/sessions/${sid}/retry`, ownerCookie);
  assert.equal(r.status, 409);
  assert.equal(getDb().prepare('select status from jobs where id = ?').get(jid).status, 'failed');
  assert.equal((await detail(sid)).delayed, null);
});

test('users cannot retry each other\'s sessions', async () => {
  const { sid, jid } = mkLimited('owner@test.com');
  const r = await post(`/api/sessions/${sid}/retry`, operatorCookie);
  assert.equal(r.status, 404);
  assert.equal(getDb().prepare('select status from jobs where id = ?').get(jid).status, 'failed');
});
```

The "newer message" test depends on the reply route setting the session to `working`, which it already does (`server.js`, `/reply` handler). That is what makes `delayed` go to `null` and the retry return 409.

- [ ] **Step 2: Run the tests to check they fail**

Run: `cd ~/j4dev/portal && node --test test/server.test.js`
Expected: the five new tests FAIL (`delayed` is `undefined`, and retry is 404 from the missing route).

- [ ] **Step 3: Implement**

In `portal/src/server.js`, add this helper at module level, above `createApp`:

```js
// The failed turn a usage-limited session is waiting on, or null. Only the
// latest job counts: once the user sends something newer, the notice is stale.
// rowid breaks ties between jobs created in the same second.
function delayedFor(db, session) {
  if (session.status !== 'usage_limited') return null;
  const job = db.prepare('select * from jobs where session_id = ? order by created_at desc, rowid desc limit 1')
    .get(session.id);
  if (!job || job.status !== 'failed' || job.failure_kind !== 'usage_limit') return null;
  return {
    jobId: job.id,
    resetsAt: job.resets_at,
    exact: job.resets_at_exact === 1,
    limitType: job.limit_type || 'unknown',
  };
}
```

In the `GET /api/sessions/:id` handler, change the final line to:

```js
    res.json({ ...withStage(session, tracker), messages: enriched, files, delayed: delayedFor(db, session) });
```

After the `/api/sessions/:id/reply` route, add:

```js
  // Sends the waiting message again. The same job is requeued rather than a new
  // one added, so the user's message is not duplicated in the history.
  app.post('/api/sessions/:id/retry', requireAuth, (req, res) => {
    const db = getDb();
    const session = getOwnSession(db, req.params.id, req.userEmail);
    if (!session) return res.status(404).json({ error: 'not found' });
    const retried = db.transaction(() => {
      const delayed = delayedFor(db, session);
      if (!delayed) return false;
      db.prepare(`update jobs set status = 'queued', error = null, failure_kind = null,
          resets_at = null, resets_at_exact = null, limit_type = null where id = ?`).run(delayed.jobId);
      db.prepare("update sessions set status = 'working', updated_at = datetime('now') where id = ?").run(session.id);
      return true;
    })();
    if (!retried) return res.status(409).json({ error: 'nothing to retry' });
    res.json({ ok: true });
  });
```

- [ ] **Step 4: Run the tests to check they pass**

Run: `cd ~/j4dev/portal && node --test test/server.test.js`
Expected: PASS, including every test that was already in the file.

- [ ] **Step 5: Commit**

```bash
cd ~/j4dev && git add portal/src/server.js portal/test/server.test.js
git commit -m "Show the usage-limit delay on a session and let the user retry it"
```

---

### Task 5: Format the reset time in UK time

**Files:**
- Modify: `portal/public/time.js`
- Test: `portal/test/time.test.js`

**Interfaces:**
- Consumes: the stored `resets_at` shape `YYYY-MM-DD HH:MM:SS` (UTC).
- Produces:
  - `formatResetLondon(stored: string | null, { exact: boolean, limitType: string }, now?: Date) => string`
  - `resetHasPassed(stored: string | null, now?: Date) => boolean`

- [ ] **Step 1: Write the failing tests**

In `portal/test/time.test.js`, change the import line to:

```js
import { formatLondon, formatResetLondon, resetHasPassed } from '../public/time.js';
```

Append:

```js
const exactSession = { exact: true, limitType: 'session' };
// 20:39 BST on Sunday 27 Sep 2026.
const SUN_EVENING = new Date('2026-09-27T19:39:00Z');

test('a reset later the same London day says today, in BST', () => {
  assert.equal(formatResetLondon('2026-09-27 21:10:00', exactSession, SUN_EVENING), '22:10 BST today');
});

test('a reset after London midnight says tomorrow with the weekday', () => {
  assert.equal(formatResetLondon('2026-09-28 00:10:00', exactSession, SUN_EVENING), '01:10 BST tomorrow (Monday)');
});

test('a reset further out gives the weekday and date', () => {
  assert.equal(formatResetLondon('2026-10-01 07:00:00', { exact: true, limitType: 'weekly' }, SUN_EVENING),
    '08:00 BST on Thursday 1 October');
});

test('a winter reset is labelled GMT', () => {
  assert.equal(formatResetLondon('2026-01-15 09:00:00', exactSession, new Date('2026-01-15T06:00:00Z')),
    '09:00 GMT today');
});

test('the label follows the clocks going back', () => {
  const now = new Date('2026-10-24T20:00:00Z');
  assert.equal(formatResetLondon('2026-10-25 00:30:00', exactSession, now), '01:30 BST tomorrow (Sunday)');
  assert.equal(formatResetLondon('2026-10-25 01:30:00', exactSession, now), '01:30 GMT tomorrow (Sunday)');
});

test('an estimated weekly reset gives no day', () => {
  assert.equal(formatResetLondon('2026-09-28 07:00:00', { exact: false, limitType: 'weekly' }, SUN_EVENING),
    '08:00 BST on a day within the next week');
});

test('an estimated session reset keeps its day, which the five-hour window makes safe', () => {
  assert.equal(formatResetLondon('2026-09-28 00:10:00', { exact: false, limitType: 'session' }, SUN_EVENING),
    '01:10 BST tomorrow (Monday)');
});

test('no reset time gives an empty string', () => {
  assert.equal(formatResetLondon(null, exactSession, SUN_EVENING), '');
  assert.equal(formatResetLondon('not a date', exactSession, SUN_EVENING), '');
});

test('resetHasPassed compares the stored UTC time with now', () => {
  assert.equal(resetHasPassed('2026-09-27 19:00:00', SUN_EVENING), true);
  assert.equal(resetHasPassed('2026-09-28 00:10:00', SUN_EVENING), false);
  assert.equal(resetHasPassed(null, SUN_EVENING), false);
});
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `cd ~/j4dev/portal && node --test test/time.test.js`
Expected: FAIL with `formatResetLondon` not exported.

- [ ] **Step 3: Implement**

Append to `portal/public/time.js`:

```js
/* The usage-limit notice gives the reset as a phrase that follows "at about",
   for example "01:10 BST tomorrow (Monday)". Unlike formatLondon it names the
   zone, taken from the zone data, because a person reading "01:10" on the night
   the clocks change cannot otherwise tell which 01:10 is meant. */
const RESET_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  weekday: 'long', day: 'numeric', month: 'long',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  timeZoneName: 'short',
});
const LONDON_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
});

function parseStoredUtc(stored) {
  if (!stored) return null;
  const date = new Date(`${String(stored).replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

// The London calendar day after `key` (YYYY-MM-DD), by calendar arithmetic
// rather than adding 24 hours, which is wrong on the days the clocks change.
function nextDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function formatResetLondon(stored, { exact = false, limitType = 'unknown' } = {}, now = new Date()) {
  const date = parseStoredUtc(stored);
  if (!date) return '';
  const part = {};
  for (const { type, value } of RESET_FMT.formatToParts(date)) part[type] = value;
  const time = `${part.hour}:${part.minute} ${part.timeZoneName}`;
  // A weekly limit read from the error text has an hour but no day.
  if (!exact && limitType === 'weekly') return `${time} on a day within the next week`;
  const day = LONDON_DAY.format(date);
  const today = LONDON_DAY.format(now);
  if (day === today) return `${time} today`;
  if (day === nextDayKey(today)) return `${time} tomorrow (${part.weekday})`;
  return `${time} on ${part.weekday} ${part.day} ${part.month}`;
}

export function resetHasPassed(stored, now = new Date()) {
  const date = parseStoredUtc(stored);
  return Boolean(date) && date <= now;
}
```

- [ ] **Step 4: Run the tests to check they pass**

Run: `cd ~/j4dev/portal && node --test test/time.test.js`
Expected: PASS. If the zone label comes out as `GMT+1` rather than `BST`, the Node build lacks full ICU data. Check with `node -p "process.versions.icu, Intl.DateTimeFormat().resolvedOptions().locale"`. Do not work around it in code without asking: the live host was checked on 2026-09-27 and prints `BST`/`GMT`.

- [ ] **Step 5: Commit**

```bash
cd ~/j4dev && git add portal/public/time.js portal/test/time.test.js
git commit -m "Format the usage-limit reset time in UK time with its zone"
```

---

### Task 6: Show the notice, the button and the label, and record the decision

**Files:**
- Modify: `portal/public/app.js` (imports line 3, list card near line 190, session view near line 264)
- Modify: `portal/public/style.css` (after `.badge-reply`)
- Modify: `CLAUDE.md` (Key decisions list)

**Interfaces:**
- Consumes: `session.delayed` (Task 4), `POST /api/sessions/:id/retry` (Task 4), `formatResetLondon` and `resetHasPassed` (Task 5), and `status === 'usage_limited'` in `/api/sessions` rows (Task 3).
- Produces: UI only.

There is no DOM test harness in this repo (`app.js` is untested by design), so this task is checked by the full suite plus a manual look in a browser.

- [ ] **Step 1: Import the helpers**

In `portal/public/app.js`, change:

```js
import { formatLondon } from './time.js';
```

to:

```js
import { formatLondon, formatResetLondon, resetHasPassed } from './time.js';
```

- [ ] **Step 2: Add the notice builder**

Below the `pill` constant, add:

```js
/* Shown when the account's usage limit stopped Claude answering. Built only
   from fixed strings and the formatted time, never from the error text. */
function delayedNotice(d) {
  let when = '';
  if (resetHasPassed(d.resetsAt)) {
    when = ' The limit should have reset by now, so a retry should work.';
  } else {
    const at = formatResetLondon(d.resetsAt, d);
    if (at) when = ` The limit should reset at about ${esc(at)}.`;
  }
  return `<div class="notice-delayed" role="status">
    <p><strong>Your reply is delayed.</strong> The Claude account behind Jawbs has reached its usage limit, so Jawbs couldn't answer this message yet.${when}</p>
    <button id="retry" class="secondary">Retry message</button></div>`;
}
```

- [ ] **Step 3: Render it in the session view**

In `renderSession`, directly after the line that renders the `working` paragraph:

```js
    ${s.status === 'working' ? '<p class="muted">Jawbs is working on this. You can close the page; it will be here when you come back.</p>' : ''}
```

add:

```js
    ${s.delayed ? delayedNotice(s.delayed) : ''}
```

After the `document.getElementById('doc-btn')?.addEventListener(...)` line, add:

```js
  const retry = document.getElementById('retry');
  if (retry) retry.onclick = async () => {
    if (retry.disabled) return;
    retry.disabled = true;
    // A 409 or a network error re-renders too, so the page shows the real state.
    try { await api(`/sessions/${id}/retry`, { method: 'POST' }); } catch { /* shown by the re-render */ }
    renderSession(id, true);
  };
```

- [ ] **Step 4: Add the list label**

In `renderList`, after the line that renders `badge-reply`, add:

```js
      ${s.status === 'usage_limited' ? `<span class="badge-delayed" aria-label="${esc(s.title)}: reply delayed by the usage limit">Delayed</span>` : ''}
```

- [ ] **Step 5: Style both**

In `portal/public/style.css`, after the `.badge-reply { ... }` rule, add:

```css
/* Quieter than the Reply badge: nothing is being asked of the reader, the
   account is simply out of usage for now. */
.badge-delayed {
  position: absolute;
  top: -6px;
  right: 12px;
  padding: 3px 7px;
  border-radius: 6px;
  background: var(--tint);
  color: var(--ink-soft);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.notice-delayed {
  border-left: 3px solid var(--amber);
  background: var(--card);
  border-radius: 10px;
  padding: 12px 16px;
  margin: 12px 0;
}
.notice-delayed p { margin: 0 0 10px; }
```

- [ ] **Step 6: Record the decision in `CLAUDE.md`**

In `~/j4dev/CLAUDE.md`, add this bullet at the end of the "Key decisions: don't re-litigate" list:

```markdown
- **A usage limit is a notice, not a fault.** When the Claude account's usage limit stops a turn, `runClaudeSdk` throws `UsageLimitError` (`portal/src/usage-limit.js`), taking the reset time from a rejected `rate_limit_event` when one arrived and otherwise estimating it from the error text ("resets 12:10am (UTC)"). `queue.js` records it on the job (`failure_kind`, `resets_at`, `resets_at_exact`, `limit_type`), sets the session to `usage_limited`, skips the fresh-session recovery (it would hit the same limit) and sends no admin email. The page shows the reset in UK time and a Retry button that requeues the same job, so the message is not duplicated. Retry is manual only and always pressable (owner decision, 2026-09-27). Spec: `docs/superpowers/specs/2026-09-27-portal-usage-limit-notice-design.md`.
```

- [ ] **Step 7: Run the full suite**

Run: `cd ~/j4dev/portal && node --test 'test/**/*.test.js'`
Expected: every test passes (264 before this plan, plus the new ones).

- [ ] **Step 8: Look at it in a browser**

Start a throwaway portal on a free port with its own database. Never use 8710.

```bash
cd ~/j4dev/portal && D=$(mktemp -d) && \
  DB_PATH=$D/p.db PORT=59717 BIND_HOST=127.0.0.1 COOKIE_SECRET=x ALLOWED_EMAILS=me@test.com \
  PORTAL_USERS_FILE=/nonexistent PROJECT_DIR=$D AGENT_RUNNER=claude-sdk node src/server.js
```

Then, in a second shell, seed one usage-limited session with `sqlite3 $D/p.db`, using the same inserts as `mkLimited` in Task 4. Log in with a cookie from `makeCookie('me@test.com')`, or use the login link printed by the email fallback. Check:

- the list shows "Delayed", not "Reply";
- the session shows the notice with a BST time, and the Retry button;
- pressing Retry shows the "working" line.

The worker will then try a real turn. Stop the server (Ctrl+C) before it does, or accept that it runs against `$D`. Then delete `$D`.

- [ ] **Step 9: Commit**

```bash
cd ~/j4dev && git add portal/public/app.js portal/public/style.css CLAUDE.md
git commit -m "Show the usage-limit notice and Retry button in the portal"
```
