import { spawn } from 'node:child_process';
import { config } from '../config.js';

// Runner for the Codex CLI (`codex exec --json`), which writes a JSON Lines
// event stream: one JSON object per line. This is why the generic `cli`
// runner cannot drive it. That runner JSON.parses the whole of stdout, which
// throws on the second line, falls back to treating the raw stream as the
// reply text, and never finds a session id, so every turn started cold.
//
// Written to the documented event shape and NOT verified against a live
// binary. `npm run calibrate` probes a real install and reports which of the
// assumptions below hold. There are exactly two places to correct:
// createCodexEventSink for field names, buildCodexArgs for the command line.

// Accumulates the only three things a turn produces that the portal needs,
// discarding everything else as it arrives. Kept separate from
// parseCodexEvents so runCodex can feed it line by line without holding a
// whole stream in memory: command_execution events carry an
// aggregated_output field that a render or research-heavy turn makes large.
export function createCodexEventSink() {
  let threadId = null;
  let text = null;
  let failure = null;
  return {
    push(line) {
      const trimmed = String(line).trim();
      if (!trimmed) return;
      let event;
      // Some builds write plain warnings to stdout. One stray line must not
      // fail a turn that otherwise succeeded.
      try { event = JSON.parse(trimmed); } catch { return; }
      if (!event || typeof event !== 'object') return;
      switch (event.type) {
        case 'thread.started':
          // thread_id is the documented field; id is cheap tolerance for a
          // name that has moved before.
          threadId = event.thread_id ?? event.id ?? threadId;
          break;
        case 'item.completed':
          // An empty or whitespace-only message is treated the same as a
          // missing one, so a blank reply cannot be stored: it falls through
          // to runCodex's "no agent_message" error rather than being saved as
          // the assistant's reply. If a later, non-empty agent_message
          // arrives it still overwrites text as usual.
          if (event.item?.type === 'agent_message' && typeof event.item.text === 'string'
            && event.item.text.trim() !== '') {
            text = event.item.text;
          }
          break;
        case 'turn.failed':
          // A real turn outcome, so it overwrites a bare error.
          failure = event.error?.message || 'codex reported a failed turn';
          break;
        case 'error':
          // A transport-level hiccup, which may be recoverable and may be
          // followed by a real outcome, so it never overwrites one.
          if (!failure) failure = event.message || 'codex reported an error';
          break;
        default:
          break;
      }
    },
    result() {
      return { threadId, text, failure };
    },
  };
}

// Pure convenience over the sink, for tests and for calibration replaying a
// saved stream from disk.
export function parseCodexEvents(lines) {
  const sink = createCodexEventSink();
  for (const line of lines) sink.push(line);
  return sink.result();
}

// Matches the bypassPermissions posture the claude-sdk runner already runs
// with, and which docs/portal.md documents. Hardcoded rather than exposed as
// an env var because the only other values break the workflow: workspace-write
// blocks network access, which silently guts the salary, company and
// interviewer research the portal agent depends on.
const SANDBOX = ['--sandbox', 'danger-full-access'];

// A project folder created outside the kit checkout need not be a git
// repository, and codex refuses to run in one without this.
const SKIP_REPO_CHECK = '--skip-git-repo-check';

// The prompt goes on argv rather than through the documented `-` stdin
// sentinel. It is the form the docs lead with, and there is no quoting hazard
// because runCodex spawns without a shell. The ceiling is lower than ARG_MAX
// suggests, though: on Linux a single argv entry is capped by MAX_ARG_STRLEN
// at 131072 bytes, independent of ARG_MAX and not raisable with ulimit, and a
// long pasted job advert (the portal accepts request bodies up to 1mb) or a
// long buildRecoveryPrompt history can cross it. runCodex translates the
// resulting E2BIG into a message naming the limit rather than a bare errno.
// The resume path is a subcommand whose composition with the stdin sentinel
// is not documented at all, and one unverified assumption about resume is
// enough: see docs/superpowers/specs/2026-07-29-multi-provider-support-design.md,
// "Why the prompt goes on argv, not stdin", for the full reasoning and the
// stdin escape hatch if this limit is ever hit in practice.
//
// CALIBRATION FIX POINT: if `npm run calibrate` reports that the argv is
// wrong, this function is the only place to change it.
export function buildCodexArgs({ resumeSessionId, model, modelExplicit, fullPrompt }) {
  const head = resumeSessionId ? ['exec', 'resume', resumeSessionId] : ['exec'];
  const modelArgs = modelExplicit ? ['--model', model] : [];
  return [...head, '--json', ...SANDBOX, SKIP_REPO_CHECK, ...modelArgs, fullPrompt];
}

// Satisfies the runner contract documented in src/agent.js. spawnImpl is
// injected so tests need no child process.
//
// The system prompt is re-sent on every turn including resumes, matching the
// claude-sdk runner, which passes options.systemPrompt on each query(). This
// costs tokens and is deliberate: the session-title and email-to-user
// directive formats are load-bearing for the portal, codex compacts long
// threads, and an instruction that had aged out of a compacted context would
// produce a session that silently stopped naming itself and stopped
// delivering documents.
export async function runCodex(
  { prompt, systemPrompt, resumeSessionId, cwd, model },
  { spawnImpl = spawn } = {},
) {
  const fullPrompt = `${systemPrompt}\n\n${prompt}`;
  const args = buildCodexArgs({
    resumeSessionId: resumeSessionId || null,
    model,
    modelExplicit: config.agentModelExplicit,
    fullPrompt,
  });

  const sink = createCodexEventSink();
  let partial = '';
  let errOut = '';

  await new Promise((resolve, reject) => {
    const child = spawnImpl('codex', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    // Decode at the stream level, not per chunk: accumulating raw Buffers and
    // decoding the concatenation would still be safe, but decoding each
    // chunk independently (`partial += data` on a Buffer coerces it to a
    // string per chunk) would corrupt a multi-byte character split across a
    // pipe boundary into a replacement character that still parses as valid
    // JSON. setEncoding makes Node buffer an incomplete multi-byte sequence
    // internally until the next chunk completes it.
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', data => {
      partial += data;
      const lines = partial.split('\n');
      // The last element is either an incomplete line or an empty string, and
      // is held back until the next chunk completes it.
      partial = lines.pop();
      for (const line of lines) sink.push(line);
    });
    child.stderr.on('data', data => { errOut += data; });
    child.on('error', error => reject(
      error.code === 'ENOENT'
        ? new Error('codex was not found on PATH. Install the Codex CLI, or set AGENT_RUNNER to a runner you have.')
        : error.code === 'E2BIG'
        ? new Error('The prompt was too large to pass on the command line (spawn failed with E2BIG). '
          + 'On Linux a single command-line argument is capped at roughly 128KB (MAX_ARG_STRLEN), regardless '
          + 'of ulimit. Shorten the submission (or the conversation, on a resumed turn) and try again.')
        : error));
    child.on('close', code => {
      if (partial.trim()) sink.push(partial);
      if (code !== 0) {
        // Prefer whatever the event stream itself said went wrong: codex can
        // report a turn.failed reason on stdout while writing nothing to
        // stderr, and "codex exited 1: " with nothing after the colon is not
        // an admin alert anyone can act on.
        const { failure: closeFailure } = sink.result();
        reject(new Error(`codex exited ${code}: ${closeFailure || errOut.trim() || 'no output'}`));
      } else {
        resolve();
      }
    });
  });

  const { threadId, text, failure } = sink.result();
  // Everything below throws, so queue.js's existing recovery takes over: one
  // retry in a fresh session carrying buildRecoveryPrompt context. That is
  // strictly better than storing a raw event stream as the reply, which is
  // what the generic cli runner did.
  if (failure) throw new Error(`codex turn failed: ${failure}`);
  if (text === null) {
    throw new Error('codex exited cleanly but emitted no agent_message, so there is no reply to store.');
  }
  return { sessionId: threadId ?? resumeSessionId ?? null, text };
}
