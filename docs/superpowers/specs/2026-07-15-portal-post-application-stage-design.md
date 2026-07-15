# Portal post-application stage (stage 3)

**Date:** 2026-07-15
**Status:** Approved for planning

## Goal

The portal currently takes a job description through assessment (stage 1) and application (stage 2, tailored CV and cover letter delivered by portal reply and email). This design adds stage 3: everything after the application is sent. When a user reports news in their application session, the portal agent updates the tracker and the application's records, does the research and interview preparation work the kit already prescribes in WORKFLOW.md section 7, and delivers the prep back through the portal reply and email, exactly as the CV and cover letter flow already does.

The reference for quality is the existing manual work in `s/applications/mc-saatchi-social-strategy-director/` (interview-1-prep.md, interview-2-prep.md, log.md, tracker row with Next_Action kept current).

## Decisions taken

- **Scope: the full post-application stage.** Interview invites, rejections, offers, recruiter correspondence and scheduling changes, and keeping Next_Action current. Not just interviews.
- **Entry point: the existing application session only.** The user replies in the same portal session they applied from. No new-submission matching of old applications in this version; applications made outside the portal cannot receive portal prep (accepted limitation).
- **Delivery: portal reply plus markdown attachment.** The full prep is shown in the portal reply and emailed with `interview-<round>-prep.md` attached (Brevo renames .md to .txt; acceptable). No PDF rendering of prose documents.
- **Verification: automated tests only.** No staged live trial.

## Approach

Prompt-only. The portal's behaviour lives in `portalPrompt` (`portal/src/agent.js`); stage 3 is added there. No changes to server, queue, database, email, runners or frontend. The email pipeline already supports arbitrary attachments and the agent already runs with web tools available (`bypassPermissions`), so research needs no new plumbing.

## Prompt changes (`portal/src/agent.js`)

Add a STAGE 3: AFTER APPLYING section to `portalPrompt`, following the existing voice and register. Behaviour:

**Trigger.** The user's reply arrives in a session whose application has been sent (tracker Status is Applied or later). The agent classifies the news: interview invite, rejection, offer, recruiter correspondence, or a scheduling change.

**Interview invite.**
1. Update the tracker row: `Status = Interviewing`, `Next_Action` and `Next_Action_Date` set to the interview, `Notes` updated. Append the facts to the application's `log.md`.
2. If essentials are missing (date and time, format, interviewer names and roles, what the round is), ask for them as clearly numbered questions and end the turn. Do not produce thin prep on guesswork.
3. With enough known, research: the company's business, brand and recent direction; the interviewers' public professional profiles; what this round type typically tests; salary context where relevant. Follow WORKFLOW.md section 7 and the fit and evidence sources already used in stages 1 and 2.
4. Write `interview-<round>-prep.md` in the application folder (round numbers increment: interview-1-prep.md, interview-2-prep.md). At-a-glance summary up top, per section 7.
5. End the turn with the complete prep in the portal reply, followed by an `email-to-user` block attaching the prep file, subject along the lines of "<role> at <company>: interview prep for <date>".

**Rejection.** Tracker `Status = Rejected`, log it in `log.md`, add what can honestly be learned to `core/learnings.md`. Reply in the portal plainly and kindly; ask whether any feedback arrived that should be captured. No email block.

**Offer.** Tracker `Status = Offer`, log the terms in `log.md`. Reply with an honest read of the offer against the salary context already gathered, including what a negotiation position could be. No email block unless a document is produced.

**Correspondence and scheduling changes.** Append to `log.md`, keep `Next_Action` and `Next_Action_Date` current, confirm in the portal what was recorded.

**Amendment rounds.** A reply after prep has been delivered is treated as notes on it, mirroring the existing CV redraft loop: update the prep file in place, and end the turn with a fresh `email-to-user` block. Prep files are working documents, never immutable.

The existing rules stand unchanged: never invent facts about the user, never apply to or contact anyone, never email except via the block.

## Template and docs alignment

- `template/WORKFLOW.md` section 7: change the prep filename convention from `interview-prep.md` to `interview-<round>-prep.md` to match established practice. No other workflow changes.
- `portal/README.md`: extend the opening description by a sentence covering the post-application stage.
- `docs/portal.md`: same, if it describes the stages.
- Existing personalised project folders (`s/`, `n/`, `jc/`) are not touched by this change; their WORKFLOW.md copies can be synced manually by the owner if wanted (out of scope).

## Testing

In `portal/test/agent.test.js`, following the existing style of asserting on the built prompt:

- The prompt contains the stage 3 section and its trigger (post-application news in an applied session).
- The prompt instructs tracker and log.md updates for interview news, and names the `interview-<round>-prep.md` convention.
- The prompt routes rejections to `core/learnings.md` without an email block.
- The prompt requires the prep to be delivered as portal reply plus `email-to-user` attachment.
- Existing tests (email directive parsing, .md attachment handling, personalised prompt) continue to pass unchanged.

Verification: `cd portal && npm test` plus `bash setup/test/run-tests.sh` (setup untouched but cheap to run).

## Out of scope

- UI changes (status buttons, badges) and any database or server changes.
- PDF rendering of prose documents.
- Matching post-application news submitted as a new portal submission to an existing application.
- Any "view another user's sessions" capability (standing owner decision, 2026-07-14).
