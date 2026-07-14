# Multi-User Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the portal serve multiple job-seekers from one instance, each login email mapped to its own project folder, with strict per-user data isolation, while keeping the repo safe to publish publicly.

**Architecture:** Replace the global `ALLOWED_EMAILS`/`PROJECT_DIR`/`USER_NAME` env trio with a gitignored per-email user registry (`data/users.json`). Every DB query that touches sessions is scoped by the logged-in email; file downloads are additionally confined to the requesting user's project directory; each agent run receives the submitting user's name and project dir. A legacy fallback synthesises a single-user registry from the old env vars so existing installs and the existing test suite keep working.

**Tech Stack:** Node 20+, Express, better-sqlite3, node:test. No new dependencies.

## Global Constraints

- No secrets or personal data in tracked files: `users.json` lives under `portal/data/` which is already in `portal/.gitignore` (alongside `.env` and `node_modules/`). Only `users.example.json` is committed.
- Cross-user access must return **404**, not 403, so the API never confirms another user's session IDs exist.
- Backward compatible: with no users file present, the old `ALLOWED_EMAILS` + `PROJECT_DIR` + `USER_NAME` env vars still work (first email = admin).
- All tests run with `npm test` from `portal/` (it runs `node --test test/`). Run it after every task; the full suite must pass before each commit.
- British English in docs and user-facing copy; no dashes as punctuation in email copy.

---

### Task 1: User registry module

**Files:**
- Create: `portal/src/users.js`
- Create: `portal/users.example.json`
- Modify: `portal/src/config.js`
- Test: `portal/test/users.test.js`

**Interfaces:**
- Produces: `getUser(email) -> { name, projectDir, admin } | null`, `allowedEmails() -> string[]` (lowercased), `adminEmails() -> string[]` (falls back to all users if none flagged). All later tasks import these from `./users.js`.

- [ ] **Step 1: Write the failing test**

```js
// portal/test/users.test.js
import test from 'node:test';
import assert from 'node:assert';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dir = mkdtempSync(join(tmpdir(), 'users-'));
const usersFile = join(dir, 'users.json');
writeFileSync(usersFile, JSON.stringify({
  'Alice@Test.com': { name: 'Alice', projectDir: '/home/x/job-search-alice', admin: true },
  'bob@test.com': { name: 'Bob', projectDir: '/home/x/job-search-bob' },
}));

process.env.DB_PATH = ':memory:';
process.env.PORTAL_USERS_FILE = usersFile;
const { getUser, allowedEmails, adminEmails } = await import('../src/users.js');

test('getUser normalises case and whitespace', () => {
  const u = getUser('  alice@test.COM ');
  assert.deepEqual(u, { name: 'Alice', projectDir: '/home/x/job-search-alice', admin: true });
});

test('getUser returns null for unknown email', () => {
  assert.equal(getUser('evil@test.com'), null);
});

test('allowedEmails lists lowercased registry keys', () => {
  assert.deepEqual(allowedEmails().sort(), ['alice@test.com', 'bob@test.com']);
});

test('adminEmails returns flagged admins', () => {
  assert.deepEqual(adminEmails(), ['alice@test.com']);
});

test('registry edits are picked up without restart', () => {
  writeFileSync(usersFile, JSON.stringify({
    'bob@test.com': { name: 'Bob', projectDir: '/home/x/job-search-bob' },
  }));
  assert.equal(getUser('alice@test.com'), null);
  // no admins flagged: fall back to all users so alerts still go somewhere
  assert.deepEqual(adminEmails(), ['bob@test.com']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd portal && node --test test/users.test.js`
Expected: FAIL (cannot find module `../src/users.js`)

- [ ] **Step 3: Write the implementation**

Add to `portal/src/config.js` inside the `config` object:

```js
  usersFile: process.env.PORTAL_USERS_FILE || new URL('../data/users.json', import.meta.url).pathname,
```

Create `portal/src/users.js`:

```js
import { readFileSync } from 'node:fs';
import { config } from './config.js';

// The registry is read on every call: it is tiny, and live edits (adding a
// user, revoking one) must take effect without a restart. If the file is
// missing, fall back to the legacy single-user env configuration so old
// installs keep working unchanged.
function loadUsers() {
  let raw;
  try {
    raw = readFileSync(config.usersFile, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return legacyUsers();
    throw err;
  }
  const parsed = JSON.parse(raw);
  const users = {};
  for (const [email, u] of Object.entries(parsed)) {
    if (!u || typeof u.name !== 'string' || typeof u.projectDir !== 'string') {
      throw new Error(`users file: entry for ${email} needs "name" and "projectDir" strings`);
    }
    users[email.trim().toLowerCase()] = { name: u.name, projectDir: u.projectDir, admin: !!u.admin };
  }
  return users;
}

function legacyUsers() {
  const users = {};
  config.allowedEmails.forEach((email, i) => {
    users[email] = { name: config.userName, projectDir: config.projectDir, admin: i === 0 };
  });
  return users;
}

export function getUser(email) {
  return loadUsers()[String(email || '').trim().toLowerCase()] || null;
}

export function allowedEmails() {
  return Object.keys(loadUsers());
}

export function adminEmails() {
  const users = loadUsers();
  const admins = Object.keys(users).filter(e => users[e].admin);
  return admins.length ? admins : Object.keys(users);
}
```

Create `portal/users.example.json`:

```json
{
  "alice@example.com": { "name": "Alice Example", "projectDir": "/home/alice/job-search-alice", "admin": true },
  "bob@example.com": { "name": "Bob Example", "projectDir": "/home/alice/job-search-bob" }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd portal && node --test test/users.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the full suite, then commit**

Run: `cd portal && npm test`
Expected: all existing tests still pass (nothing imports users.js yet).

```bash
git add portal/src/users.js portal/src/config.js portal/users.example.json portal/test/users.test.js
git commit -m "feat(portal): per-email user registry with legacy env fallback"
```

---

### Task 2: Auth and outbound email check against the registry

**Files:**
- Modify: `portal/src/auth.js` (the `issueToken` function)
- Modify: `portal/src/email.js` (the allowlist check in `sendEmail`)
- Test: `portal/test/auth.test.js`, `portal/test/email.test.js` (additions only)

**Interfaces:**
- Consumes: `getUser`, `allowedEmails` from Task 1.
- Produces: unchanged public signatures; behaviour now driven by the registry.

- [ ] **Step 1: Write the failing tests**

Both existing test files set `ALLOWED_EMAILS` and no users file, so they exercise the legacy fallback unchanged. Add registry-driven tests in a new file `portal/test/registry-auth.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dir = mkdtempSync(join(tmpdir(), 'regauth-'));
const usersFile = join(dir, 'users.json');
writeFileSync(usersFile, JSON.stringify({
  'alice@test.com': { name: 'Alice', projectDir: dir, admin: true },
}));

process.env.DB_PATH = ':memory:';
process.env.PORTAL_USERS_FILE = usersFile;
process.env.COOKIE_SECRET = 'testsecret';
process.env.EMAIL_PROVIDER = 'webhook';
process.env.WEBHOOK_URL = 'http://example.invalid/hook';
const { issueToken } = await import('../src/auth.js');
const { sendEmail } = await import('../src/email.js');

test('issueToken accepts registry user and rejects strangers', () => {
  assert.ok(issueToken('alice@test.com'));
  assert.equal(issueToken('evil@test.com'), null);
});

test('sendEmail refuses recipients not in the registry', async () => {
  await assert.rejects(
    sendEmail({ to: 'evil@test.com', subject: 's', text: 't' }, { retryDelayMs: 1 }),
    /not on allowlist/
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd portal && node --test test/registry-auth.test.js`
Expected: FAIL (`issueToken('alice@test.com')` returns null because auth.js still reads `config.allowedEmails`, which is empty here)

- [ ] **Step 3: Implement**

In `portal/src/auth.js`, replace the import of `config` usage for the allowlist:

```js
import { getUser } from './users.js';
```

and in `issueToken` replace

```js
  if (!config.allowedEmails.includes(email)) return null;
```

with

```js
  if (!getUser(email)) return null;
```

(`config` is still imported for `cookieSecret`.)

In `portal/src/email.js`, add `import { getUser } from './users.js';` and replace

```js
  if (!config.allowedEmails.includes(String(to).toLowerCase())) {
    throw new Error(`recipient not on allowlist: ${to}`);
  }
```

with

```js
  if (!getUser(to)) {
    throw new Error(`recipient not on allowlist: ${to}`);
  }
```

- [ ] **Step 4: Run tests**

Run: `cd portal && node --test test/registry-auth.test.js && npm test`
Expected: new tests PASS, full suite PASS (legacy fallback keeps old tests green).

- [ ] **Step 5: Commit**

```bash
git add portal/src/auth.js portal/src/email.js portal/test/registry-auth.test.js
git commit -m "feat(portal): drive login and outbound-email allowlists from the user registry"
```

---

### Task 3: Scope every session route to the logged-in user

**Files:**
- Modify: `portal/src/server.js` (routes `GET /api/sessions`, `GET /api/sessions/:id`, `POST /api/sessions/:id/reply`, `GET /api/sessions/:id/files/:idx`, and the two prompt strings in `POST /api/sessions` and `.../reply`)
- Test: `portal/test/server.test.js` (replace the owner-special-case listing test), new assertions for cross-user 404

**Interfaces:**
- Consumes: `getUser` from Task 1.
- Produces: `getOwnSession(db, id, email)` helper (module-local); all session routes return 404 for sessions owned by someone else.

- [ ] **Step 1: Write the failing tests**

In `portal/test/server.test.js`, add a second cookie near the existing `ownerCookie`:

```js
const operatorCookie = `jskit=${makeCookie('operator@test.com')}`;
```

Delete the existing test that asserts the owner/others listing split (the one built around `OWNER_EMAIL`), and add:

```js
test('users see only their own sessions', async () => {
  // owner creates a session
  const r = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ jd: 'Isolation test role' }),
  });
  const { id } = await r.json();

  // operator's list must not contain it
  const list = await (await fetch(`${base}/api/sessions`, { headers: { cookie: operatorCookie } })).json();
  assert.ok(!list.some(s => s.id === id));

  // and direct access, reply, and file download must 404, not 403
  assert.equal((await fetch(`${base}/api/sessions/${id}`, { headers: { cookie: operatorCookie } })).status, 404);
  assert.equal((await fetch(`${base}/api/sessions/${id}/reply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: operatorCookie },
    body: JSON.stringify({ body: 'peek' }),
  })).status, 404);
  assert.equal((await fetch(`${base}/api/sessions/${id}/files/0`, { headers: { cookie: operatorCookie } })).status, 404);

  // the owner still sees it
  assert.equal((await fetch(`${base}/api/sessions/${id}`, { headers: { cookie: ownerCookie } })).status, 200);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd portal && node --test test/server.test.js`
Expected: FAIL (operator currently receives the owner's session in the list and can fetch it directly)

- [ ] **Step 3: Implement**

In `portal/src/server.js`:

Delete the `OWNER_EMAIL` line entirely:

```js
const OWNER_EMAIL = () => config.allowedEmails[0]; // DELETE
```

Add a module-local helper after the imports:

```js
// Look up a session only if it belongs to the requesting user. Missing and
// forbidden are deliberately the same answer (404) so the API never confirms
// that someone else's session id exists.
function getOwnSession(db, id, email) {
  return db.prepare('select * from sessions where id = ? and user_email = ?').get(id, email);
}
```

Replace the `GET /api/sessions` handler body with:

```js
  app.get('/api/sessions', requireAuth, (req, res) => {
    const rows = getDb()
      .prepare('select * from sessions where user_email = ? order by updated_at desc')
      .all(req.userEmail);
    res.json(rows);
  });
```

In `GET /api/sessions/:id`, `POST /api/sessions/:id/reply`, and `GET /api/sessions/:id/files/:idx`, replace every

```js
    const session = db.prepare('select * from sessions where id = ?').get(req.params.id);
```

(and the equivalent `getDb().prepare(...)` one-liner in the files route) with:

```js
    const session = getOwnSession(getDb(), req.params.id, req.userEmail);
```

keeping the existing `if (!session) return res.status(404)...` lines.

Personalise the two prompts. Add `import { getUser } from './users.js';`, then in `POST /api/sessions` replace both uses of `config.userName` in the `prompt` template with the submitter's registry name:

```js
    const userName = getUser(req.userEmail)?.name || 'the user';
    const prompt = isLink
      ? `${userName} has sent a link to a job listing via the portal. Fetch the job description from this URL (use WebFetch; if the page is blocked or empty, ask for the text to be pasted instead), then proceed as with any new job description.\n\n${jd}`
      : `New job description from ${userName} via the portal.\n\n${jd}`;
```

and in the reply route:

```js
    const userName = getUser(req.userEmail)?.name || 'the user';
    enqueue({ sessionId: session.id, prompt: `${userName} replies via the portal:\n\n${body}` });
```

- [ ] **Step 4: Run tests**

Run: `cd portal && npm test`
Expected: PASS (including the rewritten listing test)

- [ ] **Step 5: Commit**

```bash
git add portal/src/server.js portal/test/server.test.js
git commit -m "fix(portal): scope all session routes to the logged-in user"
```

---

### Task 4: Confine file downloads to the user's project directory

**Files:**
- Modify: `portal/src/server.js` (files route)
- Test: `portal/test/server.test.js`

**Interfaces:**
- Consumes: `getUser` (already imported in Task 3).
- Produces: downloads succeed only for real files inside the requesting user's `projectDir`; anything else is 404.

Defence in depth: the stored paths come from the agent, and a prompt-injected job description could steer the agent into naming a file outside the project (for example another user's CV, or `~/.ssh/id_rsa`). The server must refuse to serve such a path regardless of what is in the DB.

- [ ] **Step 1: Write the failing test**

The server tests use the legacy env fallback, so both test users share `PROJECT_DIR`. At the top of `portal/test/server.test.js`, before the `import`s of app modules, pin the project dir to a temp folder:

```js
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const projectDir = mkdtempSync(join(tmpdir(), 'proj-'));
process.env.PROJECT_DIR = projectDir;
```

Then add the test:

```js
test('file downloads are confined to the user projectDir', async () => {
  const inside = join(projectDir, 'cv.pdf');
  writeFileSync(inside, 'pdf-bytes');
  const r = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ jd: 'Download test role' }),
  });
  const { id } = await r.json();
  getDb().prepare('update sessions set files = ? where id = ?')
    .run(JSON.stringify([inside, '/etc/passwd']), id);

  const ok = await fetch(`${base}/api/sessions/${id}/files/0`, { headers: { cookie: ownerCookie } });
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), 'pdf-bytes');

  const evil = await fetch(`${base}/api/sessions/${id}/files/1`, { headers: { cookie: ownerCookie } });
  assert.equal(evil.status, 404);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd portal && node --test test/server.test.js`
Expected: FAIL (`/etc/passwd` currently downloads with status 200)

- [ ] **Step 3: Implement**

In `portal/src/server.js`, extend the node imports:

```js
import { basename, sep } from 'node:path';
import { realpathSync } from 'node:fs';
```

and in the files route, before `res.download(...)`:

```js
    const user = getUser(req.userEmail);
    let real, root;
    try {
      real = realpathSync(paths[idx]);
      root = realpathSync(user.projectDir);
    } catch {
      return res.status(404).json({ error: 'not found' });
    }
    if (real !== root && !real.startsWith(root + sep)) {
      return res.status(404).json({ error: 'not found' });
    }
    res.download(real, basename(real), err => {
      if (err && !res.headersSent) res.status(404).json({ error: 'file unavailable' });
    });
```

(replacing the existing `res.download(paths[idx], ...)` call).

- [ ] **Step 4: Run tests**

Run: `cd portal && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add portal/src/server.js portal/test/server.test.js
git commit -m "feat(portal): confine deliverable downloads to the user's project directory"
```

---

### Task 5: Per-user agent runs and admin failure alerts

**Files:**
- Modify: `portal/src/agent.js` (prompt becomes a function of the user; `runAgentTurn` takes a `user`)
- Modify: `portal/src/queue.js` (`processOneJob` resolves the session's user and passes it through; failure alerts go to admins)
- Test: `portal/test/agent.test.js`, `portal/test/queue.test.js`

**Interfaces:**
- Consumes: `getUser`, `adminEmails` from Task 1.
- Produces: `runAgentTurn({ prompt, resumeSessionId, user }, { runners })` where `user` is `{ name, projectDir }`; the runner receives `cwd: user.projectDir` and a system prompt built with `user.name`. `portalPrompt(userName)` is exported for tests.

- [ ] **Step 1: Write the failing tests**

In `portal/test/agent.test.js`, add:

```js
test('runAgentTurn runs in the user projectDir with a personalised prompt', async () => {
  let got;
  const fake = async args => { got = args; return { sessionId: 's1', text: 'ok' }; };
  await runAgentTurn(
    { prompt: 'p', resumeSessionId: null, user: { name: 'Bob', projectDir: '/tmp/bobproj' } },
    { runners: { [process.env.AGENT_RUNNER || 'claude-sdk']: fake } }
  );
  assert.equal(got.cwd, '/tmp/bobproj');
  assert.match(got.systemPrompt, /Bob/);
  assert.doesNotMatch(got.systemPrompt, /the owner/);
});
```

(Match the existing test file's import style; import `runAgentTurn` if not already imported.)

In `portal/test/queue.test.js`, the existing tests stub `runTurn`. Update the stub-shape assertions where present, and add:

```js
test('processOneJob passes the session user to the runner', async () => {
  // (reuse the file's existing helpers for creating a session + job; the
  // legacy env fallback makes every allowlisted email a user whose
  // projectDir is PROJECT_DIR)
  let got;
  const runTurn = async args => { got = args; return { sessionId: 'c1', text: 'assessment' }; };
  await processOneJob({ runTurn, send: async () => {} });
  assert.equal(got.user.projectDir, process.env.PROJECT_DIR);
  assert.ok(got.user.name);
});
```

Adapt the setup lines to the file's existing fixtures (it already inserts sessions with `user_email` values from `ALLOWED_EMAILS`).

- [ ] **Step 2: Run to verify it fails**

Run: `cd portal && node --test test/agent.test.js test/queue.test.js`
Expected: FAIL (`got.cwd` is `config.projectDir`, not `/tmp/bobproj`; `got.user` is undefined)

- [ ] **Step 3: Implement**

In `portal/src/agent.js`:

1. Rename the constant to a function. Change the declaration line from

```js
const PORTAL_PROMPT = `
```

to

```js
export const portalPrompt = (userName) => `
```

and inside the template replace **every** occurrence of `${config.userName}` with `${userName}` (there are ten). Keep `${config.portalTitle}` as is. Close with `` `; `` unchanged.

2. Rework `runAgentTurn`:

```js
export async function runAgentTurn({ prompt, resumeSessionId, user }, { runners = RUNNERS } = {}) {
  const runner = runners[config.agentRunner];
  if (!runner) throw new Error(`unknown agent runner: ${config.agentRunner}`);
  return runner({
    prompt,
    systemPrompt: portalPrompt(user.name),
    resumeSessionId: resumeSessionId || null,
    cwd: user.projectDir,
    model: config.agentModel,
  });
}
```

Update the runner-contract comment above `RUNNERS` accordingly (cwd and userName now come from the session's user).

In `portal/src/queue.js`:

1. Add `import { getUser, adminEmails } from './users.js';` and remove the now-unused `config` import if nothing else uses it (it still does, for `portalTitle`).

2. In `processOneJob`, after loading the session, resolve the user and fail cleanly if they have been removed from the registry:

```js
  const user = getUser(session.user_email);
  try {
    if (!user) throw new Error(`no registered user for ${session.user_email}; add them to users.json`);
    const { sessionId: claudeId, text } = await runTurn({
      prompt: job.prompt,
      resumeSessionId: session.claude_session_id || null,
      user,
    });
```

(the rest of the try block is unchanged).

3. Replace the failure-alert recipient logic in the catch block:

```js
    for (const admin of adminEmails()) {
      try {
        await send({
          to: admin,
          subject: `${config.portalTitle}: session "${session.title}" needs attention`,
          text: String(err),
          attachments: [],
        });
      } catch { /* alert is best-effort */ }
    }
```

Note the alert body is the error string only; never include message bodies or job-description text in alert emails, since admins may not be the session's owner.

- [ ] **Step 4: Run tests**

Run: `cd portal && npm test`
Expected: PASS. If existing agent/queue tests called `runAgentTurn` without a `user`, update those call sites to pass `user: { name: 'Test', projectDir: process.env.PROJECT_DIR || '/tmp' }`.

- [ ] **Step 5: Commit**

```bash
git add portal/src/agent.js portal/src/queue.js portal/test/agent.test.js portal/test/queue.test.js
git commit -m "feat(portal): run each agent session as the submitting user; alert admins on failure"
```

---

### Task 6: Documentation and example config for the shared, public-repo deployment

**Files:**
- Modify: `docs/portal.md` (env-var walkthrough and security section)
- Modify: `portal/.env.example` (retire the trio, point at users.json)
- Modify: `portal/README.md` (one-line positioning update)
- Modify: `README.md` (portal bullet in Structure)

No test cycle; verify with a read-through and `npm test` still green.

- [ ] **Step 1: Update `portal/.env.example`**

Replace the `ALLOWED_EMAILS`, `PROJECT_DIR`, and `USER_NAME` entries with:

```
# Users live in data/users.json (gitignored), one entry per login email:
#   { "alice@example.com": { "name": "Alice", "projectDir": "/home/alice/job-search-alice", "admin": true } }
# Copy users.example.json to data/users.json and edit it. "admin": true marks
# who receives failure alerts. Legacy single-user installs can instead keep
# using ALLOWED_EMAILS + PROJECT_DIR + USER_NAME below.
#PORTAL_USERS_FILE=data/users.json
#ALLOWED_EMAILS=you@example.com
#PROJECT_DIR=/home/you/job-search
#USER_NAME=Your Name
```

- [ ] **Step 2: Update `docs/portal.md`**

In the `.env` walkthrough, replace the `ALLOWED_EMAILS`/`PROJECT_DIR`/`USER_NAME` bullets with a "Users" subsection describing `data/users.json` (schema as above), stating: each login email maps to its own project folder; sessions, files, and deliverable emails are visible only to their own user; `admin: true` marks failure-alert recipients; edits to the file take effect immediately, and removing an entry revokes login and delivery for that address (existing browser cookies stop mattering because every route re-checks the registry only for new logins — note that issued cookies remain valid until expiry, so also rotate `COOKIE_SECRET` when removing a user you do not trust).

Extend the security notes with a new subsection:

```markdown
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
```

Also state the public-repo hygiene rule: `portal/.gitignore` already excludes `.env`, `data/` (which holds `users.json` and the SQLite DB), and `node_modules/`; never commit real emails, names, or project paths — that is why only `users.example.json` is tracked.

- [ ] **Step 3: Update the two READMEs**

`portal/README.md`, first paragraph: after the two-stage sentence, add: "One portal instance can serve several people: each login email is mapped to its own project folder in `data/users.json`, and every user sees only their own sessions and deliverables."

Root `README.md`, the `portal/` bullet in Structure: append "One instance can serve several people, each mapped to their own project folder."

- [ ] **Step 4: Verify and commit**

Run: `cd portal && npm test` (expected: PASS) and re-read the three docs for consistency with the code.

```bash
git add docs/portal.md portal/.env.example portal/README.md README.md
git commit -m "docs(portal): document the multi-user registry and its isolation boundaries"
```

---

## Decision: no helper mode in the portal

The old accidental behaviour where a second allowlisted address could see the owner's sessions is removed deliberately and must NOT be reintroduced. Decision from the kit owner (2026-07-14): the portal is strictly one person per login; someone helping with another person's search does so via Claude Code on the CLI inside that person's project folder, not via the portal. Do not add a "helper of X" feature.

## Deployment note (not a code task)

For the shared deployment: run **one** portal from the kit checkout (not the per-project copies `setup.sh` makes), with `data/users.json` pointing at each person's generated project directory. The per-project portal copy remains valid for single users via the legacy env fallback. When a new person runs the setup wizard, add one line to `users.json`; no restart needed.

## Self-review notes

- Cross-user reads: list, get, reply, download all scoped (Task 3) with a 404 contract; download additionally path-confined (Task 4).
- Outbound email can only reach registered users (Task 2), so a hijacked agent cannot exfiltrate PDFs to an outside address via the email-to-user block.
- Deliverables already go to `session.user_email` in `queue.js`; Tasks 2 and 5 make that safe and correctly personalised.
- Legacy fallback keeps the existing suite and single-user installs green; the only intentionally changed behaviour is the removal of the "non-owners see all sessions" listing (which was a leak).
