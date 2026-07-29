import test from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, join, delimiter } from 'node:path';

process.env.DB_PATH = ':memory:';
process.env.AGENT_RUNNER = 'codex';
delete process.env.AGENT_MODEL;
const { parseCodexEvents, buildCodexArgs, runCodex } =
  await import('../src/runners/codex.js');

const FIXTURE_BIN = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bin');

// Real-shaped events, taken from the documented codex exec --json stream.
const THREAD = '{"type":"thread.started","thread_id":"th_abc123"}';
const TURN_STARTED = '{"type":"turn.started"}';
const CMD = '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls","aggregated_output":"","exit_code":null,"status":"in_progress"}}';
const MSG = '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"Fit assessment ready."}}';
const TURN_DONE = '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":3}}';

test('reads the thread id from thread.started.thread_id', () => {
  const { threadId } = parseCodexEvents([THREAD, TURN_STARTED, MSG, TURN_DONE]);
  assert.equal(threadId, 'th_abc123');
});

test('falls back to thread.started.id when thread_id is absent', () => {
  const { threadId } = parseCodexEvents(['{"type":"thread.started","id":"th_legacy"}', MSG]);
  assert.equal(threadId, 'th_legacy');
});

test('reads the reply from an agent_message item', () => {
  const { text } = parseCodexEvents([THREAD, CMD, MSG, TURN_DONE]);
  assert.equal(text, 'Fit assessment ready.');
});

test('the last agent_message wins', () => {
  const first = '{"type":"item.completed","item":{"id":"a","type":"agent_message","text":"first"}}';
  const second = '{"type":"item.completed","item":{"id":"b","type":"agent_message","text":"second"}}';
  assert.equal(parseCodexEvents([first, second]).text, 'second');
});

test('item.completed of another item type never becomes the reply', () => {
  const fileChange = '{"type":"item.completed","item":{"id":"c","type":"file_change","changes":[{"path":"cv.yaml","kind":"update"}],"status":"completed"}}';
  const { text } = parseCodexEvents([THREAD, fileChange, TURN_DONE]);
  assert.equal(text, null);
});

test('turn.failed sets failure from error.message', () => {
  const failed = '{"type":"turn.failed","error":{"message":"model response stream ended unexpectedly"}}';
  const { failure } = parseCodexEvents([THREAD, failed]);
  assert.equal(failure, 'model response stream ended unexpectedly');
});

test('a bare error event sets failure from message', () => {
  const { failure } = parseCodexEvents([THREAD, '{"type":"error","message":"stream error: broken pipe"}']);
  assert.equal(failure, 'stream error: broken pipe');
});

test('turn.failed takes precedence over an earlier bare error', () => {
  const bare = '{"type":"error","message":"transient hiccup"}';
  const failed = '{"type":"turn.failed","error":{"message":"the real reason"}}';
  assert.equal(parseCodexEvents([bare, failed]).failure, 'the real reason');
});

test('a bare error after turn.failed does not overwrite it', () => {
  const failed = '{"type":"turn.failed","error":{"message":"the real reason"}}';
  const bare = '{"type":"error","message":"noise afterwards"}';
  assert.equal(parseCodexEvents([failed, bare]).failure, 'the real reason');
});

test('a non-JSON line is discarded and does not stop a later success', () => {
  const noise = 'warning: config key `foo` is deprecated';
  const { text, failure } = parseCodexEvents([noise, THREAD, MSG, TURN_DONE]);
  assert.equal(text, 'Fit assessment ready.');
  assert.equal(failure, null);
});

test('blank lines are ignored', () => {
  const { text } = parseCodexEvents(['', '   ', THREAD, MSG]);
  assert.equal(text, 'Fit assessment ready.');
});

test('an empty stream yields nothing at all', () => {
  assert.deepEqual(parseCodexEvents([]), { threadId: null, text: null, failure: null });
});

const PROMPT = 'system rules\n\njob advert text';

test('a new session builds the documented exec argv', () => {
  const args = buildCodexArgs({
    resumeSessionId: null, model: 'gpt-5-codex', modelExplicit: false, fullPrompt: PROMPT,
  });
  assert.deepEqual(args, [
    'exec', '--json',
    '--sandbox', 'danger-full-access',
    '--skip-git-repo-check',
    PROMPT,
  ]);
});

test('an explicit model adds --model, in that position', () => {
  const args = buildCodexArgs({
    resumeSessionId: null, model: 'gpt-5-codex', modelExplicit: true, fullPrompt: PROMPT,
  });
  assert.deepEqual(args, [
    'exec', '--json',
    '--sandbox', 'danger-full-access',
    '--skip-git-repo-check',
    '--model', 'gpt-5-codex',
    PROMPT,
  ]);
});

test('no --model anywhere when the model was not set explicitly', () => {
  const args = buildCodexArgs({
    resumeSessionId: null, model: 'claude-opus-5', modelExplicit: false, fullPrompt: PROMPT,
  });
  assert.equal(args.includes('--model'), false);
  assert.equal(args.includes('claude-opus-5'), false);
});

test('resuming uses the exec resume subcommand with the id in third position', () => {
  const args = buildCodexArgs({
    resumeSessionId: 'th_abc123', model: 'gpt-5-codex', modelExplicit: false, fullPrompt: PROMPT,
  });
  assert.deepEqual(args, [
    'exec', 'resume', 'th_abc123', '--json',
    '--sandbox', 'danger-full-access',
    '--skip-git-repo-check',
    PROMPT,
  ]);
});

test('the prompt is always the final argument, on both paths', () => {
  for (const resumeSessionId of [null, 'th_abc123']) {
    const args = buildCodexArgs({
      resumeSessionId, model: 'gpt-5-codex', modelExplicit: true, fullPrompt: PROMPT,
    });
    assert.equal(args[args.length - 1], PROMPT);
  }
});

// A fake child process. `chunks` are written to stdout in order, so a test
// can split a JSON line across two of them.
function fakeSpawn({ chunks = [], stderr = '', exitCode = 0, spawnError = null } = {}) {
  const calls = [];
  const impl = (bin, args, opts) => {
    calls.push({ bin, args, opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      if (spawnError) { child.emit('error', spawnError); return; }
      for (const chunk of chunks) child.stdout.emit('data', Buffer.from(chunk));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', exitCode);
    });
    return impl.child = child;
  };
  impl.calls = calls;
  return impl;
}

const TURN = { prompt: 'job advert', systemPrompt: 'portal rules', resumeSessionId: null, cwd: '/tmp', model: 'gpt-5-codex' };

test('a well-formed stream yields the session id and the reply', async () => {
  const spawnImpl = fakeSpawn({ chunks: [[THREAD, TURN_STARTED, CMD, MSG, TURN_DONE].join('\n') + '\n'] });
  const out = await runCodex(TURN, { spawnImpl });
  assert.equal(out.sessionId, 'th_abc123');
  assert.equal(out.text, 'Fit assessment ready.');
});

test('the system prompt is prepended to the prompt', async () => {
  const spawnImpl = fakeSpawn({ chunks: [[THREAD, MSG].join('\n') + '\n'] });
  await runCodex(TURN, { spawnImpl });
  const args = spawnImpl.calls[0].args;
  assert.equal(args[args.length - 1], 'portal rules\n\njob advert');
});

test('it spawns codex in the session cwd', async () => {
  const spawnImpl = fakeSpawn({ chunks: [[THREAD, MSG].join('\n') + '\n'] });
  await runCodex(TURN, { spawnImpl });
  assert.equal(spawnImpl.calls[0].bin, 'codex');
  assert.equal(spawnImpl.calls[0].opts.cwd, '/tmp');
});

test('a JSON line split across two chunks still parses', async () => {
  const line = MSG + '\n';
  const spawnImpl = fakeSpawn({
    chunks: [THREAD + '\n' + line.slice(0, 40), line.slice(40)],
  });
  const out = await runCodex(TURN, { spawnImpl });
  assert.equal(out.text, 'Fit assessment ready.');
});

test('a final line with no trailing newline is not dropped', async () => {
  const spawnImpl = fakeSpawn({ chunks: [THREAD + '\n' + MSG] });
  const out = await runCodex(TURN, { spawnImpl });
  assert.equal(out.text, 'Fit assessment ready.');
});

test('resuming carries the previous session id when no thread.started arrives', async () => {
  const spawnImpl = fakeSpawn({ chunks: [MSG + '\n'] });
  const out = await runCodex({ ...TURN, resumeSessionId: 'th_old' }, { spawnImpl });
  assert.equal(out.sessionId, 'th_old');
  assert.deepEqual(spawnImpl.calls[0].args.slice(0, 3), ['exec', 'resume', 'th_old']);
});

test('ENOENT throws an error naming codex and PATH', async () => {
  const spawnError = Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
  const spawnImpl = fakeSpawn({ spawnError });
  await assert.rejects(() => runCodex(TURN, { spawnImpl }), /codex was not found on PATH/);
});

test('a non-zero exit throws with the stderr text included', async () => {
  const spawnImpl = fakeSpawn({ chunks: [], stderr: 'not logged in', exitCode: 1 });
  await assert.rejects(() => runCodex(TURN, { spawnImpl }), /codex exited 1: not logged in/);
});

test('turn.failed throws rather than returning an empty reply', async () => {
  const failed = '{"type":"turn.failed","error":{"message":"context window exceeded"}}';
  const spawnImpl = fakeSpawn({ chunks: [[THREAD, failed].join('\n') + '\n'] });
  await assert.rejects(() => runCodex(TURN, { spawnImpl }), /context window exceeded/);
});

test('exit 0 with no agent_message throws rather than storing empty text', async () => {
  const spawnImpl = fakeSpawn({ chunks: [[THREAD, TURN_STARTED, TURN_DONE].join('\n') + '\n'] });
  await assert.rejects(() => runCodex(TURN, { spawnImpl }), /no agent_message/);
});

test('fixture: a real spawn of a codex stand-in on PATH works end to end', async () => {
  const originalPath = process.env.PATH;
  process.env.PATH = `${FIXTURE_BIN}${delimiter}${originalPath}`;
  try {
    const out = await runCodex(TURN);
    assert.equal(out.sessionId, 'th_fixture_1');
    assert.equal(out.text, 'Fixture reply.');
  } finally {
    process.env.PATH = originalPath;
  }
});
