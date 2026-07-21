import test from 'node:test';
import assert from 'node:assert';
process.env.DB_PATH = ':memory:';
process.env.AGENT_RUNNER = 'cli';
process.env.AGENT_CMD = 'fake-agent --output-format json --model {model}';
process.env.AGENT_CMD_RESUME = 'fake-agent --output-format json --resume {sessionId}';
const { parseEmailDirective, parseTitleDirective, runAgentTurn, portalPrompt } = await import('../src/agent.js');
const { runCli } = await import('../src/runners/cli.js');

test('extracts email directive and strips it from text', () => {
  const text = 'All done!\n\n```email-to-user\n{"subject":"Your CV","body":"Here you go","attachments":["/tmp/a.md"]}\n```';
  const { clean, email } = parseEmailDirective(text);
  assert.equal(clean.trim(), 'All done!');
  assert.equal(email.subject, 'Your CV');
  assert.deepEqual(email.attachments, ['/tmp/a.md']);
});

test('returns null email when no directive', () => {
  const { clean, email } = parseEmailDirective('Just a question?');
  assert.equal(email, null);
  assert.equal(clean, 'Just a question?');
});

test('malformed JSON yields null email, keeps text', () => {
  const { email } = parseEmailDirective('x\n```email-to-user\nnot json\n```');
  assert.equal(email, null);
});

test('extracts email directive when the agent appends content after the block', () => {
  const text = 'All done!\n\n```email-to-user\n{"subject":"Your CV","body":"Here you go","attachments":["/tmp/a.md"]}\n```\n\nSources: [a](https://x)';
  const { clean, email } = parseEmailDirective(text);
  assert.equal(email.subject, 'Your CV');
  assert.equal(clean, 'All done!\n\nSources: [a](https://x)');
});

test('runAgentTurn selects the configured runner and passes the contract fields', async () => {
  let seen;
  const runners = { cli: async args => { seen = args; return { sessionId: 's1', text: 'hi' }; } };
  const out = await runAgentTurn(
    { prompt: 'JD text', resumeSessionId: null, user: { name: 'Test', projectDir: process.env.PROJECT_DIR || '/tmp' } },
    { runners },
  );
  assert.deepEqual(out, { sessionId: 's1', text: 'hi' });
  assert.equal(seen.prompt, 'JD text');
  assert.equal(seen.resumeSessionId, null);
  assert.ok(seen.systemPrompt.includes('email-to-user'));
  assert.ok(seen.cwd);
  assert.ok(seen.model);
});

test('runAgentTurn rejects an unknown runner', async () => {
  await assert.rejects(runAgentTurn({ prompt: 'x' }, { runners: {} }), /unknown agent runner/);
});

test('runAgentTurn runs in the user projectDir with a personalised prompt', async () => {
  let got;
  const fake = async args => { got = args; return { sessionId: 's1', text: 'ok' }; };
  await runAgentTurn(
    { prompt: 'p', resumeSessionId: null, user: { name: 'Bob', projectDir: '/tmp/bobproj' } },
    { runners: { [process.env.AGENT_RUNNER || 'claude-sdk']: fake } }
  );
  assert.equal(got.cwd, '/tmp/bobproj');
  assert.match(got.systemPrompt, /Bob/);
  assert.doesNotMatch(got.systemPrompt, /the owner/);
});

function fakeSpawn({ stdout = '', code = 0 } = {}) {
  const calls = [];
  const spawnImpl = (bin, args, opts) => {
    const handlers = {};
    const child = {
      stdout: { on: (ev, fn) => { if (ev === 'data') child._out = fn; } },
      stderr: { on: () => {} },
      on: (ev, fn) => { handlers[ev] = fn; },
      stdin: {
        end: input => {
          calls.push({ bin, args, opts, input });
          queueMicrotask(() => {
            if (stdout) child._out(stdout);
            handlers.close(code);
          });
        },
      },
    };
    return child;
  };
  return { spawnImpl, calls };
}

test('cli runner substitutes {model}, pipes prompt to stdin, parses JSON output', async () => {
  const json = JSON.stringify({ result: 'Final answer', session_id: 'sess-42' });
  const { spawnImpl, calls } = fakeSpawn({ stdout: json });
  const out = await runCli(
    { prompt: 'JD here', systemPrompt: 'SYS', resumeSessionId: null, cwd: '/tmp', model: 'model-x' },
    { spawnImpl },
  );
  assert.deepEqual(out, { sessionId: 'sess-42', text: 'Final answer' });
  assert.equal(calls[0].bin, 'fake-agent');
  assert.deepEqual(calls[0].args, ['--output-format', 'json', '--model', 'model-x']);
  assert.equal(calls[0].opts.cwd, '/tmp');
  assert.ok(calls[0].input.startsWith('SYS'));
  assert.ok(calls[0].input.includes('JD here'));
});

test('cli runner uses the resume template and carries sessionId over raw-text output', async () => {
  const { spawnImpl, calls } = fakeSpawn({ stdout: 'plain text reply\n' });
  const out = await runCli(
    { prompt: 'notes', systemPrompt: 'SYS', resumeSessionId: 'sess-42', cwd: '/tmp', model: 'model-x' },
    { spawnImpl },
  );
  assert.deepEqual(out, { sessionId: 'sess-42', text: 'plain text reply' });
  assert.deepEqual(calls[0].args, ['--output-format', 'json', '--resume', 'sess-42']);
});

test('cli runner rejects on a non-zero exit code', async () => {
  const { spawnImpl } = fakeSpawn({ stdout: '', code: 1 });
  await assert.rejects(
    runCli({ prompt: 'x', systemPrompt: 'S', resumeSessionId: null, cwd: '/tmp', model: 'm' }, { spawnImpl }),
    /exited 1/,
  );
});

test('prompt includes a post-application stage 3', () => {
  const p = portalPrompt('Test');
  assert.match(p, /STAGE 3: AFTER APPLYING/);
  assert.match(p, /Date_Applied is filled in/);
});

test('stage 3 handles interviews: tracker, log, numbered prep files, email delivery', () => {
  const p = portalPrompt('Test');
  assert.match(p, /Status = Interviewing/);
  assert.match(p, /log\.md/);
  assert.match(p, /interview-1-prep\.md, interview-2-prep\.md/);
  assert.match(p, /complete prep in your reply/);
  assert.match(p, /followed by an email-to-user block[\s\S]{0,80}attaching the prep file/);
});

test('stage 3 asks for missing interview essentials instead of guessing', () => {
  const p = portalPrompt('Test');
  assert.match(p, /do not build\s+prep on guesswork/i);
});

test('stage 3 routes rejections to learnings without an email block', () => {
  const p = portalPrompt('Test');
  assert.match(p, /Status to Turned down/);
  assert.match(p, /core\/learnings\.md/);
  assert.match(p, /Rejection:[\s\S]*?No email block/);
});

test('stage 3 covers offers and general correspondence', () => {
  const p = portalPrompt('Test');
  assert.match(p, /Status to Interviewing and record the offer in the notes/);
  assert.match(p, /Next_Action and Next_Action_Date current/);
});

test('parseTitleDirective extracts and strips a trailing title block', () => {
  const text = 'Assessment here.\n```session-title\n{"title": "Designer at Acme"}\n```';
  const { clean, title } = parseTitleDirective(text);
  assert.equal(title, 'Designer at Acme');
  assert.equal(clean, 'Assessment here.');
});

test('parseTitleDirective returns null title on malformed JSON', () => {
  const text = 'Text.\n```session-title\n{not json}\n```';
  const { clean, title } = parseTitleDirective(text);
  assert.equal(title, null);
  assert.equal(clean, 'Text.');
});

test('parseTitleDirective returns null when absent or title missing', () => {
  assert.equal(parseTitleDirective('Just text.').title, null);
  assert.equal(parseTitleDirective('Just text.').clean, 'Just text.');
  const missing = parseTitleDirective('T.\n```session-title\n{"role": "x"}\n```');
  assert.equal(missing.title, null);
});

test('parseTitleDirective extracts the title when the agent appends a Sources section after the block', () => {
  const text = 'Would you like to apply anyway, or shall I log it as Withdrawn?\n\n'
    + '```session-title\n{"title": "Digital Director at Goodstuff"}\n```\n\n'
    + 'Sources: [Goodstuff salaries](https://example.com/salaries)';
  const { clean, title } = parseTitleDirective(text);
  assert.equal(title, 'Digital Director at Goodstuff');
  assert.equal(clean, 'Would you like to apply anyway, or shall I log it as Withdrawn?\n\nSources: [Goodstuff salaries](https://example.com/salaries)');
});

test('portal prompt instructs the session-title block', () => {
  assert.match(portalPrompt('Sam'), /session-title/);
});
