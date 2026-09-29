# The submission portal

The portal is a small web app that lets you submit job descriptions to your
job-search project from anywhere, including your phone. You paste a job
description (or just a link to one) into a single box. Each submission starts
an agent session inside your project: the agent follows `WORKFLOW.md` end to
end, writes the usual application files, logs the tracker row, asks you any
follow-up questions in the app, and emails you the rendered CV and cover
letter PDFs. If you reply with notes on the PDFs, the same session redrafts
and re-emails them. After you apply, the same session handles what comes
next: tell it you have landed an interview and it updates the tracker,
researches the company and interviewers, and emails you an interview prep
document; rejections, offers and other correspondence are logged and the
tracker kept current.

The portal lives in the `portal/` folder of your project. It is optional: the
rest of the kit works without it.

## Requirements

- **Node 18 or newer.** Every dependency, including the Claude Agent SDK,
  requires only 18, and the full test suite passes on it. Check with
  `node --version`.
- **Claude and ChatGPT, or one of them.** By default the portal drives Claude
  via the Claude Agent SDK (a logged-in Claude Code install or an
  `ANTHROPIC_API_KEY`) and has ChatGPT write the CV and cover letter copy
  through the Codex CLI, signed in with `codex login`. If you have only one of
  the two, say so with `SUBSCRIPTIONS`; see "Running on one subscription"
  below.
- **An email provider** for sending you the finished PDFs: Brevo, any SMTP
  account, or a webhook you run yourself.

## Using Jawbs on your own computer

The simplest way to run Jawbs is in your browser on the computer you already
use, with nothing to publish and no emailed sign-in links. In the setup
wizard, choose option 1, "In your web browser, on this computer". The wizard
then asks who should write your CVs and cover letters:

- Claude runs Jawbs and ChatGPT writes the CV and letter copy (recommended;
  needs both subscriptions).
- Claude does everything (a Claude subscription only).
- ChatGPT does everything (a ChatGPT subscription only; newer and less tested).

The answer is recorded in `SETUP.md` as `Writer:`. The wizard then runs
`setup/jawbs-local.sh` for you, which does six things:

1. Checks that Node 18 or newer is installed, and whichever of Claude Code
   and Codex (the program Jawbs uses to reach ChatGPT) your choice needs. If
   one is missing it tells you how to install it and stops without failing;
   if you chose ChatGPT as the writer and Codex is missing, it also offers
   to let Claude write instead, but never switches without asking. If a
   program is installed but not signed in, it opens the sign-in in your
   browser (`claude auth login` or `codex login`). Skipping that does not
   stop setup: until you sign in, Jawbs shows the same instructions in place
   of a reply or a draft, with a button to try again.
2. Checks that this copy of the kit does not already run Jawbs for someone
   else.
3. Installs the portal's dependencies.
4. Writes `portal/.env` with the local settings (`EXPOSURE=local`, loopback
   only, no email provider) and your writer choice. A project set up before
   the question existed has its choice worked out from what is signed in on
   this computer. An existing `.env` is left as it is.
5. Registers you as the portal's one user.
6. Creates a Jawbs icon (in Applications and on your Desktop on a Mac, in the
   applications menu and on your Desktop on Linux) and opens Jawbs in your
   browser.

Next time, double-click the Jawbs icon. It starts Jawbs if it is not already
running and opens it in your browser; double-clicking again is harmless. The
cog menu on the main page has Quit Jawbs, which lets any reply in progress
finish and then stops Jawbs. Open it from the icon again whenever you like.

Jawbs opens on a conversation called Getting started, which works through the
same steps as `docs/first-session.md`. When it asks for your CV, attach it
with the Attach a file button (PDF, Word, text and similar formats, up to
15 MB).

In Getting started, Jawbs offers a link to Typst Universe's CV templates
before and after it renders your test CV: name any template there, or paste
its link, and Jawbs adapts it to your CV and cover letter, checks it still
fits one page, and switches over. After setup, "Change CV design" in the cog
menu does the same, and can put an earlier design back.

If something goes wrong, the log is `portal/data/jawbs.log` in the kit
folder. If setup stopped because something was missing, install it and run
`setup/jawbs-local.sh <project folder>` again; it needs no further questions.

Jawbs on a computer serves one person, so a second person needs their own copy
of the kit (clone it again into another folder). Each copy picks its own port
when it is set up (8710 if free, otherwise the next free one up to 8730), and
its icon opens that copy, never another person's. The port is `PORT` in
`portal/.env`.

There is no sign-in. Anyone or anything with an account on this computer, and any program you run, can use Jawbs. Local Jawbs suits a computer only you use; on a shared computer, use the shared setup instead. Jawbs listens only on this computer (127.0.0.1) and refuses requests addressed to any other host name, which stops websites you visit from reaching it through your browser. Do not change `BIND_HOST` or put a proxy in front of a local Jawbs: publish it with `docs/portal-remote-access.md` instead, which switches to emailed sign-in links.

## Setup walkthrough

From the project root:

```bash
cd portal
npm install
cp .env.example .env
```

Then edit `.env`, field by field:

- `PORT`: the port the portal listens on. Any free port is fine.
- `BASE_URL`: the URL you will open the portal at. Login links are built from
  this, so it must be reachable from the device you will use (for example
  your phone on a VPN or tunnel). It must be `https` unless it is
  `localhost`: the session cookie is set `Secure`, and browsers discard
  `Secure` cookies sent over plain http, so the login link will appear to
  work and then silently return you to the login screen. Startup refuses to
  run rather than let you hit this.
- `COOKIE_SECRET`: a long random string used to sign login cookies. Generate
  one with `openssl rand -hex 32` and never reuse it elsewhere. At least 32
  characters are required for a private portal; a portal with
  `EXPOSURE=public` is held to a stronger bar of at least 64, because the
  session cookie is the only thing between a stranger on the internet and an
  agent running with `bypassPermissions` inside your project.
- `EXPOSURE`: `private`, `public` or `local`, describing whether the portal is
  reachable from the public internet, not which tool you used to publish it.
  A Tailscale Funnel install and a reverse-proxied public domain are both
  `public`. Leave it unset (or `private`) for Tailscale `serve`, a VPN, or
  localhost only. `setup-remote.sh configure` sets this for you when using
  Tailscale. `local` is Jawbs on your own computer, with no sign-in and one
  person; the wizard writes it for you (see "Using Jawbs on your own computer", above).
- `BIND_HOST`: the address the portal listens on. Defaults to `0.0.0.0`, all
  interfaces, which is what a reverse proxy on another host or in a
  container such as Docker generally needs, since it cannot reach loopback.
  `setup-remote.sh configure` narrows this to `127.0.0.1` for Tailscale
  setups, where Tailscale itself connects locally, so only it needs to reach
  the portal.
- **Users**: who can log in, and what project each of them works in, is
  configured in `data/users.json` (gitignored), one entry per login email:

  ```json
  { "alice@example.com": { "name": "Alice", "projectDir": "/home/alice/job-search-alice", "admin": true } }
  ```

  Copy `users.example.json` to `data/users.json` and edit it. Each login
  email maps to its own project folder; sessions, files, and deliverable
  emails are visible only to their own user. `admin: true` marks who
  receives failure alerts. Edits to the file take effect immediately.
  Removing an entry is enforced at login, agent-run, email-delivery, and
  download time: `issueToken` refuses new logins for the address, `queue.js`
  fails any new job for it and alerts admins, `email.js` won't send it
  deliverables, and new file downloads are blocked. It is not re-checked on
  every read route, though: a cookie already issued before removal stays
  valid until it expires, and its holder can still browse existing session
  history and submit job descriptions (which then fail at queue time). If
  you are removing someone you no longer trust, also rotate `COOKIE_SECRET`
  to invalidate their session immediately. `PORTAL_USERS_FILE` overrides where
  the portal looks for this file, if you want it somewhere other than
  `data/users.json`.

  You rarely need to edit this file by hand to add someone: the setup wizard
  registers each new person automatically when they answer yes to the portal
  question, including asking whether they should receive failure alerts.
  Manual edits remain the way to remove someone or change an existing entry.
  The wizard honours `PORTAL_REGISTRY` if you keep the registry somewhere
  other than `portal/data/users.json` in the kit checkout.

  Legacy single-user installs can skip `users.json` entirely and instead set
  `ALLOWED_EMAILS` (a comma-separated allowlist; the first address is the
  owner), `PROJECT_DIR` (the absolute path of the generated job-search
  project), and `USER_NAME` (how the agent and emails address you). This
  fallback only applies when no users file exists.
- `DB_PATH` (optional): where the SQLite database lives. Defaults to
  `data/portal.db` inside `portal/`.
- `PORTAL_TITLE`: the name shown in the web app and email subjects.
- `AGENT_MODEL`: the model used for portal sessions. What it means depends on
  `AGENT_RUNNER`: for `claude-sdk` it is a Claude model id and defaults to
  `claude-opus-5-5`; for `codex` it should be left unset so the codex runner
  omits `--model` and lets Codex choose its own default (see "Using Codex"
  below).
- `AGENT_RUNNER`, `AGENT_CMD`, `AGENT_CMD_RESUME`: see "Using a different
  LLM" below. Leave at the defaults to use the Claude Agent SDK.
- `SUBSCRIPTIONS`: `both` (the default), `claude-only` or `chatgpt-only`. See
  "Running on one subscription" below.
- `EMAIL_PROVIDER` and the provider fields: see "Choosing an email provider"
  next.

### Choosing an email provider

Set `EMAIL_PROVIDER` to one of:

- `smtp` (recommended): send through a mailbox you already have. No new
  account needed. Full walkthrough below.
- `brevo`: a hosted transactional email service with a free tier that
  comfortably covers a job search. Create an account, generate an API key,
  and set `BREVO_API_KEY` and `EMAIL_FROM`. The sender address must be one
  Brevo has verified for your account. Choose this over `smtp` if your
  mailbox provider does not allow app passwords or SMTP access.
- `webhook`: the portal POSTs `{to, subject, text, attachments}` as JSON to
  `WEBHOOK_URL`, and delivery is your problem. Attachments are included as
  base64. Use this to hand delivery to an automation tool such as n8n, or
  for local testing with a dummy listener.
- `log`: sends nothing. Every message, including login links, is printed to
  the portal's own terminal or log instead of being delivered anywhere. No
  account and no credentials are needed. This is the way to prove the rest
  of the portal works, end to end, before you have set up any mail account:
  request a login link, copy it out of the log, and open it.

One wrinkle to know about: **the code's built-in default is `webhook`, not
`smtp`.** If `EMAIL_PROVIDER` is unset, the portal behaves as if you chose
`webhook`, and if `WEBHOOK_URL` is also unset, every send fails. Startup now
warns about this explicitly if you leave `EMAIL_PROVIDER` unset, but the
warning does not stop the portal starting. For real use, always set
`EMAIL_PROVIDER` explicitly, and use `log` rather than leaving it unset if
you just want to smoke-test the portal.

### Setting up SMTP, step by step

You need two values in `.env`: `SMTP_URL` and `EMAIL_FROM`.

`SMTP_URL` is a nodemailer connection URL in this shape:

```
smtps://USERNAME:PASSWORD@HOST:465
```

Three rules that catch almost everyone:

1. **The username is usually your full email address**, and the `@` in it
   must be written as `%40`. So `alex@gmail.com` becomes `alex%40gmail.com`.
2. **The password is not your normal login password.** Most providers
   require an app password (see below). If the password contains special
   characters, percent-encode those too (`#` becomes `%23`, `/` becomes
   `%2F` and so on); letters, digits and spaces removed are safest.
3. **Use `smtps://` with port 465** where your provider offers it. If your
   provider only lists port 587 (STARTTLS), use `smtp://HOST:587` instead.

**Gmail:**

1. Turn on 2-step verification at myaccount.google.com/security (app
   passwords are only available once it is on).
2. Go to myaccount.google.com/apppasswords, create a password named
   "job search portal", and copy the 16-character code Google shows you.
   Remove the spaces.
3. Set, using your address and that code:

```
EMAIL_PROVIDER=smtp
SMTP_URL=smtps://alex%40gmail.com:abcdefghijklmnop@smtp.gmail.com:465
EMAIL_FROM=alex@gmail.com
```

**Other providers:** search "SMTP settings" plus your provider's name for
the host and port, and check whether they need an app password. Yahoo and
iCloud work like Gmail (app password, port 465). Outlook.com has been
retiring basic SMTP authentication, so if it refuses to authenticate, use
`brevo` instead rather than fighting it.

**Test it:** start the portal (`node src/server.js`), open `BASE_URL`, and
request a login link to your own address. If nothing arrives, the portal
log will show the SMTP error; an authentication failure means the username
or password in `SMTP_URL` is wrong, and a connection error means the host
or port is.

## Running it

For a first run, from `portal/`:

```bash
node src/server.js
```

Open `BASE_URL` in a browser, enter an allowlisted email address, and click
the login link that arrives (or, with `EMAIL_PROVIDER=log`, copy it out of
the terminal).

To reach the portal from your phone or another device, see
`docs/portal-remote-access.md`, which is the recommended path: it walks
through publishing the portal over Tailscale, with a script that checks,
configures and verifies each step. The rest of this section covers keeping
the portal running as a background service once it is reachable, whichever
way you chose to publish it.

To keep it running, use your platform's service manager.

### Linux: systemd user service

Create `~/.config/systemd/user/job-search-portal.service`:

```ini
[Unit]
Description=Job search submission portal

[Service]
WorkingDirectory=/home/you/job-search/portal
ExecStart=/usr/bin/node src/server.js
Restart=on-failure

[Install]
WantedBy=default.target
```

Then:

```bash
systemctl --user daemon-reload
systemctl --user enable --now job-search-portal
loginctl enable-linger "$USER"   # keep it running when you log out
```

### macOS: launchd

Create `~/Library/LaunchAgents/com.job-search.portal.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.job-search.portal</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>src/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/you/job-search/portal</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
```

Then `launchctl load ~/Library/LaunchAgents/com.job-search.portal.plist`.

## Running on one subscription

Out of the box the portal uses two subscriptions: Claude runs the
conversation, and ChatGPT (through the Codex CLI) writes the prose in each CV
and cover letter, which Claude then fits and checks. If you only have one,
tell the portal so in `.env`. It never switches on its own.

| `SUBSCRIPTIONS` | Who does what | Needs |
|---|---|---|
| `both` (default) | Claude runs the portal; ChatGPT writes the CV and letter copy | Claude, plus Codex installed and signed in |
| `claude-only` | Claude writes everything | Claude only |
| `chatgpt-only` | ChatGPT runs everything | `AGENT_RUNNER=codex` (see "Using Codex") |

At startup the portal checks the setting. With `both` and no Codex installed
it refuses to start and says so, rather than leaving every draft waiting.
Codex installed but signed out only prints a warning, because logins lapse on
their own: drafts then wait with a Retry button, and admins are emailed, until
someone runs `codex login` as the user the portal runs as. Settings that
contradict `AGENT_RUNNER` also stop startup.

ChatGPT cannot be used without an account: `codex login` accepts a ChatGPT
login, an API key or an access token, and nothing else.

## Using a different LLM

The portal is Claude-first but not Claude-only. `AGENT_RUNNER` selects how
sessions run:

- **`claude-sdk`** (the default) uses `@anthropic-ai/claude-agent-sdk` in
  process. This is the tested path.
- **`codex`** shells out to `codex exec --json`. New, and calibration is
  required before first use; see the next section.
- **`cli`** shells out to a command-line tool using the templates below. It
  suits a CLI that prints a single JSON object of the Claude Code
  `-p --output-format json` shape, and nothing else.

Gemini CLI and Cursor have no runner. They work well on a project folder
through `AGENTS.md`, but they cannot drive the portal.

### The runner contract

Adding first-class support for another LLM means writing one file under
`src/runners/` that exports a single async function taking
`{ prompt, systemPrompt, resumeSessionId, cwd, model }` and returning
`{ sessionId, structured?, text }` (the contract is documented in
`src/agent.js`), then adding it to the `RUNNERS` map there and to
`AGENT_RUNNERS` in `src/preflight.js`.

Only a schema-capable runner populates `structured`, and its presence is what
makes `queue.js` read the reply, title and email as fields; `portalPrompt`
gives every other runner the fenced protocol and `queue.js` parses those
directives out of `text` instead.

Write a runner, rather than reaching for `AGENT_RUNNER=cli`, whenever the
tool's output is not a single JSON object. `cli` used to claim it could wire
up any CLI. It cannot, and the failure is silent and expensive: with a
streaming tool its `JSON.parse` throws, the raw event stream gets stored as
the assistant's reply and shown to the user, and no session id is ever found,
so every turn starts a fresh session with no memory. The portal's core loop
(fit assessment, then apply, then notes, then interview prep) depends
entirely on the session remembering the turn before.

### CLI templates

For a CLI that does print one JSON object, set `AGENT_RUNNER=cli` and provide:

- `AGENT_CMD`: the command for a fresh session. `{model}` is substituted.
- `AGENT_CMD_RESUME`: the command for resuming a session. `{sessionId}` is
  substituted.

The prompt is piped to the command's stdin. A worked Claude Code CLI example:

```bash
AGENT_RUNNER=cli
AGENT_CMD=claude -p --output-format json --model {model}
AGENT_CMD_RESUME=claude -p --output-format json --resume {sessionId}
```

Two limitations: command templates are split on whitespace, so quoted
arguments containing spaces are not supported (wrap the invocation in a small
shell script instead), and a resume mechanism that is a subcommand rather
than a flag cannot be expressed at all.

### Using Codex

Install the Codex CLI and log in per its own instructions, then:

```bash
AGENT_RUNNER=codex
SUBSCRIPTIONS=chatgpt-only
# AGENT_MODEL left unset on purpose: see below
```

`SUBSCRIPTIONS=chatgpt-only` confirms the portal runs on ChatGPT alone;
preflight refuses the codex runner without it.

Leave `AGENT_MODEL` unset unless you want a specific Codex model. It defaults
to a Claude model id, and the codex runner omits `--model` altogether when it
was not set explicitly, so Codex chooses its own default. Preflight treats an
explicitly set `claude-*` model with this runner as an error.

The runner runs Codex with `--sandbox danger-full-access`. That matches the
`bypassPermissions` posture the `claude-sdk` runner already uses, described
under Security below, so the portal's risk profile does not change with the
runner. The weaker `workspace-write` was not used because it blocks network
access, which would silently gut the salary, company and interviewer research
the portal agent depends on, while the agent carried on and returned thinner
work with no sign of why.

**There is a hard ceiling on how long a submission can be.** The prompt is
passed as a single command-line argument, and on Linux a single argument is
capped by `MAX_ARG_STRLEN` at roughly 128KB, regardless of `ulimit` and much
lower than the machine's overall `ARG_MAX`. The portal accepts submissions up
to 1MB and the portal system prompt alone is about 6.7KB, so a very long
pasted job advert, or a long-running thread (a resumed turn that fails
rebuilds its prompt from the whole message history), can cross that line. If
it does, the runner raises a clear error naming the limit rather than a bare
`spawn E2BIG`; shortening the submission is the fix.

## Portal calibration

**The codex runner was written to the documented `codex exec --json` event
stream and has never been exercised against a live binary.** Codex is not
installed on the machine the kit is developed on. Rather than claim tested
support, the portal ships a calibration step that verifies the assumptions
against the binary you actually have.

Run it once before using a non-Claude runner for the first time:

```bash
cd portal && npm run calibrate
```

It confirms `codex` is installed, captures `codex exec --help` and
`codex exec resume --help` as evidence, runs one real turn in a throwaway
directory using exactly the argv the runner builds, saves the raw event
stream to `portal/data/calibration-<date>.jsonl`, feeds it through exactly the
parser the runner uses, and then resumes that thread with a question only
answerable from the first turn. It prints a pass or fail line per assumption.

It never touches a real project folder, because that turn runs an agent with
full access.

If something fails, there is exactly one place to change for each case:

| What failed | What to change |
| --- | --- |
| The new-session argv was rejected | `buildCodexArgs` in `src/runners/codex.js`, the non-resume branch |
| The resume argv was rejected | `buildCodexArgs`, the resume branch |
| No thread id, or no `agent_message`, was found | `createCodexEventSink` in `src/runners/codex.js` |
| Resume was accepted but the thread did not remember | the resume argv is being accepted and ignored; compare `codex exec resume --help` against what calibration printed |

Compare against the saved `.jsonl` to see what the real events look like, and
update `test/codex.test.js` in the same commit. Those tests pin the exact argv
and event field names on purpose, so that a correction cannot be applied to
the runner and missed in the tests.

## Security

Take this section seriously before exposing the portal to anything.

- **The agent runs with bypassPermissions inside your project.** A portal
  session can run commands and edit files in `PROJECT_DIR` without asking
  you first. That is what makes unattended submissions work, and it is also
  why anyone who can submit to the portal can effectively drive an agent on
  your machine. `AGENT_RUNNER=codex` runs with `--sandbox danger-full-access`,
  which is the equivalent posture for Codex: the risk described here applies
  the same way regardless of which runner is configured.
- **Run it only on a network you control.** Localhost, a VPN such as
  Tailscale or WireGuard, or a tunnel that has its own authentication in
  front. Never expose the portal bare to the internet.
- **Login links are the only authentication.** Anyone who can read a
  registered user's mailbox can log in. Protect the email accounts in
  `users.json` (or the allowlist, for legacy installs) with strong
  passwords and two-factor authentication, and keep the list short.
- **Costs.** Each submission is a real AI session, typically several minutes
  of agent work, and each round of notes extends it. If you are paying per
  token, expect portal use to show up on the bill; if you are on a
  subscription plan, it draws from the same usage limits as your normal
  sessions.
- **No helper mode.** The portal is strictly one person per login: each
  registered email sees only its own sessions and deliverables. Someone
  helping with another person's search does so via Claude Code on the CLI,
  working inside that person's project folder directly, rather than by
  logging into the portal as them.

### Multi-user isolation, honestly stated

Isolation between users is enforced at the application layer: every API
route is scoped to the logged-in email, downloads are confined to that
user's project folder, and each agent session runs inside that user's
project only. What the portal does NOT provide is operating-system
isolation: all agent sessions run as the same OS account, with the same
filesystem permissions and the same AI credentials. A determined user
could try to steer the agent (via a crafted "job description") toward
reading files outside their project; the prompt and the download
containment resist this, but the OS does not enforce it. Share a portal
instance only with people you trust, such as family or a small circle.
Anything wider needs per-user OS accounts or containers, which is out of
scope for this kit.

### Public-repo hygiene

`portal/.gitignore` already excludes `.env`, `data/` (which holds
`users.json` and the SQLite database), and `node_modules/`. Never commit
real emails, names, or project paths; that is why only
`users.example.json` is tracked, not `users.json` itself.

## Appendix: reverse proxy on a public domain (advanced, existing installs)

Tailscale (`docs/portal-remote-access.md`) is the recommended way to reach
the portal remotely, and is the right choice for almost everyone. This
appendix documents a different topology: a public domain name, port
forwarding, and a reverse proxy terminating TLS, which is how the
maintainer's own live instance runs. It is here for people who already have
this kind of setup for other services and want to add the portal to it, not
as a recommendation to build one from scratch. It assumes comfort with a
router's admin page, DNS, and running a proxy as a service or in Docker.

The shape of it:

```
dynamic DNS name --> port forward on your router --> Caddy (TLS) --> portal
```

1. **A stable public name.** If you do not own a domain, a free dynamic DNS
   service (DuckDNS is a common choice) gives you a hostname such as
   `yourname.duckdns.org` that always resolves to your current public IP,
   updated by a small client you run on the host. A domain you own with an
   A record pointed at your public IP works the same way, and does not need
   the updater unless your IP changes.
2. **Port forwarding.** On your router, forward ports 80 and 443 to the
   internal address of the host running Caddy. Port 80 is needed briefly for
   Let's Encrypt's HTTP challenge even if you only ever use 443 afterwards.
3. **Caddy as the reverse proxy.** Caddy gets you a valid TLS certificate
   automatically and renews it without further attention. A minimal
   Caddyfile:

   ```
   yourname.duckdns.org {
       reverse_proxy 172.18.0.1:8710
   }
   ```

   Replace the address with whatever the portal actually listens on: the
   host's own address if Caddy runs on the same machine, or the Docker
   bridge gateway (as above) if Caddy runs in a container and the portal
   runs on the host.
4. **Set `EXPOSURE=public` in the portal's `.env`.** This is not optional.
   `EXPOSURE` describes reachability, not which tool did the publishing: a
   proxied public domain is exactly as reachable from the internet as a
   Tailscale Funnel install, so it is held to the same 64-character
   `COOKIE_SECRET` bar, for the same reason: the login cookie is the only
   thing between a stranger and an agent running with `bypassPermissions`
   inside your project.
5. **Leave `BIND_HOST` at its default, or set it to an address the proxy can
   actually reach.** The portal's built-in default is already `0.0.0.0`, all
   interfaces, which is what this setup generally needs: a Caddy instance
   running in Docker cannot reach the host's loopback address at all, so
   narrowing `BIND_HOST` to `127.0.0.1` (the value Tailscale setups use,
   where Tailscale itself connects locally) would break it here. Only set
   `BIND_HOST` explicitly if you need to restrict the portal to a specific
   interface the proxy can reach.
6. **`BASE_URL` is your public hostname over https**, for example
   `https://yourname.duckdns.org`. As with any setup, plain http will not
   work past localhost, because the session cookie is `Secure`.

Keep the router, the dynamic DNS updater, and Caddy itself patched and
running: unlike Tailscale, nothing here has its own authentication layer in
front of the portal's login page, so the login cookie really is the only
defence, exactly as it is for Funnel.
