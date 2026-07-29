// Runner for the Codex CLI (`codex exec --json`), which writes a JSON Lines
// event stream: one JSON object per line. This is why the generic `cli`
// runner cannot drive it. That runner JSON.parses the whole of stdout, which
// throws on the second line, falls back to treating the raw stream as the
// reply text, and never finds a session id, so every turn started cold.
//
// Written to the documented event shape and NOT verified against a live
// binary. `npm run calibrate` probes a real install and reports which of the
// assumptions below hold. There are exactly two places to correct:
// parseCodexEvents for field names, buildCodexArgs for the command line.

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
          if (event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
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
