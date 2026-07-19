import test from 'node:test';
import assert from 'node:assert';
import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
process.env.DB_PATH = ':memory:';
// Point the user registry at a missing file so a real data/users.json on the
// host cannot shadow the ALLOWED_EMAILS fallback these tests rely on.
process.env.PORTAL_USERS_FILE = '/nonexistent-portal-users.json';
process.env.ALLOWED_EMAILS = 'owner@test.com,operator@test.com';
process.env.PROJECT_DIR = process.env.PROJECT_DIR || '/tmp/queue-test-project';
const { getDb, newId } = await import('../src/db.js');
const { enqueue, processOneJob, buildRecoveryPrompt } = await import('../src/queue.js');

function mkSession() {
  const id = newId();
  getDb().prepare("insert into sessions (id, user_email, title) values (?, 'owner@test.com', 'Test role')").run(id);
  return id;
}

test('processOneJob stores reply and resumes with session id', async () => {
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'JD text here' });
  const runTurn = async ({ prompt, resumeSessionId, user }) => {
    assert.equal(resumeSessionId, null);
    assert.ok(user);
    return { sessionId: 'claude-123', text: 'What is the salary?' };
  };
  await processOneJob({ runTurn, send: async () => {} });
  const s = getDb().prepare('select * from sessions where id = ?').get(sid);
  assert.equal(s.claude_session_id, 'claude-123');
  assert.equal(s.status, 'awaiting_reply');
  const msgs = getDb().prepare('select * from messages where session_id = ?').all(sid);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].role, 'claude');
});

test('email directive marks session done and sends', async () => {
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'reply' });
  let sent;
  const runTurn = async () => ({
    sessionId: 'c2',
    text: 'Done!\n```email-to-user\n{"subject":"S","body":"B","attachments":[]}\n```',
  });
  await processOneJob({ runTurn, send: async e => { sent = e; } });
  assert.equal(sent.subject, 'S');
  assert.equal(getDb().prepare('select status from sessions where id = ?').get(sid).status, 'done');
});

test('attachments are passed through with their original filenames', async () => {
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'reply' });
  const mdPath = join(tmpdir(), `cv-tailored-${newId()}.md`);
  const mdContent = '# CV\n\nSome tailored CV content.';
  writeFileSync(mdPath, mdContent);
  const pdfPath = join(tmpdir(), `cv-${newId()}.pdf`);
  // minimal binary content including non-UTF8 bytes, like a real PDF header
  const pdfContent = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xff, 0xfe, 0x00]);
  writeFileSync(pdfPath, pdfContent);
  const directive = JSON.stringify({ subject: 'S', body: 'B', attachments: [mdPath, pdfPath] });
  let sent;
  const runTurn = async () => ({
    sessionId: 'c3',
    text: `Done!\n\`\`\`email-to-user\n${directive}\n\`\`\``,
  });
  await processOneJob({ runTurn, send: async e => { sent = e; } });
  assert.equal(sent.attachments.length, 2);
  // any provider-specific renaming (e.g. Brevo's .md rejection) happens in the provider, not here
  assert.equal(sent.attachments[0].filename, basename(mdPath));
  assert.equal(Buffer.from(sent.attachments[0].contentBase64, 'base64').toString(), mdContent);
  assert.equal(sent.attachments[1].filename, basename(pdfPath));
  assert.ok(Buffer.from(sent.attachments[1].contentBase64, 'base64').equals(pdfContent));
});

test('failed email send still persists the claude turn and files', async () => {
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'reply' });
  const mdPath = join(tmpdir(), `cv-${newId()}.md`);
  writeFileSync(mdPath, 'cv');
  const directive = JSON.stringify({ subject: 'S', body: 'B', attachments: [mdPath] });
  const runTurn = async () => ({
    sessionId: 'c-persist',
    text: `All done.\n\`\`\`email-to-user\n${directive}\n\`\`\``,
  });
  await processOneJob({ runTurn, send: async () => { throw new Error('provider down'); } });
  const s = getDb().prepare('select * from sessions where id = ?').get(sid);
  assert.equal(s.status, 'needs_attention');
  assert.equal(s.claude_session_id, 'c-persist');
  assert.deepEqual(JSON.parse(s.files), [mdPath]);
  const msgs = getDb().prepare("select * from messages where session_id = ? and role = 'claude'").all(sid);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].body, 'All done.');
});

test('failure marks job failed and session needs_attention', async () => {
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'x' });
  await processOneJob({ runTurn: async () => { throw new Error('boom'); }, send: async () => {} });
  assert.equal(getDb().prepare('select status from sessions where id = ?').get(sid).status, 'needs_attention');
  assert.equal(getDb().prepare("select status from jobs where session_id = ?").get(sid).status, 'failed');
});

test('processOneJob passes the session user to the runner', async () => {
  // the legacy env fallback makes every allowlisted email a user whose
  // projectDir is PROJECT_DIR
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'JD text here' });
  let got;
  const runTurn = async args => { got = args; return { sessionId: 'c1', text: 'assessment' }; };
  await processOneJob({ runTurn, send: async () => {} });
  assert.equal(got.user.projectDir, process.env.PROJECT_DIR);
  assert.ok(got.user.name);
});

test('title directive updates the session title and is stripped from the message', async () => {
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'linkedin url' });
  const runTurn = async () => ({
    sessionId: 'c-title',
    text: 'Here is my assessment.\n```session-title\n{"title": "Design Director at Acme"}\n```',
  });
  await processOneJob({ runTurn, send: async () => {} });
  const s = getDb().prepare('select * from sessions where id = ?').get(sid);
  assert.equal(s.title, 'Design Director at Acme');
  const msg = getDb().prepare("select body from messages where session_id = ? and role = 'claude'").get(sid);
  assert.equal(msg.body, 'Here is my assessment.');
});

test('title longer than 80 characters is truncated to 80', async () => {
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'x' });
  const long = 'A'.repeat(120);
  const runTurn = async () => ({
    sessionId: 'c-long',
    text: `Text.\n\`\`\`session-title\n{"title": "${long}"}\n\`\`\``,
  });
  await processOneJob({ runTurn, send: async () => {} });
  assert.equal(getDb().prepare('select title from sessions where id = ?').get(sid).title, 'A'.repeat(80));
});

test('empty or missing title leaves the session title unchanged', async () => {
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'x' });
  const runTurn = async () => ({
    sessionId: 'c-empty',
    text: 'Text.\n```session-title\n{"title": "   "}\n```',
  });
  await processOneJob({ runTurn, send: async () => {} });
  assert.equal(getDb().prepare('select title from sessions where id = ?').get(sid).title, 'Test role');
});

test('a reply with both title and email blocks applies both and strips both', async () => {
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'x' });
  let sent;
  const runTurn = async () => ({
    sessionId: 'c-both',
    text: 'Pack ready.\n```session-title\n{"title": "Writer at Beta"}\n```\n```email-to-user\n{"subject":"S","body":"B","attachments":[]}\n```',
  });
  await processOneJob({ runTurn, send: async e => { sent = e; } });
  const s = getDb().prepare('select * from sessions where id = ?').get(sid);
  assert.equal(s.title, 'Writer at Beta');
  assert.equal(s.status, 'done');
  assert.equal(sent.subject, 'S');
  const msg = getDb().prepare("select body from messages where session_id = ? and role = 'claude'").get(sid);
  assert.equal(msg.body, 'Pack ready.');
});

test('buildRecoveryPrompt renders title, ordered labelled history, and the prompt last', () => {
  const out = buildRecoveryPrompt(
    { title: 'Designer at Acme' },
    [
      { role: 'user', body: 'the JD' },
      { role: 'claude', body: 'my assessment' },
      { role: 'system', body: 'housekeeping note' },
    ],
    'New reply from the portal.',
  );
  assert.match(out, /Portal session title: Designer at Acme/);
  const iUser = out.indexOf('[User] the JD');
  const iClaude = out.indexOf('[Claude] my assessment');
  const iPortal = out.indexOf('[Portal] housekeeping note');
  const iPrompt = out.indexOf('New reply from the portal.');
  assert.ok(iUser >= 0 && iClaude > iUser && iPortal > iClaude && iPrompt > iPortal);
  assert.ok(out.endsWith('New reply from the portal.'));
});

test('buildRecoveryPrompt truncates each message body to 2000 characters', () => {
  const out = buildRecoveryPrompt(
    { title: 'T' },
    [{ role: 'user', body: 'x'.repeat(2001) }],
    'p',
  );
  assert.ok(out.includes('x'.repeat(2000)));
  assert.ok(!out.includes('x'.repeat(2001)));
});
