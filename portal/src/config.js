import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 8710),
  // Loopback is right for Tailscale but wrong for a reverse proxy on another
  // host (the live install reaches the portal from Caddy in Docker), so the
  // default stays open and setup-remote.sh narrows it for Tailscale setups.
  bindHost: process.env.BIND_HOST || '0.0.0.0',
  // Reachability, not tooling: `public` means the login page is on the
  // internet, whether via Tailscale Funnel or a reverse proxy.
  exposure: process.env.EXPOSURE || '',
  baseUrl: process.env.BASE_URL || 'http://localhost:8710',
  cookieSecret: process.env.COOKIE_SECRET || 'dev-secret',
  allowedEmails: (process.env.ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  projectDir: process.env.PROJECT_DIR || `${process.env.HOME}/job-search`,
  dbPath: process.env.DB_PATH || new URL('../data/portal.db', import.meta.url).pathname,
  usersFile: process.env.PORTAL_USERS_FILE || new URL('../data/users.json', import.meta.url).pathname,
  portalTitle: process.env.PORTAL_TITLE || 'Job Search Portal',
  userName: process.env.USER_NAME || 'the owner',
  // "opus" is Claude Code's name for the newest Opus it knows, so the portal
  // moves to a new Opus when the Agent SDK is updated, with no edit here.
  agentModel: process.env.AGENT_MODEL || 'opus',
  // Whether the fallback above is in play. The codex runner omits --model
  // entirely when it is not, so the Claude default can never leak into a
  // codex command line. Same pattern as emailProviderExplicit below.
  agentModelExplicit: Boolean(process.env.AGENT_MODEL),
  agentRunner: process.env.AGENT_RUNNER || 'claude-sdk',
  // Which subscriptions this host has: both (Claude runs the portal, ChatGPT
  // writes the CV and letter copy), claude-only or chatgpt-only. An explicit
  // opt-in; preflight.js checks it against AGENT_RUNNER and the Codex install.
  subscriptions: (process.env.SUBSCRIPTIONS || 'both').trim().toLowerCase(),
  // Speech to text: a mic on the text boxes, transcribed here by an open model.
  // Off unless setup/jawbs-speech.sh has downloaded the model and said so.
  speech: (process.env.SPEECH_TO_TEXT || '').trim().toLowerCase() === 'on',
  speechDir: process.env.SPEECH_MODEL_DIR || new URL('../data/speech', import.meta.url).pathname,
  agentCmd: process.env.AGENT_CMD || '',
  agentCmdResume: process.env.AGENT_CMD_RESUME || '',
  emailProvider: process.env.EMAIL_PROVIDER || 'webhook',
  // Whether the fallback above is in play, which preflight warns about.
  emailProviderExplicit: Boolean(process.env.EMAIL_PROVIDER),
  brevoApiKey: process.env.BREVO_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || '',
  smtpUrl: process.env.SMTP_URL || '',
  webhookUrl: process.env.WEBHOOK_URL || '',
};
