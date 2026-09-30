// Turns one recording into text, then exits. speech.js starts one of these
// per clip: PCM (16 kHz mono, 16-bit little-endian) on stdin, the model folder
// as the one argument, a single JSON line on stdout. A process of its own
// because decoding is a synchronous native call that would freeze the portal
// for as long as it runs, and because exiting hands the memory back.
import os from 'node:os';
import { join } from 'node:path';

export const SAMPLE_RATE = 16000;
export const WINDOW_SECONDS = 25;
const VAD_WINDOW = 512;

// Groups neighbouring pieces of speech into windows of at most `max` samples,
// returning the piece indexes in each window. Fed one short fragment per pause,
// the model's word errors more than doubled (2.1% to 5.0% in the timing test),
// so pieces are packed together. A piece longer than `max` gets a window of its
// own rather than being cut mid-word.
export function packWindows(lengths, max = WINDOW_SECONDS * SAMPLE_RATE) {
  const windows = [];
  let current = [];
  let total = 0;
  lengths.forEach((length, i) => {
    if (current.length && total + length > max) {
      windows.push(current);
      current = [];
      total = 0;
    }
    current.push(i);
    total += length;
  });
  if (current.length) windows.push(current);
  return windows;
}

// os.availableParallelism arrived in Node 18.14 and package.json promises 18.0,
// so fall back to counting cores. Capped at four: more gave nothing in testing.
export const threadCount = (o = os) => Math.min(4, o.availableParallelism?.() ?? o.cpus().length);

export function pcmToFloat(buffer) {
  const out = new Float32Array(buffer.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = buffer.readInt16LE(i * 2) / 32768;
  return out;
}

async function main(dir) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const samples = pcmToFloat(Buffer.concat(chunks));
  // Imported here, not at the top, so the pure helpers above can be tested on
  // a machine where the optional dependency did not install.
  const { default: sherpa } = await import('sherpa-onnx-node');
  const model = join(dir, 'parakeet');
  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(model, 'encoder.int8.onnx'),
        decoder: join(model, 'decoder.int8.onnx'),
        joiner: join(model, 'joiner.int8.onnx'),
      },
      tokens: join(model, 'tokens.txt'),
      modelType: 'nemo_transducer',
      numThreads: threadCount(),
      provider: 'cpu',
      debug: 0,
    },
  });
  const vad = new sherpa.Vad({
    sileroVad: {
      model: join(dir, 'silero_vad.onnx'),
      threshold: 0.5, minSpeechDuration: 0.25, minSilenceDuration: 0.4,
      maxSpeechDuration: 20, windowSize: VAD_WINDOW,
    },
    sampleRate: SAMPLE_RATE, numThreads: 1, debug: false,
  }, 60);
  const pieces = [];
  const drain = () => {
    while (!vad.isEmpty()) {
      pieces.push(Float32Array.from(vad.front().samples));
      vad.pop();
    }
  };
  for (let i = 0; i + VAD_WINDOW <= samples.length; i += VAD_WINDOW) {
    vad.acceptWaveform(samples.subarray(i, i + VAD_WINDOW));
    drain();
  }
  vad.flush();
  drain();
  const parts = [];
  for (const group of packWindows(pieces.map(p => p.length))) {
    const joined = new Float32Array(group.reduce((n, i) => n + pieces[i].length, 0));
    let offset = 0;
    for (const i of group) { joined.set(pieces[i], offset); offset += pieces[i].length; }
    const stream = recognizer.createStream();
    stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: joined });
    recognizer.decode(stream);
    const text = recognizer.getResult(stream).text.trim();
    if (text) parts.push(text);
  }
  process.stdout.write(JSON.stringify({ text: parts.join(' ') }) + '\n');
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv[2]).catch(err => { console.error(err?.stack || String(err)); process.exit(1); });
}
