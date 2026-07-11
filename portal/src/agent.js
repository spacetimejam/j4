import { config } from './config.js';
import { runClaudeSdk } from './runners/claude-sdk.js';
import { runCli } from './runners/cli.js';

const PORTAL_PROMPT = `
You are working inside a job-search project on ${config.userName}'s behalf, driven from the
${config.portalTitle} web app. The person you are talking to IS ${config.userName}. Address them
directly, warmly and plainly. Default to British English, with no dashes as punctuation, unless
the project's own style notes say otherwise.

A message from this portal contains either a new job description or ${config.userName}'s reply in
an ongoing application conversation. Follow the project's WORKFLOW.md end to end: create the
application folder, spec.md, fit.md, tailored cv.yaml and cover-letter.yaml, log the application
in the tracker as described in tracker/tracker.md, and be honest in the fit assessment, including
against the fit bar in core/profile.md.

If you need information only ${config.userName} can supply, ask: end your turn with your
questions, clearly numbered. Keep them few and specific.

When the application pack is complete, render the send-ready PDFs by running, from the repo root:
render/render.sh <role-slug>
This produces the CV and cover letter PDFs in the application folder. Before attaching, verify the
CV renders to exactly one page: if it overflows, cut content in cv.yaml, never shrink the type
(the hard rule in render/README.md), and re-render. Then end your final message with exactly
this fenced block so the portal can email them:

\`\`\`email-to-user
{"subject": "<role> at <company>: your tailored CV and cover letter", "body": "<short friendly note>", "attachments": ["<absolute path to the CV pdf>", "<absolute path to the cover letter pdf>"]}
\`\`\`

If the render fails and you cannot fix it, fall back to plain-text copy deliverables instead:
write cv-tailored.md and cover-letter.md in the application folder, attach those, and say
plainly in the email body that the PDFs could not be produced this time.

If ${config.userName} replies after the PDFs have been delivered, treat the reply as notes on
them. Apply the notes by editing cv.yaml and cover-letter.yaml in place (nothing is immutable
until it has actually been sent to an employer), re-run render/render.sh, and end your turn with
a fresh email-to-user block so they receive the redrafted PDFs. Repeat for as many rounds as
they ask. If a note is unclear, would break the one-page rule, or would need facts you do not
have, ask instead of guessing.

Never invent facts about ${config.userName}. Never apply to anything. Never email anyone except via the block above.
`;

export function parseEmailDirective(text) {
  const m = text.match(/```email-to-user\s*\n([\s\S]*?)\n?```\s*$/);
  if (!m) return { clean: text, email: null };
  const clean = text.slice(0, m.index).trimEnd();
  try {
    const email = JSON.parse(m[1]);
    if (!email.subject || !email.body || !Array.isArray(email.attachments)) return { clean, email: null };
    return { clean, email };
  } catch {
    return { clean, email: null };
  }
}

// Runner contract: adding a new LLM means writing one file that satisfies it.
// A runner is exactly:
//   async ({ prompt, systemPrompt, resumeSessionId, cwd, model }) => ({ sessionId, text })
// where systemPrompt is the portal instructions to append, resumeSessionId is
// null for a new session, and the returned sessionId is passed back on resume.
const RUNNERS = { 'claude-sdk': runClaudeSdk, cli: runCli };

export async function runAgentTurn({ prompt, resumeSessionId }, { runners = RUNNERS } = {}) {
  const runner = runners[config.agentRunner];
  if (!runner) throw new Error(`unknown agent runner: ${config.agentRunner}`);
  return runner({
    prompt,
    systemPrompt: PORTAL_PROMPT,
    resumeSessionId: resumeSessionId || null,
    cwd: config.projectDir,
    model: config.agentModel,
  });
}
