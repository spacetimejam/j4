import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

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

// Which providers need EMAIL_FROM. smtp and brevo send real mail themselves
// (email.js puts EMAIL_FROM straight into the message as the sender), so a
// blank value means every send goes out with an empty From and fails or
// bounces, including login links. webhook hands the message to an external
// system that may set its own sender, and log sends nothing at all, so
// neither needs a value here.
const PROVIDERS_NEEDING_FROM = new Set(['smtp', 'brevo']);

// Every value agent.js's RUNNERS map accepts. Kept here so a bad AGENT_RUNNER
// fails at startup rather than at the first job, where it currently surfaces
// to the user as a failed session rather than a configuration problem. Not
// imported from agent.js, because that would pull the Claude SDK into a
// module whose whole point is to run cheaply before anything else loads;
// agent.test.js pins the two lists together instead.
export const AGENT_RUNNERS = ['claude-sdk', 'cli', 'codex'];

// Is `bin` executable somewhere on PATH? A plain scan rather than a
// subprocess, so preflight stays synchronous and cheap. Injected as
// `lookupBin` so tests need no real binary. Exported so a test can exercise
// the real default directly, rather than only ever through an injected fake.
export function onPath(bin) {
  return (process.env.PATH || '')
    .split(delimiter)
    .some(dir => dir && existsSync(join(dir, bin)));
}

// Validate configuration before the server binds. Errors are conditions that
// cannot work and so abort startup; warnings are conditions that merely
// deserve saying out loud. `exists` is injected so tests need no filesystem.
export function checkConfig(cfg, { exists = existsSync, lookupBin = onPath } = {}) {
  const issues = [];
  const err = message => issues.push({ level: 'error', message });
  const warn = message => issues.push({ level: 'warn', message });

  // --- Exposure ------------------------------------------------------------
  // EXPOSURE describes reachability, not tooling, so a publicly reachable
  // Caddy install is held to the same bar as a Tailscale Funnel one.
  // Normalised here rather than in config.js because this is where the
  // vocabulary is defined, and because it also covers the plain objects the
  // tests inject. EXPOSURE=PUBLIC used to stop the service with a message
  // that named the value without hinting that case was the culprit.
  let exposure = (cfg.exposure || '').trim().toLowerCase();
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
    if (PROVIDERS_NEEDING_FROM.has(cfg.emailProvider) && !cfg.emailFrom) {
      err(`EMAIL_PROVIDER is "${cfg.emailProvider}" but EMAIL_FROM is empty, so every message would be sent with no sender and fail, including login links. Set EMAIL_FROM in .env.`);
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

  // --- Agent runner --------------------------------------------------------
  const runner = cfg.agentRunner || '';
  if (!AGENT_RUNNERS.includes(runner)) {
    err(`AGENT_RUNNER is "${runner}", which is not one of: ${AGENT_RUNNERS.join(', ')}.`);
  } else if (runner === 'codex') {
    if (!lookupBin('codex')) {
      err('AGENT_RUNNER is "codex" but no codex binary is on PATH. Install the Codex CLI, or set AGENT_RUNNER=claude-sdk in .env.');
    }
    // AGENT_MODEL defaults to a Claude id, so only an explicit setting is a
    // mistake. Left unset, the codex runner omits --model and codex chooses.
    if (cfg.agentModelExplicit && /^claude-/.test(cfg.agentModel || '')) {
      err(`AGENT_RUNNER is "codex" but AGENT_MODEL is "${cfg.agentModel}", which is a Claude model id. Leave AGENT_MODEL unset to let codex choose its own default, or set a codex model.`);
    }
    // A warning, not an error: the runner may well be correct. But a broken
    // assumption here fails silently in production (queue.js's existing
    // retry-in-a-fresh-session recovery swallows it, so neither the user nor
    // an admin sees anything), so this is the one place to say out loud that
    // calibration is the way to find out before that happens.
    warn('AGENT_RUNNER is "codex". This runner is written to the documented codex exec --json event stream and has not been verified against a live binary. Run `npm run calibrate` once before first use.');
  }

  // --- Bind ----------------------------------------------------------------
  if (!LOOPBACK_BINDS.includes(cfg.bindHost)) {
    warn(`BIND_HOST is ${cfg.bindHost}, so the portal is reachable from your local network. Tailscale setups should use 127.0.0.1; a reverse proxy on another host needs the wider bind.`);
  }

  return issues;
}
