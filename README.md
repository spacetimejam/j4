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
- An AI coding assistant such as Claude Code, Claude, or equivalent
- Approximately 30 minutes for initial setup

## Installation

Clone the kit and run the setup wizard:

```bash
git clone https://github.com/OWNER/job-search-kit && cd job-search-kit && ./setup/setup.sh
```

The wizard will:
- Create your project structure (core documents, templates, application folders)
- Set up your file tracker connection
- Initialise an optional Typst render pipeline for polished CV and cover-letter PDFs (you pick your own template from Typst Universe; the kit does not ship a design)
- Seed template documents with your information

## Getting started

Open the job-search-kit folder in your AI tool and say: **"run setup"**

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
- `portfolio/`: case-study bank (optional)
- `render/`: Typst rendering for professional PDFs (optional; bring your own template)
- `tracker/`: configuration for your application log

See `WORKFLOW.md` for the job-description-to-logged-application process.

## Open source

Licensed under MIT. Contributions welcome. Built as a personal tool, generalised for sharing.

## Questions?

See `CLAUDE.md` for operating conventions, `WORKFLOW.md` for the day-to-day process, and the docs in `docs/` for deeper guidance.

Happy hunting.
