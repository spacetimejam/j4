import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSubmitChord } from '../public/keys.js';

const chord = over => ({
  key: 'Enter',
  metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
  repeat: false, isComposing: false,
  ...over,
});

test('accepts Cmd+Enter and Ctrl+Enter', () => {
  assert.equal(isSubmitChord(chord({ metaKey: true })), true);
  assert.equal(isSubmitChord(chord({ ctrlKey: true })), true);
});

test('ignores Enter with no modifier, so it still inserts a newline', () => {
  assert.equal(isSubmitChord(chord({})), false);
  assert.equal(isSubmitChord(chord({ shiftKey: true })), false);
});

test('ignores the chord when Alt or Shift is also held', () => {
  assert.equal(isSubmitChord(chord({ metaKey: true, altKey: true })), false);
  assert.equal(isSubmitChord(chord({ metaKey: true, shiftKey: true })), false);
  assert.equal(isSubmitChord(chord({ ctrlKey: true, shiftKey: true })), false);
  // AltGr on Windows and European layouts reports as Ctrl+Alt, so this must not submit.
  assert.equal(isSubmitChord(chord({ ctrlKey: true, altKey: true })), false);
});

test('ignores other keys held with the modifier', () => {
  assert.equal(isSubmitChord(chord({ key: 'k', metaKey: true })), false);
  assert.equal(isSubmitChord(chord({ key: 'a', ctrlKey: true })), false);
});

test('ignores an auto-repeating held chord', () => {
  assert.equal(isSubmitChord(chord({ metaKey: true, repeat: true })), false);
});

test('ignores Enter that is confirming an IME composition', () => {
  assert.equal(isSubmitChord(chord({ metaKey: true, isComposing: true })), false);
});
