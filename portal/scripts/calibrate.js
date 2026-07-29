#!/usr/bin/env node
// Portal calibration. The codex runner is written to the documented
// `codex exec --json` event stream and has never been exercised against a
// live binary. This script probes the binary actually installed, using the
// same pure functions the runner uses, and reports which assumptions hold.
//
// Run it before using a non-Claude runner for the first time:
//   cd portal && npm run calibrate
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../src/config.js';
import { buildCodexArgs, createCodexEventSink } from '../src/runners/codex.js';

const SENTINEL = 'CALIBRATION-OK-7391';
const DATA_DIR = new URL('../data/', import.meta.url).pathname;

const verdicts = [];
function record(name, ok, detail) {
  verdicts.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
}

function heading(text) {
  console.log(`\n== ${text}`);
}

// Run codex with the given argv, collecting raw stdout and feeding the runner's
// own sink, so calibration and the runner can never disagree about parsing.
function runCodexProbe(args, cwd) {
  return new Promise(resolve => {
    const child = spawn('codex', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    // Decode at the stream level, not per chunk: a multi-byte character (a
    // pound sign, an accented name) split across a pipe boundary would
    // otherwise decode as a replacement character on each side independently.
    child.stdout.setEncoding('utf8');
    const sink = createCodexEventSink();
    let raw = '';
    let partial = '';
    let errOut = '';
    child.stdout.on('data', data => {
      raw += data;
      partial += data;
      const lines = partial.split('\n');
      partial = lines.pop();
      for (const line of lines) sink.push(line);
    });
    child.stderr.on('data', data => { errOut += data; });
    child.on('error', error => resolve({ spawnError: error, raw, errOut, ...sink.result() }));
    child.on('close', code => {
      if (partial.trim()) sink.push(partial);
      resolve({ code, raw, errOut, ...sink.result() });
    });
  });
}

async function calibrateCodex() {
  heading('Step 1: is codex installed?');
  const version = spawnSync('codex', ['--version'], { encoding: 'utf8' });
  if (version.error || version.status !== 0) {
    record('codex is on PATH', false, 'not found, or --version failed');
    console.log('\nInstall the Codex CLI first: npm install -g @openai/codex');
    return 1;
  }
  record('codex is on PATH', true, version.stdout.trim());

  heading('Step 2: capturing help output as evidence');
  for (const args of [['exec', '--help'], ['exec', 'resume', '--help']]) {
    const help = spawnSync('codex', args, { encoding: 'utf8' });
    console.log(`--- codex ${args.join(' ')} ---`);
    console.log((help.stdout || help.stderr || '(no output)').trim());
  }

  heading('Step 3: one real turn in a throwaway directory');
  // Same guard preflight.js applies at startup. Without it, a user who copies
  // .env.example, sets AGENT_RUNNER=codex and leaves an explicit Claude
  // AGENT_MODEL in place gets a spawn that fails for a reason that has
  // nothing to do with buildCodexArgs, and the verdict below would point them
  // at the wrong function.
  if (config.agentModelExplicit && /^claude-/.test(config.agentModel || '')) {
    record('AGENT_MODEL is compatible with codex', false,
      `AGENT_MODEL is "${config.agentModel}", which is a Claude model id. Leave AGENT_MODEL unset to let codex choose its own default, or set a codex model.`);
    return 1;
  }
  const scratch = mkdtempSync(join(tmpdir(), 'portal-calibrate-'));
  console.log(`Working directory: ${scratch}`);
  const newArgs = buildCodexArgs({
    resumeSessionId: null,
    model: config.agentModel,
    modelExplicit: config.agentModelExplicit,
    fullPrompt: `Reply with exactly this token and nothing else: ${SENTINEL}`,
  });
  console.log(`argv: codex ${newArgs.slice(0, -1).join(' ')} <prompt>`);
  const first = await runCodexProbe(newArgs, scratch);

  mkdirSync(DATA_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const rawPath = join(DATA_DIR, `calibration-${stamp}.jsonl`);
  writeFileSync(rawPath, first.raw);
  console.log(`Raw stream saved to ${rawPath}`);

  if (first.spawnError) {
    record('the new-session argv is accepted', false, first.spawnError.message);
    return 1;
  }
  record('the new-session argv is accepted', first.code === 0,
    first.code === 0 ? 'exit 0' : `exit ${first.code}: ${first.errOut.trim()}`);

  heading('Step 4: does the parser find what the runner needs?');
  record('a thread id was found', Boolean(first.threadId), first.threadId || 'none, so resume can never work');
  record('an agent_message was found', first.text !== null, first.text === null ? 'none' : 'yes');
  record('the reply contains the sentinel', Boolean(first.text?.includes(SENTINEL)),
    first.text ? first.text.slice(0, 120) : 'no reply');

  if (!first.threadId) {
    console.log('\nNo thread id, so the resume path cannot be tested. Fix createCodexEventSink');
    console.log('first: compare the thread.started line in the saved stream against the');
    console.log('field names it reads.');
    return 1;
  }

  heading('Step 5: does resume work, and does the thread carry?');
  const resumeArgs = buildCodexArgs({
    resumeSessionId: first.threadId,
    model: config.agentModel,
    modelExplicit: config.agentModelExplicit,
    fullPrompt: 'What was the exact token I asked you to reply with in my previous message? Reply with just that token.',
  });
  console.log(`argv: codex ${resumeArgs.slice(0, -1).join(' ')} <prompt>`);
  const second = await runCodexProbe(resumeArgs, scratch);
  // A resumed turn can be accepted (exit 0, no spawn error) yet emit its own
  // fresh thread.started because the argv was silently ignored. That is
  // direct evidence for the "accepted but the thread did not remember" row of
  // the failure table below, so it is worth surfacing even when the sentinel
  // check also fails for the same underlying reason.
  const threadIdChanged = Boolean(second.threadId) && second.threadId !== first.threadId;

  // Two separate questions, deliberately reported separately: whether the
  // command line was accepted at all, and whether the thread remembered.
  record('the resume argv is accepted', !second.spawnError && second.code === 0,
    second.spawnError ? second.spawnError.message
      : second.code === 0 ? 'exit 0' : `exit ${second.code}: ${second.errOut.trim()}`);
  record('the resumed thread remembered turn 1', Boolean(second.text?.includes(SENTINEL)),
    second.text
      ? threadIdChanged
        ? `${second.text.slice(0, 120)} (resume emitted a new thread id "${second.threadId}", different from turn 1's "${first.threadId}": resume was accepted but silently ignored, not carried)`
        : second.text.slice(0, 120)
      : 'no reply');

  heading('Verdict');
  const failed = verdicts.filter(v => !v.ok);
  if (failed.length === 0) {
    console.log('All assumptions hold. AGENT_RUNNER=codex is ready to use.');
    return 0;
  }
  console.log(`${failed.length} assumption(s) did not hold:`);
  for (const v of failed) console.log(`  - ${v.name}`);
  console.log('\nWhat to change, from docs/portal.md "Portal calibration":');
  console.log('  argv wrong          -> buildCodexArgs in src/runners/codex.js');
  console.log('  resume argv wrong   -> the resume branch of buildCodexArgs');
  console.log('  fields not found    -> createCodexEventSink in src/runners/codex.js');
  console.log(`\nCompare against the raw stream in ${rawPath}, and update`);
  console.log('test/codex.test.js in the same commit so the two cannot drift.');
  return 1;
}

async function main() {
  console.log(`Portal calibration, AGENT_RUNNER=${config.agentRunner}\n`);
  switch (config.agentRunner) {
    case 'claude-sdk':
      console.log('The claude-sdk runner talks to @anthropic-ai/claude-agent-sdk in process.');
      console.log('There is no external command line to calibrate. Nothing to do.');
      return 0;
    case 'cli':
      console.log('The cli runner is driven entirely by your own AGENT_CMD and');
      console.log('AGENT_CMD_RESUME templates, so there is no fixed shape to calibrate.');
      console.log('Nothing to do.');
      return 0;
    case 'codex':
      return calibrateCodex();
    default:
      console.log(`Unknown AGENT_RUNNER "${config.agentRunner}". Valid values: claude-sdk, cli, codex.`);
      return 1;
  }
}

process.exit(await main());
