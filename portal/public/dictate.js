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
  /* Firefox on a Mac reports "not found", not "not allowed", when macOS itself
     has not let Firefox use the microphone, so this cannot only say none exists. */
  'no-mic': 'Jawbs could not find a microphone. If this computer has one, it may not be letting your browser use it. On a Mac: open System Settings, then Privacy and Security, then Microphone, switch it on for your browser, and restart the browser.',
  silence: 'Jawbs did not catch any speech in that. Press the mic to try again.',
  busy: "Jawbs is busy with someone else's recording. Try again in a minute.",
  unreadable: 'Sorry, that recording could not be read. Press the mic to try again.',
  failed: 'Sorry, that could not be turned into text.',
};

/* Spoken text goes after whatever is already in the box, as a new paragraph. */
export const appendTranscript = (existing, text) =>
  (existing.trim() ? `${existing.replace(/\s+$/, '')}\n\n${text}` : text);

/* The ten-minute stop rides on a timer, and a browser may hold timers back in
   a background tab. A recording that overran would be over the portal's size
   limit and refused every time, Try again included, which would lose exactly
   the long answer this exists for. So anything past ten minutes is cut here. */
export const capSamples = samples =>
  (samples.length > MAX_SECONDS * SAMPLE_RATE ? samples.subarray(0, MAX_SECONDS * SAMPLE_RATE) : samples);

export function floatToPcm16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    out[i] = v < 0 ? v * 32768 : v * 32767;
  }
  return out;
}

const MIC_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v4"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>';
const RETRY = ' <button type="button" class="linkish dictate-retry">Try again</button>';

/* The recorder's state lives here, not in the DOM: the ten-second poll while a
   session is working rewrites app.innerHTML, and app.js attaches a fresh
   button after every render. Same reasoning as the document panel.

   `run` is bumped whenever the person starts again or leaves the page, and
   every step that waits checks it afterwards, so a late answer from an
   abandoned recording is dropped instead of landing in another conversation. */
const state = { phase: 'idle', page: '', startedAt: 0, waitingSince: 0, error: null, note: '', pcm: null };
let run = 0;
let recorder = null;
let stream = null;
let chunks = [];
let ticker = null;
let ui = null;
/* The request in flight, so leaving can cancel it: the portal then stops
   transcribing a clip nobody is waiting for. */
let sending = null;

const pageKey = () => location.hash;

function supported() {
  return typeof MediaRecorder !== 'undefined' && typeof OfflineAudioContext !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia) && Boolean(window.AudioContext || window.webkitAudioContext);
}

/* Adds the mic button above `anchor` (the Send button) and its notice under
   the text box. Called after every render; does nothing in a browser that
   cannot record. */
export function attachDictation(textarea, anchor) {
  if (!textarea || !anchor || !supported()) return;
  const button = document.createElement('button');
  button.type = 'button';
  anchor.before(button);
  const notice = document.createElement('div');
  notice.className = 'dictate-notice';
  notice.setAttribute('aria-live', 'polite');
  textarea.after(notice);
  ui = { textarea, button, notice, phase: null, time: null, shownNotice: null };
  button.onclick = () => {
    if (state.phase === 'recording') stopRecording(false);
    else if (state.phase === 'idle') startRecording();
  };
  notice.onclick = e => { if (e.target.closest('.dictate-retry')) retry(); };
  paint();
}

/* Called when the person moves to another page. Stops a recording, releases
   the microphone and abandons anything still being transcribed. */
export function leaveDictation() {
  run++;
  sending?.abort();
  sending = null;
  if (recorder && recorder.state !== 'inactive') {
    recorder.onstop = null;
    recorder.stop();
  }
  recorder = null;
  chunks = [];
  releaseMic();
  stopTicking();
  Object.assign(state, { phase: 'idle', error: null, note: '', pcm: null });
  ui = null;
}

function releaseMic() {
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
}

function startTicking() {
  if (!ticker) ticker = setInterval(tick, 250);
}

function stopTicking() {
  clearInterval(ticker);
  ticker = null;
}

function tick() {
  if (state.phase === 'recording' && (Date.now() - state.startedAt) / 1000 >= MAX_SECONDS) stopRecording(true);
  paint();
}

function paint() {
  if (!ui || !ui.button.isConnected) return;
  const { button } = ui;
  if (ui.phase !== state.phase) {
    /* Rebuilt only when the phase changes, so a press that lands between two
       ticks is never on an element that has just been replaced. The children
       take no pointer events (style.css) for the same reason. */
    ui.phase = state.phase;
    button.className = `secondary dictate${state.phase === 'recording' ? ' recording' : ''}`;
    button.disabled = state.phase === 'transcribing';
    if (state.phase === 'recording') {
      button.innerHTML = `${STOP_ICON}<span>Stop recording</span><small class="dictate-time"></small>`;
      button.setAttribute('aria-label', 'Stop recording');
    } else if (state.phase === 'transcribing') {
      button.innerHTML = '<small class="dictate-time"></small>';
      button.setAttribute('aria-label', 'Transcribing your recording');
    } else {
      button.innerHTML = `${MIC_ICON}<span>Speak your answer</span>`;
      button.setAttribute('aria-label', 'Speak your answer');
    }
    ui.time = button.querySelector('.dictate-time');
  }
  let notice = '';
  if (state.phase === 'recording') {
    const seconds = (Date.now() - state.startedAt) / 1000;
    ui.time.textContent = formatTimer(seconds);
    ui.time.classList.toggle('warn', seconds >= WARN_SECONDS);
    notice = recordingNotice(seconds);
  } else if (state.phase === 'transcribing') {
    ui.time.textContent = transcribingLabel((Date.now() - state.waitingSince) / 1000);
    notice = state.note;
  } else if (state.error) {
    notice = ERRORS[state.error] + (state.pcm ? RETRY : '');
  } else {
    notice = state.note;
  }
  /* Compared against what was last written, so the live region announces a
     change once rather than four times a second. */
  if (ui.shownNotice !== notice) {
    ui.notice.innerHTML = notice;
    ui.shownNotice = notice;
  }
}

function settle(error) {
  state.phase = 'idle';
  state.error = error;
  stopTicking();
  paint();
}

async function startRecording() {
  const mine = ++run;
  sending?.abort();
  sending = null;
  Object.assign(state, { error: null, note: '', pcm: null });
  paint();
  let granted;
  try {
    granted = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    if (mine !== run) return;
    return settle(err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError' ? 'no-mic' : 'denied');
  }
  if (mine !== run) {
    granted.getTracks().forEach(t => t.stop());
    return;
  }
  stream = granted;
  chunks = [];
  const rec = new MediaRecorder(granted);
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => finish(mine, rec.mimeType);
  rec.start(1000);
  recorder = rec;
  Object.assign(state, { phase: 'recording', page: pageKey(), startedAt: Date.now() });
  startTicking();
  paint();
}

function stopRecording(full) {
  if (state.phase !== 'recording' || !recorder) return;
  Object.assign(state, { phase: 'transcribing', waitingSince: Date.now(), note: full ? FULL_NOTICE : '' });
  recorder.stop();
  releaseMic();
  paint();
}

async function finish(mine, mimeType) {
  const blob = new Blob(chunks, { type: mimeType });
  chunks = [];
  recorder = null;
  if (mine !== run) return;
  let pcm;
  try {
    pcm = await toPcm16(blob);
  } catch {
    if (mine === run) settle('unreadable');
    return;
  }
  if (mine !== run) return;
  if (!pcm.length) return settle('silence');
  if (pcm.length >= MAX_SECONDS * SAMPLE_RATE) state.note = FULL_NOTICE;
  state.pcm = pcm;
  send(mine);
}

/* The browser decodes its own recording (WebM Opus in Chrome and Firefox, MP4
   AAC in Safari) and resamples it, so the portal needs no audio converter. */
async function toPcm16(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    return floatToPcm16(capSamples((await offline.startRendering()).getChannelData(0)));
  } finally {
    ctx.close();
  }
}

async function send(mine) {
  let r;
  try {
    /* An Int16Array is sent in the machine's byte order, which is
       little-endian on everything a browser runs on, as the portal expects. */
    sending = new AbortController();
    r = await fetch('/api/transcribe', {
      method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: state.pcm, signal: sending.signal,
    });
  } catch {
    if (mine === run) settle('failed');
    return;
  }
  if (mine !== run) return;
  if (r.status === 503) return settle('busy');
  if (!r.ok) return settle('failed');
  const out = await r.json().catch(() => ({}));
  if (mine !== run) return;
  /* The answer is in, so the recording is no longer needed. Until here it is
     kept so a failure can be retried without speaking it all again. */
  state.pcm = null;
  const text = typeof out.text === 'string' ? out.text.trim() : '';
  if (!text) return settle('silence');
  if (ui?.textarea.isConnected && state.page === pageKey()) {
    const box = ui.textarea;
    box.value = appendTranscript(box.value, text);
    box.focus();
    box.scrollTop = box.scrollHeight;
  }
  settle(null);
}

function retry() {
  if (state.phase !== 'idle' || !state.pcm) return;
  Object.assign(state, { phase: 'transcribing', waitingSince: Date.now(), error: null });
  startTicking();
  paint();
  send(run);
}
