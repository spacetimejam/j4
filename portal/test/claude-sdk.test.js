import test from 'node:test';
import assert from 'node:assert';

const { runClaudeSdk } = await import('../src/runners/claude-sdk.js');

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
    success(directive),
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
    success('Here is the fit assessment.'),
  ]);
  assert.equal(text, 'Here is the fit assessment.');
});

test('an empty text block adds no blank space to the reply', async () => {
  const { text } = await run([init, assistantText(''), assistantText('The verdict.'), success('The verdict.')]);
  assert.equal(text, 'The verdict.');
});

// The old runner read msg.result alone. Keeping it as the fallback means this
// one can never return less than the old one did.
test('falls back to the result text when no assistant message carried any', async () => {
  const { text } = await run([init, toolUse(), success('Delivered.')]);
  assert.equal(text, 'Delivered.');
});

test('throws when the turn did not end in success', async () => {
  await assert.rejects(
    run([init, assistantText('half an answer'), { type: 'result', subtype: 'error_max_turns' }]),
    /error_max_turns/,
  );
});

test('reports the session id from the init message', async () => {
  const { sessionId } = await run([init, assistantText('hello'), success('hello')]);
  assert.equal(sessionId, 'sess-1');
});
