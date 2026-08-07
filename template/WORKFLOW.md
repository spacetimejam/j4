# Application workflow (runbook)

The repeatable process for turning a job description into a tailored, logged application. Read alongside `CLAUDE.md`.

Detail references, not duplicated here:
- **Fit criteria:** `core/profile.md`, including the fit bar and the per-role dials.
- **Voice:** `core/voice.md`.
- **Evidence:** `core/master-cv.md`, `core/stories.md`.
- **Field norms:** `core/industry-brief.md`, what recruiters in the target field prioritise and the conventions that follow.
- **Render:** `render/README.md`.
- **Letter shape:** `templates/cover-letters/README.md`.
- **Tracker:** `tracker/tracker.md`.

Confirmation checkpoints are marked **[STOP]**. Work one component at a time; starting points to refine, never finished files dropped on the user.

## 1. Capture the role
- Create `applications/<role-slug>/` (kebab-case).
- Save the job description verbatim to `spec.md`.
- Log to the tracker: Role, Org, Source, `Status = Researching`.

## 2. Appraise fit, both directions  →  `fit.md`
- Map the job description against `profile.md`, `master-cv.md`, `stories.md`, with `industry-brief.md` as the market lens. If the brief's researched date is more than twelve months old, renew the research first.
- If the role sits outside the field the brief covers (adjacent sector, pivot), do a quick delta research for that field here in `fit.md` rather than stretching the brief; fold anything durable back into the brief afterwards.
- Honest verdict, both directions, and explicitly against the fit bar in section 3 of `CLAUDE.md`: does this clearly beat what the user already has, or clearly meet their acceptable-role criteria? Don't soften.
- Salary sense-check, practitioner sources first over publisher content.
- Set `Fit` in the tracker.
- **[STOP]** The user reacts before any tailoring.

## 3. Set the per-role dials  (from `profile.md`, informed by `industry-brief.md`)
Decide, for this role, letting the brief steer emphasis (what leads, how much space each evidence type gets) without overriding voice, the fit bar, or accuracy:
- **Which projects lead.** Start from the patterns in `profile.md` and add to those patterns as they emerge.
- **The header line** (`position:` in both yamls): the default title from `profile.md`, moved toward the target title only where honest.
- **Key skills cut and order:** from the master list, job-relevant first; trim rather than pad.
- **About me angle:** re-angle the about paragraphs to the sector without inventing.
- **Portfolio or work-sample links:** which pieces the letter and CV point to.
- **[STOP]** The user confirms the dials.

## 4. Tailor the CV  →  `cv.yaml`  →  named PDF
- Copy the schema from `render/templates/configuration.yaml`; set the top-level `role:` (names the output file and the PDF title).
- Levers, in rough order of effect: job `intro` lines re-angled to the job description; bullets reordered so the relevant lead, cut to fit; `key_skills` order; `about` paragraphs.
- Jobs stay chronological. Don't drop a role without asking.
- Work from `master-cv.md` and `stories.md`. **Never invent or inflate.**
- **Hard rules: one page, never over** (check the render, don't shrink type); your chosen template's type sizes are the floor.
- Render: `render/render.sh <role-slug>`.
- **[STOP]** The user confirms the content; they own the craft.

## 5. Draft the cover letter  →  `cover-letter.yaml`
- Shape per `templates/cover-letters/README.md`: most of a page (75%+ as rendered), the user's agreed paragraph count (set at intake) covering benefit in both directions, why-them before what-they-bring, real evidence.
- The user's voice (`voice.md`): prose-led, warm, direct, economical.
- **[STOP]** The user confirms.

## 5a. Deliver the draft (especially through the portal)

Drafts reach the user as a message with files attached, and that message sets
what they think they are allowed to ask for. Send it as a draft, not as a
finished thing awaiting approval.

Say, in your own words and briefly:

- A first draft usually has a few small things off, and some of the phrasing
  may not sound like them.
- Rewriting a paragraph, or telling you a particular word feels wrong and to
  stop using it, is a normal part of this, not a complaint or a special
  request.
- The more they tell you about what does and does not sound like them, the
  closer the next draft starts. Name where it goes: word and phrasing
  preferences into `core/voice.md`, anything wider into `core/learnings.md`.

Two things to hold in tension. This is modesty about a **first draft**, not
apology for the work, and not an invitation to hedge the fit read: `CLAUDE.md`
still says do not soften, and `core/voice.md` still says no over-apologising.
Three or four plain sentences, then the files. Do not open with an apology, do
not stack qualifiers, and do not undercut a draft you believe in.

**When they give that feedback, actually record it** before doing anything else
with it. A banned word the user has to repeat three times is worse than never
having offered. See "Words and phrasings the user has flagged" in
`core/voice.md`.

## 6. Freeze and log
- Once sent, the CV and letter files are the immutable record. Re-tailoring makes new files.
- Tracker: `Status → Applying`, `Date_Applied`, `CV_Version`, `Letter_Version`, and set `Next_Action` + `Next_Action_Date`.

## 7. Follow up and interview
- Keep `Next_Action` / `Next_Action_Date` populated while the application is live.
- Reaching interview: build `interview-<round>-prep.md`, numbered per round (`interview-1-prep.md`, `interview-2-prep.md`), at-a-glance up top. Always include company background research (business, brand, recent direction) and a read on how the role fits within the company's context and work, e.g. where it sits, what the team ships, why the hire. Draw on `industry-brief.md` for field-typical formats and assessments (tastings, trade tests, portfolio walkthroughs, service scenarios) and current sector talking points.
- Correspondence, dates, recruiter notes → `log.md`.
- Rejections and feedback → `core/learnings.md`.

## Non-negotiables
Accuracy first, no fabrication. The user's voice and the user's sign-off on anything sent. Selective search: the fit bar applies to every fit read.
