# Application workflow (runbook)

The repeatable process for turning a job description into a tailored, logged application. Read alongside `CLAUDE.md`.

Detail references, not duplicated here:
- **Fit criteria:** `core/profile.md`, including the fit bar and the per-role dials.
- **Voice:** `core/voice.md`.
- **Evidence:** `core/master-cv.md`, `core/stories.md`.
- **Render:** `render/README.md`.
- **Letter shape:** `templates/cover-letters/README.md`.
- **Tracker:** `tracker/tracker.md`.

Confirmation checkpoints are marked **[STOP]**. Work one component at a time; starting points to refine, never finished files dropped on the user.

## 1. Capture the role
- Create `applications/<role-slug>/` (kebab-case).
- Save the job description verbatim to `spec.md`.
- Log to the tracker: Role, Org, Source, `Status = Sourced` (or `Researching`).

## 2. Appraise fit, both directions  →  `fit.md`
- Map the job description against `profile.md`, `master-cv.md`, `stories.md`.
- Honest verdict, both directions, and explicitly against the fit bar in section 3 of `CLAUDE.md`: does this clearly beat what the user already has, or clearly meet their acceptable-role criteria? Don't soften.
- Salary sense-check, practitioner sources first over publisher content.
- Set `Fit` in the tracker.
- **[STOP]** The user reacts before any tailoring.

## 3. Set the per-role dials  (from `profile.md`)
Decide, for this role:
- **Which projects lead.** Start from the patterns in `profile.md` and add to those patterns as they emerge.
- **The header line** (`position:` in both yamls): the default title from `profile.md`, moved toward the target title only where honest.
- **Key skills cut and order:** from the master list, job-relevant first; trim rather than pad.
- **About me angle:** re-angle the sidebar paragraphs to the sector without inventing.
- **Portfolio or work-sample links:** which pieces the letter and CV point to.
- **[STOP]** The user confirms the dials.

## 4. Tailor the CV  →  `cv.yaml`  →  named PDF
- Copy the schema from `render/templates/configuration.yaml`; set the top-level `role:` (names the output file and the PDF title).
- Levers, in rough order of effect: job `intro` lines re-angled to the job description; bullets reordered so the relevant lead, cut to fit; `key_skills` order; `about` paragraphs.
- Jobs stay chronological. Don't drop a role without asking.
- Work from `master-cv.md` and `stories.md`. **Never invent or inflate.**
- **Hard rules: one page, never over** (check the render, don't shrink type); template type sizes are the floor.
- Render: `render/render.sh <role-slug>`.
- **[STOP]** The user confirms the content; they own the craft.

## 5. Draft the cover letter  →  `cover-letter.yaml`
- Shape per `templates/cover-letters/README.md`: most of a page, four or five paragraphs, why-them before what-they-bring, real evidence.
- The user's voice (`voice.md`): prose-led, warm, direct, economical.
- **[STOP]** The user confirms.

## 6. Freeze and log
- Once sent, the CV and letter files are the immutable record. Re-tailoring makes new files.
- Tracker: `Status → Applied`, `Date_Applied`, `CV_Version`, `Letter_Version`, and set `Next_Action` + `Next_Action_Date`.

## 7. Follow up and interview
- Keep `Next_Action` / `Next_Action_Date` populated while the application is live.
- Reaching interview: build `interview-prep.md` (at-a-glance up top). Always include company background research (business, brand, recent direction) and a read on how the role fits within the company's context and work, e.g. where it sits, what the team ships, why the hire.
- Correspondence, dates, recruiter notes → `log.md`.
- Rejections and feedback → `core/learnings.md`.

## Non-negotiables
Accuracy first, no fabrication. The user's voice and the user's sign-off on anything sent. Selective search: the fit bar applies to every fit read.
