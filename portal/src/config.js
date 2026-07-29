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
  agentModel: process.env.AGENT_MODEL || 'claude-opus-4-6',
  // Whether the fallback above is in play. The codex runner omits --model
  // entirely when it is not, so the Claude default can never leak into a
  // codex command line. Same pattern as emailProviderExplicit below.
  agentModelExplicit: Boolean(process.env.AGENT_MODEL),
  agentRunner: process.env.AGENT_RUNNER || 'claude-sdk',
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
