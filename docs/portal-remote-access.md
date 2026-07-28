# Publishing the portal for remote access

This is a runbook for the assistant, not the user. It describes the commands
to run and the words to say when a user wants to reach their already-running
portal from a phone or another device. Follow it during setup session C, or
any later session where the user asks for remote access.

Prerequisites, all inside `portal/`: `npm install` has been run, `.env`
exists (copied from `.env.example`), and at least one user is registered
(either in `data/users.json` or via `ALLOWED_EMAILS`). If any of those is
missing, sort it out first using `docs/portal.md`; this runbook assumes a
portal that already runs locally.

The mechanism is Tailscale: a VPN that gives the machine a stable HTTPS
name and terminates TLS locally, so no third party, including Tailscale
itself, sees the portal's traffic in plaintext. That is true of both options
below.

## The four human gates

Everything else in this document is mechanical and the assistant should just
do it. Four points need the human, and it is worth naming them to the user
up front so nothing feels sprung on them:

1. **Choosing serve or funnel.** This is a decision about who can reach the
   portal, and it is the user's to make, not the assistant's.
2. **Approving `tailscale up` in a browser.** Logging the machine into the
   user's Tailscale account opens a browser window and needs a human click.
3. **Creating the email account, or generating a Gmail app password.** The
   assistant cannot do this on the user's behalf.
4. **Confirming the machine will stay awake.** Only the user knows whether
   the machine they are publishing from is going to be left running.

## Presenting the choice

Ask the user to choose between two ways of publishing the portal, and show
them this table:

| | `tailscale serve` | `tailscale funnel` |
|---|---|---|
| Reachable from | the user's own devices only | the public internet |
| Device needs | the Tailscale app, signed in | nothing, any browser |
| URL | `https://<machine>.<tailnet>.ts.net` | same |
| TLS terminates | on the user's machine | on the user's machine |
| Exposure written to `.env` | `EXPOSURE=private` | `EXPOSURE=public` |

Recommend `serve`. It is the default: the portal is reachable only from
devices already signed in to the user's own tailnet, nothing is publicly
reachable, and there is no downstream cost to weigh.

State Funnel's cost plainly, because the user needs to choose with their
eyes open, not have it softened: with Funnel, the portal's login page sits
on the public internet, and behind that login page are AI agent sessions
running with `bypassPermissions` inside the user's project folder, able to
run commands and edit files without asking anyone first. The only thing
standing between a stranger on the internet and those sessions is the
signed login cookie. That is why `configure funnel` demands a 64-character
`COOKIE_SECRET` and refuses to publish without one; it will not let a weak
secret through even if the user says yes. Offer Funnel only to a user who
wants to submit from a borrowed device or does not want to install an app
on every phone; otherwise `serve` is the right answer.

## The sequence

Run these from `portal/`, in order.

1. `./setup-remote.sh check`

   Reports the platform, Node version, whether dependencies are installed,
   whether `.env` exists, and whether Tailscale is installed and logged in.
   It changes nothing. Fix anything it flags as missing before continuing.

2. `./setup-remote.sh install`

   Installs Tailscale: Homebrew on macOS, the official install script on
   Linux and WSL. If Tailscale is already present it says so and does
   nothing further.

3. **Gate: `tailscale up`.** Run `tailscale up` and tell the user a browser
   window is about to open asking them to sign in to (or create) a
   Tailscale account. The assistant cannot click through this; wait for the
   human to confirm they are signed in before moving on.

4. `./setup-remote.sh configure serve` or `./setup-remote.sh configure
   funnel`, matching whichever the user chose in step "Presenting the
   choice" above. For funnel, add `--generate-secret` if the assistant
   already knows `COOKIE_SECRET` is weak or is the placeholder value and
   wants to skip the interactive yes/no prompt; without it, a weak secret
   makes the script ask an *are you sure* question on a terminal, or refuse
   outright when there is no terminal to ask on.

   This command writes `BASE_URL`, `BIND_HOST` and `EXPOSURE` into `.env`
   itself, reading the real tailnet hostname back from `tailscale status`
   rather than guessing it. **Do not hand-edit those three keys**; if
   anything about them looks wrong later (a renamed machine, for instance),
   the fix is to run `configure` again, not to edit `.env` directly.

5. Restart the portal so it picks up the new `.env` values. If it is not
   yet running as a service, `npm start` (or `node src/server.js`) is
   enough for a first check; see `docs/portal.md` for making it survive
   reboots, or run `./setup-remote.sh service` here (add `--write-only` to
   write the systemd unit or launchd plist without enabling or loading it,
   useful if the assistant wants the user to review it first).

6. `./setup-remote.sh verify`

   Proves the whole path works end to end. See "Reading verify output"
   below for what each line means.

## Email

Follow `docs/portal.md`'s SMTP walkthrough for setting up the account the
portal will send login links and deliverables from (an existing mailbox
with SMTP access, or a Gmail app password, or Brevo, or a webhook). That is
where gate 3 lives.

Before the user has any mail account set up, or while diagnosing the rest
of this sequence, set `EMAIL_PROVIDER=log` in `.env`. Nothing is sent
anywhere; the portal prints every outgoing message, including the login
link itself, to its own terminal or log. This lets the assistant prove the
whole publish-and-login chain works, end to end, by reading the link out of
the log and opening it, before the user has decided on an email provider at
all. Switch to a real provider once the user is ready to receive mail on
their phone.

## Reading `verify` output

`verify` runs four checks in order and reports `ok` or `FAIL` on each.

1. **The portal responds on loopback** (`127.0.0.1:<PORT>`). If this fails,
   the portal process itself is not running or not listening; the message
   points at `npm start`. Nothing past this point can pass if this fails,
   because the later checks all depend on a live server.

2. **`BASE_URL` matches the machine's live tailnet name.** `verify` reads
   the tailnet hostname back from `tailscale status`, the same way
   `configure` does, and compares it against what is written in `.env`.
   A mismatch is almost always a renamed machine or a `.env` edited by
   hand; the fix the script prints is to run `configure serve` (or
   `funnel`) again, which is the same fix as above: never hand-edit
   `BASE_URL`.

3. **The public URL serves valid HTTPS.** This calls `BASE_URL` itself,
   without `-k`, so a bad or absent certificate is a failure, not a
   warning. A failure here usually means Tailscale is not actually
   publishing on that hostname; the message points at checking
   `tailscale serve status` or `tailscale funnel status` depending on the
   configured exposure.

4. **The login route accepts requests.** This POSTs a dummy address to
   `/api/login` and only checks that the route answers, not that any mail
   was delivered (login always answers 200, by design, so a stranger can
   never learn who is registered). If this fails while check 3 passed,
   HTTPS itself is fine and the portal's own process is the suspect: check
   its output or service log, and restart it if `.env` has changed since it
   last started.

If all four pass, `verify` says so and prints the address to open. Anything
short of that, fix the failing check before telling the user the portal is
ready to use from their phone.

## Troubleshooting

- **Tailscale is not logged in.** `check` and `verify` both report this as
  an unreadable tailnet name. Run `tailscale up` again (gate 2).
- **Funnel is not enabled for the tailnet.** `configure funnel` will report
  that `tailscale funnel` failed and point at the tailnet's access
  controls; Funnel has to be turned on for the tailnet in the Tailscale
  admin console before the command will succeed, separately from being
  logged in.
- **`BASE_URL` is stale after a machine rename.** Re-run
  `./setup-remote.sh configure serve` or `configure funnel` (whichever the
  user is using); it reads the current hostname back from Tailscale and
  rewrites `.env`. Do not edit `BASE_URL` by hand.
- **The portal is not running when `verify` probes it.** Check 1 fails with
  a pointer at `npm start`. Start it (or check the service unit if one is
  installed) and run `verify` again.
- **The portal refuses to start because preflight found an error.** On
  startup the portal validates its own configuration and refuses to bind if
  something cannot work, printing the specific problem to its log rather
  than failing silently. Common causes on a remote-access setup: a
  `COOKIE_SECRET` that is empty, still the example placeholder, or too
  short for the configured `EXPOSURE` (at least 32 characters for
  `private`, 64 for `public`); a `BASE_URL` that is plain `http` on a
  non-local host, which cannot work at all because the login cookie is
  `Secure` and browsers discard `Secure` cookies sent over `http`; or no
  users configured. Read the printed message, which names the exact field
  and the fix, rather than guessing.

## The sleeping-laptop limitation

The portal has to be running at the moment a submission arrives, and an
agent turn on that submission takes several minutes to finish. A laptop
that goes to sleep between a phone submission and the portal picking it up
simply drops it; there is no code fix for this, because a sleeping machine
answers nothing at all. This is exactly what gate 4 is for: before
finishing remote-access setup, confirm with the user whether the machine
they are publishing from will actually stay awake. Recommend an always-on
machine if one is available (a desktop, a home server, a small always-on
box); failing that, tell the user to keep it plugged into mains power and
disable sleep while the portal needs to be reachable.
