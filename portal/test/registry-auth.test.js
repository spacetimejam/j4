import test from 'node:test';
import assert from 'node:assert';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dir = mkdtempSync(join(tmpdir(), 'regauth-'));
const usersFile = join(dir, 'users.json');
writeFileSync(usersFile, JSON.stringify({
  'alice@test.com': { name: 'Alice', projectDir: dir, admin: true },
}));

process.env.DB_PATH = ':memory:';
process.env.PORTAL_USERS_FILE = usersFile;
process.env.COOKIE_SECRET = 'testsecret';
process.env.EMAIL_PROVIDER = 'webhook';
process.env.WEBHOOK_URL = 'http://example.invalid/hook';
const { issueToken } = await import('../src/auth.js');
const { sendEmail } = await import('../src/email.js');

test('issueToken accepts registry user and rejects strangers', () => {
  assert.ok(issueToken('alice@test.com'));
  assert.equal(issueToken('evil@test.com'), null);
});

test('sendEmail refuses recipients not in the registry', async () => {
  await assert.rejects(
    sendEmail({ to: 'evil@test.com', subject: 's', text: 't' }, { retryDelayMs: 1 }),
    /not on allowlist/
  );
});
