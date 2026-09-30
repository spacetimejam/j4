# Speech to text: talk to Jawbs instead of typing

Date: 2026-09-30. Status: design approved in conversation, awaiting spec review.

## Intent

Jawbs does better with long, detailed answers, and those are easier to say out
loud than to type. The owner wants a microphone on the portal's text boxes that
copes equally with a quick sentence and a ten-minute account of a job.

Agreed in conversation:

1. **Both uses matter equally**: quick replies and long spoken answers (setup
   and career-step interviews). One control on every text box.
2. **It matters more on a person's own computer than on the shared portal**,
   though both get it. So the transcriber must install alongside the portal on
   a Mac or Linux computer of unknown speed, with no Python and no account.
3. **Speech is turned into text by the portal itself**, with an open model, not
   by the browser's built-in dictation, an extension or a paid service. On a
   person's own computer the audio never leaves the machine. Free of charge.
4. **Optional, asked during own-computer setup**, with the benefit and the
   costs spelled out. A one-off download of this size is acceptable.
5. **While recording, the page encourages the person to keep talking**, for up
   to ten minutes and no longer, and shows a small mm:ss timer by the mic.

Success: someone in a career-step interview presses the mic, talks for six
minutes, presses it again, and about half a minute later their words are in the
reply box, punctuated, for them to correct and send. Someone who said no at
setup sees no mic and pays nothing in disk, memory or processor time.

## What was ruled out, and why

Checked by web search and a timing test on 2026-09-30.

- **The browser's built-in dictation** (Web Speech API). Off by default in
  Firefox and listed as unsupported in Edge; Chrome and Safari send the audio
  to Google and Apple. Chrome's on-device mode (139 onwards) is experimental.
- **A dictation extension.** Most wrap the same browser recogniser, none run in
  Chrome on a phone, everyone has to install one, and they ask to read every
  page.
- **A hosted transcription service.** Cheap and accurate, but it needs an API
  key and pay-per-use billing, which the kit has avoided, and sends voices to a
  third party.
- **A model running inside the browser page.** Private and serverless, but a
  40 to 240 MB download per device and weak on phones. Not needed once the
  portal can do it.

## The model

NVIDIA Parakeet TDT 0.6b v3, the int8 ONNX build published by the sherpa-onnx
project, run through the `sherpa-onnx-node` npm package (Apache-2.0; ready-built
for macOS arm64 and x64, Linux x64 and arm64, Windows). The model card gives the
licence as CC-BY-4.0: confirm when implementing and add the attribution to
`docs/portal.md`.

Measured on beep (i5-7500T, four cores, no graphics card, already carrying its
normal load), on a five-minute LibriVox recording by a British reader, scored
against the Project Gutenberg text:

| Model | Time | Word errors | Peak memory |
|---|---|---|---|
| Parakeet v3 int8 | 25 s | 2.1% | 1.0 GB |
| Whisper small.en int8 | 117 s | 1.9% | 1.4 GB |
| Whisper base.en int8 | 39 s | 3.3% | 0.8 GB |
| Moonshine base int8 | 17 s | 4.0% | 0.8 GB |

Parakeet on two threads took 30 s. Loading the model takes about 3 s. A
one-minute clip took 5 s. Moonshine dropped most punctuation on long stretches.

Limits of that test: clean audiobook narration, one speaker. Spontaneous speech
into a laptop microphone will score worse. Only the Linux build has been run.

**Chunking is part of the accuracy.** Fed one fragment per pause, Parakeet's
errors rose from 2.1% to 5.0%. The worker therefore splits speech at pauses
with Silero VAD and packs neighbouring pieces into windows of up to 25 seconds
before decoding each window.

Files, both from the sherpa-onnx `asr-models` release, with the SHA-256 pinned
in the install script:

| File | Size | SHA-256 |
|---|---|---|
| `sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2` | 487 MB (641 MB unpacked) | `5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf` |
| `silero_vad.onnx` | 0.6 MB | `9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6` |

## Setup

### The question

Own-computer mode only (`JAWBS_CHOICE=browser`), straight after the writer
question in `setup/setup.sh`. The shared portal and terminal mode are not
asked, as with the writer.

```
Would you like to talk to Jawbs as well as type?

  Jawbs does its best work when you give it long answers with plenty of
  detail, and those are far easier to say out loud than to type. With this
  on, each text box gets a microphone button. You talk, and your words
  appear in the box for you to check before sending.

  It is free of charge. There is no subscription and nothing to pay. Your
  voice is turned into text on this computer and never leaves it.

  What it costs: a one-off download of about 490 MB, which takes about
  640 MB of disk space. While it turns your speech into text, usually under
  a minute, your computer works hard and uses about 1 GB of memory. The
  rest of the time it uses nothing.

  1) Yes, set it up
  2) No thanks (you can switch it on later)
```

- No pre-selected answer: `ask_menu` already requires a choice.
- The answer is the wizard variable `SPEECH` (`yes` or `no`), substituted into
  `setup/SETUP.md.tmpl` as `- Speech: {{SPEECH}}` beside `- Writer:`.
- An answers file with no `SPEECH` records `no`. Terminal and shared modes
  record `not asked`. Any other value is an error, as with `WRITER`.
- A project from before the question has no `Speech:` line and is treated as
  `no`.

### `setup/jawbs-speech.sh`

One script that switches speech on, used three ways: called by
`jawbs-local.sh` when `Speech: yes`, run by the owner on beep, and run later by
anyone who said no. Bash 3.2 compatible.

1. Check the speech library loads (`node -e "require('sherpa-onnx-node')"` from
   `portal/`). It is an optional dependency, so `npm ci` has already installed
   it where a build exists. If it does not load, say that speech is not
   available on this computer and stop.
2. Download the two files into `portal/data/speech/` (already gitignored) with
   `curl`, to a temporary name, verify the SHA-256 (`shasum -a 256` or
   `sha256sum`, whichever exists), unpack, then move into place. A finished
   install is detected and skipped, so a rerun is quick.
3. Set `SPEECH_TO_TEXT=on` in the portal `.env`, replacing an existing line or
   appending one, through a temporary file (no `sed -i`).
4. Say what happened in plain words, including the command to run again after
   a failure.

It never stops setup. `jawbs-local.sh` calls it after `write_local_env`, prints
a line if it failed, and carries on with speech off. `write_local_env` never
overwrites an existing `.env`, so the setting survives a rerun.

`jawbs-speech.sh off` sets `SPEECH_TO_TEXT=off` and leaves the model on disk.

Test hooks: `JAWBS_ENV_FILE` (exists), `JAWBS_SPEECH_DIR`, and
`JAWBS_SPEECH_URL_BASE` with `JAWBS_SPEECH_SHA_MODEL` and `JAWBS_SPEECH_SHA_VAD`,
so the tests serve tiny fixture files from a `file://` directory and never
download the model or touch the real `.env`.

## Portal, server side

### Config and preflight

- `config.speech`: `SPEECH_TO_TEXT=on` (default off). `config.speechDir`:
  `SPEECH_MODEL_DIR`, default `portal/data/speech`.
- `speechReady(cfg)` in `speech.js`: on, the library resolves, and the model
  files exist. Checked once at start-up.
- Preflight warns, and does not refuse, when speech is on but not ready. A
  refusal would turn a missing file into an outage.
- `/api/meta` adds `speech: true` only when ready. The page shows no mic
  otherwise.

### `POST /api/transcribe`

- Behind `requireAuth`. In local mode the existing `localHostGuard` covers it:
  Host check on every route, Origin check on writes.
- Body: raw 16 kHz mono 16-bit little-endian PCM, `application/octet-stream`,
  through `express.raw` with a 20 MB limit (ten minutes is 19.2 MB).
- Refuses with 404 when speech is not ready, 400 for an empty or odd-length
  body, 413 over the limit.
- Returns `{ text }`. An empty string is a valid answer (silence).
- The audio lives in memory for the length of the request. It is never written
  to disk and never logged. The log records the duration and time taken only.

### `portal/src/speech.js`

- `transcribe(pcmBuffer)` returns a promise of the text.
- Runs one clip at a time through a promise chain. At most three may wait;
  a fourth gets 503 and the page says Jawbs is busy with someone else's
  recording and to try again in a minute.
- Each clip spawns `node speech-worker.js`, writes the PCM to its stdin, and
  reads one JSON line from stdout. The process exits when done, which gives the
  memory back. A five-minute timeout kills it and rejects.
- A separate process is load-bearing, not tidiness: the decoder is a
  synchronous native call, and inside the portal process it would freeze every
  request for the 25 seconds it runs.

### `portal/src/speech-worker.js`

Reads PCM from stdin, converts to float samples, runs Silero VAD (0.4 s minimum
silence, 20 s maximum piece), packs pieces into windows of up to 25 s, decodes
each window with Parakeet, joins the text with spaces, and prints
`{"text": "..."}`. Threads: the machine's core count, capped at four. Errors go
to stderr with a non-zero exit.

### Dependency

`sherpa-onnx-node` in `optionalDependencies` of `portal/package.json`, pinned
to the version tested (1.13.8 on 2026-09-30). About 32 MB. Optional so that a
platform with no build still installs the portal; only the worker imports it.

## Portal, browser side

### `portal/public/dictate.js`

`attachDictation(textarea, anchorButton)` adds the mic control beside a text
box. `app.js` calls it for `#jd` and `#reply` when `/api/meta` reported
`speech: true` and the browser has `navigator.mediaDevices.getUserMedia` and
`MediaRecorder`. Otherwise nothing is added.

The recorder's state lives in the module, not in the DOM, and the control is
re-attached after every render, because the ten-second poll while a session is
`working` rewrites `app.innerHTML`. The same reasoning as the document panel.

States of the control:

| State | Mic button | Beside it | Notice under the box |
|---|---|---|---|
| Idle | mic icon, "Speak your answer" | nothing | none |
| Recording | stop icon, highlighted | `mm:ss` timer, small font | the encouragement below |
| Transcribing | disabled | "Transcribing (12s)", counting up | none |
| Failed | mic icon | nothing | the error, with Try again |

The timer counts up from `00:00` in small muted type immediately beside the
mic. In the last minute it takes the warning colour.

The recording notice:

> Recording. Take your time: the more detail you give, the better Jawbs does.
> You can talk for up to ten minutes. Press the button again when you have
> finished.

At `09:00` the notice changes to "One minute left. Finish your thought and
press the button." At `10:00` the recording stops itself and goes to
transcribing, with the note "That was the full ten minutes, so the recording
stopped. Press the mic again to carry on."

While the recording is being turned into text, the place the timer occupied
reads "Transcribing (12s)", in the same small muted type, and the number goes
up every second. It shows the person that something is happening and how long
they have waited so far. The count starts the moment the recording stops, so
it covers the conversion in the browser, the upload, any wait in the queue and
the transcription itself, because that is the wait the person experiences. It
is a count of time waited, not an estimate of time left. From one minute it
reads "Transcribing (1m 05s)". The counter runs in the module like the
recording timer, so a poll re-render does not reset it.

Recording and conversion:

1. `getUserMedia({ audio: true })`, then `MediaRecorder` with the browser's
   default format (WebM Opus in Chrome and Firefox, MP4 AAC in Safari).
2. On stop, release the microphone, then `decodeAudioData` on the recording
   and an `OfflineAudioContext` at 16 kHz mono to resample it, and pack the
   result as 16-bit PCM. The portal then needs no audio converter installed.
3. `POST /api/transcribe` with the PCM.
4. Append the text to the box: at the end of what is there, separated by a
   blank line if the box is not empty. Found by element id at that moment, so a
   re-render in between does not lose it. Focus the box. Nothing is sent.

Not losing a long answer:

- If the upload or transcription fails, the PCM is kept in the module and the
  notice offers Try again, which resends the same audio without re-recording.
  It is dropped when the person records again or leaves the conversation.
- `renderSession` carries the reply box's text across a poll re-render. Today
  the poll silently empties the box, which was tolerable for a typed line and
  is not for a ten-minute transcript.
- Leaving the conversation while recording stops the recording and releases
  the microphone.

Messages, all plain and under the box, never an `alert`:

- Microphone refused: "Jawbs could not use your microphone. Allow it in your
  browser's address bar, then press the mic again."
- No microphone found: "No microphone was found on this device."
- Nothing heard: "Jawbs did not catch any speech in that. Press the mic to try
  again."
- Busy (503): as above.
- Anything else: "Sorry, that could not be turned into text." with Try again.

Microphone access needs a secure page. The shared portal is HTTPS and the local
portal is `http://localhost`, which browsers treat as secure, so both qualify.

### Styling

In `style.css`, using the existing colour variables: the mic button matches the
secondary button, the timer is small and muted, and the recording state has a
visible highlight that does not rely on colour alone (the icon changes too).
The button has an `aria-label` that changes with the state, and the notice is
an `aria-live="polite"` region.

## Out of scope

- Words appearing live while speaking. The model runs after the recording.
- Reading replies aloud.
- Keeping the audio. Only the text survives.
- A choice of model or language setting. Parakeet v3 detects the language
  among the 25 it supports.
- Windows. The wizard is bash; nothing here is added for it.
- The terminal mode. Claude Code has its own input.
- A portal menu item to switch speech on. `jawbs-speech.sh` is the way.

## Testing

Portal (`npm test`, node:test):

- `speech.js` with the worker command stubbed: returns text, runs one at a
  time, refuses the fourth waiter, kills and rejects on timeout, rejects on a
  non-zero exit.
- `/api/transcribe`: 404 when not ready, 400 for empty and odd-length bodies,
  413 over the limit, sign-in required, returns the stub's text.
- `/api/meta` reports `speech` only when ready.
- Preflight warns and does not refuse when on but not ready.
- The window-packing function in the worker, as a pure function over piece
  lengths: never over 25 s, order kept, nothing dropped.
- `dictate.js` pure parts: `formatTimer`, the notice for a given elapsed time,
  the transcribing label for a given wait ("Transcribing (12s)",
  "Transcribing (1m 05s)"), and appending text to an empty and a non-empty box.

Setup (`bash setup/test/run-tests.sh`):

- The question appears only in own-computer mode; SETUP.md records `yes`, `no`
  and `not asked`; a bad value is refused.
- `jawbs-speech.sh` against fixtures: installs and sets the `.env` line,
  refuses a wrong checksum and leaves speech off, reruns without downloading,
  `off` flips the line, and a missing library stops cleanly with exit 0 from
  `jawbs-local.sh`'s point of view.
- Bash 3.2 compatibility by inspection, since this host runs 5.2.

By hand, in a worktree on a spare port, never the live portal:

- One real recording through the whole path with the real model, driven by the
  cached Chromium with a fake audio device fed from a WAV file.
- The poll case: record while a session is `working` and confirm the timer
  keeps running and the text lands.

Not testable from here: macOS, Safari's recorder, and phones. The first Mac
setup is the real test of the ready-built library and of the memory that
`decodeAudioData` needs for a ten-minute clip on a phone. If a phone cannot
decode ten minutes, the fallback is to capture PCM directly with an
`AudioWorklet`; that is a change inside `dictate.js` only.

## Docs

- `docs/portal.md`: a Speech section (what it is, the question, the script,
  the costs, the model attribution).
- `portal/.env.example`: `SPEECH_TO_TEXT` and `SPEECH_MODEL_DIR`.
- `CLAUDE.md`: a Key decisions entry, covering that the portal transcribes
  (no browser dictation, no paid service), that the worker is a separate
  process and why, that audio is never stored, that it is optional and asked
  only in own-computer mode, and the ten-minute cap.
