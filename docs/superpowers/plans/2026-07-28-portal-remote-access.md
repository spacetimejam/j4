# Portal Remote Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the portal reachable from a phone over HTTPS with the agent doing the setup, replacing the undocumented Caddy plus dynamic DNS plus port-forward layer with Tailscale, and make misconfiguration fail loudly at startup instead of silently at login.

**Architecture:** The portal binds loopback and is published by Tailscale, either `tailscale serve` (private to the user's tailnet, the default) or `tailscale funnel` (public, gated on a strong secret). Both terminate TLS on the user's own machine. A new `portal/setup-remote.sh` owns the OS-specific and verifiable steps as idempotent subcommands; a new runbook tells the agent the order and where the human gates are. A new `portal/src/preflight.js` validates configuration at startup and refuses to start on conditions that cannot work.

**Tech Stack:** Node 18+, Express 5, node:test, better-sqlite3, bash 3.2, Tailscale CLI.

**Spec:** `docs/superpowers/specs/2026-07-28-portal-remote-access-design.md`

## Global Constraints

- Setup scripts stay bash 3.2 compatible: no associative arrays, no `readarray`, no `sed -i`, no `${var,,}`, no GNU-only flags.
- Setup must never fail when node is absent.
- Setup tests must never write the real registry: always set `PORTAL_REGISTRY` in tests.
- `SETUP.md` portal task text must keep the literal phrase "If you chose the portal" (tests grep for it).
- Docs in British English; no em dashes or en dashes as sentence punctuation.
- Node floor is `package.json`'s `>=18`. The live host runs Node 18. Do not raise it.
- `EXPOSURE` values are exactly `private` and `public`. Never `serve` or `funnel`.
- Public-exposure `COOKIE_SECRET` floor is 64 characters; private floor is 32.
- Verification for every task: `bash setup/test/run-tests.sh` and `cd portal && npm test`.
- This checkout is pull-only. Commit locally; never push from here.

---

### Task 1: `checkConfig` in a new preflight module

**Files:**
- Create: `portal/src/preflight.js`
- Create: `portal/test/preflight.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `checkConfig(cfg, { exists } = {})` returning `Array<{ level: 'error' | 'warn', message: string }>`. `cfg` is the shape of `config` from `src/config.js`. `exists` defaults to `node:fs.existsSync` and is injected by tests. Also exports the constant `PLACEHOLDER_SECRET`.

This task is a pure function with no wiring, so it is testable in isolation. Task 2 wires it into the server.

- [ ] **Step 1: Write the failing test**

Create `portal/test/preflight.test.js`. Note the house pattern: `config` is a plain mutable object, so tests build their own `cfg` objects rather than manipulating env.

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd portal && node --test test/preflight.test.js`
Expected: FAIL, `Cannot find module '../src/preflight.js'`.

- [ ] **Step 3: Write the implementation**

Create `portal/src/preflight.js`:

```js
import { existsSync } from 'node:fs';

// The value shipped in .env.example. Treated as absent, because a user who
// copied the example and never edited it has no secret at all.
export const PLACEHOLDER_SECRET = 'change-me-64-random-hex';

// config.js falls back to this when COOKIE_SECRET is unset.
const DEV_SECRET = 'dev-secret';

const MIN_SECRET_PRIVATE = 32;
const MIN_SECRET_PUBLIC = 64;

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const LOOPBACK_BINDS = ['127.0.0.1', 'localhost', '::1'];

// Which env var each provider needs. `log` needs nothing by design: it is the
// smoke-test provider, usable before the user has any mail account.
const PROVIDER_CREDENTIALS = {
  smtp: ['smtpUrl', 'SMTP_URL'],
  brevo: ['brevoApiKey', 'BREVO_API_KEY'],
  webhook: ['webhookUrl', 'WEBHOOK_URL'],
  log: null,
};

// Validate configuration before the server binds. Errors are conditions that
// cannot work and so abort startup; warnings are conditions that merely
// deserve saying out loud. `exists` is injected so tests need no filesystem.
export function checkConfig(cfg, { exists = existsSync } = {}) {
  const issues = [];
  const err = message => issues.push({ level: 'error', message });
  const warn = message => issues.push({ level: 'warn', message });

  // --- Exposure ------------------------------------------------------------
  // EXPOSURE describes reachability, not tooling, so a publicly reachable
  // Caddy install is held to the same bar as a Tailscale Funnel one.
  let exposure = cfg.exposure || '';
  if (!exposure) {
    warn('EXPOSURE is not set, so this portal is being treated as private. If it is reachable from the public internet, set EXPOSURE=public in .env so the stronger COOKIE_SECRET rule applies.');
    exposure = 'private';
  } else if (exposure !== 'private' && exposure !== 'public') {
    err(`EXPOSURE is "${exposure}", which is not one of: private, public.`);
    // Assume the stricter reading while we are already failing, so the secret
    // check below cannot be softened by a typo.
    exposure = 'public';
  }

  // --- Cookie secret -------------------------------------------------------
  const secret = cfg.cookieSecret || '';
  const minSecret = exposure === 'public' ? MIN_SECRET_PUBLIC : MIN_SECRET_PRIVATE;
  if (!secret || secret === PLACEHOLDER_SECRET || secret === DEV_SECRET) {
    err('COOKIE_SECRET is unset or still the example value. Generate one with: openssl rand -hex 32');
  } else if (secret.length < minSecret) {
    err(exposure === 'public'
      ? `COOKIE_SECRET is ${secret.length} characters, but EXPOSURE=public requires at least ${MIN_SECRET_PUBLIC}. This portal's login page is reachable from the internet, and the session cookie is the only thing between a stranger and an agent running with bypassPermissions inside your project. Generate a new one with: openssl rand -hex 32 (this logs everyone out), or stop exposing the portal publicly.`
      : `COOKIE_SECRET is ${secret.length} characters, but at least ${MIN_SECRET_PRIVATE} are required. Generate one with: openssl rand -hex 32`);
  }

  // --- Base URL ------------------------------------------------------------
  let url = null;
  try {
    url = new URL(cfg.baseUrl);
  } catch {
    err(`BASE_URL is not a valid URL: ${cfg.baseUrl}`);
  }
  if (url && url.protocol === 'http:' && !LOCAL_HOSTS.includes(url.hostname)) {
    err(`BASE_URL is ${cfg.baseUrl}, which is plain http on a non-local host. Login cannot work in this configuration: the session cookie is set Secure, and browsers discard Secure cookies delivered over http, so the login link will appear to work and then return you to the login screen. Publish the portal over HTTPS (see docs/portal-remote-access.md), or use http://localhost for local testing.`);
  }

  // --- Email ---------------------------------------------------------------
  if (!cfg.emailProviderExplicit) {
    warn('EMAIL_PROVIDER is not set, so the portal is defaulting to "webhook". Set it explicitly in .env: smtp, brevo, webhook, or log.');
  }
  if (!(cfg.emailProvider in PROVIDER_CREDENTIALS)) {
    err(`EMAIL_PROVIDER is "${cfg.emailProvider}", which is not one of: smtp, brevo, webhook, log.`);
  } else {
    const credential = PROVIDER_CREDENTIALS[cfg.emailProvider];
    if (credential && !cfg[credential[0]]) {
      err(`EMAIL_PROVIDER is "${cfg.emailProvider}" but ${credential[1]} is empty, so no email can be sent, including login links.`);
    }
  }

  // --- Users ---------------------------------------------------------------
  const hasAllowlist = (cfg.allowedEmails || []).length > 0;
  if (!exists(cfg.usersFile) && !hasAllowlist) {
    err(`No users are configured: ${cfg.usersFile} does not exist and ALLOWED_EMAILS is empty. Copy users.example.json to data/users.json and edit it, or run the setup wizard.`);
  }
  // projectDir only matters in legacy allowlist mode. In registry mode each
  // user carries their own projectDir, and config's default rarely exists.
  if (hasAllowlist && !exists(cfg.projectDir)) {
    err(`PROJECT_DIR does not exist: ${cfg.projectDir}`);
  }

  // --- Bind ----------------------------------------------------------------
  if (!LOOPBACK_BINDS.includes(cfg.bindHost)) {
    warn(`BIND_HOST is ${cfg.bindHost}, so the portal is reachable from your local network. Tailscale setups should use 127.0.0.1; a reverse proxy on another host needs the wider bind.`);
  }

  return issues;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd portal && node --test test/preflight.test.js`
Expected: PASS, all tests.

- [ ] **Step 5: Run the whole suite for regressions**

Run: `cd portal && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add portal/src/preflight.js portal/test/preflight.test.js
git commit -m "feat(portal): validate configuration before startup

checkConfig returns errors for conditions that cannot work (weak or
placeholder COOKIE_SECRET, http BASE_URL on a non-local host, a provider
with no credential, no users) and warnings for ones worth saying out loud.
Public exposure raises the secret floor to 64 characters.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Wire preflight into startup, add `bindHost` and `exposure` to config

**Files:**
- Modify: `portal/src/config.js`
- Modify: `portal/src/server.js:227-230`
- Modify: `portal/test/preflight.test.js` (append)

**Interfaces:**
- Consumes: `checkConfig` from Task 1.
- Produces: `config.bindHost` (string, default `'0.0.0.0'`), `config.exposure` (string, default `''`), `config.emailProviderExplicit` (boolean).

Note the deliberate `0.0.0.0` default for `bindHost`. Loopback is correct for Tailscale but wrong for the live install, where Caddy runs in Docker and reaches the portal at `172.18.0.1:8710`. A loopback default would 502 it on restart, and preflight cannot distinguish that from a legitimate Tailscale setup. `setup-remote.sh configure` writes `BIND_HOST=127.0.0.1` explicitly instead (Task 6).

- [ ] **Step 1: Write the failing test**

Append to `portal/test/preflight.test.js`:

```js
test('config exposes bindHost, exposure and emailProviderExplicit', async () => {
  const { config } = await import('../src/config.js');
  assert.equal(typeof config.bindHost, 'string');
  assert.equal(typeof config.exposure, 'string');
  assert.equal(typeof config.emailProviderExplicit, 'boolean');
  // The default must stay 0.0.0.0 so the Caddy-in-Docker install keeps working.
  assert.equal(config.bindHost, '0.0.0.0');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd portal && node --test test/preflight.test.js`
Expected: FAIL, `config.bindHost` is `undefined`, so the `typeof` assertion reports `'undefined' !== 'string'`.

- [ ] **Step 3: Add the config fields**

In `portal/src/config.js`, add three entries to the exported object. Put `bindHost` next to `port`, and the rest near their relatives:

```js
  port: Number(process.env.PORT || 8710),
  // Loopback is right for Tailscale but wrong for a reverse proxy on another
  // host (the live install reaches the portal from Caddy in Docker), so the
  // default stays open and setup-remote.sh narrows it for Tailscale setups.
  bindHost: process.env.BIND_HOST || '0.0.0.0',
  // Reachability, not tooling: `public` means the login page is on the
  // internet, whether via Tailscale Funnel or a reverse proxy.
  exposure: process.env.EXPOSURE || '',
```

and, next to `emailProvider`:

```js
  emailProvider: process.env.EMAIL_PROVIDER || 'webhook',
  // Whether the fallback above is in play, which preflight warns about.
  emailProviderExplicit: Boolean(process.env.EMAIL_PROVIDER),
```

- [ ] **Step 4: Wire preflight into the main guard**

In `portal/src/server.js`, add the import next to the others at the top:

```js
import { checkConfig } from './preflight.js';
```

Replace lines 227-230 entirely:

```js
if (import.meta.url === `file://${process.argv[1]}`) {
  const issues = checkConfig(config);
  for (const issue of issues) {
    const prefix = issue.level === 'error' ? 'ERROR' : 'WARNING';
    console[issue.level === 'error' ? 'error' : 'warn'](`${prefix}: ${issue.message}`);
  }
  if (issues.some(issue => issue.level === 'error')) {
    console.error('\nThe portal did not start. Fix the errors above and try again.');
    console.error('Setup guidance: docs/portal.md and docs/portal-remote-access.md');
    process.exit(1);
  }
  createApp().listen(config.port, config.bindHost, () =>
    console.log(`${config.portalTitle} on ${config.bindHost}:${config.port}`));
  startWorker();
}
```

The check sits inside the main guard, not at module scope, so `createApp()` stays importable by `test/server.test.js` without a valid environment.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd portal && npm test`
Expected: PASS. If `server.test.js` fails, the check leaked outside the main guard.

- [ ] **Step 6: Verify the refusal by hand**

Run:
```bash
cd portal && BASE_URL=http://192.168.1.10:8710 COOKIE_SECRET=$(openssl rand -hex 32) \
  EMAIL_PROVIDER=log ALLOWED_EMAILS=a@b.com PROJECT_DIR=/tmp node src/server.js; echo "exit=$?"
```
Expected: an `ERROR:` line mentioning `Secure`, then `exit=1`.

- [ ] **Step 7: Commit**

```bash
git add portal/src/config.js portal/src/server.js portal/test/preflight.test.js
git commit -m "feat(portal): run preflight at startup and make the bind address configurable

Startup now prints warnings and exits non-zero on errors. BIND_HOST defaults
to 0.0.0.0 so the Caddy-in-Docker install keeps working; setup-remote.sh
narrows it to loopback for Tailscale setups.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `EMAIL_PROVIDER=log`

**Files:**
- Modify: `portal/src/email.js:45-54`
- Modify: `portal/test/email.test.js` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `'log'` as a valid `config.emailProvider`, already permitted by Task 1's `PROVIDER_CREDENTIALS`.

This makes the escape hatch `docs/portal.md` already promises actually exist. Today, with no provider configured, `sendViaWebhook` calls `fetch('')`, which throws `TypeError: Failed to parse URL from`, and `server.js:72` logs only the error, never the login link.

- [ ] **Step 1: Write the failing test**

Append to `portal/test/email.test.js`:

```js
test('log provider writes the message to stdout and resolves', async () => {
  config.emailProvider = 'log';
  const written = [];
  const realLog = console.log;
  console.log = (...args) => written.push(args.join(' '));
  try {
    await sendEmail({
      to: 'owner@test.com',
      subject: 'Your login link',
      text: 'Click to log in: https://box.ts.net/auth/abc123',
      attachments: [{ filename: 'prep.md', contentBase64: Buffer.from('x').toString('base64') }],
    });
  } finally {
    console.log = realLog;
  }
  const out = written.join('\n');
  assert.match(out, /owner@test\.com/);
  assert.match(out, /Your login link/);
  assert.match(out, /auth\/abc123/);
  // Attachments are named, not dumped, and .md is normalised first.
  assert.match(out, /prep\.txt/);
  assert.doesNotMatch(out, /contentBase64/);
});

test('log provider still enforces the allowlist', async () => {
  config.emailProvider = 'log';
  await assert.rejects(sendEmail({ to: 'evil@test.com', subject: 'x', text: 'x' }), /allowlist/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd portal && node --test test/email.test.js`
Expected: FAIL with `unknown email provider: log`.

- [ ] **Step 3: Implement the provider**

In `portal/src/email.js`, add the function immediately after `sendViaWebhook`:

```js
// The smoke-test provider: no account, no credentials, no network. Prints the
// message so a first-time user can copy a login link out of the terminal and
// confirm the rest of the portal works before configuring mail. Never a
// default, because a silent no-op would be worse than a loud failure.
async function sendViaLog({ to, subject, text, attachments }) {
  const names = attachments.map(a => a.filename).join(', ') || 'none';
  console.log(
    `\n--- email (EMAIL_PROVIDER=log, not actually sent) ---\n` +
    `to:          ${to}\n` +
    `subject:     ${subject}\n` +
    `attachments: ${names}\n\n` +
    `${text}\n` +
    `--- end email ---\n`);
}
```

Then add it to the registry on the existing `PROVIDERS` line:

```js
const PROVIDERS = { brevo: sendViaBrevo, smtp: sendViaSmtp, webhook: sendViaWebhook, log: sendViaLog };
```

Do not change `config.emailProvider`'s `'webhook'` fallback in `config.js`. Changing the default would alter behaviour for existing installs; Task 1 already warns when the fallback is in play.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd portal && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add portal/src/email.js portal/test/email.test.js
git commit -m "feat(portal): add EMAIL_PROVIDER=log for first-run smoke tests

docs/portal.md already promised that an unconfigured portal writes login
links to the log. It did not: sendViaWebhook called fetch('') and only the
error was logged. This makes the promise true.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `.env.example` accuracy

**Files:**
- Modify: `portal/.env.example`

**Interfaces:**
- Consumes: `BIND_HOST`, `EXPOSURE` (Task 2), `log` provider (Task 3).
- Produces: nothing consumed by later tasks.

`EMAIL_FROM` currently ships `Job Search Portal <portal@example.com>`, which looks filled in while `SMTP_URL` is blank, so a half-edited file leaves a sender Gmail rejects outright.

- [ ] **Step 1: Make the edits**

In `portal/.env.example`:

Replace the `BASE_URL` and `COOKIE_SECRET` block:

```
# Public URL of the portal (used in login links). Must be https unless it is
# localhost: the session cookie is set Secure, and browsers discard Secure
# cookies sent over plain http, which silently breaks login.
BASE_URL=https://portal.example.com
# Secret for signing login cookies; use 64 random hex chars
COOKIE_SECRET=change-me-64-random-hex
# Is the portal reachable from the public internet? private | public
# "public" (Tailscale Funnel, or any reverse proxy on a public domain)
# requires a COOKIE_SECRET of at least 64 characters. setup-remote.sh
# configure sets this for you.
EXPOSURE=private
# Address to bind. setup-remote.sh sets 127.0.0.1 for Tailscale setups; a
# reverse proxy on another host (for example Caddy in Docker) needs 0.0.0.0.
#BIND_HOST=0.0.0.0
```

Replace the provider line and the `EMAIL_FROM` line:

```
# Email provider: smtp | brevo | webhook | log (see docs/portal.md)
# "log" sends nothing and prints messages to the terminal, including login
# links. Useful for a first smoke test before you have a mail account.
EMAIL_PROVIDER=smtp
```

```
# Sender for outbound mail, e.g. "Job Search Portal <portal@example.com>".
# Left blank deliberately: for SMTP this usually must match the authenticated
# account, and a plausible-looking wrong value is rejected by most providers.
EMAIL_FROM=
```

- [ ] **Step 2: Verify a fresh copy fails loudly rather than quietly**

Simulate the values a fresh `cp .env.example .env` would supply, by overriding
them inline. Do not source or copy the example over a real `.env`: this may be
a live install, and the example's unquoted values with spaces (`PORTAL_TITLE=Job
Search Portal`) parse under dotenv but not under shell sourcing or `xargs`.

Run:
```bash
cd portal && COOKIE_SECRET=change-me-64-random-hex EMAIL_PROVIDER=smtp SMTP_URL= \
  BASE_URL=https://portal.example.com node src/server.js; echo "exit=$?"
```
Expected: `ERROR:` lines naming `COOKIE_SECRET` and `SMTP_URL`, then `exit=1`. This exits before `listen`, so it cannot collide with a portal already running on the same port. Previously this configuration started cleanly and failed at login time.

- [ ] **Step 3: Commit**

```bash
git add portal/.env.example
git commit -m "docs(portal): make .env.example honest about what is unfilled

EMAIL_FROM is now blank like SMTP_URL, so a half-edited file cannot leave a
sender address that mail providers reject. Documents EXPOSURE, BIND_HOST and
the log provider.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `setup-remote.sh` skeleton with `check` and `install`

**Files:**
- Create: `portal/setup-remote.sh` (mode 755)
- Create: `setup/test/remote-tests.sh`
- Modify: `setup/test/run-tests.sh` (append a sourcing line)

**Interfaces:**
- Consumes: nothing.
- Produces: the script's subcommand dispatch and these shell helpers, used by Task 6 and Task 7: `env_value <key> <file>`, `set_env_value <key> <value> <file>`, `die <message>`, `PORTAL_DIR`, `ENV_FILE`.

The script uses `set -u` only, not `set -eu`. Under `set -e` a `grep` that matches nothing aborts the script, and several helpers here rely on an empty grep being a normal outcome.

- [ ] **Step 1: Write the failing test**

Create `setup/test/remote-tests.sh`. It is sourced by `run-tests.sh`, so it inherits `check`, `pass`, `fail` and the counters, matching the existing harness style.

```bash
# Tests for portal/setup-remote.sh. Sourced by run-tests.sh, so `check`,
# `pass`, `fail` and the counters are already defined.

REMOTE_SH="$(dirname "$TEST_DIR")/../portal/setup-remote.sh"

# A stub `tailscale` earlier on PATH than any real one. It records every
# invocation to $TS_LOG and answers `status --json` with a canned tailnet so
# hostname derivation can be tested without a network.
make_tailscale_stub() {
  stub_dir="$1"
  mkdir -p "$stub_dir"
  cat > "$stub_dir/tailscale" <<'STUB'
#!/usr/bin/env bash
echo "$@" >> "$TS_LOG"
if [ "$1" = "status" ]; then
  cat <<'JSON'
{"Self":{"DNSName":"box.tail1234.ts.net.","Online":true},"BackendState":"Running"}
JSON
  exit 0
fi
exit 0
STUB
  chmod +x "$stub_dir/tailscale"
}

RWORK2="$(mktemp -d)"
make_tailscale_stub "$RWORK2/bin"
export TS_LOG="$RWORK2/ts.log"
: > "$TS_LOG"

check "setup-remote.sh exists and is executable" test -x "$REMOTE_SH"

check "no subcommand exits non-zero" \
  sh -c "! PATH=$RWORK2/bin:\$PATH '$REMOTE_SH' >/dev/null 2>&1"

check "an unknown subcommand exits non-zero" \
  sh -c "! PATH=$RWORK2/bin:\$PATH '$REMOTE_SH' frobnicate >/dev/null 2>&1"

if PATH="$RWORK2/bin:$PATH" "$REMOTE_SH" check >"$RWORK2/check.out" 2>&1; then
  pass
else
  fail "check should exit 0 when tailscale is present"
fi
check "check reports the tailscale it found" \
  grep -qi "tailscale" "$RWORK2/check.out"

# check must be read-only: it reports, it does not configure.
check "check does not invoke serve or funnel" \
  sh -c "! grep -qE '^(serve|funnel)' '$TS_LOG'"

# install is idempotent when tailscale is already present.
if PATH="$RWORK2/bin:$PATH" "$REMOTE_SH" install >"$RWORK2/install.out" 2>&1; then
  pass
else
  fail "install should exit 0 when tailscale is already installed"
fi
check "install says tailscale is already present" \
  grep -qi "already" "$RWORK2/install.out"

# With no tailscale on PATH, check must still exit 0 and say what is missing.
EMPTY_BIN="$RWORK2/empty"
mkdir -p "$EMPTY_BIN"
if PATH="$EMPTY_BIN:/usr/bin:/bin" "$REMOTE_SH" check >"$RWORK2/check2.out" 2>&1; then
  pass
else
  fail "check should exit 0 even when tailscale is missing"
fi
check "check reports tailscale as missing" \
  grep -qi "not installed" "$RWORK2/check2.out"

rm -rf "$RWORK2"
```

Append to `setup/test/run-tests.sh`, immediately before the final summary that prints `Passed: N  Failed: N`:

```bash
# --- portal/setup-remote.sh -------------------------------------------------

# shellcheck source=remote-tests.sh
. "$TEST_DIR/remote-tests.sh"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bash setup/test/run-tests.sh`
Expected: FAIL lines including "setup-remote.sh exists and is executable", and a non-zero `Failed:` count.

- [ ] **Step 3: Write the script**

Create `portal/setup-remote.sh`:

```bash
#!/usr/bin/env bash
# Publish the job-search portal with Tailscale.
#
# Usage:
#   ./setup-remote.sh check                    report what is installed
#   ./setup-remote.sh install                  install tailscale
#   ./setup-remote.sh configure serve|funnel   publish the portal
#   ./setup-remote.sh service                  install a service unit
#   ./setup-remote.sh verify                   prove it works end to end
#
# Every subcommand is idempotent. Bash 3.2 compatible (macOS ships 3.2).
#
# Deliberately `set -u` and not `set -eu`: several helpers here treat "grep
# matched nothing" as a normal outcome, and -e would abort on it.
set -u

PORTAL_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$PORTAL_DIR/.env"

die() {
  echo "Error: $1" >&2
  exit 1
}

# env_value <key> <file>: print the value of KEY=..., or nothing.
env_value() {
  ev_key="$1"
  ev_file="$2"
  [ -f "$ev_file" ] || return 0
  grep "^${ev_key}=" "$ev_file" 2>/dev/null | tail -1 | cut -d= -f2-
}

# set_env_value <key> <value> <file>: upsert KEY=value. No `sed -i`, which is
# not portable between GNU and BSD.
set_env_value() {
  sv_key="$1"
  sv_value="$2"
  sv_file="$3"
  sv_tmp="$sv_file.tmp.$$"
  : > "$sv_tmp"
  if [ -f "$sv_file" ]; then
    grep -v "^${sv_key}=" "$sv_file" >> "$sv_tmp"
  fi
  printf '%s=%s\n' "$sv_key" "$sv_value" >> "$sv_tmp"
  mv "$sv_tmp" "$sv_file"
}

portal_port() {
  pp_value="$(env_value PORT "$ENV_FILE")"
  if [ -n "$pp_value" ]; then
    printf '%s' "$pp_value"
  else
    printf '8710'
  fi
}

# The tailnet hostname, read back from Tailscale rather than constructed, so a
# renamed machine or a custom tailnet name still yields a correct URL.
tailnet_hostname() {
  command -v tailscale >/dev/null 2>&1 || return 1
  tailscale status --json 2>/dev/null \
    | tr ',' '\n' \
    | grep '"DNSName"' \
    | head -1 \
    | cut -d'"' -f4 \
    | sed 's/\.$//'
}

cmd_check() {
  echo "Portal remote-access check"
  echo "=========================="
  echo "  portal folder: $PORTAL_DIR"

  case "$(uname)" in
    Darwin) echo "  platform:      macOS" ;;
    Linux)  echo "  platform:      Linux (or WSL)" ;;
    *)      echo "  platform:      $(uname) (untested)" ;;
  esac

  if command -v node >/dev/null 2>&1; then
    echo "  node:          $(node --version)"
  else
    echo "  node:          NOT found. The portal needs Node 18 or newer."
  fi

  if [ -d "$PORTAL_DIR/node_modules" ]; then
    echo "  dependencies:  installed"
  else
    echo "  dependencies:  NOT installed. Run: npm install"
  fi

  if [ -f "$ENV_FILE" ]; then
    echo "  .env:          present"
  else
    echo "  .env:          missing. Run: cp .env.example .env"
  fi

  if command -v tailscale >/dev/null 2>&1; then
    echo "  tailscale:     found"
    ts_host="$(tailnet_hostname)"
    if [ -n "$ts_host" ]; then
      echo "  tailnet name:  $ts_host"
    else
      echo "  tailnet name:  unknown. Not logged in? Run: tailscale up"
    fi
  else
    echo "  tailscale:     not installed. Run: ./setup-remote.sh install"
  fi

  return 0
}

cmd_install() {
  if command -v tailscale >/dev/null 2>&1; then
    echo "tailscale is already installed; nothing to do."
    return 0
  fi
  case "$(uname)" in
    Darwin)
      command -v brew >/dev/null 2>&1 \
        || die "Homebrew not found. Install Tailscale from https://tailscale.com/download/mac"
      echo "Installing tailscale with Homebrew..."
      brew install tailscale || die "brew install tailscale failed" ;;
    Linux)
      echo "Installing tailscale with the official installer..."
      command -v curl >/dev/null 2>&1 || die "curl not found; install curl first"
      curl -fsSL https://tailscale.com/install.sh | sh \
        || die "the Tailscale installer failed" ;;
    *)
      die "Unsupported platform $(uname). See https://tailscale.com/download" ;;
  esac
  command -v tailscale >/dev/null 2>&1 \
    || die "tailscale still not on PATH after installing; open a new terminal and retry"
  echo "Installed. Next: log in with 'tailscale up' (this opens a browser)."
  return 0
}

usage() {
  echo "Usage: setup-remote.sh check|install|configure <serve|funnel>|service|verify" >&2
}

case "${1:-}" in
  check)     cmd_check ;;
  install)   cmd_install ;;
  *)         usage; exit 1 ;;
esac
```

- [ ] **Step 4: Make it executable and run the tests**

Run:
```bash
chmod +x portal/setup-remote.sh && bash setup/test/run-tests.sh
```
Expected: `Failed: 0`.

- [ ] **Step 5: Commit**

```bash
git add portal/setup-remote.sh setup/test/remote-tests.sh setup/test/run-tests.sh
git commit -m "feat(portal): add setup-remote.sh with check and install

First half of the agent-driven Tailscale setup. check is read-only and always
exits 0; install is idempotent. Tested with a stubbed tailscale on PATH.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `configure serve|funnel` and the public-exposure gate

**Files:**
- Modify: `portal/setup-remote.sh`
- Modify: `setup/test/remote-tests.sh` (append)

**Interfaces:**
- Consumes: `env_value`, `set_env_value`, `die`, `portal_port`, `tailnet_hostname`, `ENV_FILE`, `PORTAL_DIR` (Task 5); the `EXPOSURE` and `BIND_HOST` semantics (Task 2).
- Produces: `.env` keys `BASE_URL`, `BIND_HOST=127.0.0.1`, and `EXPOSURE=private` (serve) or `EXPOSURE=public` (funnel).

The gate is the point of this task: `configure funnel` must not publish anything when `COOKIE_SECRET` is weak. It is a stop, not a warning, because the failure mode is a stranger driving an agent with `bypassPermissions` on the user's machine.

- [ ] **Step 1: Write the failing tests**

Append to the **end** of `setup/test/remote-tests.sh`, after Task 5's
`rm -rf "$RWORK2"`. This block creates its own working directory and reuses the
`make_tailscale_stub` function defined at the top of the file.

```bash
# --- configure --------------------------------------------------------------

CWORK="$(mktemp -d)"
make_tailscale_stub "$CWORK/bin"
cp "$REMOTE_SH" "$CWORK/setup-remote.sh"
chmod +x "$CWORK/setup-remote.sh"
CENV="$CWORK/.env"

STRONG="$(printf 'a%.0s' $(seq 1 64))"
WEAK="$(printf 'b%.0s' $(seq 1 32))"

reset_env() {
  # $1 = COOKIE_SECRET to seed
  printf 'PORT=8710\nCOOKIE_SECRET=%s\n' "$1" > "$CENV"
  export TS_LOG="$CWORK/ts.log"
  : > "$TS_LOG"
}

# serve: writes private exposure and a loopback bind, and does not demand 64.
reset_env "$WEAK"
if PATH="$CWORK/bin:$PATH" "$CWORK/setup-remote.sh" configure serve >/dev/null 2>&1; then
  pass
else
  fail "configure serve should succeed with a 32-character secret"
fi
check "configure serve calls tailscale serve" grep -q '^serve' "$TS_LOG"
check "configure serve writes EXPOSURE=private" grep -q '^EXPOSURE=private$' "$CENV"
check "configure serve writes a loopback BIND_HOST" grep -q '^BIND_HOST=127.0.0.1$' "$CENV"
check "configure serve derives BASE_URL from tailscale status" \
  grep -q '^BASE_URL=https://box.tail1234.ts.net$' "$CENV"

# funnel with a weak secret: refuses, and crucially never publishes.
reset_env "$WEAK"
check "configure funnel refuses a weak secret" \
  sh -c "! PATH=$CWORK/bin:\$PATH '$CWORK/setup-remote.sh' configure funnel </dev/null >/dev/null 2>&1"
check "configure funnel does not publish when it refuses" \
  sh -c "! grep -q '^funnel' '$TS_LOG'"
check "configure funnel leaves EXPOSURE unchanged when it refuses" \
  sh -c "! grep -q '^EXPOSURE=public$' '$CENV'"

# funnel with a strong secret: publishes and records public exposure.
reset_env "$STRONG"
if PATH="$CWORK/bin:$PATH" "$CWORK/setup-remote.sh" configure funnel </dev/null >/dev/null 2>&1; then
  pass
else
  fail "configure funnel should succeed with a 64-character secret"
fi
check "configure funnel calls tailscale funnel" grep -q '^funnel' "$TS_LOG"
check "configure funnel writes EXPOSURE=public" grep -q '^EXPOSURE=public$' "$CENV"

# funnel with a weak secret and --generate-secret: rotates, then publishes.
reset_env "$WEAK"
if PATH="$CWORK/bin:$PATH" "$CWORK/setup-remote.sh" configure funnel --generate-secret \
    >/dev/null 2>&1; then
  pass
else
  fail "configure funnel --generate-secret should succeed"
fi
check "generated secret is at least 64 characters" \
  sh -c "test \$(grep '^COOKIE_SECRET=' '$CENV' | cut -d= -f2- | tr -d '\n' | wc -c) -ge 64"
check "configure funnel publishes after generating" grep -q '^funnel' "$TS_LOG"

# Bad arguments.
reset_env "$STRONG"
check "configure with no mode exits non-zero" \
  sh -c "! PATH=$CWORK/bin:\$PATH '$CWORK/setup-remote.sh' configure >/dev/null 2>&1"
check "configure with a bad mode exits non-zero" \
  sh -c "! PATH=$CWORK/bin:\$PATH '$CWORK/setup-remote.sh' configure sideways >/dev/null 2>&1"

rm -rf "$CWORK"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bash setup/test/run-tests.sh`
Expected: FAIL lines for the configure tests, because `configure` currently hits the `usage` branch.

- [ ] **Step 3: Implement `configure`**

In `portal/setup-remote.sh`, add these functions after `cmd_install`:

```bash
MIN_SECRET_PUBLIC=64

# Refuse to publish a public portal behind a weak secret. Under Funnel the
# login page is on the internet and the signed cookie is the only barrier in
# front of agent sessions running with bypassPermissions, so this is a stop
# rather than a warning.
require_strong_secret() {
  rs_generate="$1"
  rs_secret="$(env_value COOKIE_SECRET "$ENV_FILE")"
  if [ "${#rs_secret}" -ge "$MIN_SECRET_PUBLIC" ] \
     && [ "$rs_secret" != "change-me-64-random-hex" ]; then
    return 0
  fi

  echo "Funnel puts your portal's login page on the public internet."
  echo "Behind it, agent sessions run with bypassPermissions inside your project,"
  echo "so the login cookie must be signed with a strong secret."
  echo "COOKIE_SECRET is currently ${#rs_secret} characters; $MIN_SECRET_PUBLIC are required."
  echo

  if [ "$rs_generate" != "yes" ]; then
    if [ -t 0 ]; then
      printf 'Generate a new COOKIE_SECRET now? This logs everyone out. [y/N]: '
      read -r rs_reply
    else
      rs_reply="n"
    fi
    case "$rs_reply" in
      y|Y|yes|Yes|YES) ;;
      *) die "Not publishing. Set a 64-character COOKIE_SECRET (openssl rand -hex 32) and retry, or use: configure serve" ;;
    esac
  fi

  command -v openssl >/dev/null 2>&1 || die "openssl not found; cannot generate a secret"
  rs_new="$(openssl rand -hex 32)"
  set_env_value COOKIE_SECRET "$rs_new" "$ENV_FILE"
  echo "Wrote a new 64-character COOKIE_SECRET. Everyone must log in again."
  return 0
}

# Every registered address becomes an internet-reachable login under Funnel,
# so publishing with an empty allowlist is always a mistake.
require_registered_users() {
  ru_registry="$PORTAL_DIR/data/users.json"
  if [ -f "$ru_registry" ] && command -v node >/dev/null 2>&1; then
    ru_count="$(node -e 'try{const u=require(process.argv[1]);console.log(Object.keys(u).length)}catch(e){console.log(0)}' "$ru_registry")"
    [ "$ru_count" -gt 0 ] || die "No users are registered in data/users.json. Run the setup wizard before publishing."
    echo "$ru_count address(es) on the allowlist; each is now an internet-reachable login."
    return 0
  fi
  ru_allow="$(env_value ALLOWED_EMAILS "$ENV_FILE")"
  [ -n "$ru_allow" ] || die "No users are configured. Create data/users.json or set ALLOWED_EMAILS before publishing."
  return 0
}

cmd_configure() {
  cc_mode="${1:-}"
  cc_generate="no"
  [ "${2:-}" = "--generate-secret" ] && cc_generate="yes"

  case "$cc_mode" in
    serve|funnel) ;;
    *) echo "Usage: setup-remote.sh configure serve|funnel [--generate-secret]" >&2; exit 1 ;;
  esac

  command -v tailscale >/dev/null 2>&1 \
    || die "tailscale is not installed. Run: ./setup-remote.sh install"
  [ -f "$ENV_FILE" ] \
    || die "$ENV_FILE not found. Run: cp .env.example .env"

  # The gate runs before anything is published, so a refusal leaves the portal
  # exactly as private as it was.
  if [ "$cc_mode" = "funnel" ]; then
    require_strong_secret "$cc_generate"
    require_registered_users
  fi

  cc_port="$(portal_port)"
  echo "Publishing port $cc_port with 'tailscale $cc_mode'..."
  tailscale "$cc_mode" --bg "$cc_port" \
    || die "tailscale $cc_mode failed. Logged in? Try: tailscale up. For funnel, check that it is enabled in your tailnet's access controls."

  cc_host="$(tailnet_hostname)"
  [ -n "$cc_host" ] \
    || die "Could not read this machine's tailnet name from 'tailscale status'. Are you logged in?"

  set_env_value BASE_URL "https://$cc_host" "$ENV_FILE"
  set_env_value BIND_HOST "127.0.0.1" "$ENV_FILE"
  if [ "$cc_mode" = "funnel" ]; then
    set_env_value EXPOSURE "public" "$ENV_FILE"
  else
    set_env_value EXPOSURE "private" "$ENV_FILE"
  fi

  echo
  echo "Configured. Your portal address is:"
  echo "  https://$cc_host"
  if [ "$cc_mode" = "serve" ]; then
    echo "Reachable only from devices signed in to your tailnet."
    echo "Install the Tailscale app on your phone and sign in with the same account."
  else
    echo "Reachable from any browser on the internet. Keep the allowlist short."
  fi
  echo
  echo "Next: restart the portal, then run: ./setup-remote.sh verify"
  return 0
}
```

Extend the dispatch at the bottom:

```bash
case "${1:-}" in
  check)     cmd_check ;;
  install)   cmd_install ;;
  configure) shift; cmd_configure "$@" ;;
  *)         usage; exit 1 ;;
esac
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bash setup/test/run-tests.sh`
Expected: `Failed: 0`.

- [ ] **Step 5: Commit**

```bash
git add portal/setup-remote.sh setup/test/remote-tests.sh
git commit -m "feat(portal): configure serve|funnel, gated on a strong secret

configure derives BASE_URL by reading the tailnet name back from tailscale
status, and records EXPOSURE plus a loopback BIND_HOST. Funnel refuses to
publish behind a COOKIE_SECRET under 64 characters, or with an empty
allowlist, and offers to rotate the secret. Tests assert it never invokes
tailscale funnel when it refuses.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `service` and `verify`

**Files:**
- Modify: `portal/setup-remote.sh`
- Modify: `setup/test/remote-tests.sh` (append)

**Interfaces:**
- Consumes: all Task 5 helpers, plus `EXPOSURE` and `BASE_URL` written by Task 6.
- Produces: nothing consumed by later tasks.

`verify` is why this is a script and not prose: it turns "I think it worked" into four specific assertions, so a half-finished setup fails at setup time rather than at 11pm from a phone.

- [ ] **Step 1: Write the failing tests**

Append to the **end** of `setup/test/remote-tests.sh`, after Task 6's
`rm -rf "$CWORK"`.

```bash
# --- service and verify -----------------------------------------------------

SWORK="$(mktemp -d)"
make_tailscale_stub "$SWORK/bin"
cp "$REMOTE_SH" "$SWORK/setup-remote.sh"
chmod +x "$SWORK/setup-remote.sh"
export TS_LOG="$SWORK/ts.log"
: > "$TS_LOG"

printf 'PORT=8710\nBASE_URL=https://box.tail1234.ts.net\nEXPOSURE=private\n' > "$SWORK/.env"

# service writes a unit without enabling anything, so it is safe under test.
if PATH="$SWORK/bin:$PATH" XDG_CONFIG_HOME="$SWORK/config" \
   "$SWORK/setup-remote.sh" service --write-only >"$SWORK/svc.out" 2>&1; then
  pass
else
  fail "service --write-only should exit 0"
fi
case "$(uname)" in
  Linux)
    check "service writes a systemd user unit" \
      test -f "$SWORK/config/systemd/user/job-search-portal.service"
    check "the unit runs the portal from its own folder" \
      grep -q "WorkingDirectory=$SWORK" "$SWORK/config/systemd/user/job-search-portal.service" ;;
  Darwin)
    check "service writes a launchd plist" \
      test -f "$SWORK/config/LaunchAgents/com.job-search.portal.plist" ;;
esac

# verify fails cleanly when the portal is not running, and says which check failed.
check "verify exits non-zero when the portal is not running" \
  sh -c "! PATH=$SWORK/bin:\$PATH '$SWORK/setup-remote.sh' verify >'$SWORK/ver.out' 2>&1"
check "verify names the loopback check that failed" \
  grep -qi "127.0.0.1\|loopback" "$SWORK/ver.out"

# verify fails when BASE_URL disagrees with the live tailnet hostname.
printf 'PORT=8710\nBASE_URL=https://stale.tail1234.ts.net\nEXPOSURE=private\n' > "$SWORK/.env"
PATH="$SWORK/bin:$PATH" "$SWORK/setup-remote.sh" verify >"$SWORK/ver2.out" 2>&1
check "verify flags a stale BASE_URL" \
  grep -qi "box.tail1234.ts.net" "$SWORK/ver2.out"

rm -rf "$SWORK"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bash setup/test/run-tests.sh`
Expected: FAIL lines for the service and verify tests.

- [ ] **Step 3: Implement `service` and `verify`**

Add to `portal/setup-remote.sh` after `cmd_configure`:

```bash
cmd_service() {
  cs_write_only="no"
  [ "${1:-}" = "--write-only" ] && cs_write_only="yes"
  cs_node="$(command -v node)"
  [ -n "$cs_node" ] || die "node not found; install Node 18 or newer first"

  case "$(uname)" in
    Linux)
      cs_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
      mkdir -p "$cs_dir"
      cs_unit="$cs_dir/job-search-portal.service"
      cat > "$cs_unit" <<EOF
[Unit]
Description=Job search submission portal

[Service]
WorkingDirectory=$PORTAL_DIR
ExecStart=$cs_node src/server.js
Restart=on-failure

[Install]
WantedBy=default.target
EOF
      echo "Wrote $cs_unit"
      if [ "$cs_write_only" = "yes" ]; then
        echo "Not enabling it (--write-only)."
        return 0
      fi
      systemctl --user daemon-reload || die "systemctl --user daemon-reload failed"
      systemctl --user enable --now job-search-portal \
        || die "could not enable job-search-portal; check: systemctl --user status job-search-portal"
      loginctl enable-linger "$USER" >/dev/null 2>&1 \
        || echo "Note: could not enable lingering; the portal will stop when you log out."
      echo "Enabled and started." ;;
    Darwin)
      cs_dir="${XDG_CONFIG_HOME:-$HOME/Library}/LaunchAgents"
      mkdir -p "$cs_dir"
      cs_plist="$cs_dir/com.job-search.portal.plist"
      cat > "$cs_plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.job-search.portal</string>
  <key>ProgramArguments</key>
  <array>
    <string>$cs_node</string>
    <string>src/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$PORTAL_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
EOF
      echo "Wrote $cs_plist"
      if [ "$cs_write_only" = "yes" ]; then
        echo "Not loading it (--write-only)."
        return 0
      fi
      launchctl load "$cs_plist" || die "launchctl load failed"
      echo "Loaded." ;;
    *)
      die "Unsupported platform $(uname); see docs/portal.md for a manual service unit" ;;
  esac
  return 0
}

cmd_verify() {
  cv_fails=0
  cv_port="$(portal_port)"
  cv_base="$(env_value BASE_URL "$ENV_FILE")"

  echo "Verifying the portal"
  echo "===================="

  # 1. The portal answers locally.
  if curl -fsS --max-time 10 "http://127.0.0.1:$cv_port/api/meta" >/dev/null 2>&1; then
    echo "  ok    portal responds on 127.0.0.1:$cv_port"
  else
    echo "  FAIL  portal does not respond on loopback at 127.0.0.1:$cv_port"
    echo "        Is it running? Start it with: npm start"
    cv_fails=$((cv_fails + 1))
  fi

  # 2. BASE_URL matches the live tailnet name. A machine rename silently
  #    breaks login links, and this is the only place that would catch it.
  cv_host="$(tailnet_hostname)"
  if [ -z "$cv_host" ]; then
    echo "  FAIL  could not read the tailnet name; run: tailscale up"
    cv_fails=$((cv_fails + 1))
  elif [ "$cv_base" = "https://$cv_host" ]; then
    echo "  ok    BASE_URL matches this machine's tailnet name"
  else
    echo "  FAIL  BASE_URL is $cv_base but this machine is https://$cv_host"
    echo "        Fix with: ./setup-remote.sh configure serve   (or funnel)"
    cv_fails=$((cv_fails + 1))
  fi

  # 3. The public URL serves valid HTTPS. curl without -k, so an invalid
  #    certificate is a failure rather than a warning.
  if [ -n "$cv_base" ]; then
    if curl -fsS --max-time 20 "$cv_base/api/meta" >/dev/null 2>&1; then
      echo "  ok    $cv_base responds over HTTPS with a valid certificate"
    else
      echo "  FAIL  $cv_base did not respond over HTTPS with a valid certificate"
      echo "        Check: tailscale $( [ "$(env_value EXPOSURE "$ENV_FILE")" = "public" ] && echo funnel || echo serve ) status"
      cv_fails=$((cv_fails + 1))
    fi

    # 4. Login round-trips. Always 200 by design (no allowlist oracle), so
    #    this proves the route is reachable, not that mail was delivered.
    if curl -fsS --max-time 20 -X POST "$cv_base/api/login" \
         -H 'content-type: application/json' -d '{"email":"verify@example.invalid"}' \
         >/dev/null 2>&1; then
      echo "  ok    the login route accepts requests"
    else
      echo "  FAIL  the login route did not respond"
      cv_fails=$((cv_fails + 1))
    fi
  fi

  echo
  if [ "$cv_fails" -eq 0 ]; then
    echo "All checks passed. Open $cv_base and request a login link."
    return 0
  fi
  echo "$cv_fails check(s) failed. Fix them before relying on the portal from a phone."
  return 1
}
```

Extend the dispatch:

```bash
case "${1:-}" in
  check)     cmd_check ;;
  install)   cmd_install ;;
  configure) shift; cmd_configure "$@" ;;
  service)   shift; cmd_service "$@" ;;
  verify)    cmd_verify ;;
  *)         usage; exit 1 ;;
esac
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bash setup/test/run-tests.sh`
Expected: `Failed: 0`.

- [ ] **Step 5: Commit**

```bash
git add portal/setup-remote.sh setup/test/remote-tests.sh
git commit -m "feat(portal): add service and verify subcommands

verify asserts four things: the portal answers on loopback, BASE_URL matches
the live tailnet name, the public URL serves valid HTTPS, and the login route
responds. A half-finished setup now fails at setup time.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Honest wizard messaging and a node check

**Files:**
- Modify: `setup/setup.sh:132-198` (dependency checks) and `:261-274` (portal registration)
- Modify: `setup/SETUP.md.tmpl` is untouched; the inserted task text lives in `setup/setup.sh:299-317`
- Modify: `setup/test/run-tests.sh` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks.

On `PORTAL=yes` the wizard prints `Portal: registered ...`, which reads as though something is now working. For a lone GitHub downloader nothing is running at all.

- [ ] **Step 1: Write the failing test**

Append to `setup/test/run-tests.sh`, immediately **above** the
`. "$TEST_DIR/remote-tests.sh"` line that Task 5 added, so both sit before the
final `Passed: N  Failed: N` summary:

```bash
# --- Wizard portal messaging ------------------------------------------------

PWORK="$(mktemp -d)"
PORTAL_REGISTRY="$PWORK/users.json" \
  bash "$SETUP_DIR/setup.sh" --answers "$TEST_DIR/answers-portal.env" \
  --target "$PWORK/proj" --skip-deps >"$PWORK/out.txt" 2>&1

check "wizard says the portal itself is not set up yet" \
  grep -qi "not set up yet" "$PWORK/out.txt"
# Assert the runbook by name. Grepping for "assistant" alone would pass without
# any change, because the wizard's closing message already says "AI assistant".
check "wizard points at the remote-access runbook" \
  grep -q "portal-remote-access.md" "$PWORK/out.txt"
check "SETUP.md portal task keeps the required phrase" \
  grep -q "If you chose the portal" "$PWORK/proj/SETUP.md"
check "SETUP.md portal task points at the runbook" \
  grep -q "portal-remote-access.md" "$PWORK/proj/SETUP.md"
rm -rf "$PWORK"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bash setup/test/run-tests.sh`
Expected: FAIL for the four new checks.

- [ ] **Step 3: Add the node dependency check**

In `setup/setup.sh`, inside the `if [ "$SKIP_DEPS" = "no" ]; then` block, after the typst block and before the "Detected AI CLIs" block:

```bash
  case "$PORTAL" in
    y|Y|yes|Yes|YES)
      if command -v node >/dev/null 2>&1; then
        echo "  node: found ($(node --version)); needed by the portal"
      else
        echo "  node: NOT found. The portal needs Node 18 or newer."
        echo "        macOS: brew install node   Linux/WSL: sudo apt install -y nodejs npm"
      fi ;;
  esac
```

- [ ] **Step 4: Make the registration message honest**

In `setup/setup.sh`, replace the two `echo` lines in the `if [ "$PORTAL" = "yes" ]` block:

```bash
  if [ "$PORTAL_ADMIN" = "yes" ]; then
    echo "Portal: registered as a failure-alert recipient (admin), project $ABS_TARGET."
  else
    echo "Portal: registered (no failure alerts), project $ABS_TARGET."
  fi
  echo "        This records who you are. The portal itself is not set up yet, and"
  echo "        is not running. Your AI assistant will set it up with you in a"
  echo "        later session, following docs/portal-remote-access.md."
```

- [ ] **Step 5: Point the SETUP.md task at the runbook**

In `setup/setup.sh`, in the awk block that inserts the portal task, replace the four `print` lines. Keep the literal phrase "If you chose the portal", which `run-tests.sh` greps for:

```bash
      print n ". If you chose the portal: this person is registered with the shared"
      print "   portal in the kit checkout, but the portal may not be running yet. Follow"
      print "   the kit'"'"'s docs/portal-remote-access.md to install it, publish it with"
      print "   Tailscale, and run ./setup-remote.sh verify, then test a submission end"
      print "   to end with the user."
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bash setup/test/run-tests.sh`
Expected: `Failed: 0`.

- [ ] **Step 7: Commit**

```bash
git add setup/setup.sh setup/test/run-tests.sh
git commit -m "fix(setup): stop implying the portal is working after registration

Registration records who someone is; it does not start a portal. The wizard
now says so, checks for node when the portal was chosen, and points the
assistant at the new runbook.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The agent's runbook

**Files:**
- Create: `docs/portal-remote-access.md`

**Interfaces:**
- Consumes: every subcommand from Tasks 5 to 7, and the `EXPOSURE` semantics from Tasks 1 and 2.
- Produces: the document `setup/setup.sh` and `docs/portal.md` point at.

This is the document the agent follows during setup session C. Write it addressed to the assistant, not the user, because the assistant is the one executing it.

- [ ] **Step 1: Write the runbook**

Create `docs/portal-remote-access.md` covering, in this order:

1. **What this is:** publishing an already-installed portal so its owner can reach it from a phone. Prerequisites: `npm install` done, `.env` created, at least one registered user.
2. **The four human gates**, listed up front so the assistant can warn the user what it will need: choosing an option; approving `tailscale up` in a browser; creating the email account or Gmail app password; confirming the machine stays awake.
3. **Presenting the choice.** Reproduce the comparison table from the spec (`serve` versus `funnel`: who can reach it, whether a device needs the app, where TLS terminates, exposure). Recommend `serve`. State Funnel's cost plainly: the login page is public and behind it are agent sessions running with `bypassPermissions`, so Funnel requires a 64-character `COOKIE_SECRET` and `configure funnel` will refuse without one.
4. **The sequence:** `./setup-remote.sh check`, then `install`, then the `tailscale up` gate, then `configure serve|funnel`, then restart the portal, then `verify`. Note that `configure` writes `BASE_URL`, `BIND_HOST` and `EXPOSURE` into `.env` itself, so the assistant should not hand-edit those.
5. **Email:** point at `docs/portal.md`'s SMTP walkthrough, and note that `EMAIL_PROVIDER=log` lets the assistant prove the whole chain works before the user has any mail account, by reading the login link out of the terminal.
6. **Reading `verify` output:** what each of the four checks means and the first thing to try when it fails.
7. **Troubleshooting**, at minimum: Tailscale not logged in; Funnel not enabled in the tailnet access controls; `BASE_URL` stale after a machine rename (run `configure` again); the portal not running when `verify` probes it; the portal refusing to start because preflight found an error, with a pointer to the message it prints.
8. **The sleeping-laptop limitation:** the portal must be running to accept a submission and a turn takes minutes, so a laptop that sleeps drops submissions from a phone. Prefer an always-on machine, or keep it awake on mains power. This is the fourth gate's purpose.

Follow the house style: British English, no em dashes or en dashes as sentence punctuation.

- [ ] **Step 2: Check the cross-references resolve**

Run:
```bash
grep -o 'docs/[a-z-]*\.md\|setup-remote\.sh [a-z]*' docs/portal-remote-access.md | sort -u
```
Expected: every referenced file exists, and every subcommand named is one of `check`, `install`, `configure`, `service`, `verify`.

- [ ] **Step 3: Commit**

```bash
git add docs/portal-remote-access.md
git commit -m "docs: add the portal remote-access runbook

The document the assistant follows to publish a portal with Tailscale,
including the four gates that need the human and how to read verify output.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Corrections to `docs/portal.md` and `README.md`

**Files:**
- Modify: `docs/portal.md:19-30` (requirements), `:93-115` (providers), `:165-176` (running it)
- Modify: `README.md:16-41`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

The single highest-value line in this plan is in `README.md`: `docs/getting-started/` contains a good beginner's guide, and nothing in the repository references it, so the audience it was written for never finds it.

- [ ] **Step 1: Fix `docs/portal.md`**

- Replace the paragraph at lines 108-115 (beginning "One wrinkle to know about"). It claims that with nothing configured, login links are written to the log and can be copied from there. That is false: `sendViaWebhook` calls `fetch('')`, which throws, and only the error is logged. Replace with an accurate description of `EMAIL_PROVIDER=log`: it sends nothing, prints each message including login links to the terminal, and is the way to test the portal before setting up mail. Keep the warning that an unset `EMAIL_PROVIDER` silently defaults to `webhook`, and add that startup now warns about it.
- In the `BASE_URL` bullet (line 45), state that it must be `https` unless it is `localhost`, because the session cookie is set `Secure` and browsers discard `Secure` cookies sent over plain http, so login silently fails.
- Add `EXPOSURE` and `BIND_HOST` to the field-by-field walkthrough, including both `COOKIE_SECRET` thresholds (32 private, 64 public) alongside the existing `openssl rand -hex 32` advice.
- In "Running it" (line 165), point at `docs/portal-remote-access.md` as the recommended path. Keep the systemd and launchd examples.
- Add an appendix, "Reverse proxy on a public domain (advanced, existing installs)", documenting the Caddy plus dynamic DNS plus port-forward topology for the first time. It must say to set `EXPOSURE=public` (these installs are publicly reachable, so the 64-character bar should apply to them for the same reason it applies to Funnel) and to set `BIND_HOST` to an address the proxy can reach, noting that a proxy in Docker does not reach loopback.
- Reconcile the Node floor to `>=18`, matching `package.json` and the live host. Change line 21's "Node 18 or newer (20+ recommended)" to state 18 plainly, and update `CLAUDE.md`'s "Node 20+" to match.

- [ ] **Step 2: Fix `README.md`**

- Add a "Start here" line immediately above Installation, linking `docs/getting-started/` and naming the PDF as the step-by-step guide for people new to the terminal. Nothing currently links it.
- In Requirements: state that a paid Claude plan (Pro or Max) is required, as `docs/getting-started/guide.typ` already says and the README does not, and mention Node 18+ for the optional portal.
- Replace "Set up your file tracker connection" with wording that matches reality. The tracker is a CSV file; there is no connection to configure. This is vestigial from the removed Grist option.
- In the `portal/` bullet, mention that it is published with Tailscale and point at `docs/portal-remote-access.md`.

- [ ] **Step 3: Verify the claims the docs now make**

Run:
```bash
cd portal && npm test && \
  grep -n "Node 18\|>=18" ../docs/portal.md ../CLAUDE.md package.json && \
  grep -c "getting-started" ../README.md
```
Expected: tests pass; the Node floor reads 18 in all three places; the README references `getting-started` at least once.

- [ ] **Step 4: Full verification**

Run:
```bash
bash setup/test/run-tests.sh && cd portal && npm test
```
Expected: `Failed: 0` and all node tests passing.

- [ ] **Step 5: Commit**

```bash
git add docs/portal.md README.md CLAUDE.md
git commit -m "docs: correct the portal setup story and surface the beginner's guide

docs/portal.md no longer promises a log fallback that never existed, states
the https requirement for BASE_URL and why, documents EXPOSURE and BIND_HOST,
and records the Caddy topology as an appendix. README links the
getting-started guide, which nothing referenced before.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Manual verification before deploying

Automated tests cannot cover the network path. Do these by hand once, on a machine with a real tailnet:

- [ ] Clone into a scratch directory, run the wizard, and follow `docs/portal-remote-access.md` as the assistant would. Confirm `./setup-remote.sh verify` passes for `serve`.
- [ ] Switch to `funnel` and confirm `verify` passes, and that the portal loads on a phone with the Tailscale app turned off.
- [ ] With `EXPOSURE=public` and a 32-character `COOKIE_SECRET`, confirm the portal refuses to start and `configure funnel` refuses to publish.
- [ ] Set `BASE_URL=http://192.168.1.10:8710` and confirm the portal refuses to start with a message naming the `Secure` cookie.
- [ ] With `EMAIL_PROVIDER=log` and no mail account, request a login link and complete a login using the link printed to the terminal.

## Rollout to the live instance

The live portal at `jawbs.duckdns.org` is reached from DuckDNS to an Oracle VPS, over WireGuard, to Caddy in Docker, which connects to the portal at `172.18.0.1:8710`. Before restarting it:

- [ ] Confirm `BIND_HOST` is unset or `0.0.0.0` in its `.env`. Loopback would 502 the site.
- [ ] Set `EXPOSURE=public`. It is publicly reachable, and left unset it would be held to the 32-character bar despite being exactly the exposure the 64-character bar exists for.
- [ ] Confirm `COOKIE_SECRET` is at least 64 characters; rotate with `openssl rand -hex 32` if not. Preflight will refuse to start otherwise.
- [ ] Rotation logs everyone out, so warn the portal's registered users before the restart, not after.
- [ ] Then: pull into `~/j4`, and `systemctl --user restart job-search-portal` (a user unit; `sudo` fails with "Unit not found").

Per `MEMORY.md`, this checkout is pull-only: the branch is pushed to the public repo from `~/j4dev`, and live service changes are run by Sam.
