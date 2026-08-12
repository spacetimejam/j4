import { query } from '@anthropic-ai/claude-agent-sdk';
import { REPLY_SCHEMA } from '../reply-schema.js';

// Default runner: drives Claude via @anthropic-ai/claude-agent-sdk.
// Satisfies the runner contract documented in src/agent.js.
export async function runClaudeSdk(
  { prompt, systemPrompt, resumeSessionId, cwd, model },
  { queryImpl = query } = {},
) {
  const q = queryImpl({
    prompt,
    options: {
      cwd,
      model,
      // Documented risk: the portal agent runs with permission prompts bypassed
      // so it can work unattended. See docs/portal.md before deploying.
      permissionMode: 'bypassPermissions',
      settingSources: ['project'],
      outputFormat: { type: 'json_schema', schema: REPLY_SCHEMA },
      systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPrompt },
      ...(resumeSessionId ? { resume: resumeSessionId } : {}),
    },
  });
  let sessionId = resumeSessionId || null;
  const parts = [];
  let result = '';
  let structured = null;
  for await (const msg of q) {
    if (msg.type === 'system' && msg.subtype === 'init') sessionId = msg.session_id;
    // Every text block the agent addressed to the user, in order. The
    // structured field below is the answer; this satisfies the shared runner
    // contract and gives a failing turn something to show. Reading msg.result
    // instead loses everything said before a tool call, because result is only
    // the final assistant message. A subagent's text is working-out rather than
    // an answer, so it stays out.
    if (msg.type === 'assistant' && !msg.parent_tool_use_id) {
      for (const block of msg.message?.content || []) {
        if (block.type === 'text' && block.text.trim()) parts.push(block.text.trim());
      }
    }
    if (msg.type === 'result') {
      if (msg.subtype !== 'success') throw new Error(`agent turn failed: ${msg.subtype}`);
      result = msg.result || '';
      structured = msg.structured_output ?? null;
    }
  }
  // This runner always asks for REPLY_SCHEMA and always prompts the agent with
  // the structured protocol, so a success without structured_output cannot be
  // parsed as fenced directives either: queue.js would store the narration,
  // title nothing, send nothing, and badge every session for a reply, all
  // without a word in the log. Fail loudly rather than run a portal that looks
  // healthy and delivers nothing. The message goes straight into an admin
  // email, so it has to say what to check.
  if (!structured) {
    throw new Error(
      'the agent SDK returned a successful turn with no structured_output, but this runner '
      + 'requested the reply schema, so the reply, title and email delivery are all missing. '
      + 'Check that @anthropic-ai/claude-agent-sdk is at least 0.3.207, the version where '
      + 'outputFormat support was verified, and that the installed CLI matches it. '
      + `Claude session id: ${sessionId || 'unknown'}.`,
    );
  }
  return { sessionId, structured, text: parts.length ? parts.join('\n\n') : result };
}
