import { spawn } from 'node:child_process';
import { config } from '../config.js';

// Generic CLI runner, configured by env (see .env.example):
//   AGENT_CMD        command template for a new session
//   AGENT_CMD_RESUME command template for resuming an existing session
// {model} and {sessionId} placeholders are substituted; the prompt (with the
// portal system prompt prepended) is written to the process stdin. Stdout is
// parsed as JSON when it carries result/session_id fields (the Claude Code
// `-p --output-format json` shape); otherwise it is treated as the raw final
// text and the previous sessionId is carried over. Other CLIs (codex, gemini)
// can be wired via these templates or given their own runner file satisfying
// the contract in src/agent.js.
export async function runCli(
  { prompt, systemPrompt, resumeSessionId, cwd, model },
  { spawnImpl = spawn } = {},
) {
  const template = resumeSessionId ? config.agentCmdResume : config.agentCmd;
  if (!template) throw new Error('AGENT_CMD / AGENT_CMD_RESUME not configured');
  const cmd = template
    .replaceAll('{model}', model)
    .replaceAll('{sessionId}', resumeSessionId || '');
  const [bin, ...args] = cmd.split(/\s+/).filter(Boolean);
  const stdout = await new Promise((resolve, reject) => {
    const child = spawnImpl(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', errOut = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { errOut += d; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) reject(new Error(`agent CLI exited ${code}: ${errOut.trim()}`));
      else resolve(out);
    });
    child.stdin.end(`${systemPrompt}\n\n${prompt}`);
  });
  const raw = stdout.trim();
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.result !== undefined || parsed.session_id !== undefined) {
        return {
          sessionId: parsed.session_id ?? resumeSessionId ?? null,
          text: String(parsed.result ?? ''),
        };
      }
    } catch { /* fall through to raw text */ }
  }
  return { sessionId: resumeSessionId || null, text: raw };
}
