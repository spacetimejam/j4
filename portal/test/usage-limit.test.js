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

test('a session reset read at the stated minute is the one just passed, not a day away', () => {
  // The session window is five hours, so a reset 24 hours out is always wrong.
  const r = parseUsageLimitText(SESSION_TEXT, new Date('2026-09-28T00:10:00Z'));
  assert.equal(r.resetsAt.toISOString(), '2026-09-28T00:10:00.000Z');
});
