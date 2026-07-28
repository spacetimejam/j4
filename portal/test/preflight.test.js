import test from 'node:test';
import assert from 'node:assert';
import { checkConfig, PLACEHOLDER_SECRET } from '../src/preflight.js';

const GOOD_SECRET = 'a'.repeat(64);
const OK_PRIVATE_SECRET = 'b'.repeat(32);

// A configuration with nothing wrong with it. Each test clones this and
// breaks exactly one thing, so a failure names its own cause.
function valid(overrides = {}) {
  return {
    baseUrl: 'https://box.tail1234.ts.net',
    cookieSecret: GOOD_SECRET,
    exposure: 'private',
    bindHost: '127.0.0.1',
    emailProvider: 'smtp',
    emailProviderExplicit: true,
    smtpUrl: 'smtps://u%40e.com:pw@smtp.e.com:465',
    brevoApiKey: '',
    webhookUrl: '',
    usersFile: '/portal/data/users.json',
    allowedEmails: [],
    projectDir: '/home/u/job-search',
    ...overrides,
  };
}

const alwaysExists = () => true;
const errors = issues => issues.filter(i => i.level === 'error');
const warns = issues => issues.filter(i => i.level === 'warn');

test('a valid config produces no issues', () => {
  assert.deepEqual(checkConfig(valid(), { exists: alwaysExists }), []);
});

test('placeholder or short COOKIE_SECRET is an error', () => {
  for (const secret of ['', PLACEHOLDER_SECRET, 'dev-secret', 'short']) {
    const issues = checkConfig(valid({ cookieSecret: secret }), { exists: alwaysExists });
    assert.equal(errors(issues).length, 1, `expected an error for ${JSON.stringify(secret)}`);
    assert.match(errors(issues)[0].message, /COOKIE_SECRET/);
  }
});

test('32-character secret passes when private and fails when public', () => {
  const asPrivate = checkConfig(
    valid({ cookieSecret: OK_PRIVATE_SECRET, exposure: 'private' }), { exists: alwaysExists });
  assert.deepEqual(errors(asPrivate), []);

  const asPublic = checkConfig(
    valid({ cookieSecret: OK_PRIVATE_SECRET, exposure: 'public' }), { exists: alwaysExists });
  assert.equal(errors(asPublic).length, 1);
  assert.match(errors(asPublic)[0].message, /64/);
});

test('64-character secret passes under both exposures', () => {
  for (const exposure of ['private', 'public']) {
    const issues = checkConfig(valid({ exposure }), { exists: alwaysExists });
    assert.deepEqual(errors(issues), [], `expected no errors for ${exposure}`);
  }
});

test('unset EXPOSURE warns and is treated as private', () => {
  const issues = checkConfig(
    valid({ exposure: '', cookieSecret: OK_PRIVATE_SECRET }), { exists: alwaysExists });
  assert.deepEqual(errors(issues), []);
  assert.equal(warns(issues).filter(w => /EXPOSURE/.test(w.message)).length, 1);
});

test('unrecognised EXPOSURE is an error', () => {
  const issues = checkConfig(valid({ exposure: 'funnel' }), { exists: alwaysExists });
  assert.match(errors(issues)[0].message, /EXPOSURE/);
});

test('http BASE_URL on a non-local host is an error naming the Secure cookie', () => {
  const issues = checkConfig(
    valid({ baseUrl: 'http://192.168.1.10:8710' }), { exists: alwaysExists });
  assert.equal(errors(issues).length, 1);
  assert.match(errors(issues)[0].message, /Secure/);
});

test('http BASE_URL on localhost is allowed', () => {
  for (const baseUrl of ['http://localhost:8710', 'http://127.0.0.1:8710']) {
    const issues = checkConfig(valid({ baseUrl }), { exists: alwaysExists });
    assert.deepEqual(errors(issues), [], `expected ${baseUrl} to be allowed`);
  }
});

test('a provider with no credential is an error', () => {
  const cases = [
    { emailProvider: 'smtp', smtpUrl: '' },
    { emailProvider: 'brevo', brevoApiKey: '' },
    { emailProvider: 'webhook', webhookUrl: '' },
  ];
  for (const override of cases) {
    const issues = checkConfig(valid(override), { exists: alwaysExists });
    assert.equal(errors(issues).length, 1, `expected an error for ${override.emailProvider}`);
  }
});

test('the log provider needs no credential', () => {
  const issues = checkConfig(
    valid({ emailProvider: 'log', smtpUrl: '' }), { exists: alwaysExists });
  assert.deepEqual(errors(issues), []);
});

test('an unknown provider is an error', () => {
  const issues = checkConfig(valid({ emailProvider: 'carrier-pigeon' }), { exists: alwaysExists });
  assert.match(errors(issues)[0].message, /carrier-pigeon/);
});

test('unset EMAIL_PROVIDER warns about the silent webhook default', () => {
  const issues = checkConfig(
    valid({ emailProviderExplicit: false, emailProvider: 'webhook', webhookUrl: 'http://h/x' }),
    { exists: alwaysExists });
  assert.deepEqual(errors(issues), []);
  assert.equal(warns(issues).filter(w => /EMAIL_PROVIDER/.test(w.message)).length, 1);
});

test('no users file and no allowlist is an error', () => {
  const issues = checkConfig(valid(), { exists: () => false });
  assert.equal(errors(issues).filter(e => /users/i.test(e.message)).length, 1);
});

test('a missing projectDir is an error only in legacy allowlist mode', () => {
  // Registry mode: projectDir comes per-user from users.json, and config's
  // default ($HOME/job-search) usually does not exist. Must not error.
  const registry = checkConfig(valid(), { exists: p => p !== '/home/u/job-search' });
  assert.deepEqual(errors(registry), []);

  const legacy = checkConfig(
    valid({ allowedEmails: ['a@b.com'] }), { exists: p => p !== '/home/u/job-search' });
  assert.equal(errors(legacy).filter(e => /PROJECT_DIR/.test(e.message)).length, 1);
});

test('a non-loopback BIND_HOST warns but does not error', () => {
  const issues = checkConfig(valid({ bindHost: '0.0.0.0' }), { exists: alwaysExists });
  assert.deepEqual(errors(issues), []);
  assert.equal(warns(issues).filter(w => /BIND_HOST/.test(w.message)).length, 1);
});
