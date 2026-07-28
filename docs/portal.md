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
- **API access for your AI tool.** By default the portal drives Claude via
  the Claude Agent SDK, which needs either a logged-in Claude Code install or
  an `ANTHROPIC_API_KEY`. Other tools can be wired in; see "Using a different
  LLM" below.
- **An email provider** for sending you the finished PDFs: Brevo, any SMTP
  account, or a webhook you run yourself.

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
- `EXPOSURE`: `private` or `public`, describing whether the portal is
  reachable from the public internet, not which tool you used to publish it.
  A Tailscale Funnel install and a reverse-proxied public domain are both
  `public`. Leave it unset (or `private`) for Tailscale `serve`, a VPN, or
  localhost only. `setup-remote.sh configure` sets this for you when using
  Tailscale.
- `BIND_HOST`: the address the portal listens on. Defaults to loopback
  (`127.0.0.1`), which is correct for Tailscale setups. A reverse proxy
  running on another host, or in a container such as Docker, needs the
  portal to listen on `0.0.0.0` (or the specific interface the proxy can
  reach) since it cannot reach loopback.
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
- `AGENT_MODEL`: the Claude model used for portal sessions.
- `AGENT_RUNNER`, `AGENT_CMD`, `AGENT_CMD_RESUME`: see "Using a different
  LLM" below. Leave at the defaults to use the Claude Agent SDK.
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

## Using a different LLM

The portal is Claude-first but not Claude-only. Two mechanisms:

- **`AGENT_RUNNER`** selects how sessions run. `claude-sdk` (the default)
  uses `@anthropic-ai/claude-agent-sdk` in-process. `cli` shells out to a
  command-line tool using the templates below.
- **The runner contract.** Adding first-class support for another LLM means
  writing one file under `src/runners/` that exports a single async
  function taking `{ prompt, systemPrompt, resumeSessionId, cwd, model }`
  and returning `{ sessionId, text }` (the contract is documented in
  `src/agent.js`), then wiring it into the runner switch there.

For CLI tools you usually do not need a new runner file. Set
`AGENT_RUNNER=cli` and provide command templates:

- `AGENT_CMD`: the command for a fresh session. `{model}` is substituted.
- `AGENT_CMD_RESUME`: the command for resuming a session. `{sessionId}` is
  substituted.

The prompt is piped to the command's stdin. A worked Claude Code CLI
example:

```bash
AGENT_RUNNER=cli
AGENT_CMD=claude -p --output-format json --model {model}
AGENT_CMD_RESUME=claude -p --output-format json --resume {sessionId}
```

One limitation: command templates are split on whitespace, so quoted
arguments containing spaces are not supported. If your tool needs an
argument with spaces in it, wrap the invocation in a small shell script and
point the template at that instead.

## Security

Take this section seriously before exposing the portal to anything.

- **The agent runs with bypassPermissions inside your project.** A portal
  session can run commands and edit files in `PROJECT_DIR` without asking
  you first. That is what makes unattended submissions work, and it is also
  why anyone who can submit to the portal can effectively drive an agent on
  your machine.
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
5. **Set `BIND_HOST` to an address the proxy can actually reach.** The
   portal defaults to loopback (`127.0.0.1`), which is correct for
   Tailscale but wrong here whenever the proxy is not on the exact same
   network namespace as the portal. A Caddy instance running in Docker
   cannot reach the host's loopback address at all: set `BIND_HOST=0.0.0.0`
   (or the specific interface the container's network can reach) so the
   portal is listening somewhere the proxy can connect to.
6. **`BASE_URL` is your public hostname over https**, for example
   `https://yourname.duckdns.org`. As with any setup, plain http will not
   work past localhost, because the session cookie is `Secure`.

Keep the router, the dynamic DNS updater, and Caddy itself patched and
running: unlike Tailscale, nothing here has its own authentication layer in
front of the portal's login page, so the login cookie really is the only
defence, exactly as it is for Funnel.
