import test from 'node:test';
import assert from 'node:assert';
const { attachNote, appendNote } = await import('../public/setup.js');

test('attachNote names the saved path', () => {
  assert.equal(attachNote('core/source/cv.pdf'), "I've attached my CV: core/source/cv.pdf");
});

test('appendNote adds the note on its own line after any draft text', () => {
  assert.equal(appendNote('', 'N'), 'N');
  assert.equal(appendNote('Here you go', 'N'), 'Here you go\nN');
  assert.equal(appendNote('Here you go\n', 'N'), 'Here you go\nN');
});
