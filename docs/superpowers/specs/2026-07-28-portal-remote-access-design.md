# Portal remote access and agent-driven setup design

Date: 2026-07-28

## Problem

A stranger who clones the kit from GitHub cannot get the portal working, and
the docs do not admit it. Four separate causes:

1. **The deployment layer has never been written down.** The live portal is
   reached over the internet through Caddy, a DuckDNS hostname and a forwarded
   port. No tracked file in the kit mentions Caddy, DuckDNS, reverse proxies or
   port forwarding. `docs/portal.md` stops at "use your platform's service
   manager" (its "Running it" section) and says nothing about TLS, DNS or
   reachability. The layer that turns a localhost app into a portal exists only
   as tribal knowledge.

2. **The obvious do-it-yourself route is silently broken.** `server.js:81`
   always sets the session cookie with `Secure`. Browsers accept `Secure`
   cookies only over HTTPS, with `localhost` as the sole exception. So
   `BASE_URL=http://<LAN-or-tailnet-IP>:8710`, which is exactly what a
   first-timer will try, yields a login link that arrives, works, redirects to
   `/`, drops the cookie, and returns them to the login screen. Forever, with
   no error on either side. Nothing in the docs says `BASE_URL` must be HTTPS.

3. **Email fails quietly, and the documented escape hatch does not exist.**
   Following `docs/portal.md` exactly (`cp .env.example .env`, `npm start`)
   leaves `EMAIL_PROVIDER=smtp` with an empty `SMTP_URL`. nodemailer throws
   `Cannot create property 'mailer' on string ''`, `email.js:81-89` retries
   three times over six seconds, `server.js:72` swallows it into a
   `console.error`, and `app.js:176` tells the user a link is on its way.
   Worse, `docs/portal.md:108-115` claims that with no provider configured,
   login links are "only written to the portal's log" and can be copied from
   there. They are not. `sendViaWebhook` calls `fetch('')`, which throws
   `TypeError: Failed to parse URL from`; only the error is logged, never the
   link. There is no log fallback anywhere in `email.js`.

4. **Nothing validates configuration.** `server.js:228` binds and listens. A
   default `COOKIE_SECRET`, an unreachable `BASE_URL`, a provider with no
   credentials and a missing `users.json` all start cleanly and fail later.

The goal is that a non-technical person, working with their AI assistant,
reaches a portal that is remotely accessible from their phone, without buying a
domain, opening a router port, or handing their traffic to a third party.

## Scope

- Remote access, setup, configuration validation and the surrounding docs.
- Two supported topologies, both built on Tailscale. Caddy, dynamic DNS and
  port forwarding move to a documented appendix for existing installs.
- Multi-provider support (root `AGENTS.md` symlink, Codex runner, the
  getting-started guide's provider chapter) is deliberately **out of scope**
  and becomes its own spec. It is sequenced second because its guide chapter
  has to describe the portal path this spec defines.
- Also out of scope: VPS hosting, Windows-native (WSL only), Headscale, and
  OS-level isolation between portal users, which `docs/portal.md` already
  states honestly as a limitation.

## Approach

Publish the portal with Tailscale and bind the server to loopback. The user
picks one of two topologies during setup, and both terminate TLS on their own
machine.

### Why Tailscale for both options

Cloudflare Tunnel was considered and rejected. It is neither broken nor
unsafe, but it terminates TLS at Cloudflare's edge, so a third party sees
portal traffic in the clear. This portal carries CVs, salary floors and
application history. Tailscale Funnel provides the same "any browser, no app
installed" capability without that trade: Funnel relay servers proxy the raw
TCP connection and never terminate TLS, so termination happens on the user's
own machine with their own `.ts.net` certificate. Choosing Tailscale for both
options also collapses the setup script to a single install path.

Cloudflare Tunnel additionally needs a Cloudflare account and a purchased
domain, two web signups and a payment the agent cannot perform for the user.
Tailscale needs one account and no domain.

### The two topologies

| | Option A: `tailscale serve` | Option B: `tailscale funnel` |
|---|---|---|
| Reachable from | the user's own devices only | the public internet |
| Device needs | Tailscale app, logged in | nothing, any browser |
| URL | `https://<machine>.<tailnet>.ts.net` | same |
| TLS terminates | on the user's machine | on the user's machine |
| Third party sees plaintext | no | no |
| Exposure | nothing is publicly reachable | the login page is public |

Option A is the default and the recommendation. Option B exists for people who
want to submit from a borrowed device, or who will not install an app on every
phone.

Option B's cost is stated plainly in the docs rather than softened: behind that
public login page are agent sessions running with `bypassPermissions` inside
the user's project. Under Funnel, the magic-link auth and the `users.json`
allowlist are the only barrier. Funnel listens only on ports 443, 8443 and
10000; the portal keeps its own port and Funnel maps 443 to it.

Because that barrier is thinner, Funnel is **gated on a strong
`COOKIE_SECRET`, enforced at runtime rather than only at setup**. The
mechanism is a recorded exposure mode: `EXPOSURE=private|public` in `.env`,
written by `configure`, with preflight raising the `COOKIE_SECRET` bar when
the value is `public`. A secret that was adequate for a private tailnet
therefore cannot be carried into public exposure, and someone who later
weakens the secret is caught on the next start rather than never.

`EXPOSURE` deliberately describes **reachability, not tooling**. `configure
serve` writes `private`, `configure funnel` writes `public`, and the Caddy
appendix instructs existing public installs to declare `public` too. Keying
the bar on the word "funnel" would have been the obvious implementation and
the wrong one: it would leave a publicly reachable Caddy install held to a
lower standard than a Funnel install with identical exposure. The thresholds
are in component 2.

### Division of labour

The agent does everything mechanical. Four gates need the human, and the
runbook names them explicitly so the agent stops cleanly at each:

1. Choosing Option A or B (a conversation, using the table above).
2. Approving `tailscale up` in a browser.
3. Creating the email account, or generating a Gmail app password.
4. Confirming the machine will stay awake.

## Components

### 1. `portal/setup-remote.sh`: the mechanical steps

A new script, bash 3.2 compatible per the kit's standing constraint (no
associative arrays, no `readarray`, no `sed -i`, no `${var,,}`, no GNU-only
flags). Every subcommand is idempotent and exits non-zero with a plain-English
reason on failure.

```
setup-remote.sh check                    what is installed, what is missing
setup-remote.sh install                  tailscale, per-OS
setup-remote.sh configure serve|funnel   publish the portal port, print BASE_URL
setup-remote.sh service                  systemd user unit or launchd plist
setup-remote.sh verify                   end-to-end proof
```

- `check` reports OS, node version, whether `portal/node_modules` exists,
  whether `tailscale` is installed, and whether the daemon is logged in. It
  changes nothing.
- `install` uses `brew install tailscale` on macOS and the official install
  script on Linux and WSL. If Tailscale is already present it says so and
  returns 0.
- `configure` runs `tailscale serve --bg <port>` or `tailscale funnel --bg
  <port>`, then reads the resulting hostname back from `tailscale status
  --json` and prints the `BASE_URL` line the agent writes into `.env`. The
  hostname is read back rather than constructed, so a renamed machine or a
  tailnet with a custom name still produces a correct URL. It also writes
  `BIND_HOST=127.0.0.1`, and `EXPOSURE=private` for serve or `EXPOSURE=public`
  for funnel.
- `configure funnel` is gated. Before publishing anything it checks
  `COOKIE_SECRET` against the funnel threshold in component 2. If the secret is
  too weak it stops, explains that Funnel puts the login page on the public
  internet, and offers to generate a replacement with `openssl rand -hex 32`,
  writing it to `.env` on confirmation. Rotating the secret invalidates
  existing login cookies, which the script says out loud; at setup time that
  costs nothing, and `docs/portal.md` already recommends rotation as the way to
  evict a removed user. The gate is a stop, not a warning: it will not publish
  a Funnel with a weak secret even if the user insists, because the failure
  mode is a stranger driving an agent with `bypassPermissions` on their
  machine. `configure funnel` also refuses when no user is registered, and
  reports how many addresses are on the allowlist, since each is now an
  internet-reachable login.
- `service` writes the unit or plist for the portal itself, reusing the
  existing examples in `docs/portal.md`, and enables lingering on Linux.
- `verify` is the reason this is a script and not prose. It asserts, in order:
  the portal answers on `127.0.0.1:<port>`; the public URL returns 200 over
  HTTPS with a certificate that validates; the hostname in `.env`'s `BASE_URL`
  matches the live Tailscale hostname; and `POST /api/login` round-trips. Each
  assertion prints a pass or a specific failure. A half-finished setup fails
  here, at setup time, rather than at 11pm from a phone.

### 2. `portal/src/preflight.js`: startup validation

A new module exporting `checkConfig(config)`, returning an array of
`{ level, message }` where `level` is `error` or `warn`. `server.js` calls it
before listening: warnings print, any error prints and exits non-zero.

Errors:

- `COOKIE_SECRET` is unset, still the `.env.example` placeholder, or shorter
  than 32 characters. When `EXPOSURE=public` the threshold rises to 64
  characters, matching `openssl rand -hex 32`, which `docs/portal.md` already
  recommends and which is therefore a bright line rather than an arbitrary
  one. The error message names the exposure mode as the reason, so the user
  understands why a secret that worked yesterday is refused today, and gives
  both remedies: rotate the secret, or stop exposing the portal publicly.
- `EXPOSURE` is set to anything other than `private` or `public`.
- `BASE_URL` uses `http:` and its host is not `localhost` or `127.0.0.1`. This
  configuration cannot work, because the `Secure` cookie set at
  `server.js:81` will be discarded by the browser. Failing to start is
  deliberate: the alternative is a login page that silently never works, which
  is the single hardest failure in this system to diagnose without reading the
  source. The message names the cause and points at the two Tailscale options.
- The selected `EMAIL_PROVIDER` has no credentials: `smtp` with empty
  `SMTP_URL`, `brevo` with empty `BREVO_API_KEY`, `webhook` with empty
  `WEBHOOK_URL`.
- `EMAIL_PROVIDER` is set to an unknown value.
- Neither a users file nor `ALLOWED_EMAILS` is present.
- A configured `projectDir` does not exist on disk.

Warnings:

- `EMAIL_PROVIDER` is unset, noting that `config.js:17` silently defaults it to
  `webhook`.
- `BIND_HOST` is not loopback, noting the portal is reachable on the local
  network. This is a warning rather than an error because the Caddy topology
  legitimately needs a non-loopback bind (see component 4).
- `EXPOSURE` is unset, noting that it is being treated as `private` and that a
  publicly reachable install should declare `public`. Unset defaults to
  `private` so existing installs keep starting; the warning is what moves them
  to declare their real exposure, and the Caddy appendix says to do so.

### 3. `portal/src/email.js`: a real `log` provider

Add `log` to `PROVIDERS`, writing recipient, subject, body and attachment
filenames to stdout and resolving. This makes the smoke-test escape hatch that
`docs/portal.md` already promises actually exist, which is better than deleting
the paragraph: a first-timer can start the portal with no email account at all,
copy the login link from the terminal, and confirm the rest of the system works
before touching SMTP.

`log` is never a default. `config.js`'s fallback stays `webhook`, because
changing it would alter behaviour for existing installs, and preflight now
warns when the fallback is in play.

### 4. `portal/src/server.js` and `config.js`: configurable bind address

Add `bindHost: process.env.BIND_HOST || '0.0.0.0'` to `config`, and pass it to
`listen`. Today `server.js:228` binds all interfaces unconditionally, so a
laptop running the portal on a café network offers its login page to that
network.

The default deliberately stays `0.0.0.0` rather than becoming loopback.
Loopback is the right value for both Tailscale topologies, where the publisher
connects locally, but it is the wrong value for the existing Caddy topology:
the live instance is reached from Caddy running in Docker at `172.18.0.1:8710`,
so a loopback default would 502 it on the next restart, and preflight could not
distinguish that mistake from a legitimate Tailscale setup.

Instead, `setup-remote.sh configure` writes `BIND_HOST=127.0.0.1` into `.env`
explicitly as part of Tailscale setup. New installs get the closed default
where it is correct and verifiable; existing installs are untouched and need no
migration step anyone could forget.

### 5. `portal/.env.example`

`EMAIL_FROM` becomes empty, matching `SMTP_URL`. It currently ships
`Job Search Portal <portal@example.com>`, which looks filled in, so a
half-edited file leaves a sender address Gmail rejects outright. Add commented
`BIND_HOST` and `EMAIL_PROVIDER=log` lines with one-line explanations, and an
`EXPOSURE=private` line noting that `public` requires a 64-character
`COOKIE_SECRET` and that `setup-remote.sh configure` sets this for you.

### 6. `setup/setup.sh`: honest portal messaging

On `PORTAL=yes` the wizard prints `Portal: registered ...`, which reads as
though something is now working. For a lone downloader nothing is running. The
message gains a line saying registration is recorded but the portal itself is
not yet set up, and that the assistant will do that in a later session.

The dependency check (currently git, python3, pyyaml, typst and AI CLIs) gains
a node check, reported only when `PORTAL=yes`.

`SETUP.md.tmpl`'s inserted portal task points at the new runbook instead of
`docs/portal.md`. The literal phrase "If you chose the portal" is preserved,
because `setup/test/run-tests.sh` greps for it.

### 7. `docs/portal-remote-access.md`: the runbook

New file, the document the agent follows. Contents: the choice table and how to
present it; the four human gates and how to hand off at each; the subcommand
order; what to write into `.env` after `configure`; how to read `verify`'s
output; and a troubleshooting section covering the failures we know are likely
(Tailscale not logged in, Funnel not enabled in the tailnet policy, a stale
`BASE_URL` after a machine rename, the portal not running when `verify` probes
it).

### 8. `docs/portal.md`: corrections

- Replace the false log-fallback paragraph at lines 108-115 with an accurate
  description of `EMAIL_PROVIDER=log`.
- State that `BASE_URL` must be HTTPS unless it is localhost, with the reason.
- Point at the new runbook from "Running it", keep the systemd and launchd
  examples, and add the Caddy, dynamic DNS and port-forwarding topology as an
  appendix marked as advanced and for existing installs. That appendix must
  tell such installs to set `EXPOSURE=public`, since they are publicly
  reachable and the raised `COOKIE_SECRET` bar should apply to them for the
  same reason it applies to Funnel.
- Document `EXPOSURE` and the two `COOKIE_SECRET` thresholds in the field-by-
  field walkthrough, alongside the existing `openssl rand -hex 32` advice.
- Reconcile the Node version, stated as `>=18` in `package.json`, "18 or newer
  (20+ recommended)" here, "Node 20+" in `CLAUDE.md` and "20 or newer" in
  `guide.typ`. Settle on the `package.json` floor and say it once.

### 9. `README.md`

Link `docs/getting-started/` prominently near the top, above Installation.
This is the highest-value single line in the spec: the beginner's guide is
good and currently nothing in the repository references it, so the audience it
was written for never finds it. Also mention Node for the portal, state that a
paid Claude plan is required (as `guide.typ` correctly does and the README does
not), and drop the vestigial "Set up your file tracker connection" wording left
over from the Grist era.

## Tests

Following the two existing suites.

`setup/test/run-tests.sh`, with a stub `tailscale` earlier on `PATH` that
records its arguments and emits canned `status --json`:

- `check` reports missing Tailscale without failing.
- `install` is idempotent when Tailscale is already present.
- `configure serve` and `configure funnel` each invoke the right subcommand.
- `configure` derives `BASE_URL` from `status --json`, not from the machine
  name, proving the read-back.
- `configure serve` writes `EXPOSURE=private`; `configure funnel` writes
  `EXPOSURE=public`; both write `BIND_HOST=127.0.0.1`.
- `configure funnel` with a weak `COOKIE_SECRET` exits non-zero and, crucially,
  never invokes `tailscale funnel`. The stub asserts it was not called, so the
  gate is proven to stop before publishing rather than after.
- `configure funnel` with a weak secret and confirmation writes a 64-character
  secret to `.env`, then proceeds.
- `configure funnel` with an empty allowlist exits non-zero.
- `configure serve` with a 32-character secret succeeds, proving the raised bar
  is scoped to public exposure.
- `configure` with a bad argument exits non-zero.
- The wizard's portal message includes the not-yet-set-up line.
- The existing "If you chose the portal" grep still passes.

`portal/npm test`, using node:test:

- `checkConfig` flags each error condition above, and returns clean for a
  valid config.
- `http:` plus a non-localhost host is an error; `http://localhost` is not.
- A short or placeholder `COOKIE_SECRET` is an error.
- A 32-character `COOKIE_SECRET` passes under `EXPOSURE=private` and fails
  under `EXPOSURE=public`; a 64-character one passes under both.
- Unset `EXPOSURE` behaves as `private` and warns.
- An unrecognised `EXPOSURE` value is an error.
- Unset `EMAIL_PROVIDER` warns rather than errors.
- The `log` provider resolves and writes the recipient, subject and attachment
  filenames.
- `log` is reachable through `sendEmail`, including the allowlist check at
  `email.js:74` and `normaliseAttachments`.

`verify` needs real network and a real tailnet, so it is a manual smoke step
in the Verification section below, not automated.

## Rollout

The live instance at `jawbs.duckdns.org` must keep working. Its traffic path is
DuckDNS to an Oracle VPS, over WireGuard, to Caddy running in Docker, which
reaches the portal at `172.18.0.1:8710`. Three consequences:

- `BIND_HOST` keeps its `0.0.0.0` default precisely so this path survives a
  restart. See component 4.
- The `BASE_URL` check passes, because the instance is served over HTTPS.
- `EMAIL_PROVIDER=webhook` with a populated `WEBHOOK_URL` (the local n8n
  workflow) passes the credentials check.

The pre-deploy actions, both to be done before restarting rather than after:

1. That instance is publicly reachable, so set `EXPOSURE=public` in its `.env`.
   Left unset it would start and merely warn, but it would then be held to the
   32-character bar despite being exactly the exposure the 64-character bar
   exists for.
2. Consequently, confirm its `COOKIE_SECRET` is at least 64 characters, and
   rotate it with `openssl rand -hex 32` if not. Preflight will refuse to start
   otherwise. Rotation logs everyone out, so warn the portal's registered users
   before the restart rather than after.

That host runs Node 18, which is why the Node floor in component 8 settles on
`package.json`'s `>=18` rather than the 20+ quoted elsewhere in the docs.

Per `MEMORY.md`, this checkout is pull-only. The branch is pushed to the public
repo from `~/j4dev`, never from here, and live service or database changes are
run by Sam.

## Verification

- `bash setup/test/run-tests.sh`
- `cd portal && npm test`
- Manual, on a clean machine or VM: clone, run the wizard, follow
  `docs/portal-remote-access.md` as the agent would, and confirm
  `setup-remote.sh verify` passes for Option A and then Option B.
- Manual: set `BASE_URL=http://192.168.1.10:8710` and confirm the portal
  refuses to start with a message naming the cause.
- Manual: with `EXPOSURE=public` and a 32-character `COOKIE_SECRET`, confirm
  the portal refuses to start, and that `setup-remote.sh configure funnel`
  refuses to publish and offers to generate a replacement.
- Manual: with `EMAIL_PROVIDER=log` and no mail account, request a login link
  and complete a login from the link printed to the terminal.

## Known limitation, documented not solved

The portal must be running to accept a submission, and a turn takes minutes. A
laptop that sleeps drops submissions sent from a phone. There is no fix in
code. The runbook says to prefer an always-on machine, or to keep the machine
awake while on mains power, and the fourth human gate exists to make the user
decide this consciously rather than discover it later.
