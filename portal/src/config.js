import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 8710),
  baseUrl: process.env.BASE_URL || 'http://localhost:8710',
  cookieSecret: process.env.COOKIE_SECRET || 'dev-secret',
  allowedEmails: (process.env.ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  projectDir: process.env.PROJECT_DIR || `${process.env.HOME}/job-search`,
  dbPath: process.env.DB_PATH || new URL('../data/portal.db', import.meta.url).pathname,
  portalTitle: process.env.PORTAL_TITLE || 'Job Search Portal',
  userName: process.env.USER_NAME || 'the owner',
  agentModel: process.env.AGENT_MODEL || 'claude-opus-4-8',
  agentRunner: process.env.AGENT_RUNNER || 'claude-sdk',
  agentCmd: process.env.AGENT_CMD || '',
  agentCmdResume: process.env.AGENT_CMD_RESUME || '',
  emailProvider: process.env.EMAIL_PROVIDER || 'webhook',
  brevoApiKey: process.env.BREVO_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || '',
  smtpUrl: process.env.SMTP_URL || '',
  webhookUrl: process.env.WEBHOOK_URL || '',
};
