import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { formatLondon } from '../public/time.js';

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
