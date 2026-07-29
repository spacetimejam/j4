import test from 'node:test';
import assert from 'node:assert';
import { parseCodexEvents } from '../src/runners/codex.js';

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
