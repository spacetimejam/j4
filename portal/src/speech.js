import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Speech to text: whether it is available, and the queue that feeds clips to
// the worker. Spec: docs/superpowers/specs/2026-09-30-portal-speech-to-text-design.md

// What setup/jawbs-speech.sh leaves in the speech folder.
export const SPEECH_FILES = [
  'parakeet/encoder.int8.onnx',
  'parakeet/decoder.int8.onnx',
  'parakeet/joiner.int8.onnx',
  'parakeet/tokens.txt',
  'silero_vad.onnx',
];

// Ten minutes of 16 kHz 16-bit mono is 19.2 MB.
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const WORKER = fileURLToPath(new URL('./speech-worker.js', import.meta.url));
const require = createRequire(import.meta.url);

// The library is an optional dependency, so it may not be there. Resolved, not
// loaded: loading it pulls native code into the portal process for nothing.
function libraryInstalled() {
  try {
    require.resolve('sherpa-onnx-node');
    return true;
  } catch {
    return false;
  }
}

export function speechReady(cfg, { exists = existsSync, library = libraryInstalled } = {}) {
  return Boolean(cfg.speech) && library() && SPEECH_FILES.every(f => exists(join(cfg.speechDir, f)));
}

const fail = (code, message) => Object.assign(new Error(message), { code });
const gone = () => fail('aborted', 'nobody is waiting for this recording any more');

function runWorker(command, args, pcm, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let errText = '';
    let done = false;
    // Nobody is waiting any more (they left the page or the connection
    // dropped): stop at once rather than spend a minute of every core on text
    // no one will read.
    const onAbort = () => {
      child.kill('SIGKILL');
      finish(reject, gone());
    };
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn(value);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, fail('timeout', 'the speech worker took too long and was stopped'));
    }, timeoutMs);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { errText = (errText + d).slice(-2000); });
    child.on('error', err => finish(reject, fail('failed', `the speech worker could not start: ${err.message}`)));
    child.on('close', code => {
      if (code !== 0) return finish(reject, fail('failed', `the speech worker exited ${code}: ${errText.trim()}`));
      try {
        // The last line, in case the native library ever prints above it.
        const text = JSON.parse(out.trim().split('\n').pop()).text;
        if (typeof text !== 'string') throw new Error('no text');
        finish(resolve, text);
      } catch {
        finish(reject, fail('failed', 'the speech worker gave no result'));
      }
    });
    // A worker that dies early closes its end of the pipe while we are still
    // writing. Without a listener that EPIPE is an unhandled error event and
    // takes the portal down; the close handler above reports the failure.
    child.stdin.on('error', () => {});
    child.stdin.end(pcm);
  });
}

// Returns transcribe(pcm, { signal }). One clip runs at a time, because each
// takes every core and about 1 GB; up to maxWaiting wait their turn and the
// next is refused as busy rather than left hanging. Aborting the signal gives
// up a waiting clip's place, or kills the worker of a running one, so a clip
// whose listener has gone cannot hold the queue against the next person.
export function createTranscriber({
  dir, command = process.execPath, args = [WORKER, dir], timeoutMs = 5 * 60 * 1000, maxWaiting = 3,
} = {}) {
  let active = false;
  const waiting = [];
  const pump = () => {
    if (active || !waiting.length) return;
    active = true;
    const job = waiting.shift();
    // From here the worker owns the signal.
    job.signal?.removeEventListener('abort', job.leave);
    runWorker(command, args, job.pcm, timeoutMs, job.signal)
      .then(job.resolve, job.reject)
      .finally(() => { active = false; pump(); });
  };
  return function transcribe(pcm, { signal } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(gone());
      if (active && waiting.length >= maxWaiting) {
        return reject(fail('busy', 'too many recordings are waiting'));
      }
      const job = { pcm, resolve, reject, signal };
      job.leave = () => {
        const i = waiting.indexOf(job);
        if (i < 0) return;
        waiting.splice(i, 1);
        reject(gone());
      };
      signal?.addEventListener('abort', job.leave, { once: true });
      waiting.push(job);
      pump();
    });
  };
}
