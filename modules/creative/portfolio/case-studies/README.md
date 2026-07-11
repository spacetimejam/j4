# Case-study builder

A method for turning a portfolio project into a written case study, adapted from Jeff Zych's approach to writing case studies with an AI: gather artifacts and stream-of-consciousness notes first, then let the AI do the synthesis work. Full write-up: [My Claude prompt for writing case studies in days not weeks](https://jlzych.com/2026/01/04/my-claude-prompt-for-writing-case-studies-in-days-not-weeks/).

The method has four stages.

## Stage 1: Interview

Work through `interview-questions.md` for the project. Record answers however is easiest, a voice note works well, then transcribe it or hand the transcript to the AI. Answers should be raw, not polished: full sentences aren't needed, the point is to get everything that's relevant onto the page. Budget 10 to 15 minutes per project.

## Stage 2: Generate tailored questions

Some projects need follow-up beyond the generic question set, for example, a project with an unusual client relationship, or a page on the live site with placeholder or outdated copy that needs explaining. Use `prompts/question-generator.md`: the AI reads `portfolio/site.md` and any existing copy for the project and produces a short list of extra prompts specific to it.

## Stage 3: Synthesise

Gather the raw interview answers and any artifacts (existing copy, briefs, screenshots described in `site.md`) and run `prompts/synthesis.md`. This turns the raw material into a 1,000 to 1,500 word case study.

## Stage 4: Review

Open a fresh session, no memory of the synthesis stage, and run `prompts/hiring-manager-review.md` against the draft. A fresh context reads the case study the way an actual hiring manager would, without the benefit of having sat through the interview. Feed the review back into a revision.

## The accuracy rule

Nothing in a case study is invented. Numbers come from the user's own material only, never estimated or rounded up to sound better. Where there's no hard number, use an honest proxy instead: scale (how many stores, how many markets), duration (how long the project ran, how long it's been live), or adoption (rolled out across the estate, adopted as the template for future work). A proxy is a substitute for a metric that doesn't exist, not a way of dressing one up.
