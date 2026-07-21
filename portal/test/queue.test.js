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

test('failed resumed turn retries once fresh with a recovery prompt and heals the session', async () => {
  const sid = mkSession();
  getDb().prepare("update sessions set claude_session_id = 'stale-id' where id = ?").run(sid);
  getDb().prepare('insert into messages (id, session_id, role, body) values (?, ?, ?, ?)')
    .run(newId(), sid, 'user', 'original JD text');
  enqueue({ sessionId: sid, prompt: 'Nat replies via the portal:\n\nany news?' });
  const calls = [];
  const runTurn = async args => {
    calls.push(args);
    if (args.resumeSessionId) throw new Error('agent turn failed: error_during_execution');
    return { sessionId: 'fresh-id', text: 'Re-oriented and replied.' };
  };
  await processOneJob({ runTurn, send: async () => {} });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].resumeSessionId, 'stale-id');
  assert.equal(calls[1].resumeSessionId, null);
  assert.match(calls[1].prompt, /Portal session title: Test role/);
  assert.match(calls[1].prompt, /\[User\] original JD text/);
  assert.match(calls[1].prompt, /any news\?$/);
  const s = getDb().prepare('select * from sessions where id = ?').get(sid);
  assert.equal(s.claude_session_id, 'fresh-id');
  assert.equal(s.status, 'awaiting_reply');
  assert.equal(getDb().prepare('select status from jobs where session_id = ?').get(sid).status, 'done');
});

test('failed resumed turn whose fresh retry also fails goes to needs_attention', async () => {
  const sid = mkSession();
  getDb().prepare("update sessions set claude_session_id = 'stale-id' where id = ?").run(sid);
  enqueue({ sessionId: sid, prompt: 'x' });
  let count = 0;
  const runTurn = async () => { count++; throw new Error('boom'); };
  await processOneJob({ runTurn, send: async () => {} });
  assert.equal(count, 2);
  assert.equal(getDb().prepare('select status from sessions where id = ?').get(sid).status, 'needs_attention');
  assert.equal(getDb().prepare('select status from jobs where session_id = ?').get(sid).status, 'failed');
});

test('failed fresh turn is not retried', async () => {
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'x' });
  let count = 0;
  const runTurn = async () => { count++; throw new Error('boom'); };
  await processOneJob({ runTurn, send: async () => {} });
  assert.equal(count, 1);
  assert.equal(getDb().prepare('select status from sessions where id = ?').get(sid).status, 'needs_attention');
});

test('each delivery adds documents rows while files keeps only the latest', async () => {
  const sid = mkSession();
  const first = join(tmpdir(), `cv-${newId()}.pdf`);
  const second = join(tmpdir(), `letter-${newId()}.pdf`);
  writeFileSync(first, 'one');
  writeFileSync(second, 'two');

  enqueue({ sessionId: sid, prompt: 'first' });
  await processOneJob({
    runTurn: async () => ({
      sessionId: 'c-d1',
      text: `Done.\n\`\`\`email-to-user\n${JSON.stringify({ subject: 'S', body: 'B', attachments: [first] })}\n\`\`\``,
    }),
    send: async () => {},
  });

  enqueue({ sessionId: sid, prompt: 'second' });
  await processOneJob({
    runTurn: async () => ({
      sessionId: 'c-d2',
      text: `Done.\n\`\`\`email-to-user\n${JSON.stringify({ subject: 'S', body: 'B', attachments: [second] })}\n\`\`\``,
    }),
    send: async () => {},
  });

  const paths = getDb().prepare('select path from documents where session_id = ? order by path').all(sid).map(r => r.path);
  assert.deepEqual(paths.sort(), [first, second].sort());
  // files still holds the latest delivery only, which deriveApplicationFolder relies on
  assert.deepEqual(JSON.parse(getDb().prepare('select files from sessions where id = ?').get(sid).files), [second]);
});

test('redelivering the same path keeps one row and moves its date forward', async () => {
  const sid = mkSession();
  const p = join(tmpdir(), `cv-${newId()}.pdf`);
  writeFileSync(p, 'v1');
  const directive = JSON.stringify({ subject: 'S', body: 'B', attachments: [p] });
  const runTurn = async () => ({ sessionId: 'c-re', text: `Done.\n\`\`\`email-to-user\n${directive}\n\`\`\`` });

  enqueue({ sessionId: sid, prompt: 'first' });
  await processOneJob({ runTurn, send: async () => {} });
  const before = getDb().prepare('select delivered_at from documents where session_id = ?').get(sid).delivered_at;

  // rewind the stored date so the update is observable without waiting a second
  getDb().prepare("update documents set delivered_at = '2020-01-01 00:00:00' where session_id = ?").run(sid);

  enqueue({ sessionId: sid, prompt: 'again' });
  await processOneJob({ runTurn, send: async () => {} });

  const rows = getDb().prepare('select * from documents where session_id = ?').all(sid);
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].delivered_at, '2020-01-01 00:00:00');
  assert.ok(rows[0].delivered_at >= before);
});

test('a failed email send still records the documents', async () => {
  const sid = mkSession();
  const p = join(tmpdir(), `cv-${newId()}.pdf`);
  writeFileSync(p, 'x');
  enqueue({ sessionId: sid, prompt: 'x' });
  await processOneJob({
    runTurn: async () => ({
      sessionId: 'c-fail',
      text: `Done.\n\`\`\`email-to-user\n${JSON.stringify({ subject: 'S', body: 'B', attachments: [p] })}\n\`\`\``,
    }),
    send: async () => { throw new Error('provider down'); },
  });
  assert.equal(getDb().prepare('select count(*) c from documents where session_id = ?').get(sid).c, 1);
});
