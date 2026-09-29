# Intake

The structured record of the first AI session: the interview that seeds `profile.md`, `master-cv.md`, `voice.md` and the rest of `core/`.

## How to fill this

Run this as a conversation, one question at a time, not a form to fill in silently. Write the answers here as they come in, then use them to populate the other core files.

## Before the first question: setting expectations

Say this once, in your own words, warmly and in a sentence or two, then move on; never repeat it as a nag:

- Everything later (fit reads, CVs, cover letters, interview prep) is only as good as what the user shares here about their career, their history and what they want next.
- Detail beats polish. A rambling answer with specifics in it is worth far more than a tidy one without them.
- What they share stays in their own project folder.

## Intake interview script

1. **Current situation.** What is the user's current or most recent role? Employed, or actively seeking? How did they get here, briefly: the shape of their career history.
2. **What they want next.** Start with: "Do you have a particular career step in mind currently?" Three honest answers, each fine:
   - **Yes, one.** They name it: title, scope, sector, type of work.
   - **Could go several ways.** They name the directions; all of them count.
   - **Not yet.** Offer: "Would you like me to suggest some potential paths based on your CV?" If yes, draft a shortlist of plausible paths from the CV, including adjacent fields, and let them pick as many as appeal. If no, start from their current field and revisit as the search teaches.

   Whatever emerges seeds `core/industry-brief.md`, which can cover several candidate directions; comparing how those markets actually work is itself a good way to help someone decide.
3. **The fit bar, dimension by dimension** (feeds `profile.md`):
   - Salary: minimum acceptable, and ideal.
   - Level: minimum seniority, and ideal.
   - Pattern: working pattern (office, hybrid, remote, days).
   - Location: acceptable locations or commute.
   - Company: type, size, sector preferences or exclusions.
   - Scope: what the role must include or avoid.
4. **Dealbreakers.** Anything that rules a role out regardless of the rest.
5. **Salary expectations and evidence.** What are they asking for, and what supports it (market data, current pay, past offers)?
6. **Working pattern.** Days, hours, remote or office split, any constraints.
7. **Locations.** Where they can work from, commute limits, relocation willingness.
8. **Notice period.** Current notice period, if employed.
9. **Existing CV.** Where does their current CV live? Use it to seed `master-cv.md`.
10. **Links.** Portfolio, LinkedIn, work samples, or any other public profile worth referencing.
11. **Cover-letter shape.** How many paragraphs should letters run: a fixed count, or a minimum (and if so, what)? Explain the page-fill constraint (letters must fill at least three quarters of the rendered page, so fewer paragraphs means fuller ones). Record the answer in `templates/cover-letters/README.md`.

## After the interview

**Write `core/voice.md` from this conversation, in this session.** The intake is
usually the richest sample of how the user sounds that the project will ever
get, and it is available immediately; do not hold the file open waiting for a
sample of their writing. That file's own header explains how to mine a
transcript, and in particular how to separate durable traits from artefacts of
speech that must never reach copy. Revise it later against a writing sample if
one turns up.

Once the CV is in `core/source/` and question 2 is answered, research the target field and build `core/industry-brief.md` before the first fit read. The brief's own header explains what to research and what it may and may not change. Present the draft brief to the user for review; it steers nothing until they confirm adopting it.

Be careful with the answer to question 2 specifically. When someone names an
example to illustrate the kind of work or employer they want, record it as an
example. Promoting it into a target sector points the search somewhere they did
not ask to go, and the resulting research can be entirely accurate while aiming
at the wrong thing. The kind of work and the kind of employer are separate axes:
one is what to search for, the other is a filter across the results.

## Career-step interviews

One short interview per role in the user's history, so the project holds more than the CV ever said. Setup runs these in session B, once the master CV draft lists the roles; after setup, run one whenever the user asks to be interviewed about a role, or adds a new one.

**Order and pace.** Most recent role first. Offer each interview rather than launching into it: the user can take it, skip that role, or stop for now and carry on another day. One question per turn. A role counts as done when it has been interviewed or deliberately skipped.

**What to ask, per role:**

1. What the job actually was, beyond the title: scope, team, who they answered to, what they owned.
2. The two or three things they are proudest of there, with numbers wherever numbers exist (money, time, scale, people, before and after).
3. What was hard, and what they did about it.
4. Why they left, or why they are looking to leave.
5. What they would want more of, and less of, next time.

Follow up where an answer is thin or vague; do not accept "I helped with" without asking what they did.

**Where the answers go:**

- Facts and outcomes into that role's section of `core/master-cv.md`, ending the section with `Interviewed: <YYYY-MM-DD>` (or `Skipped by choice: <YYYY-MM-DD>`), so later sessions know which roles are covered.
- Anything with a situation, an action and an outcome into `core/stories.md`.
- How they talk about it into `core/voice.md`, following that file's method.
- Question 5 into `core/profile.md`, where it sharpens the fit bar.

Never invent or round up: record what they said, and mark anything uncertain as uncertain.
