/* Talk instead of typing. The page records, turns the recording into 16 kHz
   PCM itself, posts it to /api/transcribe, and puts the text in the box for
   the person to check before sending. Nothing is sent on their behalf.

   Every string this file puts on the page is a constant defined here. The
   transcript goes into textarea.value only, never into innerHTML: the portal
   is served with no CSP.

   Spec: docs/superpowers/specs/2026-09-30-portal-speech-to-text-design.md */

export const MAX_SECONDS = 600;
const WARN_SECONDS = MAX_SECONDS - 60;
const SAMPLE_RATE = 16000;

const pad = n => String(n).padStart(2, '0');

export function formatTimer(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/* How long the person has waited so far, not an estimate of time left. */
export function transcribingLabel(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return s < 60 ? `Transcribing (${s}s)` : `Transcribing (${Math.floor(s / 60)}m ${pad(s % 60)}s)`;
}

export const RECORDING_NOTICE = 'Recording. Take your time: the more detail you give, the better Jawbs does. You can talk for up to ten minutes. Press the button again when you have finished.';
export const LAST_MINUTE_NOTICE = 'One minute left. Finish your thought and press the button.';
export const FULL_NOTICE = 'That was the full ten minutes, so the recording stopped. Press the mic again to carry on.';

export const recordingNotice = seconds => (seconds >= WARN_SECONDS ? LAST_MINUTE_NOTICE : RECORDING_NOTICE);

export const ERRORS = {
  denied: "Jawbs could not use your microphone. Allow it in your browser's address bar, then press the mic again.",
  'no-mic': 'No microphone was found on this device.',
  silence: 'Jawbs did not catch any speech in that. Press the mic to try again.',
  busy: "Jawbs is busy with someone else's recording. Try again in a minute.",
  unreadable: 'Sorry, that recording could not be read. Press the mic to try again.',
  failed: 'Sorry, that could not be turned into text.',
};

/* Spoken text goes after whatever is already in the box, as a new paragraph. */
export const appendTranscript = (existing, text) =>
  (existing.trim() ? `${existing.replace(/\s+$/, '')}\n\n${text}` : text);

export function floatToPcm16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    out[i] = v < 0 ? v * 32768 : v * 32767;
  }
  return out;
}
