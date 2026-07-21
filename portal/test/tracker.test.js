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

test('parseCsv handles a file with no trailing newline', () => {
  const rows = parseCsv('Role,Org,Status\nDesigner,Acme,Applied');
  assert.deepEqual(rows, [{ Role: 'Designer', Org: 'Acme', Status: 'Applied' }]);
});

test('parseCsv handles a quoted field at the end of a line', () => {
  const rows = parseCsv('Role,Org,Notes\nDesigner,Acme,"end of line"\nWriter,Beta,plain\n');
  assert.equal(rows[0].Notes, 'end of line');
  assert.equal(rows[1].Notes, 'plain');
});

test('parseCsv handles a quoted field at end of input, with and without an escaped quote', () => {
  const plain = parseCsv('Role,Org,Notes\nDesigner,Acme,"end of input"');
  assert.equal(plain[0].Notes, 'end of input');
  const escaped = parseCsv('Role,Org,Notes\nDesigner,Acme,"she said ""hi"""');
  assert.equal(escaped[0].Notes, 'she said "hi"');
});

test('parseCsv keeps a quoted empty field distinct from a missing column', () => {
  const quoted = parseCsv('Role,Org,Notes\nDesigner,Acme,""\n');
  assert.equal(quoted[0].Notes, '');
  assert.ok(Object.hasOwn(quoted[0], 'Notes'));
  const missing = parseCsv('Role,Org,Notes\nDesigner,Acme\n');
  assert.equal(missing[0].Notes, '');
  assert.ok(Object.hasOwn(missing[0], 'Notes'));
});

test('parseCsv fills missing trailing columns with empty strings rather than throwing', () => {
  const rows = parseCsv('Role,Org,Status,Notes\nDesigner,Acme\n');
  assert.deepEqual(rows, [{ Role: 'Designer', Org: 'Acme', Status: '', Notes: '' }]);
});

test('stageFor is defensive against a non-array or sparse rows argument', () => {
  // truthy non-arrays matter as much as falsy ones: `rows || []` would let
  // these through to the for..of and throw into the request handler
  for (const bad of [undefined, null, {}, 5, true, 'rows']) {
    assert.equal(stageFor('Designer at Acme', bad), null, String(bad));
  }
  assert.equal(stageFor('Designer at Acme', [null, undefined, {}, { Role: 'Designer', Org: 'Acme', Status: 'Applied' }]), 'applying');
});

test('stageFor treats a Status of "constructor" or "__proto__" as unrecognised', () => {
  assert.equal(stageFor('Designer at Acme', [{ Role: 'Designer', Org: 'Acme', Status: 'constructor' }]), null);
  assert.equal(stageFor('Designer at Acme', [{ Role: 'Designer', Org: 'Acme', Status: '__proto__' }]), null);
});

test('parseCsv and stageFor handle a Role containing a comma, matching the owner\'s real tracker row', () => {
  const csv = 'Role,Org,Status,Date_Applied,Link,CV_Version,Letter_Version,Source,Salary_Range,Deadline,Next_Action,Next_Action_Date,Fit,Folder,Notes\n'
    + '"Senior Account Director, Digital",Madano,Withdrawn,,https://grnh.se/6005b19j7us,,,Portal (Greenhouse),Undisclosed (est ~£60-75k),,None; withdrawn,,Weak,madano-senior-account-director-digital,"Withdrawn 2026-07-20 before applying. Fails fit bar: healthcare-compliance essential Sam lacks, role revolves around digital-marketing channel craft."\n';
  const rows = parseCsv(csv);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    Role: 'Senior Account Director, Digital',
    Org: 'Madano',
    Status: 'Withdrawn',
    Date_Applied: '',
    Link: 'https://grnh.se/6005b19j7us',
    CV_Version: '',
    Letter_Version: '',
    Source: 'Portal (Greenhouse)',
    Salary_Range: 'Undisclosed (est ~£60-75k)',
    Deadline: '',
    Next_Action: 'None; withdrawn',
    Next_Action_Date: '',
    Fit: 'Weak',
    Folder: 'madano-senior-account-director-digital',
    Notes: 'Withdrawn 2026-07-20 before applying. Fails fit bar: healthcare-compliance essential Sam lacks, role revolves around digital-marketing channel craft.',
  });
  assert.equal(stageFor('Senior Account Director, Digital at Madano', rows), 'turned_down');
});

test('readTracker reads the file and returns [] when it is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracker-'));
  assert.deepEqual(readTracker(dir), []);
  assert.deepEqual(readTracker(undefined), []);
  mkdirSync(join(dir, 'tracker'));
  writeFileSync(join(dir, 'tracker', 'applications.csv'), 'Role,Org,Status\nDesigner,Acme,Applied\n');
  assert.equal(readTracker(dir)[0].Org, 'Acme');
});
