import test from 'node:test';
import assert from 'node:assert';
process.env.DB_PATH = ':memory:';
process.env.ALLOWED_EMAILS = 'owner@test.com';
process.env.EMAIL_FROM = 'Portal <portal@test.com>';
process.env.BREVO_API_KEY = 'brevo-key';
process.env.WEBHOOK_URL = 'http://hooks.test/portal-email';
const { config } = await import('../src/config.js');
const { sendEmail } = await import('../src/email.js');

test('rejects non-allowlisted recipient', async () => {
  config.emailProvider = 'webhook';
  await assert.rejects(sendEmail({ to: 'evil@test.com', subject: 'x', text: 'x' }), /allowlist/);
});

test('webhook provider posts the payload as JSON', async () => {
  config.emailProvider = 'webhook';
  let seen;
  const fetchImpl = async (url, opts) => { seen = { url, body: JSON.parse(opts.body) }; return { ok: true }; };
  await sendEmail({ to: 'owner@test.com', subject: 'Hi', text: 'Body' }, { fetchImpl });
  assert.equal(seen.url, 'http://hooks.test/portal-email');
  assert.equal(seen.body.to, 'owner@test.com');
});

test('brevo provider posts the Brevo shape and renames .md attachments to .txt', async () => {
  config.emailProvider = 'brevo';
  let seen;
  const fetchImpl = async (url, opts) => { seen = { url, headers: opts.headers, body: JSON.parse(opts.body) }; return { ok: true }; };
  await sendEmail({
    to: 'owner@test.com',
    subject: 'Hi',
    text: 'Body',
    attachments: [
      { filename: 'cv-tailored.md', contentBase64: Buffer.from('cv').toString('base64') },
      { filename: 'cv.pdf', contentBase64: Buffer.from('pdf').toString('base64') },
    ],
  }, { fetchImpl });
  assert.equal(seen.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(seen.headers['api-key'], 'brevo-key');
  assert.deepEqual(seen.body.sender, { name: 'Portal', email: 'portal@test.com' });
  assert.deepEqual(seen.body.to, [{ email: 'owner@test.com' }]);
  assert.equal(seen.body.subject, 'Hi');
  assert.equal(seen.body.textContent, 'Body');
  assert.equal(seen.body.attachment[0].name, 'cv-tailored.txt');
  assert.equal(seen.body.attachment[1].name, 'cv.pdf');
  assert.equal(Buffer.from(seen.body.attachment[0].content, 'base64').toString(), 'cv');
});

test('smtp provider sends via the injected transport with Buffer attachments', async () => {
  config.emailProvider = 'smtp';
  let seen;
  const transport = { sendMail: async msg => { seen = msg; } };
  await sendEmail({
    to: 'owner@test.com',
    subject: 'Hi',
    text: 'Body',
    attachments: [{ filename: 'cv.pdf', contentBase64: Buffer.from('pdf').toString('base64') }],
  }, { transport });
  assert.equal(seen.from, 'Portal <portal@test.com>');
  assert.equal(seen.to, 'owner@test.com');
  assert.equal(seen.attachments[0].filename, 'cv.pdf');
  assert.ok(Buffer.isBuffer(seen.attachments[0].content));
  assert.equal(seen.attachments[0].content.toString(), 'pdf');
});

test('retries 3 times then throws', async () => {
  config.emailProvider = 'webhook';
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: false, status: 500 }; };
  await assert.rejects(sendEmail({ to: 'owner@test.com', subject: 'x', text: 'x' }, { fetchImpl, retryDelayMs: 1 }));
  assert.equal(calls, 3);
});

test('unknown provider throws without retrying', async () => {
  config.emailProvider = 'pigeon';
  await assert.rejects(sendEmail({ to: 'owner@test.com', subject: 'x', text: 'x' }), /unknown email provider/);
  config.emailProvider = 'webhook';
});
