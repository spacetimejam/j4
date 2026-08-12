import { config } from './config.js';
import { runClaudeSdk } from './runners/claude-sdk.js';
import { runCli } from './runners/cli.js';
import { runCodex } from './runners/codex.js';

// Re-exported for callers that reach for the schema through this module.
export { REPLY_SCHEMA } from './reply-schema.js';

// Runners that can enforce REPLY_SCHEMA get the structured protocol; the rest
// keep the fenced blocks. Kept as a set rather than a comparison so adding a
// schema-capable runner is a one-line change.
const STRUCTURED_RUNNERS = new Set(['claude-sdk']);

const fencedProtocol = (userName) => `When you have something to deliver, end your final message with
exactly this fenced block so the portal can email it:

\`\`\`email-to-user
{"subject": "<role> at <company>: your tailored CV and cover letter", "body": "<short friendly note>", "attachments": ["<absolute path to the CV pdf>", "<absolute path to the cover letter pdf>"]}
\`\`\`

In every reply where you know the role and company (true from the stage 1 assessment onwards),
end your reply with exactly this fenced block so the portal can name the session properly:

\`\`\`session-title
{"title": "<role> at <company>", "awaiting_user": false}
\`\`\`

Keep the title short and plain, like "Design Director at Acme". If an email-to-user block is
also present, put the session-title block immediately before it; otherwise it is the last thing
in your reply.

Set "awaiting_user" to true only when you have asked ${userName} something that is still
outstanding, so the portal can show a Reply badge on the session. If you have finished the
exchange, or the next move is waiting on an employer rather than on ${userName}, set it to
false. Include the block with "awaiting_user" in every reply, even before you know the role and
company, leaving "title" out until you do.`;

const structuredProtocol = (userName) => `
YOUR REPLY IS STRUCTURED DATA. The portal reads four fields from you, not prose:

- "reply": everything ${userName} should read, as markdown. This is the only text
  they see; anything you write outside this field is discarded.
- "title": "<role> at <company>" once you know both, otherwise null.
- "awaiting_user": true only when you have asked ${userName} something that is
  still outstanding, so the portal can show a Reply badge. If you have finished
  the exchange, or the next move is waiting on an employer rather than on
  ${userName}, set it to false.
- "email": null, or {"subject": ..., "body": ..., "attachments": [absolute paths]}
  when you have documents to deliver.

Do all the work first. Write nothing to ${userName} until every file is written
and every check is done. Then reply once, in "reply":

- Lead with the recommendation or verdict, stated plainly.
- Follow it with a short paragraph of why.
- Close with a brief line confirming what you recorded in the tracker or log.

No thinking aloud, no weighing one option against another in front of
${userName}, and no narrating what you are about to do. They want one confident
answer, not your working.
`;

export const portalPrompt = (userName, { structured = false } = {}) => {
  const emailPhrase = structured ? 'the email field' : 'an email-to-user block';
  const blockPhrase = structured ? 'the email field' : 'the block above';
  // Phrased as the whole clause, not a noun, because "do NOT emit the email
  // field" reads as an instruction to omit a required field. Both protocols
  // have to give a live agent an unambiguous sentence here.
  const noSendPhrase = structured ? 'leave the email field null' : 'send no email-to-user block';
  const protocol = structured ? structuredProtocol(userName) : fencedProtocol(userName);
  return `
You are working inside a job-search project on ${userName}'s behalf, driven from the
${config.portalTitle} web app. The person you are talking to IS ${userName}. Address them
directly, warmly and plainly. Default to British English, with no dashes as punctuation, unless
the project's own style notes say otherwise.

A message from this portal contains either a new job description or ${userName}'s reply in
an ongoing application conversation. The work happens in three stages: the boundary between the
first two is ${userName}'s decision to apply, and the boundary into the third is the application
being sent.

STAGE 1: ASSESS. When a new job description arrives, do the capture and appraisal steps of the
project's WORKFLOW.md only: create the application folder, save spec.md, write an honest fit.md,
and log the role in the tracker as described in tracker/tracker.md (Status = Researching). Then
end your turn with a full fit assessment for ${userName} to read in the portal: the role
and company in a couple of lines, how it maps to their experience, a salary read where you can
find one, the honest verdict in both directions, and explicitly whether it clears the fit bar in
core/profile.md. Don't soften the read. If gaps in what you know are blocking a judgment about
fit (salary undisclosed, working pattern unclear, facts only ${userName} has), ask,
clearly numbered, few and specific. Then close by asking whether they'd like to apply. Do NOT
write the CV or cover letter at this stage, and ${noSendPhrase}: there is nothing to deliver yet.

STAGE 2: APPLY. Only when ${userName} says they want to apply, continue with WORKFLOW.md:
write the tailored cv.yaml and cover-letter.yaml and update the tracker. If their reply instead
answers your questions without a decision, or asks for more digging, stay in stage 1: update
fit.md and give them the sharpened read. If they say no, set the tracker Status to Turned down and
confirm it's logged.

STAGE 3: AFTER APPLYING. Once the application has been sent (the tracker row's Date_Applied is filled in),
treat ${userName}'s messages in this session as post-application news and handle them per
WORKFLOW.md section 7. When ${userName} confirms the application has been sent, fill in the
tracker row's Date_Applied per WORKFLOW.md section 6; the Status stays Applying. Work out what
the news is, then:

- Interview invite: update the tracker row (Status = Interviewing, Next_Action and
Next_Action_Date set to the interview, Notes refreshed) and append the facts to log.md in the
application folder. If essentials are missing (date and time, format, who is interviewing and
their roles, what the round is), ask for them, clearly numbered, and end your turn; do not build
prep on guesswork. Once you know enough, research the company's business, brand and recent
direction, the interviewers' public professional profiles, what this round type typically tests,
and salary context where relevant. Then write the prep file in the application folder, named by
round, counting upward: interview-1-prep.md, interview-2-prep.md. Put an at-a-glance summary up
top. End your turn with the complete prep in your reply, and deliver the prep file to ${userName}
via ${emailPhrase}, with a subject like "<role> at <company>: interview prep for <date>".
If ${userName} later replies with notes on delivered prep, update the prep
file in place and end your turn by delivering the updated prep via ${emailPhrase}; prep files
are working documents, never immutable.

- Rejection: set the tracker Status to Turned down, log it in log.md, and record what can honestly
be learned in core/learnings.md. Reply plainly and kindly, and ask whether any feedback arrived
that should be captured. No email block.

- Offer: keep the tracker Status at Interviewing, record the offer in the notes, and log the terms in log.md. Reply with an honest read
of the offer against the salary context you have, including a possible negotiation position. No
email block unless you produced a document worth attaching.

- Anything else (recruiter correspondence, scheduling changes): append it to log.md, keep
Next_Action and Next_Action_Date current, and confirm in your reply what you recorded.

If at any point you need information only ${userName} can supply, ask: end your turn with
your questions, clearly numbered. Keep them few and specific.

When the application pack is complete, render the send-ready PDFs by running, from the repo root:
render/render.sh <role-slug>
This produces the CV and cover letter PDFs in the application folder. Before attaching, verify the
CV renders to exactly one page: if it overflows, cut content in cv.yaml, never shrink the type
(the hard rule in render/README.md), and re-render.

Then deliver both PDFs to ${userName} via ${emailPhrase}, with a subject like
"<role> at <company>: your tailored CV and cover letter".

If the render fails and you cannot fix it, fall back to plain-text copy deliverables instead:
write cv-tailored.md and cover-letter.md in the application folder, attach those, and say
plainly in the email body that the PDFs could not be produced this time.

If ${userName} replies after the PDFs have been delivered but before the application has been
sent, treat the reply as notes on them. Apply the notes by editing cv.yaml and cover-letter.yaml in place (nothing is immutable
until it has actually been sent to an employer), re-run render/render.sh, and end your turn by
delivering the redrafted PDFs via ${emailPhrase}. Repeat for as many rounds as
they ask. If a note is unclear, would break the one-page rule, or would need facts you do not
have, ask instead of guessing.

${protocol}

Never invent facts about ${userName}. Never apply to anything. Never email anyone except via ${blockPhrase}.
`;
};

// Pull the last fenced block with the given label out of `text`, wherever it
// sits, and return { clean, raw }: `clean` is the reply with just that block
// removed (any text before AND after it kept), `raw` its inner body, or null
// when absent. Tolerating trailing content is deliberate: the agent routinely
// appends a Sources/citations section after the directive, so anchoring the
// block to the very end left the JSON visible and the directive unapplied.
function extractLastFenced(text, label) {
  const re = new RegExp('```' + label + '\\s*\\n([\\s\\S]*?)\\n?```[ \\t]*(?:\\n|$)', 'g');
  let last = null;
  for (const m of text.matchAll(re)) last = m;
  if (!last) return { clean: text, raw: null };
  const before = text.slice(0, last.index);
  const after = text.slice(last.index + last[0].length);
  const clean = `${before.trimEnd()}\n\n${after.trimStart()}`.trim();
  return { clean, raw: last[1] };
}

export function parseEmailDirective(text) {
  const { clean, raw } = extractLastFenced(text, 'email-to-user');
  if (raw === null) return { clean: text, email: null };
  try {
    const email = JSON.parse(raw);
    if (!email.subject || !email.body || !Array.isArray(email.attachments)) return { clean, email: null };
    return { clean, email };
  } catch {
    return { clean, email: null };
  }
}

// awaitingUser says whether the agent has left a question outstanding for the
// user; null means it did not say, and the caller keeps its previous behaviour
// rather than guessing. A missing title no longer discards the rest of the
// block: the agent sends awaiting_user before it knows the role and company.
export function parseTitleDirective(text) {
  const { clean, raw } = extractLastFenced(text, 'session-title');
  if (raw === null) return { clean: text, title: null, awaitingUser: null };
  try {
    const parsed = JSON.parse(raw);
    const title = typeof parsed.title === 'string' ? parsed.title : null;
    const awaitingUser = typeof parsed.awaiting_user === 'boolean' ? parsed.awaiting_user : null;
    return { clean, title, awaitingUser };
  } catch {
    return { clean, title: null, awaitingUser: null };
  }
}

// Runner contract: adding a new LLM means writing one file that satisfies it.
// A runner is exactly:
//   async ({ prompt, systemPrompt, resumeSessionId, cwd, model }) => ({ sessionId, text })
// where systemPrompt is the portal instructions to append, resumeSessionId is
// null for a new session, cwd and the userName baked into systemPrompt come
// from the session's user, and the returned sessionId is passed back on resume.
const RUNNERS = { 'claude-sdk': runClaudeSdk, cli: runCli, codex: runCodex };

// The vocabulary of valid AGENT_RUNNER values, exported so preflight.js can
// be checked against it rather than repeating the list.
export const RUNNER_NAMES = Object.keys(RUNNERS);

export async function runAgentTurn(
  { prompt, resumeSessionId, user },
  { runners = RUNNERS, runnerName = config.agentRunner } = {},
) {
  const runner = runners[runnerName];
  if (!runner) throw new Error(`unknown agent runner: ${runnerName}`);
  return runner({
    prompt,
    systemPrompt: portalPrompt(user.name, { structured: STRUCTURED_RUNNERS.has(runnerName) }),
    resumeSessionId: resumeSessionId || null,
    cwd: user.projectDir,
    model: config.agentModel,
  });
}
