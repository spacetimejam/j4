import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { formatLondon, formatResetLondon, resetHasPassed } from '../public/time.js';

// Stored timestamps are UTC (SQLite datetime('now')). Expectations below are
// the London wall-clock time for that instant, so a pure passthrough fails.
test('shifts by an hour during British Summer Time', () => {
  assert.equal(formatLondon('2026-07-21 13:40:06'), '2026-07-21 14:40:06');
});

test('leaves winter timestamps alone, when London is GMT', () => {
  assert.equal(formatLondon('2026-01-15 09:00:00'), '2026-01-15 09:00:00');
});

test('switches at the spring forward boundary', () => {
  // BST begins 01:00 UTC on 29 Mar 2026.
  assert.equal(formatLondon('2026-03-29 00:30:00'), '2026-03-29 00:30:00');
  assert.equal(formatLondon('2026-03-29 01:30:00'), '2026-03-29 02:30:00');
});

test('switches back at the autumn boundary', () => {
  // BST ends 01:00 UTC on 25 Oct 2026.
  assert.equal(formatLondon('2026-10-25 00:30:00'), '2026-10-25 01:30:00');
  assert.equal(formatLondon('2026-10-25 01:30:00'), '2026-10-25 01:30:00');
});

test('rolls the date over and renders midnight as 00, not 24', () => {
  assert.equal(formatLondon('2026-07-21 23:30:00'), '2026-07-22 00:30:00');
});

test('passes through anything it cannot parse, and blanks empty input', () => {
  assert.equal(formatLondon('not a date'), 'not a date');
  assert.equal(formatLondon(''), '');
  assert.equal(formatLondon(null), '');
  assert.equal(formatLondon(undefined), '');
});

// The whole point is London regardless of where the viewer is, so the result
// must not drift with the host/browser timezone.
test('ignores the ambient timezone', () => {
  const script = "import('./public/time.js').then(m => console.log(m.formatLondon('2026-07-21 13:40:06')))";
  for (const TZ of ['America/New_York', 'Asia/Tokyo', 'UTC', 'Europe/London']) {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TZ },
      encoding: 'utf8',
    }).trim();
    assert.equal(out, '2026-07-21 14:40:06', `wrong under TZ=${TZ}`);
  }
});

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
  assert.equal(resetHasPassed('2026-09-27 19:00:00', exactSession, SUN_EVENING), true);
  assert.equal(resetHasPassed('2026-09-28 00:10:00', exactSession, SUN_EVENING), false);
  assert.equal(resetHasPassed(null, exactSession, SUN_EVENING), false);
});

test('an estimated weekly reset is never taken to have passed, because its day is unknown', () => {
  assert.equal(resetHasPassed('2026-09-27 07:00:00', { exact: false, limitType: 'weekly' }, SUN_EVENING), false);
  assert.equal(resetHasPassed('2026-09-27 07:00:00', { exact: true, limitType: 'weekly' }, SUN_EVENING), true);
  assert.equal(resetHasPassed('2026-09-27 19:00:00', { exact: false, limitType: 'session' }, SUN_EVENING), true);
});
