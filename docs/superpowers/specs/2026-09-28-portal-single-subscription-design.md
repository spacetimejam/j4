# Portal: running on one subscription

Date: 2026-09-28. Status: design approved in conversation, awaiting spec review.

## Intent

Since the ChatGPT drafting change (`2026-09-28-portal-chatgpt-drafting-design.md`),
a portal running the default `claude-sdk` runner needs a Claude subscription
and a ChatGPT subscription. Someone installing the kit with only one of them
gets a portal where every CV and cover letter waits forever: each stage 2 turn
blocks on the writer and emails the admins.

The owner wants a portal host with one subscription to be able to use only
that one, as an explicit, opt-in choice: nothing falls back to a single
subscription on its own.

Agreed in conversation:

1. The choice belongs to the portal install, not to each portal user. The
   subscriptions are the host's; users never bring their own.
2. The choice is a `.env` setting plus a startup check (option 1 of 2 offered;
   an interactive confirmation script was declined).
3. Being signed out of ChatGPT warns at startup rather than refusing to start.
4. Neither route works with no ChatGPT account at all: `codex login` accepts
   only a ChatGPT login, an API key or an access token (checked on beep).

Success: with `SUBSCRIPTIONS=claude-only` the portal drafts with Claude alone and
never calls Codex; with the setting left at its default on a machine that has
never had Codex installed, the portal refuses to start and says what to do;
beep behaves exactly as it does today.

## The setting

`SUBSCRIPTIONS` in `portal/.env`, read by `config.js` as `config.subscriptions`:

| Value | Meaning |
|---|---|
| `both` (default when unset) | Claude runs the portal; ChatGPT writes the CV and cover letter copy. Current behaviour. |
| `claude-only` | Claude writes the copy itself, as before the drafting change. |
| `chatgpt-only` | ChatGPT does everything, through the existing codex runner (`AGENT_RUNNER=codex`). |

The drafting route is on exactly when `subscriptions === 'both'` and the runner
is in `STRUCTURED_RUNNERS`. That one condition is exported from `agent.js`
(for example `draftingEnabled(config)`) so the prompt and the queue cannot
disagree.

- **`agent.js`**: `portalPrompt` takes a `drafting` option alongside
  `structured`, and appends `draftingProtocol` only when it is true.
  Structured runners without drafting get the structured protocol alone, so
  Claude drafts per the project's WORKFLOW.md as it did before.
- **`queue.js`**: the provenance check after delivery (`unprovenancedDeliveries`
  and its admin alert) runs only when drafting is enabled. The
  `drafting_blocked` handling stays unconditional: it acts only on a field the
  agent sets, and without the protocol the agent has no reason to set it.
- **`reply-schema.js`** is unchanged. `drafting_blocked` stays a required,
  nullable field; under `claude-only` it is always null.

## Startup check

`checkConfig` in `preflight.js` gains a subscriptions section. Errors stop the
portal starting, as the existing checks do; warnings print and continue.

| Condition | Result |
|---|---|
| `SUBSCRIPTIONS` is set to anything other than the three values | error, naming the valid values |
| `claude-only` with `AGENT_RUNNER=codex` | error: the settings contradict each other |
| `chatgpt-only` with a runner other than `codex` | error: set `AGENT_RUNNER=codex` |
| `AGENT_RUNNER=codex` with `both` (including unset) | error: the codex runner uses ChatGPT alone, so confirm with `SUBSCRIPTIONS=chatgpt-only` |
| `both`, structured runner, no executable at `CODEX_BIN` | error: install Codex and sign in to ChatGPT, or set `SUBSCRIPTIONS=claude-only` if you only have Claude |
| `both`, structured runner, `codex login status` exits non-zero | warning: drafts will wait until someone runs `codex login` as the service user |

The Codex path is the one the writer uses (`CODEX_BIN` from `drafting.js`), not
a `PATH` lookup, because systemd user units often lack `~/.local/bin`. The login
probe runs `codex login status` with stdin closed and a short timeout (5
seconds); a timeout counts as not signed in. On beep it returns in about 50 ms.

Signed out is a warning, not an error, because ChatGPT logins lapse on their
own: refusing to start would turn a routine restart after a lapse into a full
outage (sign-in, assessments, interview prep), whereas the running portal
already handles a lapsed login with a waiting draft, a Retry button and an
admin email.

`cli` runners are not checked against the setting: they receive the fenced
protocol and never draft through ChatGPT, whatever the value.

Both probes are injected into `checkConfig` (as `lookupBin` and `exists` are
today) so tests need no real Codex.

## Docs

- `portal/.env.example`: the setting, its three values and what each needs.
- `docs/portal.md`: a short section on choosing subscriptions, including the
  no-account answer and pointing `chatgpt-only` at the codex runner and
  `npm run calibrate`.
- `CLAUDE.md`: amend the ChatGPT drafting Key-decisions entry to say it applies
  under `SUBSCRIPTIONS=both`, and that single-subscription hosts opt out with an
  explicit setting, never automatically.

## Testing

`npm test` (node:test):

- `preflight`: each row of the table above, with injected probes; beep's
  configuration (`both`, `claude-sdk`, Codex present and signed in) passes
  with no new warning.
- `agent`: `portalPrompt` includes the drafting section only with
  `drafting: true`; `draftingEnabled` for each setting and runner.
- `queue`: under `claude-only`, a CV delivered with no provenance sends the user
  email and no admin alert; under `both`, the existing alert test still passes.

Live check, in a scratch portal on a spare port: start with
`SUBSCRIPTIONS=claude-only` and `CODEX_BIN` pointing nowhere (starts cleanly),
then with the default and the same `CODEX_BIN` (refuses, with the message).

## Rollout

Merge, push from `~/j4dev`, pull into `~/j4` and restart on the owner's
go-ahead. No `.env` change is needed on beep.

## Out of scope

Per-user subscription choices; automatic fallback between writers; checking
the Claude login at startup; calibrating or changing the codex runner.
