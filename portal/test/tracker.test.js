import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseCsv, readTracker, stageFor } from '../src/tracker.js';

test('parseCsv keys rows by header and trims values', () => {
  const rows = parseCsv('Role,Org,Status\n Designer , Acme , Applied \n');
  assert.deepEqual(rows, [{ Role: 'Designer', Org: 'Acme', Status: 'Applied' }]);
});

test('parseCsv handles quoted commas, escaped quotes and CRLF', () => {
  const rows = parseCsv('Role,Org,Notes\r\nDesigner,Acme,"one, two ""quoted"" three"\r\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Notes, 'one, two "quoted" three');
});

test('parseCsv handles a newline inside a quoted field', () => {
  const rows = parseCsv('Role,Notes\nDesigner,"line one\nline two"\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Notes, 'line one\nline two');
});

test('parseCsv skips blank lines and returns [] for empty input', () => {
  assert.deepEqual(parseCsv(''), []);
  assert.equal(parseCsv('Role,Org\nDesigner,Acme\n\n\n').length, 1);
});

test('stageFor matches Role and Org, case-insensitively', () => {
  const rows = [{ Role: 'Content Lead', Org: 'Wellcome Trust', Status: 'Applied' }];
  assert.equal(stageFor('Content Lead at Wellcome Trust', rows), 'applying');
  assert.equal(stageFor('content lead at WELLCOME TRUST', rows), 'applying');
});

test('stageFor matches when either Org is a prefix of the other', () => {
  const rows = [{ Role: 'Social Strategy Director', Org: 'M+C Saatchi UK', Status: 'Interviewing' }];
  assert.equal(stageFor('Social Strategy Director at M+C Saatchi', rows), 'interviewing');
  const short = [{ Role: 'Social Strategy Director', Org: 'M+C Saatchi', Status: 'Interviewing' }];
  assert.equal(stageFor('Social Strategy Director at M+C Saatchi UK', short), 'interviewing');
});

test('stageFor prefers an exact Org match over a prefix one', () => {
  const rows = [
    { Role: 'Designer', Org: 'Acme Group', Status: 'Applied' },
    { Role: 'Designer', Org: 'Acme', Status: 'Hired' },
  ];
  assert.equal(stageFor('Designer at Acme', rows), 'hired');
});

test('stageFor splits on the last " at "', () => {
  const rows = [{ Role: 'Analyst at Home', Org: 'Acme', Status: 'Researching' }];
  assert.equal(stageFor('Analyst at Home at Acme', rows), 'researching');
});

test('stageFor maps every legacy tracker value', () => {
  const cases = {
    Sourced: 'researching', Researching: 'researching',
    Drafting: 'applying', Applied: 'applying', Applying: 'applying',
    Interviewing: 'interviewing', Offer: 'interviewing',
    Hired: 'hired',
    Rejected: 'turned_down', Withdrawn: 'turned_down', 'Turned down': 'turned_down',
  };
  for (const [value, expected] of Object.entries(cases)) {
    const rows = [{ Role: 'Designer', Org: 'Acme', Status: value }];
    assert.equal(stageFor('Designer at Acme', rows), expected, value);
  }
});

test('stageFor returns null for an unknown status, no " at ", or no matching role', () => {
  assert.equal(stageFor('Designer at Acme', [{ Role: 'Designer', Org: 'Acme', Status: 'On hold' }]), null);
  assert.equal(stageFor('Designer at Acme', [{ Role: 'Designer', Org: 'Acme', Status: '' }]), null);
  assert.equal(stageFor('Just a title', [{ Role: 'Designer', Org: 'Acme', Status: 'Applied' }]), null);
  assert.equal(stageFor('Writer at Beta', [{ Role: 'Designer', Org: 'Acme', Status: 'Applied' }]), null);
  assert.equal(stageFor('', []), null);
});

test('readTracker reads the file and returns [] when it is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracker-'));
  assert.deepEqual(readTracker(dir), []);
  assert.deepEqual(readTracker(undefined), []);
  mkdirSync(join(dir, 'tracker'));
  writeFileSync(join(dir, 'tracker', 'applications.csv'), 'Role,Org,Status\nDesigner,Acme,Applied\n');
  assert.equal(readTracker(dir)[0].Org, 'Acme');
});
