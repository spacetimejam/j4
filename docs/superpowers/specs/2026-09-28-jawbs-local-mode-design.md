# Jawbs on your own computer: local mode and intake in the portal

Date: 2026-09-28. Status: design approved in conversation, awaiting spec review.

## Intent

Today a new person gets a project folder from the setup wizard and then does
everything else in a terminal: the staged setup in `SETUP.md` runs in Claude
Code, and the portal, if they want it, is a separate job involving Tailscale,
HTTPS, an email provider and a hand-edited `.env`
(`docs/portal-remote-access.md`). Login is by emailed link only.

The owner wants a new user, on their own machine, to finish a short setup,
double-click an icon, and do the whole intake in a browser.

Agreed in conversation:

1. **Scope of intake in the portal: all of `SETUP.md`, sessions A and B, with
   session C's template choice replaced by a bundled default template**
   (option C of three). A portal template picker is out of scope.
2. **No sign-in in local mode** (option A of three, chosen over a
   launcher-minted login link). A new `EXPOSURE=local` binds loopback only and
   serves exactly one user.
3. **A GUI launcher**: a Jawbs app icon that starts the portal quietly if it
   is not running and opens the browser (option A of three; an always-on
   service and a native tray app were declined). The icon goes in both the
   Applications folder (or app menu) and on the Desktop.
4. **macOS and Linux only.** No Windows or WSL-side icon.
5. **The terminal wizard stays** (a double-click installer was declined), with
   local mode as a first-class choice, worded for non-technical people as a
   three-way menu rather than a yes/no, because "no" hid two different
   meanings.
6. **One local person per kit checkout.**

Success: on a clean Mac or Linux machine with Node and a signed-in Claude Code,
someone clones the kit, runs `./setup/setup.sh`, picks option 1, and ends with a
browser open on `http://localhost:8710` showing Claude's first intake question.
They can complete sessions A to C there, upload their CV, receive a test CV as
a download, and afterwards submit job descriptions as today. Beep and the shared
portal behave exactly as they do now.

## Part 1: local mode in the portal

### `EXPOSURE=local`

`EXPOSURE` gains a third value beside `private` and `public`. It means "this
portal is used by one person, on this machine, in a browser on this machine".

`checkConfig` in `preflight.js` refuses to start under `local` unless:

- `BIND_HOST` is loopback (`127.0.0.1`, `localhost` or `::1`);
- the users registry has exactly one entry (the legacy `ALLOWED_EMAILS` path
  counts too: exactly one address);
- `BASE_URL` is `http://localhost:<PORT>` or `http://127.0.0.1:<PORT>`.

The cookie secret rules do not apply under `local`, since no cookie is read.
The email provider rules still apply as written; setup writes
`EMAIL_PROVIDER=log`, which needs nothing.

### Auth

`requireAuth` in `auth.js`: under `local`, set `req.userEmail` to the single
registered user and call `next()` without reading a cookie. This is the only
auth change. Every route keeps scoping by `req.userEmail`, so nothing else
learns about local mode.

`POST /api/login` and `GET /auth/:token` return 404 under `local`.

### Host and Origin check

With no login, a loopback server is reachable by any web page the person
visits through DNS rebinding: a hostile page resolves its own name to
127.0.0.1 and drives the API from the person's browser. The only thing between
that page and an agent running with `bypassPermissions` in their project is the
`Host` header.

Under `local`, a middleware registered before every route (static files
included) rejects with 403 any request whose `Host` is not exactly
`localhost:<PORT>` or `127.0.0.1:<PORT>`. State-changing requests (every
non-GET) additionally require `Origin`, when present, to be
`http://localhost:<PORT>` or `http://127.0.0.1:<PORT>`. This is essential, not
hardening: without it "no sign-in" means "any website can use your Jawbs".

### Quit

`GET /api/meta` adds `local: true` under local mode. The page then shows a
small "Quit Jawbs" link in the header. It calls `POST /api/quit`, which exists
only under `local`, and which:

1. stops the worker from picking up new jobs;
2. waits for any running turn to finish (the page says "Jawbs will close when
   the current reply is finished" when one is running);
3. exits 0.

Queued jobs stay queued and run next time Jawbs starts (`startWorker` already
requeues stale `running` jobs).

### Alerts

Admin alerts go through `EMAIL_PROVIDER=log` locally, which nobody reads. That
is acceptable: `needs_attention`, `usage_limited` and `drafting_blocked` are
already shown on the session itself. `queue.js` records delivered documents
before it sends mail, so download chips work without real email.

## Part 2: setup and launcher

### The wizard question

The current portal yes/no is replaced by this, printed as a block and read
with `ask_menu` using the short labels:

```
How would you like to work with Jawbs?

  1) In your web browser, on this computer (recommended)
     Jawbs opens like an app. You chat with it in a browser window.

  2) In a terminal, with Claude Code
     For people comfortable typing commands. Nothing extra is installed.

  3) On a shared Jawbs that someone else runs
     Only choose this if the person who runs it asked you to.
     They will send you the web address.
```

The answer is stored as `JAWBS_MODE=local|terminal|shared`. For answers files,
`PORTAL=yes` means `shared` and `PORTAL=no` means `terminal` when `JAWBS_MODE`
is absent, so existing answers files and tests keep working. The admin-alerts
question is asked only for `shared`. `shared` keeps today's behaviour exactly,
including the SETUP.md task containing "If you chose the portal".

### What option 1 does

In order, after the project folder is created:

1. **Check prerequisites.** Node 18 or newer and `claude` on PATH. If either is
   missing, print plain install steps (including `claude` then signing in),
   skip the rest of this list, tell them to re-run the local part with
   `setup/jawbs-local.sh <project folder>` once installed, and still exit 0
   (the existing "setup never fails when node is absent" rule). Steps 2 to 6
   live in that script so the wizard and the re-run share one code path.
2. **Install.** `npm install` in `portal/` (`npm ci` when a lock file exists).
3. **Refuse a clash.** If `portal/data/users.json` exists with an entry for
   someone else, stop the local part with a message: this checkout already
   serves another person, and a second local person needs their own copy of
   the kit on another port.
4. **Write `portal/.env`**, refusing to overwrite an existing one:
   `EXPOSURE=local`, `BIND_HOST=127.0.0.1`, `PORT=8710`,
   `BASE_URL=http://localhost:8710`, `EMAIL_PROVIDER=log`,
   `PORTAL_TITLE=Jawbs`, `AGENT_RUNNER=claude-sdk`, and `SUBSCRIPTIONS=both`
   when Codex is found (on PATH or at `~/.local/bin/codex`) and
   `codex login status` exits 0, otherwise `claude-only`. When Codex is found
   somewhere other than the default, also write `CODEX_BIN`.
5. **Register** the user with `register_portal_user` (admin yes).
6. **Install the launcher and icons** (below), then run the launcher once so
   the browser opens at the end of setup.

The final wizard message for option 1 says: Jawbs is open in your browser; next
time, double-click Jawbs on your Desktop or in Applications.

### Launcher

`bin/jawbs-open`, generated per install by `install_launcher` in
`setup/lib.sh` (bash 3.2 compatible) with absolute paths baked in:

- the kit checkout path;
- the absolute `node` path from `command -v node` at setup time;
- the setup-time `PATH`, exported before starting the portal.

The last two matter because apps launched from the macOS Dock or Finder, and
from some Linux desktops, do not get the login shell's PATH: Homebrew, nvm,
`~/.local/bin` (Typst, Codex) would all be missing, and the agent's Bash tool
inherits the portal's environment.

Behaviour:

1. If `GET http://127.0.0.1:<PORT>/api/meta` answers with `local: true`, open
   the browser on `http://localhost:<PORT>` and exit.
2. Otherwise start `node src/server.js` from `portal/`, detached (`nohup`,
   output appended to `portal/data/jawbs.log`), poll `/api/meta` for up to 15
   seconds, then open the browser.
3. If it never answers, show a native error dialog naming the log file:
   `osascript -e 'display alert ...'` on macOS; `zenity --error` or
   `notify-send` on Linux, falling back to printing. Preflight errors already
   go to the log.

The browser is opened with `open` on macOS and `xdg-open` on Linux.

### Icons

- **macOS**: a minimal `Jawbs.app` bundle in `~/Applications`
  (`Contents/Info.plist`, `Contents/MacOS/Jawbs` which execs `bin/jawbs-open`,
  `Contents/Resources/jawbs.icns`), and a Finder alias on the Desktop
  (`osascript`; a symlink as fallback). No signing: a locally created bundle
  carries no quarantine attribute, so Gatekeeper does not block it.
- **Linux**: `jawbs.desktop` in `~/.local/share/applications` and a copy in
  the Desktop directory (`xdg-user-dir DESKTOP`, falling back to `~/Desktop`),
  made executable and marked trusted with
  `gio set <file> metadata::trusted true` where `gio` exists.
- A simple icon ships in `setup/assets/` (`jawbs.png`, `jawbs.icns`).

`install_launcher` takes `HOME` from the environment so tests can point it at
a temporary directory, and takes the OS from an overridable variable so both
paths can be tested on Linux.

## Part 3: intake in the portal

### Setup sessions

`sessions` gains `kind text not null default 'application'` (migration in
`getDb()` like the existing column additions). The other value is `setup`.

Setup is **pending** while `<projectDir>/SETUP.md` exists. The agent deletes
that file at the last setup task, as it does today, so the portal keeps no
state of its own about setup progress.

New routes:

- `GET /api/setup`: `{ pending, sessionId }`, where `sessionId` is the user's
  setup session if one exists.
- `POST /api/setup/start`: creates the setup session if the user has none
  (title "Getting started", status `working`) and queues its opening turn;
  returns the id. Calling it again returns the existing id and queues nothing.
  Refuses with 409 when setup is not pending.

### What the person sees

While setup is pending, `app.js` routes the landing page straight into the
Getting started conversation, calling `/api/setup/start` first if needed, and
hides the new application box. The opening turn's prompt asks Claude to greet
them, explain briefly how the sessions ahead work, and ask the first intake
question, so they never face an empty box.

Once setup is no longer pending, the normal list and new application box
appear. Getting started stays in the list; its title has no " at ", so
`stageFor` gives it no pill. It can be archived like any session.

Setup sessions are not a local-mode feature: a shared-portal user whose project
still has `SETUP.md` gets the same flow. Beep's existing projects have no
`SETUP.md`, so nothing changes there.

### The setup prompt

`runAgentTurn` receives the session kind and uses `setupPrompt` for `setup`
sessions, in place of the stage 1 to 3 application text in `portalPrompt`. It
reuses the same reply protocol for the runner (structured or fenced), with
the title always null (the session keeps "Getting started") and drafting off
(`drafting_blocked` always null; the ChatGPT writer is for applications).

`setupPrompt` tells Claude:

- `SETUP.md` in the project root is the to-do list. Work it in order, mark each
  task done in the file as it completes, and delete the file only when every
  task is done, as the file itself says.
- This is a chat window. Ask one question per turn, set `awaiting_user` when a
  question is outstanding, and keep turns short enough to read comfortably.
- Where `SETUP.md` says to drop a CV into `core/source/`, ask them to attach it
  with the paperclip button beside the reply box. Attached files arrive in
  `core/source/` and the message names the path.
- **The between-sessions work runs on their word.** At the end of session A,
  summarise what was recorded, say that the next step (drafting the master CV
  and researching the field, tasks 4 to 6) takes around 15 to 30 minutes and
  that they can close the window while it runs, and ask them to say when to
  start. Do that work in the next turn, then open session B with the results.
  Mark drafts "draft, awaiting review" as `SETUP.md` asks.
- Session C: the project already has a working default CV template. Render a
  test CV from `core/master-cv.md` as `render/README.md` describes and deliver
  the PDF through the email field so it appears as a download. Changing the
  design is possible later in a Claude Code session; do not offer Typst
  Universe browsing here.
- The existing voice and honesty rules: never invent facts about them.

`buildRecoveryPrompt` gets a setup variant: re-orient from `SETUP.md` and
`core/` rather than the tracker and application folder.

### CV upload

- A paperclip button beside the reply box, shown on setup sessions only.
  Uploads for application sessions are out of scope.
- `POST /api/sessions/:id/upload`, raw body (`express.raw`, 15 MB cap), file
  name in an `X-Filename` header. Refused with 404 for another user's session
  and 409 for a non-setup session.
- Allowed extensions: `pdf doc docx odt rtf pages txt md`. The name is reduced
  to its basename and to `[A-Za-z0-9._ -]`, collapsing anything else to `-`; an
  empty result becomes `upload.<ext>`. A clash gets `-2`, `-3` and so on before
  the extension.
- Saved to `<projectDir>/core/source/`, created if missing, with a realpath
  check that the resolved directory is inside the project (the
  `resolveOwnedFile` rule) before writing.
- Returns `{ path }` relative to the project. The client then inserts
  "I've attached my CV: core/source/<name>" into the reply box, which the
  person can edit before sending, so every upload reaches Claude inside a
  message rather than silently.

## Part 4: default template, dependencies, docs

### Bundled CV template

`template/render/templates/` gains `main.typ`, `cover-letter.typ`, `lib.typ` and
`VANTAGE-LICENSE` (MIT), a genericised version of the vendored
`@preview/vantage-cv:1.0.0` layout: the Typst 0.15 empty-link patch, no skill
bars or "Objective", contact row built only from fields present. Nothing
personal from any existing project. Fonts default to ones Typst ships
(Libertinus Serif for headings, New Computer Modern for body), overridable in
the existing `theme:` block, so `render/fonts/` stays empty. The templates read
the kit's existing `configuration.yaml` and `cover-letter.yaml` content model
unchanged.

`render/README.md` changes from "the kit deliberately does not ship a finished
CV design" to "a default design is included; swap it for a Typst Universe
template whenever you like", keeping the swap instructions. `SETUP.md.tmpl`
task 10 becomes: the default template is in place; render a test CV from the
master CV and show it; in a terminal session, offer to switch to another design.
Existing projects are untouched.

### Rendering dependencies on macOS

- `install-typst.sh` fetches the macOS release binary (arm64 or x86_64) into
  `~/.local/bin` as it does on Linux, so Homebrew is not needed; the wizard
  offers it on macOS too.
- When `python3` is missing on macOS, the wizard says to accept the "install
  command line developer tools" prompt macOS shows, then re-run. The pyyaml
  step is unchanged.

### Docs

- `docs/portal.md`: a "Using Jawbs on your own computer" section, including the
  honest security statement: there is no sign-in, so anyone or anything that
  can act as your user account on this machine can use Jawbs; it listens on
  loopback only and rejects requests addressed to any other host name.
- `docs/first-session.md`: how to start in the browser.
- `CLAUDE.md`: Key decisions entries for local mode (no sign-in, one user,
  Host/Origin check is load-bearing) and for portal intake (`kind = setup`,
  pending means `SETUP.md` exists).

## Testing

Portal (`node:test`):

- preflight under `local`: each refusal (non-loopback bind, zero or two users,
  non-local `BASE_URL`), and no cookie-secret error;
- `requireAuth` bypass only under `local`; login routes 404 under `local`;
- Host rejection on a static file and an API route; Origin rejection on a
  POST; correct Host and Origin accepted;
- `/api/quit` absent outside `local`; under `local` it waits for a running job;
- `/api/setup`: pending follows `SETUP.md`; `start` creates once, queues once,
  409 when not pending;
- `runAgentTurn` uses `setupPrompt` for setup sessions and the application
  prompt otherwise; setup recovery prompt;
- upload: name sanitising, extension allowlist, 15 MB cap, clash suffixes,
  realpath refusal (symlinked `core/source` pointing outside), other user 404,
  application session 409.

Setup harness (`setup/test/run-tests.sh`), always with `PORTAL_REGISTRY` and a
temporary `HOME`:

- `JAWBS_MODE` values, and `PORTAL=yes/no` as aliases when it is absent;
- `shared` output unchanged, including "If you chose the portal";
- `.env` written with the expected values, never overwritten;
- `SUBSCRIPTIONS` from a fake `codex` on PATH that passes or fails
  `login status`;
- registry clash stops the local part and still exits 0;
- no node: instructions printed, exit 0;
- `install_launcher` on both OS paths: files exist, are executable, and the
  generated launcher contains the absolute node path and the captured PATH.

By hand: a full run in a scratch kit checkout on a spare port (never 8710, never
the live `~/j4/portal`), with a browser check that the Getting started turn
appears and an upload lands in `core/source/`. A macOS run needs the owner; the
plan ships a short checklist for it.

## Out of scope

- A portal template picker and Typst Universe browsing in the portal.
- Moving wizard questions into the intake conversation.
- An always-on service, a tray app, a double-click installer, Windows or WSL
  icons.
- Uploads on application sessions.
- More than one local person per kit checkout.
