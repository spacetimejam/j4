# Portal Post-Application Stage (Stage 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the portal agent a third stage covering everything after an application is sent: interview invites (tracker + log updates, researched prep delivered by portal and email), rejections, offers, and correspondence.

**Architecture:** Prompt-only change. The portal's behaviour lives in the `portalPrompt` template string in `portal/src/agent.js`; a STAGE 3 section is inserted between the STAGE 2 paragraph and the generic questions paragraph. No changes to server, queue, database, email, runners or frontend. Docs and the template WORKFLOW are aligned afterwards.

**Tech Stack:** Node 20+, Express portal, `node:test` for tests (`cd portal && npm test`).

**Spec:** `docs/superpowers/specs/2026-07-15-portal-post-application-stage-design.md`

## Global Constraints

- Docs in British English; no em or en dashes as sentence punctuation (applies to prompt text too, which mandates the same style to the agent).
- Tracker Status values must come from the schema in `template/tracker/tracker.md`: Sourced / Researching / Drafting / Applied / Interviewing / Offer / Rejected / Withdrawn / On hold.
- SETUP.md is untouched, but run `bash setup/test/run-tests.sh` anyway at the end (cheap, guards against accidental template breakage).
- Commit author: use `git -c user.name=Claude -c user.email=claude@anthropic.com commit ...` (no global git identity on this machine) and end commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Do not touch the personalised project folders `s/`, `n/`, `jc/` (untracked, out of scope).

---

### Task 1: Stage 3 in the portal prompt, with tests

**Files:**
- Modify: `portal/src/agent.js` (insert into `portalPrompt`, currently lines 5-58; new text goes between the STAGE 2 paragraph ending "...confirm it's logged." at line 30 and the "If at any point you need information..." paragraph at line 32)
- Test: `portal/test/agent.test.js` (append new tests at the end of the file)

**Interfaces:**
- Consumes: `portalPrompt(userName)` exported from `portal/src/agent.js` (already exported, already imported nowhere in tests; the test file imports from `../src/agent.js` at top).
- Produces: the same `portalPrompt(userName)` signature, now containing a `STAGE 3: AFTER APPLYING` section. Task 2 relies on the stage existing but not on its wording.

- [ ] **Step 1: Write the failing tests**

In `portal/test/agent.test.js`, extend the existing import line near the top:

```js
const { parseEmailDirective, runAgentTurn, portalPrompt } = await import('../src/agent.js');
```

Append at the end of the file:

```js
test('prompt includes a post-application stage 3', () => {
  const p = portalPrompt('Test');
  assert.match(p, /STAGE 3: AFTER APPLYING/);
  assert.match(p, /Status is Applied or later/);
});

test('stage 3 handles interviews: tracker, log, numbered prep files, email delivery', () => {
  const p = portalPrompt('Test');
  assert.match(p, /Status = Interviewing/);
  assert.match(p, /log\.md/);
  assert.match(p, /interview-1-prep\.md, interview-2-prep\.md/);
  assert.match(p, /complete prep in your reply/);
  assert.match(p, /email-to-user block[\s\S]*?attaching the prep file/);
});

test('stage 3 asks for missing interview essentials instead of guessing', () => {
  const p = portalPrompt('Test');
  assert.match(p, /do not build\s+prep on guesswork/i);
});

test('stage 3 routes rejections to learnings without an email block', () => {
  const p = portalPrompt('Test');
  assert.match(p, /Status to Rejected/);
  assert.match(p, /core\/learnings\.md/);
});

test('stage 3 covers offers and general correspondence', () => {
  const p = portalPrompt('Test');
  assert.match(p, /Status to Offer/);
  assert.match(p, /Next_Action and Next_Action_Date current/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd portal && npm test`
Expected: the five new tests FAIL (`/STAGE 3: AFTER APPLYING/` does not match, etc.); all pre-existing tests PASS.

- [ ] **Step 3: Insert the stage 3 text into the prompt**

In `portal/src/agent.js`, between the STAGE 2 paragraph (ends `...confirm it's logged.`) and the paragraph beginning `If at any point you need information only ${userName} can supply`, insert (keeping a blank line either side):

```js
STAGE 3: AFTER APPLYING. Once the application has been sent (tracker Status is Applied or later),
treat ${userName}'s messages in this session as post-application news and handle them per
WORKFLOW.md section 7. Work out what the news is, then:

- Interview invite: update the tracker row (Status = Interviewing, Next_Action and
Next_Action_Date set to the interview, Notes refreshed) and append the facts to log.md in the
application folder. If essentials are missing (date and time, format, who is interviewing and
their roles, what the round is), ask for them, clearly numbered, and end your turn; do not build
prep on guesswork. Once you know enough, research the company's business, brand and recent
direction, the interviewers' public professional profiles, what this round type typically tests,
and salary context where relevant. Then write the prep file in the application folder, named by
round, counting upward: interview-1-prep.md, interview-2-prep.md. Put an at-a-glance summary up
top. End your turn with the complete prep in your reply, followed by an email-to-user block (the
exact format below) attaching the prep file, with a subject like "<role> at <company>: interview
prep for <date>". If ${userName} later replies with notes on delivered prep, update the prep
file in place and end your turn with a fresh email-to-user block; prep files are working
documents, never immutable.

- Rejection: set the tracker Status to Rejected, log it in log.md, and record what can honestly
be learned in core/learnings.md. Reply plainly and kindly, and ask whether any feedback arrived
that should be captured. No email block.

- Offer: set the tracker Status to Offer and log the terms in log.md. Reply with an honest read
of the offer against the salary context you have, including a possible negotiation position. No
email block unless you produced a document worth attaching.

- Anything else (recruiter correspondence, scheduling changes): append it to log.md, keep
Next_Action and Next_Action_Date current, and confirm in your reply what you recorded.
```

Note: this is template-literal content inside the existing backtick string; `${userName}` interpolates as in the surrounding paragraphs. Do not add backticks or escape anything else.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd portal && npm test`
Expected: all tests PASS (five new plus all pre-existing).

- [ ] **Step 5: Commit**

```bash
git add portal/src/agent.js portal/test/agent.test.js
git -c user.name=Claude -c user.email=claude@anthropic.com commit -m "feat(portal): stage 3 post-application handling in the agent prompt

Interview invites get tracker and log updates plus researched, emailed
prep; rejections feed learnings; offers get an honest read; everything
else is logged with Next_Action kept current.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Align template WORKFLOW and portal docs

**Files:**
- Modify: `template/WORKFLOW.md` (section 7, line 56)
- Modify: `portal/README.md` (opening paragraph)
- Modify: `docs/portal.md` (opening paragraph, lines 3-11)

**Interfaces:**
- Consumes: the stage 3 behaviour added in Task 1 (docs describe it; no code dependency).
- Produces: nothing consumed by later tasks (this is the final task).

- [ ] **Step 1: Update the prep filename convention in the template workflow**

In `template/WORKFLOW.md`, section 7, change:

```markdown
- Reaching interview: build `interview-prep.md` (at-a-glance up top). Always include company background research (business, brand, recent direction) and a read on how the role fits within the company's context and work, e.g. where it sits, what the team ships, why the hire.
```

to:

```markdown
- Reaching interview: build `interview-<round>-prep.md`, numbered per round (`interview-1-prep.md`, `interview-2-prep.md`), at-a-glance up top. Always include company background research (business, brand, recent direction) and a read on how the role fits within the company's context and work, e.g. where it sits, what the team ships, why the hire.
```

- [ ] **Step 2: Extend the portal README description**

In `portal/README.md`, in the opening paragraph, change:

```markdown
only when you say yes does it tailor the CV and cover letter and email the rendered deliverables back to you.
```

to:

```markdown
only when you say yes does it tailor the CV and cover letter and email the rendered deliverables back to you. The same session then carries the application forward: report an interview and it updates your tracker, researches the company and interviewers, and emails you a prep document; rejections, offers and recruiter correspondence are logged and acted on too.
```

- [ ] **Step 3: Extend the docs/portal.md description**

In `docs/portal.md`, in the opening paragraph, change:

```markdown
If you reply with notes on the PDFs, the same session redrafts
and re-emails them.
```

to:

```markdown
If you reply with notes on the PDFs, the same session redrafts
and re-emails them. After you apply, the same session handles what comes
next: tell it you have landed an interview and it updates the tracker,
researches the company and interviewers, and emails you an interview prep
document; rejections, offers and other correspondence are logged and the
tracker kept current.
```

- [ ] **Step 4: Run both verification suites**

Run: `cd portal && npm test`
Expected: all tests PASS.

Run: `bash setup/test/run-tests.sh` (from the repo root)
Expected: output ends with `Passed: N  Failed: 0`.

- [ ] **Step 5: Commit**

```bash
git add template/WORKFLOW.md portal/README.md docs/portal.md
git -c user.name=Claude -c user.email=claude@anthropic.com commit -m "docs: describe the portal's post-application stage; number prep files per round

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
