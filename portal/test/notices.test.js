import { test } from 'node:test';
import assert from 'node:assert/strict';
const { delayedNotice } = await import('../public/notices.js');

test('the usage-limit notice is unchanged', () => {
  const html = delayedNotice({ kind: 'usage_limit', resetsAt: null, exact: false, limitType: 'session' });
  assert.match(html, /Your reply is delayed/);
  assert.match(html, /id="retry"/);
});

test('a drafting limit says the draft is waiting on the writing service', () => {
  const html = delayedNotice({ kind: 'drafting', draftingKind: 'usage_limit', resetsAt: null, exact: false, limitType: 'unknown' });
  assert.match(html, /Your draft is waiting/);
  assert.match(html, /has reached its limit/);
  assert.match(html, /id="retry"/);
});

test('any other drafting block says the service is not available, and never names the vendor', () => {
  for (const draftingKind of ['auth', 'error']) {
    const html = delayedNotice({ kind: 'drafting', draftingKind, resetsAt: null, exact: false, limitType: 'unknown' });
    assert.match(html, /isn't available right now/);
    assert.doesNotMatch(html, /codex|gpt|chatgpt|openai/i);
  }
});

test('signed out on your own computer says how to sign in', () => {
  const html = delayedNotice({ kind: 'signed_out' }, new Date(), { local: true });
  assert.match(html, /isn't connected to Claude/);
  assert.match(html, /claude auth login/);
  assert.match(html, /id="retry"/);
});

test('signed out on a shared Jawbs says the person who runs it has been told', () => {
  const html = delayedNotice({ kind: 'signed_out' });
  assert.match(html, /has been told/);
  assert.doesNotMatch(html, /claude auth login/);
  assert.match(html, /id="retry"/);
});

test('a signed-out writer on your own computer names ChatGPT and gives the command', () => {
  const html = delayedNotice({ kind: 'drafting', draftingKind: 'auth', resetsAt: null, exact: false, limitType: 'unknown' },
    new Date(), { local: true });
  assert.match(html, /ChatGPT/);
  assert.match(html, /codex login/);
  assert.match(html, /id="retry"/);
});

test('other drafting blocks on your own computer keep the unnamed wording', () => {
  const html = delayedNotice({ kind: 'drafting', draftingKind: 'error', resetsAt: null, exact: false, limitType: 'unknown' },
    new Date(), { local: true });
  assert.match(html, /isn't available right now/);
  assert.doesNotMatch(html, /codex|chatgpt/i);
});
