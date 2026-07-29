# Job Search Kit

A complete, AI-operated working environment for managing a job search: from sourcing and fit assessment through CV tailoring, cover letters, interview preparation, and application tracking.

## What it is

Job Search Kit is a starter template for building a personal job-search project in your AI tool. It provides a structured approach to applications, keeping your search organised and your materials tailored to each role.

The kit handles:
- **Sourcing and shortlisting:** capture jobs, assess fit, define your criteria
- **CV tailoring:** one master CV, tailored versions per role
- **Cover letters:** structured drafting and version tracking
- **Interview preparation:** role-specific prep notes and evidence banks
- **Application tracking:** log, timeline, follow-up management

## Requirements

- macOS (10.15+), Linux, or Windows Subsystem for Linux
- A terminal and git
- An AI coding assistant such as Claude Code, Claude, or equivalent. This
  costs money to run: either a paid Claude plan (Pro or Max), or API access
  billed by usage (an `ANTHROPIC_API_KEY`, see `docs/portal.md`).
- Node.js 18+, only if you want the optional submission portal (see `portal/`
  below)
- Approximately 30 minutes for initial setup

## Start here

New to the terminal, or not sure what any of this means? Read
[`docs/getting-started/`](docs/getting-started) first: a step-by-step guide
(as a PDF, "Job Search Kit - Getting Started.pdf", and its Typst source)
written for people who have never used one, that walks you all the way from
a bare computer to the point where the wizard below takes over. Everyone
else can go straight to Installation.

## Installation

Clone the kit and run the setup wizard:

```bash
git clone https://github.com/spacetimejam/j4 && cd j4 && ./setup/setup.sh
```

The wizard will:
- Create your project structure (core documents, templates, application folders)
- Set up your application tracker, a CSV file with no external connection to configure
- Initialise an optional Typst render pipeline for polished CV and cover-letter PDFs (you pick your own template from Typst Universe; the kit does not ship a design)
- Seed template documents with your information

## Getting started

First run the setup wizard from the kit folder (see Installation above). Then start your AI tool from inside the newly created project folder (the target directory you chose during the wizard), for example `cd ~/j4/ae` then `claude`, and say: **"run setup"**

Your AI tool will guide you through intake, then manage applications, track progress, and redraft materials as you refine your search. See `docs/first-session.md` for what that first session looks like, including choosing a Typst CV template with the assistant.

## Principles

**Tailor, don't spray.** Every application is shaped to the role. No auto-apply, no mass-sending.

**Your data stays on your machine.** All materials and logs live in your local project folder. No sign-ups, no cloud accounts.

**Accuracy first.** Every claim, example, and metric comes from real evidence. No fabrication, no overreaching.

**Sent files are the record.** Once you send a CV or cover letter, it's immutable in your tracker. Tailoring for a new role means new files, not edits.

## Structure

The kit creates:
- `core/`: durable source documents (profile, CV, stories, voice)
- `applications/`: one folder per role with spec, fit assessment, tailored CV, cover letter, interview prep
- `templates/`: reusable copy and layouts
- `portfolio/`: case-study bank (created when you choose the creative module in setup)
- `render/`: Typst rendering for professional PDFs (optional; bring your own template)
- `tracker/`: configuration for your application log
- `portal/`: an optional web app for submitting job descriptions from your phone, run from the kit checkout; the setup wizard registers you with it when you choose the portal in setup. Each submission runs an agent session in your project and emails you the finished PDFs. Read the security notes before exposing it to any network. One instance can serve several people, each mapped to their own project folder. Reach it remotely with Tailscale; see `docs/portal-remote-access.md`.

Portal setup, deployment and security guidance lives in `docs/portal.md`.

See `WORKFLOW.md` for the job-description-to-logged-application process.

## Open source

Licensed under MIT. Contributions welcome. Built as a personal tool, generalised for sharing.

## Questions?

See the `CLAUDE.md` (or `AGENTS.md`) inside your generated project for operating conventions, `WORKFLOW.md` for the day-to-day process, and the docs in `docs/` for deeper guidance.

The kit checkout itself carries a root `AGENTS.md`, which is a symlink to
`CLAUDE.md`, so Codex, Gemini CLI and Cursor can work on the kit as well as
Claude Code. One caveat: a Windows checkout made without symlink support
(git's default when it is not running elevated and Developer Mode is off)
turns that symlink into a one-line text file containing the words
`CLAUDE.md`. It is inert rather than harmful, and the kit's documented
Windows path is WSL, where symlinks behave normally. Gemini CLI needs one
extra setting before it reads `AGENTS.md` at all; see the "Using a different
AI assistant" section of the getting-started guide.

Happy hunting.
