import { config } from './config.js';
import { getUser } from './users.js';

function parseFrom(from) {
  const m = String(from).match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { name: m[1] || undefined, email: m[2] } : { email: String(from).trim() };
}

async function sendViaBrevo({ to, subject, text, attachments }, { fetchImpl }) {
  const body = {
    sender: parseFrom(config.emailFrom),
    to: [{ email: to }],
    subject,
    textContent: text,
    // Filenames arrive already normalised, from normaliseAttachments below.
    attachment: attachments.map(a => ({ name: a.filename, content: a.contentBase64 })),
  };
  if (body.attachment.length === 0) delete body.attachment;
  const res = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'api-key': config.brevoApiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`brevo responded ${res.status}`);
}

async function sendViaSmtp({ to, subject, text, attachments }, { transport }) {
  let t = transport;
  if (!t) {
    const { default: nodemailer } = await import('nodemailer');
    t = nodemailer.createTransport(config.smtpUrl);
  }
  await t.sendMail({
    from: config.emailFrom,
    to,
    subject,
    text,
    attachments: attachments.map(a => ({
      filename: a.filename,
      content: Buffer.from(a.contentBase64, 'base64'),
    })),
  });
}

async function sendViaWebhook({ to, subject, text, attachments }, { fetchImpl }) {
  const res = await fetchImpl(config.webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to, subject, text, attachments }),
  });
  if (!res.ok) throw new Error(`webhook responded ${res.status}`);
}

const PROVIDERS = { brevo: sendViaBrevo, smtp: sendViaSmtp, webhook: sendViaWebhook };

// Brevo rejects .md attachment filenames ("Unsupported file format: md") and
// 400s the whole send, which loses interview prep and the plain-text CV
// fallback. Every delivery path here ends at Brevo, either directly or through
// the n8n webhook, so normalise once for all providers rather than per
// provider: the bug this fixes was a rename that existed only in sendViaBrevo
// while production ran the webhook. The n8n "Build Email Payload" node applies
// the same rule for anything reaching it by another route.
function normaliseAttachments(attachments) {
  return attachments.map(a => {
    const name = String(a.filename || 'attachment');
    if (!name.toLowerCase().endsWith('.md')) return a;
    return { ...a, filename: `${name.slice(0, -3)}.txt` };
  });
}

export async function sendEmail({ to, subject, text, attachments = [] }, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const retryDelayMs = opts.retryDelayMs ?? 2000;
  if (!getUser(to)) {
    throw new Error(`recipient not on allowlist: ${to}`);
  }
  const provider = PROVIDERS[config.emailProvider];
  if (!provider) throw new Error(`unknown email provider: ${config.emailProvider}`);
  const safeAttachments = normaliseAttachments(attachments);
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await provider({ to, subject, text, attachments: safeAttachments }, { fetchImpl, transport: opts.transport });
      return;
    } catch (err) {
      lastErr = err;
    }
    if (attempt < 3) await new Promise(r => setTimeout(r, retryDelayMs * attempt));
  }
  throw lastErr;
}
