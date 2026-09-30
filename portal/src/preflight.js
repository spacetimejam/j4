import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { CODEX_BIN } from './drafting.js';
import { speechReady } from './speech.js';

// How many people this portal serves: the registry's entries, or the legacy
// allowlist when there is no registry. Local mode serves exactly one.
export function countRegisteredUsers(cfg) {
  try {
    return Object.keys(JSON.parse(readFileSync(cfg.usersFile, 'utf8'))).length;
  } catch (err) {
    if (err.code === 'ENOENT') return (cfg.allowedEmails || []).length;
    return 0; // unreadable or malformed: the users section below reports it
  }
}

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

// The values SUBSCRIPTIONS accepts. `both` is the default when it is unset.
export const SUBSCRIPTIONS = ['both', 'claude-only', 'chatgpt-only'];

// Is Codex signed in? `codex login status` exits 0 when it is, in about 50 ms.
// stdin is closed because codex waits on an open one, and the timeout keeps a
// wedged binary from holding up startup; either failure reads as signed out.
export function codexLoggedIn(bin) {
  const r = spawnSync(bin, ['login', 'status'], { stdio: 'ignore', timeout: 5000 });
  return r.status === 0;
}

// Validate configuration before the server binds. Errors are conditions that
// cannot work and so abort startup; warnings are conditions that merely
// deserve saying out loud. `exists` is injected so tests need no filesystem.
export function checkConfig(cfg, {
  exists = existsSync, lookupBin = onPath, codexBin = CODEX_BIN, codexSignedIn = codexLoggedIn,
  countUsers = countRegisteredUsers, speechIsReady = speechReady,
} = {}) {
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
  } else if (!['private', 'public', 'local'].includes(exposure)) {
    err(`EXPOSURE is "${exposure}", which is not one of: private, public, local.`);
    // Assume the stricter reading while we are already failing, so the secret
    // check below cannot be softened by a typo.
    exposure = 'public';
  }
  const local = exposure === 'local';

  // --- Cookie secret -------------------------------------------------------
  // Local mode reads no cookie (requireAuth serves the one registered user),
  // so a secret would guard nothing.
  if (!local) {
    const secret = cfg.cookieSecret || '';
    const minSecret = exposure === 'public' ? MIN_SECRET_PUBLIC : MIN_SECRET_PRIVATE;
    if (!secret || secret === PLACEHOLDER_SECRET || secret === DEV_SECRET) {
      err('COOKIE_SECRET is unset or still the example value. Generate one with: openssl rand -hex 32');
    } else if (secret.length < minSecret) {
      err(exposure === 'public'
        ? `COOKIE_SECRET is ${secret.length} characters, but EXPOSURE=public requires at least ${MIN_SECRET_PUBLIC}. This portal's login page is reachable from the internet, and the session cookie is the only thing between a stranger and an agent running with bypassPermissions inside your project. Generate a new one with: openssl rand -hex 32 (this logs everyone out), or stop exposing the portal publicly.`
        : `COOKIE_SECRET is ${secret.length} characters, but at least ${MIN_SECRET_PRIVATE} are required. Generate one with: openssl rand -hex 32`);
    }
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
    // AGENT_MODEL defaults to a Claude model, so only an explicit setting is a
    // mistake. Left unset, the codex runner omits --model and codex chooses.
    if (cfg.agentModelExplicit && /^(claude-|(opus|sonnet|haiku)$)/.test(cfg.agentModel || '')) {
      err(`AGENT_RUNNER is "codex" but AGENT_MODEL is "${cfg.agentModel}", which is a Claude model. Leave AGENT_MODEL unset to let codex choose its own default, or set a codex model.`);
    }
    // A warning, not an error: the runner may well be correct. But a broken
    // assumption here fails silently in production (queue.js's existing
    // retry-in-a-fresh-session recovery swallows it, so neither the user nor
    // an admin sees anything), so this is the one place to say out loud that
    // calibration is the way to find out before that happens.
    warn('AGENT_RUNNER is "codex". This runner is written to the documented codex exec --json event stream and has not been verified against a live binary. Run `npm run calibrate` once before first use.');
  }

  // --- Subscriptions -------------------------------------------------------
  // Opting down to one subscription is always explicit: nothing here falls
  // back on its own. Only claude-sdk drafts through ChatGPT (it is the one
  // runner in agent.js's STRUCTURED_RUNNERS; agent.test.js pins the two), so
  // only it needs Codex. Signed out is a warning because logins lapse on their
  // own, and refusing to start would turn a routine restart into an outage.
  const subs = cfg.subscriptions || 'both';
  if (!SUBSCRIPTIONS.includes(subs)) {
    err(`SUBSCRIPTIONS is "${subs}", which is not one of: ${SUBSCRIPTIONS.join(', ')}.`);
  } else if (runner === 'codex' && subs === 'claude-only') {
    err('SUBSCRIPTIONS is "claude-only" but AGENT_RUNNER is "codex", which runs the portal on ChatGPT. Set AGENT_RUNNER=claude-sdk, or SUBSCRIPTIONS=chatgpt-only if ChatGPT is the one you have.');
  } else if (runner === 'codex' && subs === 'both') {
    err('AGENT_RUNNER is "codex", which runs the whole portal on ChatGPT alone. Confirm that with SUBSCRIPTIONS=chatgpt-only in .env.');
  } else if (subs === 'chatgpt-only' && runner !== 'codex' && AGENT_RUNNERS.includes(runner)) {
    err(`SUBSCRIPTIONS is "chatgpt-only" but AGENT_RUNNER is "${runner}". Running on ChatGPT alone needs AGENT_RUNNER=codex (run \`npm run calibrate\` before first use).`);
  } else if (subs === 'both' && runner === 'claude-sdk') {
    if (!exists(codexBin)) {
      err(`SUBSCRIPTIONS is "both" (the default), so ChatGPT writes the CV and cover letter copy, but Codex is not installed at ${codexBin}. Install the Codex CLI and sign in with \`codex login\` (or set CODEX_BIN to where it lives). If you only have a Claude subscription, set SUBSCRIPTIONS=claude-only in .env and Claude will write the copy itself.`);
    } else if (!codexSignedIn(codexBin)) {
      warn(`Codex is installed at ${codexBin} but not signed in to ChatGPT, so CV and cover letter drafts will wait until someone runs \`codex login\` as the user this portal runs as.`);
    }
  }

  // --- Speech ---------------------------------------------------------------
  // A warning, not an error: a missing model file hides the mic and nothing
  // else, and refusing to start would turn that into an outage.
  if (cfg.speech && !speechIsReady(cfg)) {
    warn(`SPEECH_TO_TEXT is on but the speech model is not installed in ${cfg.speechDir}, so the microphone button is hidden. Run setup/jawbs-speech.sh to install it, or set SPEECH_TO_TEXT=off.`);
  }

  // --- Bind ----------------------------------------------------------------
  if (!local && !LOOPBACK_BINDS.includes(cfg.bindHost)) {
    warn(`BIND_HOST is ${cfg.bindHost}, so the portal is reachable from your local network. Tailscale setups should use 127.0.0.1; a reverse proxy on another host needs the wider bind.`);
  }

  // --- Local ----------------------------------------------------------------
  // No sign-in is safe only for one person on this machine: loopback bind, one
  // user, and a BASE_URL the Host guard in local.js will accept.
  if (local) {
    if (!LOOPBACK_BINDS.includes(cfg.bindHost)) {
      err(`EXPOSURE=local has no sign-in, so it must listen on this computer only, but BIND_HOST is ${cfg.bindHost}. Set BIND_HOST=127.0.0.1.`);
    }
    const n = countUsers(cfg);
    if (n !== 1) {
      err(`EXPOSURE=local serves exactly one person, but ${n} are registered in ${cfg.usersFile}. A second person needs their own copy of the kit.`);
    }
    const port = String(cfg.port ?? 8710);
    const okBase = url && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
      && (url.port || '80') === port;
    if (!okBase) {
      err(`EXPOSURE=local needs BASE_URL=http://localhost:${port}, but it is ${cfg.baseUrl}.`);
    }
  }

  return issues;
}
