import test from 'node:test';
import assert from 'node:assert';
import { dirname, delimiter } from 'node:path';
import { checkConfig, PLACEHOLDER_SECRET, onPath } from '../src/preflight.js';

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
    emailFrom: 'Job Search Portal <portal@example.com>',
    brevoApiKey: '',
    webhookUrl: '',
    usersFile: '/portal/data/users.json',
    allowedEmails: [],
    projectDir: '/home/u/job-search',
    agentRunner: 'claude-sdk',
    agentModel: 'claude-opus-5',
    agentModelExplicit: false,
    // The codex runner has to be confirmed as ChatGPT-only, so the valid
    // baseline for it says so; the subscriptions tests below break this.
    subscriptions: overrides.agentRunner === 'codex' ? 'chatgpt-only' : 'both',
    ...overrides,
  };
}

const alwaysExists = () => true;
const CODEX = '/opt/test/codex';
const signedIn = () => true;
const signedOut = () => false;
// Every call goes through these so no test runs the real codex binary.
const ok = { exists: alwaysExists, codexBin: CODEX, codexSignedIn: signedIn };
const errors = issues => issues.filter(i => i.level === 'error');
const warns = issues => issues.filter(i => i.level === 'warn');

test('a valid config produces no issues', () => {
  assert.deepEqual(checkConfig(valid(), { ...ok }), []);
});

test('placeholder or short COOKIE_SECRET is an error', () => {
  for (const secret of ['', PLACEHOLDER_SECRET, 'dev-secret', 'short']) {
    const issues = checkConfig(valid({ cookieSecret: secret }), { ...ok });
    assert.equal(errors(issues).length, 1, `expected an error for ${JSON.stringify(secret)}`);
    assert.match(errors(issues)[0].message, /COOKIE_SECRET/);
  }
});

test('32-character secret passes when private and fails when public', () => {
  const asPrivate = checkConfig(
    valid({ cookieSecret: OK_PRIVATE_SECRET, exposure: 'private' }), { ...ok });
  assert.deepEqual(errors(asPrivate), []);

  const asPublic = checkConfig(
    valid({ cookieSecret: OK_PRIVATE_SECRET, exposure: 'public' }), { ...ok });
  assert.equal(errors(asPublic).length, 1);
  assert.match(errors(asPublic)[0].message, /64/);
});

test('64-character secret passes under both exposures', () => {
  for (const exposure of ['private', 'public']) {
    const issues = checkConfig(valid({ exposure }), { ...ok });
    assert.deepEqual(errors(issues), [], `expected no errors for ${exposure}`);
  }
});

test('unset EXPOSURE warns and is treated as private', () => {
  const issues = checkConfig(
    valid({ exposure: '', cookieSecret: OK_PRIVATE_SECRET }), { ...ok });
  assert.deepEqual(errors(issues), []);
  assert.equal(warns(issues).filter(w => /EXPOSURE/.test(w.message)).length, 1);
});

test('unrecognised EXPOSURE is an error', () => {
  const issues = checkConfig(valid({ exposure: 'funnel' }), { ...ok });
  assert.match(errors(issues)[0].message, /EXPOSURE/);
});

test('unrecognised EXPOSURE also applies the stricter public secret bar', () => {
  // "funnel" is the Tailscale subcommand name, so it is the typo a user is
  // most likely to type where "public" belongs. A typo must never silently
  // lower the security bar: a 32-63 character secret clears the private
  // floor but not the public one, so this must fail both checks.
  //
  // Asserted by position rather than a per-message filter: the COOKIE_SECRET
  // message itself names "EXPOSURE=public" as the reason for the stricter
  // bar, so a naive /EXPOSURE/ filter over both messages double-counts.
  // checkConfig runs the exposure check before the secret check, so the
  // order below is deterministic.
  const issues = checkConfig(
    valid({ exposure: 'funnel', cookieSecret: OK_PRIVATE_SECRET }), { ...ok });
  const issueErrors = errors(issues);
  assert.equal(issueErrors.length, 2);
  assert.match(issueErrors[0].message, /EXPOSURE/);
  assert.match(issueErrors[1].message, /COOKIE_SECRET/);
});

test('EXPOSURE is matched case-insensitively', () => {
  for (const exposure of ['PUBLIC', 'Public', 'PRIVATE', 'Private']) {
    const issues = checkConfig(valid({ exposure }), { ...ok });
    assert.deepEqual(errors(issues), [], `expected no errors for ${exposure}`);
  }
});

test('EXPOSURE tolerates surrounding whitespace', () => {
  const issues = checkConfig(valid({ exposure: '  private  ' }), { ...ok });
  assert.deepEqual(errors(issues), []);
});

test('uppercase PUBLIC still applies the stricter public secret bar', () => {
  const issues = checkConfig(
    valid({ exposure: 'PUBLIC', cookieSecret: OK_PRIVATE_SECRET }), { ...ok });
  assert.equal(errors(issues).length, 1);
  assert.match(errors(issues)[0].message, /EXPOSURE=public requires at least 64/);
});

test('http BASE_URL on a non-local host is an error naming the Secure cookie', () => {
  const issues = checkConfig(
    valid({ baseUrl: 'http://192.168.1.10:8710' }), { ...ok });
  assert.equal(errors(issues).length, 1);
  assert.match(errors(issues)[0].message, /Secure/);
});

test('http BASE_URL on localhost is allowed', () => {
  for (const baseUrl of ['http://localhost:8710', 'http://127.0.0.1:8710']) {
    const issues = checkConfig(valid({ baseUrl }), { ...ok });
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
    const issues = checkConfig(valid(override), { ...ok });
    assert.equal(errors(issues).length, 1, `expected an error for ${override.emailProvider}`);
  }
});

test('the log provider needs no credential', () => {
  const issues = checkConfig(
    valid({ emailProvider: 'log', smtpUrl: '' }), { ...ok });
  assert.deepEqual(errors(issues), []);
});

test('a blank EMAIL_FROM is an error for smtp and brevo, but not webhook or log', () => {
  const cases = [
    { emailProvider: 'smtp', smtpUrl: 'smtps://u%40e.com:pw@smtp.e.com:465', needsFrom: true },
    { emailProvider: 'brevo', brevoApiKey: 'key', needsFrom: true },
    { emailProvider: 'webhook', webhookUrl: 'http://h/x', needsFrom: false },
    { emailProvider: 'log', needsFrom: false },
  ];
  for (const { needsFrom, ...override } of cases) {
    const issues = checkConfig(valid({ ...override, emailFrom: '' }), { ...ok });
    if (needsFrom) {
      assert.equal(errors(issues).filter(e => /EMAIL_FROM/.test(e.message)).length, 1,
        `expected an EMAIL_FROM error for ${override.emailProvider}`);
    } else {
      assert.equal(errors(issues).filter(e => /EMAIL_FROM/.test(e.message)).length, 0,
        `expected no EMAIL_FROM error for ${override.emailProvider}`);
    }
  }
});

test('an unknown provider is an error', () => {
  const issues = checkConfig(valid({ emailProvider: 'carrier-pigeon' }), { ...ok });
  assert.match(errors(issues)[0].message, /carrier-pigeon/);
});

test('unset EMAIL_PROVIDER warns about the silent webhook default', () => {
  const issues = checkConfig(
    valid({ emailProviderExplicit: false, emailProvider: 'webhook', webhookUrl: 'http://h/x' }),
    { ...ok });
  assert.deepEqual(errors(issues), []);
  assert.equal(warns(issues).filter(w => /EMAIL_PROVIDER/.test(w.message)).length, 1);
});

test('no users file and no allowlist is an error', () => {
  const issues = checkConfig(valid(), { exists: () => false, codexBin: CODEX, codexSignedIn: signedIn });
  assert.equal(errors(issues).filter(e => /users/i.test(e.message)).length, 1);
});

test('a missing projectDir is an error only in legacy allowlist mode', () => {
  // Registry mode: projectDir comes per-user from users.json, and config's
  // default ($HOME/job-search) usually does not exist. Must not error.
  const registry = checkConfig(valid(), { exists: p => p !== '/home/u/job-search', codexBin: CODEX, codexSignedIn: signedIn });
  assert.deepEqual(errors(registry), []);

  const legacy = checkConfig(
    valid({ allowedEmails: ['a@b.com'] }), { exists: p => p !== '/home/u/job-search', codexBin: CODEX, codexSignedIn: signedIn });
  assert.equal(errors(legacy).filter(e => /PROJECT_DIR/.test(e.message)).length, 1);
});

test('a non-loopback BIND_HOST warns but does not error', () => {
  const issues = checkConfig(valid({ bindHost: '0.0.0.0' }), { ...ok });
  assert.deepEqual(errors(issues), []);
  assert.equal(warns(issues).filter(w => /BIND_HOST/.test(w.message)).length, 1);
});

test('config exposes bindHost, exposure and emailProviderExplicit', async () => {
  const { config } = await import('../src/config.js');
  assert.equal(typeof config.bindHost, 'string');
  assert.equal(typeof config.exposure, 'string');
  assert.equal(typeof config.emailProviderExplicit, 'boolean');
  // The default must stay 0.0.0.0 so the Caddy-in-Docker install keeps working.
  assert.equal(config.bindHost, '0.0.0.0');
});

test('config exposes agentModelExplicit', async () => {
  const { config } = await import('../src/config.js');
  assert.equal(typeof config.agentModelExplicit, 'boolean');
});

const binPresent = () => true;
const binAbsent = () => false;

test('an unknown AGENT_RUNNER is an error naming the valid values', () => {
  const issues = checkConfig(valid({ agentRunner: 'gemini' }), { ...ok });
  assert.equal(errors(issues).length, 1);
  assert.match(errors(issues)[0].message, /AGENT_RUNNER/);
  assert.match(errors(issues)[0].message, /claude-sdk, cli, codex/);
});

test('an empty AGENT_RUNNER is an error', () => {
  const issues = checkConfig(valid({ agentRunner: '' }), { ...ok });
  assert.equal(errors(issues).length, 1);
  assert.match(errors(issues)[0].message, /AGENT_RUNNER/);
});

test('each valid AGENT_RUNNER passes', () => {
  for (const agentRunner of ['claude-sdk', 'cli', 'codex']) {
    const issues = checkConfig(
      valid({ agentRunner }), { ...ok, lookupBin: binPresent });
    assert.deepEqual(errors(issues), [], `expected no errors for ${agentRunner}`);
  }
});

test('AGENT_RUNNER=codex with no codex on PATH is an error', () => {
  const issues = checkConfig(
    valid({ agentRunner: 'codex' }), { ...ok, lookupBin: binAbsent });
  assert.equal(errors(issues).length, 1);
  assert.match(errors(issues)[0].message, /codex/);
  assert.match(errors(issues)[0].message, /PATH/);
});

test('the PATH check applies only to the codex runner', () => {
  for (const agentRunner of ['claude-sdk', 'cli']) {
    const issues = checkConfig(
      valid({ agentRunner }), { ...ok, lookupBin: binAbsent });
    assert.deepEqual(errors(issues), [], `expected no errors for ${agentRunner}`);
  }
});

test('AGENT_RUNNER=codex with an explicit Claude AGENT_MODEL is an error', () => {
  const issues = checkConfig(
    valid({ agentRunner: 'codex', agentModel: 'claude-opus-5', agentModelExplicit: true }),
    { ...ok, lookupBin: binPresent });
  assert.equal(errors(issues).length, 1);
  assert.match(errors(issues)[0].message, /AGENT_MODEL/);
  // The short names Claude Code accepts are Claude models too.
  const alias = checkConfig(
    valid({ agentRunner: 'codex', agentModel: 'opus', agentModelExplicit: true }),
    { ...ok, lookupBin: binPresent });
  assert.equal(errors(alias).length, 1);
});

test('AGENT_RUNNER=codex with an unset AGENT_MODEL is fine, even though the default is a Claude id', () => {
  const issues = checkConfig(
    valid({ agentRunner: 'codex', agentModel: 'claude-opus-5', agentModelExplicit: false }),
    { ...ok, lookupBin: binPresent });
  assert.deepEqual(errors(issues), []);
});

test('AGENT_RUNNER=codex with an explicit codex model is fine', () => {
  const issues = checkConfig(
    valid({ agentRunner: 'codex', agentModel: 'gpt-5-codex', agentModelExplicit: true }),
    { ...ok, lookupBin: binPresent });
  assert.deepEqual(errors(issues), []);
});

test('AGENT_RUNNER=codex always warns that calibration has not been run, even when otherwise valid', () => {
  const issues = checkConfig(
    valid({ agentRunner: 'codex', agentModel: 'gpt-5-codex', agentModelExplicit: true }),
    { ...ok, lookupBin: binPresent });
  assert.deepEqual(errors(issues), []);
  const calibrationWarnings = warns(issues).filter(w => /calibrate/.test(w.message));
  assert.equal(calibrationWarnings.length, 1);
  assert.match(calibrationWarnings[0].message, /has not been verified against a live binary/);
});

test('other runners do not get the codex calibration warning', () => {
  for (const agentRunner of ['claude-sdk', 'cli']) {
    const issues = checkConfig(valid({ agentRunner }), { ...ok, lookupBin: binPresent });
    assert.equal(warns(issues).filter(w => /calibrate/.test(w.message)).length, 0);
  }
});

test('onPath (the real default lookup, not an injected fake) finds a real binary and rejects a made-up one', () => {
  // Prove the default itself works, not just every test's injected
  // replacement for it. node is a safe stand-in for a real binary: its own
  // directory is guaranteed to exist, even if it is not already on PATH in
  // whatever environment runs this test.
  const nodeDir = dirname(process.execPath);
  const originalPath = process.env.PATH;
  process.env.PATH = `${nodeDir}${delimiter}${originalPath || ''}`;
  try {
    assert.equal(onPath('node'), true);
    assert.equal(onPath('definitely-not-a-real-binary-9f3c2a'), false);
  } finally {
    process.env.PATH = originalPath;
  }
});

// --- Subscriptions ---------------------------------------------------------

const onlyCodexMissing = p => p !== CODEX;

test('beep: both, claude-sdk, Codex installed and signed in, adds nothing', () => {
  assert.deepEqual(checkConfig(valid(), ok), []);
});

test('an unknown SUBSCRIPTIONS value is an error naming the valid values', () => {
  const issues = checkConfig(valid({ subscriptions: 'openai' }), ok);
  assert.equal(errors(issues).length, 1);
  assert.match(errors(issues)[0].message, /both, claude-only, chatgpt-only/);
});

test('both with the Claude runner and no Codex installed refuses to start and names both ways out', () => {
  const issues = checkConfig(valid(), { ...ok, exists: onlyCodexMissing });
  assert.equal(errors(issues).length, 1);
  assert.match(errors(issues)[0].message, new RegExp(CODEX));
  assert.match(errors(issues)[0].message, /codex login/);
  assert.match(errors(issues)[0].message, /SUBSCRIPTIONS=claude-only/);
});

test('both with Codex installed but signed out only warns', () => {
  const issues = checkConfig(valid(), { ...ok, codexSignedIn: signedOut });
  assert.deepEqual(errors(issues), []);
  const w = warns(issues).filter(i => /codex login/.test(i.message));
  assert.equal(w.length, 1);
});

test('the sign-in probe is given the configured Codex path', () => {
  let asked;
  checkConfig(valid(), { ...ok, codexSignedIn: bin => { asked = bin; return true; } });
  assert.equal(asked, CODEX);
});

test('claude-only needs no Codex at all', () => {
  let probed = false;
  const issues = checkConfig(valid({ subscriptions: 'claude-only' }),
    { ...ok, exists: onlyCodexMissing, codexSignedIn: () => { probed = true; return false; } });
  assert.deepEqual(issues, []);
  assert.equal(probed, false);
});

test('claude-only with the codex runner contradicts itself', () => {
  const issues = checkConfig(valid({ agentRunner: 'codex', subscriptions: 'claude-only' }),
    { ...ok, lookupBin: binPresent });
  assert.equal(errors(issues).length, 1);
  assert.match(errors(issues)[0].message, /claude-only/);
  assert.match(errors(issues)[0].message, /AGENT_RUNNER/);
});

test('the codex runner must be confirmed with chatgpt-only', () => {
  const issues = checkConfig(valid({ agentRunner: 'codex', subscriptions: 'both' }),
    { ...ok, lookupBin: binPresent });
  assert.equal(errors(issues).length, 1);
  assert.match(errors(issues)[0].message, /SUBSCRIPTIONS=chatgpt-only/);
});

test('chatgpt-only needs the codex runner', () => {
  for (const agentRunner of ['claude-sdk', 'cli']) {
    const issues = checkConfig(valid({ agentRunner, subscriptions: 'chatgpt-only' }), ok);
    assert.equal(errors(issues).length, 1, agentRunner);
    assert.match(errors(issues)[0].message, /AGENT_RUNNER=codex/);
  }
});

test('the cli runner under both is not checked for Codex', () => {
  const issues = checkConfig(valid({ agentRunner: 'cli' }),
    { ...ok, exists: onlyCodexMissing, codexSignedIn: signedOut });
  assert.deepEqual(errors(issues), []);
  assert.equal(warns(issues).filter(i => /codex|Codex/.test(i.message)).length, 0);
});

test('codexLoggedIn is false for a binary that does not exist', async () => {
  const { codexLoggedIn } = await import('../src/preflight.js');
  assert.equal(codexLoggedIn('/nonexistent/codex'), false);
});

async function configSubscriptions(value) {
  const { execFileSync } = await import('node:child_process');
  return String(execFileSync(process.execPath, ['--input-type=module', '-e',
    "import('./src/config.js').then(m => process.stdout.write(m.config.subscriptions))"],
    { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, SUBSCRIPTIONS: value } }));
}

test('SUBSCRIPTIONS defaults to both', async () => {
  assert.equal(await configSubscriptions(''), 'both');
});

test('SUBSCRIPTIONS is trimmed and lowercased', async () => {
  assert.equal(await configSubscriptions(' Claude-Only '), 'claude-only');
});

// --- EXPOSURE=local -------------------------------------------------------
function localCfg(overrides = {}) {
  return valid({
    exposure: 'local', bindHost: '127.0.0.1', baseUrl: 'http://localhost:8710', port: 8710,
    cookieSecret: '', emailProvider: 'log', emailProviderExplicit: true, subscriptions: 'claude-only',
    ...overrides,
  });
}
const oneUser = () => 1;

test('a valid local config produces no issues and needs no cookie secret', () => {
  assert.deepEqual(checkConfig(localCfg(), { ...ok, countUsers: oneUser }), []);
});

test('local refuses a non-loopback bind', () => {
  const e = errors(checkConfig(localCfg({ bindHost: '0.0.0.0' }), { ...ok, countUsers: oneUser }));
  assert.equal(e.length, 1);
  assert.match(e[0].message, /EXPOSURE=local.*BIND_HOST/);
});

test('local refuses zero or several users', () => {
  for (const n of [0, 2]) {
    const e = errors(checkConfig(localCfg(), { ...ok, countUsers: () => n }));
    assert.ok(e.some(i => /exactly one/.test(i.message)), `expected a one-user error for ${n}`);
  }
});

test('local refuses a BASE_URL that is not localhost on PORT', () => {
  for (const baseUrl of ['https://box.example.com', 'http://localhost:9999', 'http://192.168.1.4:8710']) {
    const e = errors(checkConfig(localCfg({ baseUrl }), { ...ok, countUsers: oneUser }));
    assert.ok(e.some(i => /BASE_URL/.test(i.message)), `expected a BASE_URL error for ${baseUrl}`);
  }
  assert.deepEqual(errors(checkConfig(localCfg({ baseUrl: 'http://127.0.0.1:8710' }), { ...ok, countUsers: oneUser })), []);
});

test('local does not warn about the loopback bind or a missing EXPOSURE', () => {
  assert.deepEqual(warns(checkConfig(localCfg(), { ...ok, countUsers: oneUser })), []);
});

test('EXPOSURE accepts local case-insensitively', () => {
  assert.deepEqual(errors(checkConfig(localCfg({ exposure: 'LOCAL' }), { ...ok, countUsers: oneUser })), []);
});
