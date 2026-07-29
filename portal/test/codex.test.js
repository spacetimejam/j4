import test from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { dirname, join, delimiter } from 'node:path';

process.env.DB_PATH = ':memory:';
process.env.AGENT_RUNNER = 'codex';
// Set to '' rather than deleted: config.js starts with `import 'dotenv/config'`,
// which would repopulate AGENT_MODEL from a real portal/.env on a live host
// (dotenv does not override a key already present in process.env). An empty
// string is still falsy for agentModelExplicit, so the effect is the same,
// but it stays correct even where .env exists.
process.env.AGENT_MODEL = '';
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

test('an empty agent_message is treated as no reply, not a blank one', () => {
  const empty = '{"type":"item.completed","item":{"id":"e","type":"agent_message","text":""}}';
  const { text } = parseCodexEvents([THREAD, empty, TURN_DONE]);
  assert.equal(text, null);
});

test('a whitespace-only agent_message is treated as no reply', () => {
  const whitespace = '{"type":"item.completed","item":{"id":"w","type":"agent_message","text":"   \\n  "}}';
  const { text } = parseCodexEvents([THREAD, whitespace, TURN_DONE]);
  assert.equal(text, null);
});

test('a non-empty agent_message after an empty one still wins', () => {
  const empty = '{"type":"item.completed","item":{"id":"e","type":"agent_message","text":""}}';
  assert.equal(parseCodexEvents([empty, MSG]).text, 'Fit assessment ready.');
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
// can split a JSON line across two of them; a chunk may be a string or a
// Buffer, so a test can also split a multi-byte character's raw bytes at an
// arbitrary offset rather than a JS string index (which cannot land inside a
// single BMP character). setEncoding is simulated with the same StringDecoder
// Node's real streams use internally, so an incomplete multi-byte sequence at
// the end of one chunk is held back and completed by the next, matching what
// runCodex's `child.stdout.setEncoding('utf8')` does against a real process.
function fakeSpawn({ chunks = [], stderr = '', exitCode = 0, spawnError = null } = {}) {
  const calls = [];
  const impl = (bin, args, opts) => {
    calls.push({ bin, args, opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    let decoder = null;
    child.stdout.setEncoding = encoding => { decoder = new StringDecoder(encoding); };
    child.stderr = new EventEmitter();
    setImmediate(() => {
      if (spawnError) { child.emit('error', spawnError); return; }
      for (const chunk of chunks) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        child.stdout.emit('data', decoder ? decoder.write(buf) : buf);
      }
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

test('a multi-byte character split across a chunk boundary survives intact', async () => {
  // The existing chunk-split test above only pins line splitting, since ASCII
  // decodes the same whether a chunk is cut cleanly or not. This pins the
  // actual UTF-8 hazard: without child.stdout.setEncoding('utf8'), splitting
  // a chunk mid-character would decode each half independently and each
  // would turn into a replacement character, which still parses as valid
  // JSON and would silently corrupt the reply.
  const text = 'Salary: £45,000 for the café role.'; // a pound sign and an accented e, both multi-byte in UTF-8
  const msg = JSON.stringify({ type: 'item.completed', item: { id: 'm', type: 'agent_message', text } });
  const line = Buffer.from(THREAD + '\n' + msg + '\n', 'utf8');
  const poundIndex = line.indexOf(Buffer.from('£', 'utf8'));
  const splitAt = poundIndex + 1; // between the pound sign's two UTF-8 bytes
  const spawnImpl = fakeSpawn({ chunks: [line.subarray(0, splitAt), line.subarray(splitAt)] });
  const out = await runCodex(TURN, { spawnImpl });
  assert.equal(out.text, text);
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

test('a non-zero exit with a parsed turn.failed and empty stderr surfaces the parsed reason', async () => {
  // The untested combination: previously the code !== 0 branch rejected
  // before sink.result() was ever consulted, so this case produced
  // "codex exited 1: " with nothing after the colon, even though codex had
  // reported exactly why on stdout.
  const failed = '{"type":"turn.failed","error":{"message":"rate limited, retry later"}}';
  const spawnImpl = fakeSpawn({
    chunks: [[THREAD, failed].join('\n') + '\n'], stderr: '', exitCode: 1,
  });
  await assert.rejects(() => runCodex(TURN, { spawnImpl }), /codex exited 1: rate limited, retry later/);
});

test('a non-zero exit with neither a parsed failure nor stderr says so rather than leaving a blank', async () => {
  const spawnImpl = fakeSpawn({ chunks: [], stderr: '', exitCode: 1 });
  await assert.rejects(() => runCodex(TURN, { spawnImpl }), /codex exited 1: no output/);
});

test('E2BIG throws an error naming the argv size limit', async () => {
  const spawnError = Object.assign(new Error('spawn codex E2BIG'), { code: 'E2BIG' });
  const spawnImpl = fakeSpawn({ spawnError });
  await assert.rejects(() => runCodex(TURN, { spawnImpl }), /too large to pass on the command line/);
  await assert.rejects(() => runCodex(TURN, { spawnImpl }), /128\s*KB/);
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

test('fixture: a real spawn of a codex stand-in on PATH works end to end and receives the documented argv', async () => {
  const originalPath = process.env.PATH;
  process.env.PATH = `${FIXTURE_BIN}${delimiter}${originalPath}`;
  // The fixture script echoes its argv to stderr specifically so this test
  // can pin it. Wrap the real spawn rather than replacing it, so the process
  // plumbing under test is exactly what runCodex uses with no spawnImpl
  // injected, and just tap the stderr stream on the side.
  const { spawn: realSpawn } = await import('node:child_process');
  let capturedStderr = '';
  const spawnImpl = (bin, args, opts) => {
    const child = realSpawn(bin, args, opts);
    child.stderr.on('data', d => { capturedStderr += d; });
    return child;
  };
  try {
    const out = await runCodex(TURN, { spawnImpl });
    assert.equal(out.sessionId, 'th_fixture_1');
    assert.equal(out.text, 'Fixture reply.');
    const expectedArgs = buildCodexArgs({
      resumeSessionId: null, model: TURN.model, modelExplicit: false,
      fullPrompt: `${TURN.systemPrompt}\n\n${TURN.prompt}`,
    });
    assert.equal(capturedStderr.trim(), `argv: ${expectedArgs.join(' ')}`);
  } finally {
    process.env.PATH = originalPath;
  }
});
