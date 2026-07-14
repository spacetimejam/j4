// Getting-started guide. Render with:
//   typst compile guide.typ "Job Search Kit - Getting Started.pdf"

#let teal = rgb("#2b6777")
#let ink = rgb("#1a1a1a")
#let panel = rgb("#f2f5f5")

#set document(title: "Job Search Kit: getting started", author: "Job Search Kit")
#set page(paper: "a4", margin: 2.2cm)
#set text(font: "Liberation Sans", size: 10.5pt, fill: ink)
#set par(spacing: 0.85em, leading: 0.55em)

#show heading.where(level: 1): it => text(fill: teal, size: 20pt, weight: "bold")[#it.body #v(6pt)]
#show heading.where(level: 2): it => block(above: 14pt, below: 6pt, text(fill: teal, size: 13pt, weight: "bold")[#it.body])
#show raw.where(block: true): it => block(fill: panel, inset: 8pt, radius: 2pt, width: 100%, text(size: 9.5pt, it))
#show raw.where(block: false): set text(size: 9.5pt)
#set list(indent: 8pt, spacing: 0.7em)

= Job Search Kit: getting started

This guide takes you from a bare computer to the moment the kit's own setup wizard takes over. Nothing here is difficult, and none of it needs programming knowledge. Allow half an hour.

== What you are setting up

The Job Search Kit is a private, AI-operated working environment for a job search. Once it is installed, an AI assistant works inside it with you: assessing whether roles are genuinely worth your time, tailoring your CV to each one, drafting cover letters in your voice, prepping you for interviews, and keeping an application log so nothing goes cold. Everything lives in a folder on your machine, and it never applies to anything on your behalf.

== What you need

- A computer running *macOS*, *Linux*, or *Windows* (Windows works through WSL, step 1 below).
- An *AI coding assistant*. The kit is built for *Claude Code* and works best with it; a paid Claude plan (Pro or Max) is required. Other tools that read AGENTS.md files (Codex, Gemini CLI, Cursor) also work.
- Your *current CV* and links to your portfolio or LinkedIn, for the first session after setup.

== Step 1: open a terminal

The terminal is where you will paste a handful of commands. That is the extent of it. One thing to know before you start: when a grey box in this guide shows more than one line, each line is a separate command. Paste the first line, press Enter, wait for it to finish, then paste the next.

- *macOS:* open *Terminal* (Spotlight: press Cmd+Space, type "terminal").
- *Linux:* you already know where it is.
- *Windows:* the kit needs WSL (Windows Subsystem for Linux). Open *PowerShell as administrator* and run:

```
wsl --install
```

Restart when prompted, open the new *Ubuntu* app from the Start menu, and do the remaining steps inside it.

== Step 2: install git

Git fetches the kit and keeps a history of your project. Check whether you already have it:

```
git --version
```

If that prints a version number, move on. If not:

- *macOS:* run `xcode-select --install` and accept the prompt.
- *Linux / WSL:* run `sudo apt update && sudo apt install -y git`

== Step 3: install your AI assistant

For Claude Code, run the installer, then start it (two commands, one at a time):

```
curl -fsSL https://claude.ai/install.sh | bash
claude
```

The first launch walks you through logging in with your Claude account. When you can type a question and get an answer, you are done here: type `/exit` to close Claude Code and return to the terminal. You will not need it again until the wizard hands back to it at the end of setup.

If you prefer a different assistant, install it per its own instructions. During setup the wizard will ask which tool you use and prepare the project accordingly.

== Step 4 (optional): Node.js, for the portal

The kit includes an optional web portal that lets you submit job adverts from your phone and receive tailored PDFs by email. It needs Node.js 20 or newer. Skip this happily; you can add it later.

- *macOS:* `brew install node` (or the installer from nodejs.org)
- *Linux / WSL:* `sudo apt install -y nodejs npm`

== Step 5: fetch the kit and hand over to the wizard

From here the kit guides you itself. Back in the terminal, run these two commands, one at a time (the first downloads the kit, the second starts the wizard):

```
git clone https://github.com/spacetimejam/j4
cd j4 && ./setup/setup.sh
```

The wizard checks your machine, asks a short set of questions about you and your search (including whether to register you with the shared submission portal, if your household runs one), and builds your personal project folder inside the kit, named with your initials (for example `j4/sj`). When it finishes, it tells you the final step: move into that new folder in the terminal and start your AI assistant from inside it, for example `cd ~/j4/sj` and then `claude`. Starting it from inside the folder is what lets the assistant see your project. Once it is running, say *"run setup"*. The assistant then interviews you properly, builds your profile and CV materials, and from that point on you are running your search together.

== Good to know

- *Everything stays on your machine.* The project folder contains your CV, salary expectations and application history. Treat it as private, and back it up as you would any personal documents.
- *The kit never applies for you.* Every application is tailored, checked by you, and sent by you. Quality over volume is the whole philosophy.
- *AI sessions cost money* in the usual way your Claude (or other) plan meters usage. A tailored application is a normal working session, not a one-line question.
- *Stuck?* Ask the person who sent you this guide, or ask your AI assistant itself: once the kit is installed it knows how everything fits together.
