import test from 'node:test';
import assert from 'node:assert';

const { runClaudeSdk } = await import('../src/runners/claude-sdk.js');
const { REPLY_SCHEMA } = await import('../src/agent.js');

// Real-shaped messages from @anthropic-ai/claude-agent-sdk's query() stream.
const init = { type: 'system', subtype: 'init', session_id: 'sess-1' };
const assistantText = (text, extra = {}) => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { role: 'assistant', content: [{ type: 'text', text }] },
  ...extra,
});
const toolUse = (name = 'Edit') => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name, input: {} }] },
});
const success = (result) => ({ type: 'result', subtype: 'success', result });
const structuredSuccess = (output, text = '') => ({
  type: 'result', subtype: 'success', result: text, structured_output: output,
});
const REPLY = { reply: 'One more chase tonight.', title: 'Director at Acme', awaiting_user: false, email: null };

const fakeQuery = (messages) => () => (async function* () {
  for (const m of messages) yield m;
})();

const run = (messages) =>
  runClaudeSdk(
    { prompt: 'p', systemPrompt: 's', resumeSessionId: null, cwd: '/tmp', model: 'm' },
    { queryImpl: fakeQuery(messages) },
  );

// The bug this file exists for: on 2026-08-12 the agent answered, then edited
// the tracker, then closed with a bare session-title block. result carried only
// that block, the portal stripped it as a directive, and the reply it stored
// for the user was empty.
test('keeps text the agent wrote before its tool calls', async () => {
  const prose = 'One more short chase tonight, then stop chasing.';
  const directive = '```session-title\n{"awaiting_user": false}\n```';
  const { text } = await run([
    init,
    assistantText(prose),
    toolUse(),
    assistantText(directive),
    structuredSuccess(REPLY, directive),
  ]);
  assert.match(text, /One more short chase tonight/);
  assert.match(text, /session-title/);
});

// A subagent's narration is working-out, not something to say to the user.
test('leaves subagent text out of the reply', async () => {
  const { text } = await run([
    init,
    assistantText('Searching the tracker now', { parent_tool_use_id: 'toolu_1' }),
    assistantText('Here is the fit assessment.'),
    structuredSuccess(REPLY, 'Here is the fit assessment.'),
  ]);
  assert.equal(text, 'Here is the fit assessment.');
});

test('an empty text block adds no blank space to the reply', async () => {
  const { text } = await run([init, assistantText(''), assistantText('The verdict.'), structuredSuccess(REPLY, 'The verdict.')]);
  assert.equal(text, 'The verdict.');
});

// The old runner read msg.result alone. Keeping it as the fallback means this
// one can never return less than the old one did.
test('falls back to the result text when no assistant message carried any', async () => {
  const { text } = await run([init, toolUse(), structuredSuccess(REPLY, 'Delivered.')]);
  assert.equal(text, 'Delivered.');
});

test('throws when the turn did not end in success', async () => {
  await assert.rejects(
    run([init, assistantText('half an answer'), { type: 'result', subtype: 'error_max_turns' }]),
    /error_max_turns/,
  );
});

test('reports the session id from the init message', async () => {
  const { sessionId } = await run([init, assistantText('hello'), structuredSuccess(REPLY, 'hello')]);
  assert.equal(sessionId, 'sess-1');
});

test('declares the reply schema as the output format', async () => {
  let seen;
  const capture = (args) => {
    seen = args;
    return (async function* () { yield init; yield structuredSuccess(REPLY, 'hi'); })();
  };
  await runClaudeSdk(
    { prompt: 'p', systemPrompt: 's', resumeSessionId: null, cwd: '/tmp', model: 'm' },
    { queryImpl: capture },
  );
  assert.equal(seen.options.outputFormat.type, 'json_schema');
  assert.deepEqual(seen.options.outputFormat.schema, REPLY_SCHEMA);
});

/* The schema lives in its own module so that agent.js and the runners no
   longer import each other. That cycle worked only because every runner is a
   hoisted function declaration; rewriting one as an arrow constant would have
   thrown a TDZ ReferenceError in exactly this file's import order. agent.js
   still re-exports it, so imports written against the old home keep working. */
test('the agent re-export and the schema module are the same object', async () => {
  const { REPLY_SCHEMA: fromModule } = await import('../src/reply-schema.js');
  assert.strictEqual(fromModule, REPLY_SCHEMA);
});

test('returns the structured reply when the SDK supplies one', async () => {
  const { structured } = await run([init, assistantText('narration'), structuredSuccess(REPLY)]);
  assert.deepEqual(structured, REPLY);
});

/* This runner always asks for REPLY_SCHEMA, and it prompts the agent with the
   structured protocol, so a turn that comes back without structured_output has
   no fenced blocks in its text either: queue.js would title nothing, send
   nothing, and show a Reply badge on every session while looking healthy.
   Failing here routes it to needs_attention with an admin email instead. */
test('throws when a schema was requested and no structured output came back', async () => {
  await assert.rejects(
    run([init, assistantText('plain answer'), success('plain answer')]),
    (err) => {
      assert.match(err.message, /structured_output/);
      assert.match(err.message, /sess-1/);
      assert.match(err.message, /0\.3\.207/);
      return true;
    },
  );
});

test('throws naming the subtype when structured output retries are exhausted', async () => {
  await assert.rejects(
    run([init, { type: 'result', subtype: 'error_max_structured_output_retries' }]),
    /error_max_structured_output_retries/,
  );
});

const { UsageLimitError } = await import('../src/usage-limit.js');

// A stream that yields some messages and then fails the way the SDK does when
// the account limit is hit: by throwing from the iterator.
const failingQuery = (messages, error) => () => (async function* () {
  for (const m of messages) yield m;
  throw error;
})();
const runFailing = (messages, error) =>
  runClaudeSdk(
    { prompt: 'p', systemPrompt: 's', resumeSessionId: null, cwd: '/tmp', model: 'm' },
    { queryImpl: failingQuery(messages, error) },
  );

test('a rejected rate_limit_event before the failure gives an exact UsageLimitError', async () => {
  const event = {
    type: 'rate_limit_event', session_id: 'sess-1', uuid: 'u1',
    rate_limit_info: { status: 'rejected', resetsAt: 1790554200, rateLimitType: 'five_hour' },
  };
  await assert.rejects(
    runFailing([init, event], new Error("Claude Code returned an error result: You've hit your session limit · resets 12:10am (UTC)")),
    err => err instanceof UsageLimitError && err.exact === true && err.limitType === 'session'
      && err.resetsAt.getTime() === 1790554200 * 1000,
  );
});

test('an allowed rate_limit_event does not by itself make a failure a usage limit', async () => {
  const event = {
    type: 'rate_limit_event', session_id: 'sess-1', uuid: 'u1',
    rate_limit_info: { status: 'allowed_warning', resetsAt: 1790554200, rateLimitType: 'five_hour' },
  };
  await assert.rejects(
    runFailing([init, event], new Error('boom')),
    err => !(err instanceof UsageLimitError) && err.message === 'boom',
  );
});

test('the limit text alone gives an estimated UsageLimitError', async () => {
  await assert.rejects(
    runFailing([init], new Error("Claude Code returned an error result: You've hit your weekly limit · resets 7am (UTC)")),
    err => err instanceof UsageLimitError && err.exact === false && err.limitType === 'weekly'
      && err.resetsAt instanceof Date,
  );
});

test('an assistant rate_limit error then a failed result is a usage limit', async () => {
  await assert.rejects(
    run([init, assistantText('API Error', { error: 'rate_limit' }), { type: 'result', subtype: 'error_during_execution' }]),
    err => err instanceof UsageLimitError && err.resetsAt === null,
  );
});

test('an unrelated failure is rethrown unchanged', async () => {
  const original = new Error('socket hang up');
  await assert.rejects(runFailing([init], original), err => err === original);
});

test('an is_error result carrying the limit text is a usage limit, even if the SDK never throws', async () => {
  // How 0.3.283 reports it: a "success" result marked is_error, whose text is
  // the limit message. The SDK's own throw only follows if the CLI exits non-zero.
  const limitResult = {
    type: 'result', subtype: 'success', is_error: true,
    result: "You've hit your session limit · resets 12:10am (UTC)",
  };
  await assert.rejects(
    run([init, limitResult]),
    err => err instanceof UsageLimitError && err.limitType === 'session' && err.resetsAt instanceof Date,
  );
});
