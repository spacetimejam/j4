import test from 'node:test';
import assert from 'node:assert';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dir = mkdtempSync(join(tmpdir(), 'users-'));
const usersFile = join(dir, 'users.json');
writeFileSync(usersFile, JSON.stringify({
  'Alice@Test.com': { name: 'Alice', projectDir: '/home/x/job-search-alice', admin: true },
  'bob@test.com': { name: 'Bob', projectDir: '/home/x/job-search-bob' },
}));

process.env.DB_PATH = ':memory:';
process.env.PORTAL_USERS_FILE = usersFile;
const { getUser, allowedEmails, adminEmails } = await import('../src/users.js');

test('getUser normalises case and whitespace', () => {
  const u = getUser('  alice@test.COM ');
  assert.deepEqual(u, { name: 'Alice', projectDir: '/home/x/job-search-alice', admin: true });
});

test('getUser returns null for unknown email', () => {
  assert.equal(getUser('evil@test.com'), null);
});

test('allowedEmails lists lowercased registry keys', () => {
  assert.deepEqual(allowedEmails().sort(), ['alice@test.com', 'bob@test.com']);
});

test('adminEmails returns flagged admins', () => {
  assert.deepEqual(adminEmails(), ['alice@test.com']);
});

test('registry edits are picked up without restart', () => {
  writeFileSync(usersFile, JSON.stringify({
    'bob@test.com': { name: 'Bob', projectDir: '/home/x/job-search-bob' },
  }));
  assert.equal(getUser('alice@test.com'), null);
  // no admins flagged: fall back to all users so alerts still go somewhere
  assert.deepEqual(adminEmails(), ['bob@test.com']);
});
