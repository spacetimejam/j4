import { query } from '@anthropic-ai/claude-agent-sdk';

// Default runner: drives Claude via @anthropic-ai/claude-agent-sdk.
// Satisfies the runner contract documented in src/agent.js.
export async function runClaudeSdk({ prompt, systemPrompt, resumeSessionId, cwd, model }) {
  const q = query({
    prompt,
    options: {
      cwd,
      model,
      // Documented risk: the portal agent runs with permission prompts bypassed
      // so it can work unattended. See docs/portal.md before deploying.
      permissionMode: 'bypassPermissions',
      settingSources: ['project'],
      systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPrompt },
      ...(resumeSessionId ? { resume: resumeSessionId } : {}),
    },
  });
  let sessionId = resumeSessionId || null;
  let text = '';
  for await (const msg of q) {
    if (msg.type === 'system' && msg.subtype === 'init') sessionId = msg.session_id;
    if (msg.type === 'result') {
      if (msg.subtype !== 'success') throw new Error(`agent turn failed: ${msg.subtype}`);
      text = msg.result;
    }
  }
  return { sessionId, text };
}
