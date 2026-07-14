import test from 'node:test';
import assert from 'node:assert';
process.env.DB_PATH = ':memory:';
// Point the user registry at a missing file so a real data/users.json on the
// host cannot shadow the ALLOWED_EMAILS fallback these tests rely on.
process.env.PORTAL_USERS_FILE = '/nonexistent-portal-users.json';
process.env.ALLOWED_EMAILS = 'owner@test.com';
process.env.COOKIE_SECRET = 'testsecret';
const { issueToken, redeemToken, makeCookie, verifyCookie } = await import('../src/auth.js');

test('issueToken rejects non-allowlisted email', () => {
  assert.equal(issueToken('evil@test.com'), null);
});

test('token round-trip is single use', () => {
  const t = issueToken('owner@test.com');
  assert.ok(t);
  assert.equal(redeemToken(t), 'owner@test.com');
  assert.equal(redeemToken(t), null); // second use fails
});

test('cookie round-trip and tamper rejection', () => {
  const c = makeCookie('owner@test.com');
  assert.equal(verifyCookie(c), 'owner@test.com');
  assert.equal(verifyCookie(c.replace(/.$/, c.endsWith('a') ? 'b' : 'a')), null);
  assert.equal(verifyCookie('garbage'), null);
});
