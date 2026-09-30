import test from 'node:test';
import assert from 'node:assert';
const {
  MAX_SECONDS, formatTimer, transcribingLabel, recordingNotice, RECORDING_NOTICE, LAST_MINUTE_NOTICE,
  FULL_NOTICE, ERRORS, appendTranscript, floatToPcm16,
} = await import('../public/dictate.js');

test('the limit is ten minutes', () => {
  assert.equal(MAX_SECONDS, 600);
});

test('formatTimer shows minutes and seconds, two digits each', () => {
  assert.equal(formatTimer(0), '00:00');
  assert.equal(formatTimer(7.9), '00:07');
  assert.equal(formatTimer(59.99), '00:59');
  assert.equal(formatTimer(60), '01:00');
  assert.equal(formatTimer(187), '03:07');
  assert.equal(formatTimer(600), '10:00');
  assert.equal(formatTimer(-3), '00:00');
});

test('transcribingLabel counts the wait so far', () => {
  assert.equal(transcribingLabel(0), 'Transcribing (0s)');
  assert.equal(transcribingLabel(12.4), 'Transcribing (12s)');
  assert.equal(transcribingLabel(59.9), 'Transcribing (59s)');
  assert.equal(transcribingLabel(60), 'Transcribing (1m 00s)');
  assert.equal(transcribingLabel(65), 'Transcribing (1m 05s)');
  assert.equal(transcribingLabel(-1), 'Transcribing (0s)');
});

test('the recording notice encourages detail and names the ten-minute limit', () => {
  assert.equal(recordingNotice(0), RECORDING_NOTICE);
  assert.equal(recordingNotice(539.9), RECORDING_NOTICE);
  assert.match(RECORDING_NOTICE, /the more detail you give, the better Jawbs does/);
  assert.match(RECORDING_NOTICE, /up to ten minutes/);
});

test('the notice changes for the last minute', () => {
  assert.equal(recordingNotice(540), LAST_MINUTE_NOTICE);
  assert.equal(recordingNotice(599), LAST_MINUTE_NOTICE);
  assert.match(LAST_MINUTE_NOTICE, /One minute left/);
  assert.match(FULL_NOTICE, /full ten minutes/);
});

test('every message is plain text with no markup in it', () => {
  for (const s of [RECORDING_NOTICE, LAST_MINUTE_NOTICE, FULL_NOTICE, ...Object.values(ERRORS)]) {
    assert.doesNotMatch(s, /[<>&]/, s);
  }
  assert.deepEqual(Object.keys(ERRORS).sort(), ['busy', 'denied', 'failed', 'no-mic', 'silence', 'unreadable']);
});

test('appendTranscript fills an empty box and adds to a used one after a blank line', () => {
  assert.equal(appendTranscript('', 'Hello.'), 'Hello.');
  assert.equal(appendTranscript('   \n', 'Hello.'), 'Hello.');
  assert.equal(appendTranscript('Typed first', 'Then spoken.'), 'Typed first\n\nThen spoken.');
  assert.equal(appendTranscript('Typed first\n\n\n', 'Then spoken.'), 'Typed first\n\nThen spoken.');
});

test('floatToPcm16 scales to 16-bit and clamps anything out of range', () => {
  assert.deepEqual(Array.from(floatToPcm16(new Float32Array([0, 1, -1, 0.5, -0.5, 2, -2]))),
    [0, 32767, -32768, 16383, -16384, 32767, -32768]);
  assert.equal(floatToPcm16(new Float32Array(0)).length, 0);
});
