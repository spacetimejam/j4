# Intake

The structured record of the first AI session: the interview that seeds `profile.md`, `master-cv.md`, `voice.md` and the rest of `core/`.

## How to fill this

Run this as a conversation, one question at a time, not a form to fill in silently. Write the answers here as they come in, then use them to populate the other core files.

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
