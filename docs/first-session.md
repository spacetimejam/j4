# Your first session

This guide describes what to expect when you open your new project with your
AI assistant for the first time. The wizard has already created the folder
structure and seeded it with your answers; the first session turns that
skeleton into a working search environment.

## How to start

Open the project folder in your AI tool (for example, run `claude` inside the
folder) and say:

> run setup

The assistant reads `SETUP.md`, which the wizard left as a to-do list, and
works through it with you. Expect the session to take roughly 30 to 45
minutes, most of it conversation.

## What the session covers

1. **Intake interview.** A structured conversation about your background,
   what you want next, and what you would walk away from. Answers are
   recorded in `core/intake.md`.
2. **Profile and fit bar.** The assistant builds `core/profile.md`, including
   a clear bar a new role must beat. If you are currently employed, that bar
   is "clearly better than the job I have", not "any job".
3. **Master CV.** Drop your existing CV (any format) into `core/source/` and
   the assistant synthesises `core/master-cv.md` from it. This becomes the
   single source that every tailored CV draws from.
4. **Stories and voice.** From the conversation so far, the assistant seeds
   `core/stories.md` (reusable evidence for CVs and interviews) and
   `core/voice.md` (how your application copy should sound).
5. **Tracker check.** A quick confirmation that the application log works.
6. **Choose a CV template.** Rendering uses Typst. Rather than shipping one
   fixed design, the kit expects you to browse Typst Universe
   (https://typst.app/universe) with the assistant, pick a CV template you
   like, customise it together, and confirm a test compile to PDF succeeds.
7. **Cleanup.** The assistant deletes `SETUP.md` and tells you the project is
   ready to judge fits and draft applications.

If you chose the creative module in the wizard, the assistant will also offer
the case-study interview as a follow-on: a structured conversation, described
in `portfolio/case-studies/README.md`, that turns your top projects into
written case studies.

## Example transcript shape

A condensed sketch of how the session tends to flow:

> **You:** run setup
>
> **Assistant:** I've read SETUP.md. First up is the intake interview. Let's
> start with your current role: what do you do day to day, and what would
> make you leave it?
>
> **You:** (you talk about your work, what is missing, what you want next)
>
> **Assistant:** Recorded in core/intake.md. Based on that, here is a draft
> fit bar for core/profile.md: salary at or above X, hybrid working, scope
> for Y. Does that match, or is anything missing?
>
> **You:** (you correct and confirm)
>
> **Assistant:** Next, your CV. Can you drop a copy into core/source/? Any
> format is fine.
>
> **You:** done
>
> **Assistant:** I've synthesised core/master-cv.md from it. Two things to
> check: the dates on your second role, and whether the metric in the top
> bullet is accurate. ... Now let's pick a CV design. Here are three Typst
> Universe templates that suit your field; which look do you prefer?
>
> **You:** the second one
>
> **Assistant:** Installed and customised. Test PDF compiled successfully.
> I've deleted SETUP.md; the project is ready. Paste a job description
> whenever you find a role worth assessing.

Your session will differ in the details; the shape (interview, profile, CV,
stories, tracker, template, cleanup) stays the same.

## Tips

- Be honest in the intake, including about weaknesses and dealbreakers. The
  fit bar only protects you if it is real.
- Push back on drafts. Everything the assistant writes is a starting point in
  your material and your voice, not a finished product.
- If anything looks wrong (a metric, a date, a claim you never made), say so.
  Accuracy is a core principle of the kit: nothing goes in an application
  that is not true.

## After the first session

Day-to-day use is simple: paste a job description or a link, and the
assistant follows `WORKFLOW.md` to assess fit, tailor a CV and cover letter,
and log the application in the tracker. See the root `README.md` and
`WORKFLOW.md` for the ongoing process.
