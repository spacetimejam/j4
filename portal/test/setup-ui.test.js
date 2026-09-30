import test from 'node:test';
import assert from 'node:assert';
const { attachNote, appendNote, firstMessageNotice } = await import('../public/setup.js');

test('attachNote names the saved path', () => {
  assert.equal(attachNote('core/source/cv.pdf'), "I've attached my CV: core/source/cv.pdf");
});

test('appendNote adds the note on its own line after any draft text', () => {
  assert.equal(appendNote('', 'N'), 'N');
  assert.equal(appendNote('Here you go', 'N'), 'Here you go\nN');
  assert.equal(appendNote('Here you go\n', 'N'), 'Here you go\nN');
});

test('firstMessageNotice shows only while the first setup message is on its way', () => {
  const waiting = firstMessageNotice({ kind: 'setup', status: 'working', messages: [] });
  assert.match(waiting, /getting things set up/);
  assert.match(waiting, /can take a minute or so/);
  assert.match(waiting, /That's normal/);
  assert.equal(firstMessageNotice({ kind: 'setup', status: 'working', messages: [{ role: 'claude', body: 'Hello' }] }), '');
  assert.equal(firstMessageNotice({ kind: 'setup', status: 'awaiting_reply', messages: [] }), '');
  assert.equal(firstMessageNotice({ kind: 'application', status: 'working', messages: [] }), '');
});
