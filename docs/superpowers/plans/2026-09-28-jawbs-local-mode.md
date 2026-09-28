# Jawbs Local Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new person runs the setup wizard once, double-clicks a Jawbs icon, and does their whole intake and later applications in a browser on their own machine, with no sign-in, email or tunnel.

**Architecture:** A new `EXPOSURE=local` mode in the portal replaces cookie auth with "the one registered user", guarded by a Host/Origin check against DNS rebinding. Setup sessions (`sessions.kind = 'setup'`) drive `SETUP.md` through the portal with their own prompt and a CV upload route. The wizard gains a three-way menu; option 1 runs `setup/jawbs-local.sh`, which installs, writes `.env`, registers the user and installs a launcher script plus app icons. A default CV template now ships in the kit so session C can render without choosing one.

**Tech Stack:** Node 18+ (Express 5, better-sqlite3, `node:test`), vanilla ES module front end, bash 3.2, Typst 0.15.

**Spec:** `docs/superpowers/specs/2026-09-28-jawbs-local-mode-design.md` (read it before starting any task).

## Global Constraints

- Work in `~/j4dev` (or a worktree of it). Never edit `~/j4`; `~/j4/portal` is the live service.
- Never bind or curl port 8710 in tests or manual checks: the live portal owns it machine-wide. Use `listen(0)` in node tests and port 59717 for scratch runs.
- Setup scripts stay bash 3.2 compatible: no associative arrays, no `readarray`/`mapfile`, no `sed -i`, no `${var,,}`/`${var^^}`, no `[[ =~ ]]` capture groups via `BASH_REMATCH` beyond 3.2 behaviour, no GNU-only flags (`readlink -f`, `stat -c`, `date -d`). This host runs bash 5.2, so check by inspection.
- Setup must never fail when node is absent: print manual instructions and return 0.
- Setup tests must never write the real registry: always set `PORTAL_REGISTRY`; tests that install launchers set `HOME` to a temp dir.
- SETUP.md portal task text for `shared` keeps the literal phrase "If you chose the portal".
- Docs and user-facing copy: British English, no em or en dashes as sentence punctuation. User-facing copy never names a vendor where it currently avoids it (the portal says "Jawbs", not "Claude", in status text).
- `EXPOSURE` values: `private | public | local`. `JAWBS_MODE` values: `local | terminal | shared`.
- Default local port 8710, `BIND_HOST=127.0.0.1`, `BASE_URL=http://localhost:8710`, `EMAIL_PROVIDER=log`, `PORTAL_TITLE=Jawbs`.
- Upload: 15 MB cap; extensions `pdf doc docx odt rtf pages txt md`; saved to `<projectDir>/core/source/`.
- Verification commands: `cd portal && npm test` and `bash setup/test/run-tests.sh` (prints `Passed: N  Failed: N`).

## Review Focus

1. **A request with a hostile Host header to a static file** (DNS rebinding reaches `/index.html` first): must be 403, not only `/api/*`. Pinned in Task 2.
2. **A browser `fetch` from another origin that omits `Origin`** (some same-origin GETs omit it; cross-site POSTs always send it): a POST with a foreign `Origin` is 403, a POST with no `Origin` but a good Host is allowed. Pinned in Task 2.
3. **A Getting started session when `SETUP.md` is deleted mid-conversation**: replies must still work (the session is not blocked), and `/api/setup/start` must now 409. Pinned in Task 3.
4. **An upload whose name is only punctuation or has no extension, or a double extension like `cv.pdf.exe`**: rejected on the final extension, and an all-punctuation stem becomes `upload.<ext>`. Pinned in Task 5.
5. **The launcher started from a GUI with a minimal PATH** (`/usr/bin:/bin`): it must still find node and start the portal, because it uses baked absolute paths. Pinned in Task 11.

---

## File Structure

| File | Responsibility |
|---|---|
| `portal/src/preflight.js` (modify) | `EXPOSURE=local` rules |
| `portal/src/local.js` (create) | `isLocal()`, `localHostGuard` middleware, `localUserEmail()` |
| `portal/src/auth.js` (modify) | `requireAuth` local bypass |
| `portal/src/server.js` (modify) | wiring: guard, 404 login routes, `meta.local`, `/api/quit`, setup routes, upload route |
| `portal/src/queue.js` (modify) | `stopWorker`, pass `kind` to the turn, setup recovery prompt |
| `portal/src/db.js` (modify) | `sessions.kind` column |
| `portal/src/setup-session.js` (create) | `setupPending(projectDir)`, `findSetupSession`, `startSetupSession`, `SETUP_OPENING_PROMPT` |
| `portal/src/agent.js` (modify) | `setupPrompt`, `runAgentTurn` chooses by `kind` |
| `portal/src/upload.js` (create) | `safeUploadName`, `saveUpload` |
| `portal/public/setup.js` (create) | `attachNote(path)` pure helper |
| `portal/public/app.js`, `style.css` (modify) | quit link, setup landing, paperclip |
| `template/render/templates/{lib,main,cover-letter}.typ`, `VANTAGE-LICENSE` (create) | default CV design |
| `template/render/render.sh`, `README.md`, `install-typst.sh` (modify) | bundled template wording, macOS Typst |
| `setup/SETUP.md.tmpl` (modify) | task 10 |
| `setup/setup.sh` (modify) | menu, `JAWBS_MODE`, calls `jawbs-local.sh` |
| `setup/jawbs-local.sh` (create) | local install steps 2 to 6 |
| `setup/lib.sh` (modify) | `detect_subscriptions`, `write_local_env`, `install_launcher` |
| `setup/assets/jawbs.png` (create) | icon |
| `setup/test/run-tests.sh`, `answers-local.env`, `answers-terminal.env` (modify/create) | tests |
| `docs/portal.md`, `docs/first-session.md`, `CLAUDE.md`, `portal/.env.example` (modify) | docs |

---

### Task 1: Preflight rules for `EXPOSURE=local`

**Files:**
- Modify: `portal/src/preflight.js`
- Test: `portal/test/preflight.test.js`

**Interfaces:**
- Produces: `checkConfig(cfg, { ..., countUsers })` where `countUsers(cfg) => number` (default reads `cfg.usersFile` JSON key count, or `cfg.allowedEmails.length` when the file is missing). Exported `countRegisteredUsers(cfg)`.

- [ ] **Step 1: Write the failing tests** (append to `portal/test/preflight.test.js`)

```js
// --- EXPOSURE=local -------------------------------------------------------
function localCfg(overrides = {}) {
  return valid({
    exposure: 'local', bindHost: '127.0.0.1', baseUrl: 'http://localhost:8710', port: 8710,
    cookieSecret: '', emailProvider: 'log', emailProviderExplicit: true, subscriptions: 'claude-only',
    ...overrides,
  });
}
const oneUser = () => 1;

test('a valid local config produces no issues and needs no cookie secret', () => {
  assert.deepEqual(checkConfig(localCfg(), { ...ok, countUsers: oneUser }), []);
});

test('local refuses a non-loopback bind', () => {
  const e = errors(checkConfig(localCfg({ bindHost: '0.0.0.0' }), { ...ok, countUsers: oneUser }));
  assert.equal(e.length, 1);
  assert.match(e[0].message, /EXPOSURE=local.*BIND_HOST/);
});

test('local refuses zero or several users', () => {
  for (const n of [0, 2]) {
    const e = errors(checkConfig(localCfg(), { ...ok, countUsers: () => n }));
    assert.ok(e.some(i => /exactly one/.test(i.message)), `expected a one-user error for ${n}`);
  }
});

test('local refuses a BASE_URL that is not localhost on PORT', () => {
  for (const baseUrl of ['https://box.example.com', 'http://localhost:9999', 'http://192.168.1.4:8710']) {
    const e = errors(checkConfig(localCfg({ baseUrl }), { ...ok, countUsers: oneUser }));
    assert.ok(e.some(i => /BASE_URL/.test(i.message)), `expected a BASE_URL error for ${baseUrl}`);
  }
  assert.deepEqual(errors(checkConfig(localCfg({ baseUrl: 'http://127.0.0.1:8710' }), { ...ok, countUsers: oneUser })), []);
});

test('local does not warn about the loopback bind or a missing EXPOSURE', () => {
  assert.deepEqual(warns(checkConfig(localCfg(), { ...ok, countUsers: oneUser })), []);
});

test('EXPOSURE accepts local case-insensitively', () => {
  assert.deepEqual(errors(checkConfig(localCfg({ exposure: 'LOCAL' }), { ...ok, countUsers: oneUser })), []);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd portal && node --test test/preflight.test.js`
Expected: FAIL (`EXPOSURE is "local", which is not one of: private, public.` plus a COOKIE_SECRET error).

- [ ] **Step 3: Implement**

In `portal/src/preflight.js`:

1. Add near the top:

```js
import { readFileSync } from 'node:fs';

// How many people this portal serves: the registry's entries, or the legacy
// allowlist when there is no registry. Local mode serves exactly one.
export function countRegisteredUsers(cfg) {
  try {
    return Object.keys(JSON.parse(readFileSync(cfg.usersFile, 'utf8'))).length;
  } catch (err) {
    if (err.code === 'ENOENT') return (cfg.allowedEmails || []).length;
    return 0; // unreadable or malformed: the users section below reports it
  }
}
```

2. Add `countUsers = countRegisteredUsers` to the `checkConfig` options destructuring.

3. Replace the exposure validation block so `local` is accepted:

```js
  } else if (!['private', 'public', 'local'].includes(exposure)) {
    err(`EXPOSURE is "${exposure}", which is not one of: private, public, local.`);
    exposure = 'public';
  }
  const local = exposure === 'local';
```

4. Wrap the whole cookie-secret section in `if (!local) { ... }` with this comment above it:

```js
  // Local mode reads no cookie (requireAuth serves the one registered user),
  // so a secret would guard nothing.
```

5. Wrap the "Bind" warning at the end in `if (!local)`, and add a local section just before `return issues;`:

```js
  // --- Local ----------------------------------------------------------------
  // No sign-in is safe only for one person on this machine: loopback bind, one
  // user, and a BASE_URL the Host guard in local.js will accept.
  if (local) {
    if (!LOOPBACK_BINDS.includes(cfg.bindHost)) {
      err(`EXPOSURE=local has no sign-in, so it must listen on this computer only, but BIND_HOST is ${cfg.bindHost}. Set BIND_HOST=127.0.0.1.`);
    }
    const n = countUsers(cfg);
    if (n !== 1) {
      err(`EXPOSURE=local serves exactly one person, but ${n} are registered in ${cfg.usersFile}. A second person needs their own copy of the kit.`);
    }
    const port = String(cfg.port ?? 8710);
    const okBase = url && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
      && (url.port || '80') === port;
    if (!okBase) {
      err(`EXPOSURE=local needs BASE_URL=http://localhost:${port}, but it is ${cfg.baseUrl}.`);
    }
  }
```

(`url` is the parsed BASE_URL from the existing Base URL section; `cfg.port` is `config.port`.)

- [ ] **Step 4: Run tests**

Run: `cd portal && node --test test/preflight.test.js`
Expected: PASS, including all pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add portal/src/preflight.js portal/test/preflight.test.js
git commit -m "Accept EXPOSURE=local at startup: loopback, one user, localhost BASE_URL"
```

---

### Task 2: Local auth, Host/Origin guard, quit

**Files:**
- Create: `portal/src/local.js`
- Modify: `portal/src/auth.js`, `portal/src/server.js`, `portal/src/queue.js`
- Test: `portal/test/local.test.js` (new; runs in its own process with `EXPOSURE=local`)

**Interfaces:**
- Consumes: `allowedEmails()` from `users.js`.
- Produces:
  - `isLocal(cfg = config) => boolean`
  - `localUserEmail() => string | null` (the single registered email, or null when not exactly one)
  - `localHostGuard(req, res, next)` Express middleware
  - `createApp({ send, quit })`: `quit` is `async () => void`, called by `POST /api/quit`
  - `stopWorker() => Promise<void>` in `queue.js`: resolves once no job is running and no new one will start

- [ ] **Step 1: Write the failing tests** (`portal/test/local.test.js`)

```js
import test from 'node:test';
import assert from 'node:assert';
import { request } from 'node:http';
process.env.DB_PATH = ':memory:';
process.env.PORTAL_USERS_FILE = '/nonexistent-portal-users.json';
process.env.ALLOWED_EMAILS = 'solo@test.com';
process.env.EXPOSURE = 'local';
process.env.PORTAL_TITLE = 'Jawbs';
const { createApp } = await import('../src/server.js');
const { isLocal } = await import('../src/local.js');

let quitCalls = 0;
const app = createApp({ send: async () => {}, quit: async () => { quitCalls++; } });
const server = app.listen(0, '127.0.0.1');
const port = server.address().port;
test.after(() => server.close());

// node:http, not fetch, so the Host header can be set freely.
function call(path, { method = 'GET', host = `localhost:${port}`, origin, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host };
    if (origin) headers.origin = origin;
    if (body) headers['content-type'] = 'application/json';
    const req = request({ host: '127.0.0.1', port, path, method, headers }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

test('isLocal reads EXPOSURE', () => {
  assert.equal(isLocal(), true);
  assert.equal(isLocal({ exposure: 'private' }), false);
  assert.equal(isLocal({ exposure: ' Local ' }), true);
});

test('the one user is signed in without a cookie', async () => {
  const r = await call('/api/me');
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { email: 'solo@test.com' });
});

test('meta says local', async () => {
  assert.deepEqual(JSON.parse((await call('/api/meta')).body), { title: 'Jawbs', local: true });
});

test('login routes do not exist in local mode', async () => {
  assert.equal((await call('/api/login', { method: 'POST', body: { email: 'solo@test.com' } })).status, 404);
  assert.equal((await call('/auth/abc')).status, 404);
});

test('a foreign Host is refused on API and static routes alike', async () => {
  for (const path of ['/api/me', '/', '/index.html', '/app.js']) {
    assert.equal((await call(path, { host: 'evil.example:' + port })).status, 403, path);
  }
  assert.equal((await call('/api/me', { host: 'localhost' })).status, 403, 'port must match');
});

test('127.0.0.1 is an accepted Host', async () => {
  assert.equal((await call('/api/me', { host: `127.0.0.1:${port}` })).status, 200);
});

test('a POST from a foreign Origin is refused; no Origin or our own is fine', async () => {
  const body = { jd: 'A role' };
  assert.equal((await call('/api/sessions', { method: 'POST', origin: 'https://evil.example', body })).status, 403);
  assert.equal((await call('/api/sessions', { method: 'POST', body })).status, 200);
  assert.equal((await call('/api/sessions', { method: 'POST', origin: `http://localhost:${port}`, body })).status, 200);
});

test('quit calls the injected quit function', async () => {
  const r = await call('/api/quit', { method: 'POST', origin: `http://localhost:${port}` });
  assert.equal(r.status, 200);
  await new Promise(res => setTimeout(res, 20)); // quit runs after the response
  assert.equal(quitCalls, 1);
});
```

Add to `portal/test/server.test.js` (non-local process):

```js
test('quit does not exist outside local mode', async () => {
  const r = await fetch(`${base}/api/quit`, { method: 'POST', headers: { cookie: ownerCookie } });
  assert.equal(r.status, 404);
});
```

Add to `portal/test/queue.test.js`:

```js
test('stopWorker resolves once the running job has finished and starts no more', async () => {
  const { startWorker, stopWorker } = await import('../src/queue.js');
  const sid = mkSession();
  enqueue({ sessionId: sid, prompt: 'first' });
  enqueue({ sessionId: sid, prompt: 'second' });
  let release;
  const gate = new Promise(r => { release = r; });
  let turns = 0;
  const runTurn = async () => { turns++; await gate; return { sessionId: 'x', text: 'ok' }; };
  startWorker({ runTurn, send: async () => {}, pollMs: 5 });
  while (turns === 0) await new Promise(r => setTimeout(r, 5));
  const stopped = stopWorker();
  release();
  await stopped;
  await new Promise(r => setTimeout(r, 30));
  assert.equal(turns, 1);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd portal && node --test test/local.test.js test/server.test.js test/queue.test.js`
Expected: FAIL (`Cannot find module '../src/local.js'`, quit 404 test may pass already, `stopWorker` not exported).

- [ ] **Step 3: Implement `portal/src/local.js`**

```js
import { config } from './config.js';
import { allowedEmails } from './users.js';

// EXPOSURE=local: one person, this machine, no sign-in. See the spec
// 2026-09-28-jawbs-local-mode-design.md; preflight enforces the preconditions.
export function isLocal(cfg = config) {
  return String(cfg.exposure || '').trim().toLowerCase() === 'local';
}

// The one registered user, or null when there is not exactly one. Read per
// call, like every registry lookup, so an edit needs no restart.
export function localUserEmail() {
  const emails = allowedEmails();
  return emails.length === 1 ? emails[0] : null;
}

// With no sign-in, the Host header is the only thing stopping a web page the
// person visits from rebinding its own name to 127.0.0.1 and driving the API
// from their browser. So every route, static files included, answers only to
// the names this machine uses for itself, on the port actually listened on.
// Cross-site POSTs always carry Origin, so a foreign one is refused too.
export function localHostGuard(req, res, next) {
  const port = req.socket.localPort;
  const hosts = [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`];
  if (!hosts.includes(String(req.headers.host || '').toLowerCase())) {
    return res.status(403).send('Forbidden');
  }
  const origin = req.headers.origin;
  if (req.method !== 'GET' && req.method !== 'HEAD' && origin
      && !hosts.map(h => `http://${h}`).includes(String(origin).toLowerCase())) {
    return res.status(403).send('Forbidden');
  }
  next();
}
```

- [ ] **Step 4: Implement the auth bypass** in `portal/src/auth.js`

Add `import { isLocal, localUserEmail } from './local.js';` and change `requireAuth`:

```js
export function requireAuth(req, res, next) {
  // Local mode has no sign-in: the one registered user is the only user.
  if (isLocal()) {
    const email = localUserEmail();
    if (!email) return res.status(503).json({ error: 'local mode needs exactly one registered user' });
    req.userEmail = email;
    return next();
  }
  const raw = (req.headers.cookie || '').split(';').map(s => s.trim())
    .find(s => s.startsWith('jskit='));
  const email = raw ? verifyCookie(raw.slice(6)) : null;
  if (!email) return res.status(401).json({ error: 'not logged in' });
  req.userEmail = email;
  next();
}
```

- [ ] **Step 5: Implement `stopWorker`** in `portal/src/queue.js`

Replace `startWorker` with:

```js
let workerTimer = null;
let workerIdle = Promise.resolve();

export function startWorker(deps = {}) {
  const pollMs = deps.pollMs ?? 3000;
  // recover jobs stuck in 'running' from a crash/reboot
  getDb().prepare("update jobs set status = 'queued' where status = 'running'").run();
  let busy = false;
  workerTimer = setInterval(async () => {
    if (busy) return;
    busy = true;
    let done;
    workerIdle = new Promise(r => { done = r; });
    try { await processOneJob(deps); } finally { busy = false; done(); }
  }, pollMs);
}

// Stop taking jobs and wait for the one in hand, if any. Queued jobs stay
// queued; startWorker picks them up on the next start.
export async function stopWorker() {
  clearInterval(workerTimer);
  workerTimer = null;
  await workerIdle;
}
```

- [ ] **Step 6: Wire `server.js`**

1. Imports: `import { isLocal, localHostGuard } from './local.js';` and `import { enqueue, startWorker, stopWorker } from './queue.js';`.
2. `createApp({ send = sendEmail, quit = null } = {})`. First lines inside, before `express.json`:

```js
  const local = isLocal();
  // Before static files: a rebinding attack's first request is for index.html.
  if (local) app.use(localHostGuard);
```

3. Meta: `app.get('/api/meta', (req, res) => res.json(local ? { title: config.portalTitle, local: true } : { title: config.portalTitle }));`
4. Wrap the `/api/login` and `/auth/:token` route registrations in `if (!local) { ... }` with the comment `// Local mode has no sign-in, so the login routes do not exist there.`
5. Before `return app;`:

```js
  // Local only: the page's Quit Jawbs link. Answers first, then stops, so the
  // page can say goodbye; the worker finishes any turn in hand before exit.
  if (local && quit) {
    app.post('/api/quit', requireAuth, (req, res) => {
      res.json({ ok: true });
      setImmediate(() => { quit(); });
    });
  }
```

6. In the `if (import.meta.url === ...)` block, replace `createApp().listen(...)` with:

```js
  const server = createApp({
    quit: async () => {
      console.log('Quit requested: finishing any reply in progress, then stopping.');
      await stopWorker();
      server.close(() => process.exit(0));
    },
  }).listen(config.port, config.bindHost, () =>
    console.log(`${config.portalTitle} on ${config.bindHost}:${config.port}`));
```

- [ ] **Step 7: Run tests**

Run: `cd portal && npm test`
Expected: PASS (all files).

- [ ] **Step 8: Commit**

```bash
git add portal/src/local.js portal/src/auth.js portal/src/server.js portal/src/queue.js portal/test/local.test.js portal/test/server.test.js portal/test/queue.test.js
git commit -m "Local mode: no sign-in for the one user, Host/Origin guard, Quit"
```

---

### Task 3: Setup sessions and routes

**Files:**
- Modify: `portal/src/db.js`, `portal/src/server.js`
- Create: `portal/src/setup-session.js`
- Test: `portal/test/setup-session.test.js` (new), `portal/test/db.test.js`

**Interfaces:**
- Consumes: `getDb`, `newId` (db.js), `enqueue` (queue.js).
- Produces:
  - `sessions.kind` column: `'application'` (default) or `'setup'`
  - `setupPending(projectDir) => boolean` (true when `<projectDir>/SETUP.md` exists)
  - `findSetupSession(db, email) => session row | undefined`
  - `startSetupSession(db, email) => { id, created: boolean }`
  - `SETUP_OPENING_PROMPT` string
  - Routes `GET /api/setup` → `{ pending, sessionId }`, `POST /api/setup/start` → `{ id }` or 409

- [ ] **Step 1: Write the failing tests**

`portal/test/db.test.js`, append:

```js
test('sessions have a kind that defaults to application', async () => {
  const { getDb, newId } = await import('../src/db.js');
  const id = newId();
  getDb().prepare("insert into sessions (id, user_email, title) values (?, 'a@b.c', 't')").run(id);
  assert.equal(getDb().prepare('select kind from sessions where id = ?').get(id).kind, 'application');
});
```

(If `db.test.js` does not already set `process.env.DB_PATH = ':memory:'` before importing, put this test in `setup-session.test.js` instead.)

`portal/test/setup-session.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const projectDir = mkdtempSync(join(tmpdir(), 'proj-'));
process.env.PROJECT_DIR = projectDir;
process.env.DB_PATH = ':memory:';
process.env.PORTAL_USERS_FILE = '/nonexistent-portal-users.json';
process.env.ALLOWED_EMAILS = 'owner@test.com';
process.env.COOKIE_SECRET = 'testsecret';
const { createApp } = await import('../src/server.js');
const { makeCookie } = await import('../src/auth.js');
const { getDb } = await import('../src/db.js');
const { setupPending } = await import('../src/setup-session.js');

const server = createApp({ send: async () => {} }).listen(0);
const base = `http://localhost:${server.address().port}`;
const cookie = `jskit=${makeCookie('owner@test.com')}`;
test.after(() => server.close());
const post = path => fetch(base + path, { method: 'POST', headers: { cookie } });
const get = path => fetch(base + path, { headers: { cookie } });

test('setup is pending exactly while SETUP.md exists', () => {
  assert.equal(setupPending(projectDir), false);
  writeFileSync(join(projectDir, 'SETUP.md'), '# Setup incomplete');
  assert.equal(setupPending(projectDir), true);
  assert.equal(setupPending(undefined), false);
});

test('GET /api/setup reports pending and no session yet', async () => {
  assert.deepEqual(await (await get('/api/setup')).json(), { pending: true, sessionId: null });
});

test('start creates one setup session and queues one opening turn, however often called', async () => {
  const a = await (await post('/api/setup/start')).json();
  const b = await (await post('/api/setup/start')).json();
  assert.equal(a.id, b.id);
  const db = getDb();
  const s = db.prepare('select * from sessions where id = ?').get(a.id);
  assert.equal(s.kind, 'setup');
  assert.equal(s.title, 'Getting started');
  assert.equal(s.status, 'working');
  assert.equal(db.prepare('select count(*) c from jobs where session_id = ?').get(a.id).c, 1);
  assert.equal(db.prepare('select count(*) c from messages where session_id = ?').get(a.id).c, 0);
  assert.deepEqual(await (await get('/api/setup')).json(), { pending: true, sessionId: a.id });
});

test('once SETUP.md is gone, start is refused but the session still takes replies', async () => {
  const { sessionId } = await (await get('/api/setup')).json();
  rmSync(join(projectDir, 'SETUP.md'));
  assert.equal((await post('/api/setup/start')).status, 409);
  assert.deepEqual(await (await get('/api/setup')).json(), { pending: false, sessionId });
  const r = await fetch(`${base}/api/sessions/${sessionId}/reply`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ body: 'thanks' }),
  });
  assert.equal(r.status, 200);
});

test('the sessions list carries kind', async () => {
  const list = await (await get('/api/sessions')).json();
  assert.equal(list.find(s => s.title === 'Getting started').kind, 'setup');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd portal && node --test test/setup-session.test.js`
Expected: FAIL (`Cannot find module '../src/setup-session.js'`).

- [ ] **Step 3: Add the column** in `db.js`, after the `archived` migration:

```js
    // 'setup' marks the Getting started conversation that works through the
    // project's SETUP.md; everything else is an application.
    if (!cols.some(c => c.name === 'kind')) {
      db.exec("alter table sessions add column kind text not null default 'application'");
    }
```

Also extend the status comment on the `sessions` table is unchanged; add `kind` to the `SCHEMA` create statement is NOT needed (the migration covers new and old databases alike).

- [ ] **Step 4: Create `portal/src/setup-session.js`**

```js
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { newId } from './db.js';
import { enqueue } from './queue.js';

// Setup is pending while the project's SETUP.md exists. The agent deletes it
// at the last setup task, so the portal keeps no progress state of its own.
export function setupPending(projectDir) {
  return Boolean(projectDir) && existsSync(join(projectDir, 'SETUP.md'));
}

export const SETUP_OPENING_PROMPT = 'The person has just opened Jawbs for the first time. '
  + 'Greet them warmly, explain in two or three sentences how the next few conversations will go, '
  + 'then ask the first intake question.';

export function findSetupSession(db, email) {
  return db.prepare("select * from sessions where user_email = ? and kind = 'setup' order by created_at limit 1")
    .get(email);
}

// One Getting started session per person: a second call returns the first.
// The opening turn has no user message; Claude speaks first.
export function startSetupSession(db, email) {
  return db.transaction(() => {
    const existing = findSetupSession(db, email);
    if (existing) return { id: existing.id, created: false };
    const id = newId();
    db.prepare("insert into sessions (id, user_email, title, status, kind) values (?, ?, 'Getting started', 'working', 'setup')")
      .run(id, email);
    enqueue({ sessionId: id, prompt: SETUP_OPENING_PROMPT });
    return { id, created: true };
  })();
}
```

- [ ] **Step 5: Add the routes** in `server.js` (after `/api/me`), importing `setupPending, findSetupSession, startSetupSession` from `./setup-session.js`:

```js
  app.get('/api/setup', requireAuth, (req, res) => {
    const pending = setupPending(getUser(req.userEmail)?.projectDir);
    const session = findSetupSession(getDb(), req.userEmail);
    res.json({ pending, sessionId: session?.id ?? null });
  });

  app.post('/api/setup/start', requireAuth, (req, res) => {
    if (!setupPending(getUser(req.userEmail)?.projectDir)) return res.status(409).json({ error: 'setup is complete' });
    res.json({ id: startSetupSession(getDb(), req.userEmail).id });
  });
```

- [ ] **Step 6: Run tests**

Run: `cd portal && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add portal/src/db.js portal/src/setup-session.js portal/src/server.js portal/test/setup-session.test.js portal/test/db.test.js
git commit -m "Getting started sessions: one per person while SETUP.md exists"
```

---

### Task 4: The setup prompt

**Files:**
- Modify: `portal/src/agent.js`, `portal/src/queue.js`
- Test: `portal/test/agent.test.js`, `portal/test/queue.test.js`

**Interfaces:**
- Consumes: `session.kind` (Task 3).
- Produces:
  - `setupPrompt(userName, { structured }) => string` exported from `agent.js`
  - `runAgentTurn({ prompt, resumeSessionId, user, kind })`: `kind === 'setup'` selects `setupPrompt`
  - `buildRecoveryPrompt(session, messages, prompt)` now branches on `session.kind`

- [ ] **Step 1: Write the failing tests**

`agent.test.js`, append:

```js
test('runAgentTurn gives setup sessions the setup prompt, without drafting', async () => {
  let seen;
  const runners = { 'claude-sdk': async a => { seen = a; return { sessionId: 's', text: 'x' }; } };
  const user = { name: 'Alex', projectDir: '/tmp' };
  await runAgentTurn({ prompt: 'hi', user, kind: 'setup' }, { runners, runnerName: 'claude-sdk', subscriptions: 'both' });
  assert.match(seen.systemPrompt, /SETUP\.md/);
  assert.match(seen.systemPrompt, /paperclip/);
  assert.match(seen.systemPrompt, /YOUR REPLY IS STRUCTURED DATA/);
  assert.doesNotMatch(seen.systemPrompt, /STAGE 1: ASSESS/);
  assert.doesNotMatch(seen.systemPrompt, /chatgpt-draft/);
  await runAgentTurn({ prompt: 'hi', user }, { runners, runnerName: 'claude-sdk', subscriptions: 'both' });
  assert.match(seen.systemPrompt, /STAGE 1: ASSESS/);
});

test('the setup prompt uses fenced blocks for runners without a schema', async () => {
  const { setupPrompt } = await import('../src/agent.js');
  const p = setupPrompt('Alex', { structured: false });
  assert.match(p, /```session-title/);
  assert.match(p, /Getting started|leave "title" out/);
});
```

`queue.test.js`, append:

```js
test('the turn is told the session kind, and setup recovery points at SETUP.md', async () => {
  const id = newId();
  getDb().prepare("insert into sessions (id, user_email, title, kind) values (?, 'owner@test.com', 'Getting started', 'setup')").run(id);
  enqueue({ sessionId: id, prompt: 'go' });
  let kind;
  await processOneJob({ runTurn: async a => { kind = a.kind; return { sessionId: 'c', text: 'Hello' }; }, send: async () => {} });
  assert.equal(kind, 'setup');
  const rec = buildRecoveryPrompt({ title: 'Getting started', kind: 'setup' }, [], 'next');
  assert.match(rec, /SETUP\.md/);
  assert.doesNotMatch(rec, /tracker/);
});

test('a setup turn never renames the session', async () => {
  const id = newId();
  getDb().prepare("insert into sessions (id, user_email, title, kind) values (?, 'owner@test.com', 'Getting started', 'setup')").run(id);
  enqueue({ sessionId: id, prompt: 'go' });
  await processOneJob({
    runTurn: async () => ({ sessionId: 'c', structured: { reply: 'Hi', title: 'Designer at Acme', awaiting_user: true, email: null, drafting_blocked: null } }),
    send: async () => {},
  });
  assert.equal(getDb().prepare('select title from sessions where id = ?').get(id).title, 'Getting started');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd portal && node --test test/agent.test.js test/queue.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `setupPrompt`** in `agent.js`, after `soloDraftingProtocol`:

```js
// Setup sessions work through the project's SETUP.md in the browser. They
// reuse the reply protocol, never rename themselves and never draft through
// ChatGPT: the writer is for applications.
export const setupPrompt = (userName, { structured = false } = {}) => {
  const protocol = structured ? structuredProtocol(userName, false) : fencedProtocol(userName);
  const deliver = structured ? 'the email field' : 'an email-to-user block';
  return `
You are setting up a job-search project with ${userName}, in the ${config.portalTitle} web app.
The person you are talking to IS ${userName}. Address them directly, warmly and plainly, in
British English, with no dashes as punctuation, unless the project's own notes say otherwise.

SETUP.md in the project root is your to-do list. Work its tasks in order, mark each one done in
the file as it completes, and delete the file only when every task is done, exactly as it says.

This is a chat window, not a terminal:

- Ask one question per turn. When a question is outstanding, say so with awaiting_user.
  Keep each turn short enough to read comfortably on a phone.
- Where SETUP.md says to drop a CV into core/source/, ask ${userName} to attach it with the
  paperclip button beside the reply box. Attached files arrive in core/source/ and their message
  names the path.
- The between-sessions work runs on their word. At the end of session A, summarise what you
  recorded, say that the next step (drafting the master CV and researching their field, the
  "Between sessions" tasks) takes around 15 to 30 minutes and that they can close the window while
  it runs, and ask them to tell you when to start. Do that work in the next turn, then open
  session B with the results. Mark drafts "draft, awaiting review" as SETUP.md asks.
- Session C: the project already has a working default CV template in render/templates/. Render a
  test CV from core/master-cv.md as render/README.md describes, and deliver the PDF through
  ${deliver} so it appears as a download. Changing the design can happen later in a Claude Code
  session; do not offer to browse Typst Universe here.
- Never set a session title: this conversation is always called "Getting started", so leave
  "title" ${structured ? 'null' : 'out of the session-title block'}.

${protocol}

Never invent facts about ${userName}. Never apply to anything. Never email anyone except via ${deliver}.
`;
};
```

Change `runAgentTurn`:

```js
export async function runAgentTurn(
  { prompt, resumeSessionId, user, kind = 'application' },
  { runners = RUNNERS, runnerName = config.agentRunner, subscriptions = config.subscriptions } = {},
) {
  const runner = runners[runnerName];
  if (!runner) throw new Error(`unknown agent runner: ${runnerName}`);
  const structured = STRUCTURED_RUNNERS.has(runnerName);
  const systemPrompt = kind === 'setup'
    ? setupPrompt(user.name, { structured })
    : portalPrompt(user.name, { structured, drafting: draftingEnabled({ subscriptions, runnerName }) });
  return runner({
    prompt,
    systemPrompt,
    resumeSessionId: resumeSessionId || null,
    cwd: user.projectDir,
    model: config.agentModel,
  });
}
```

- [ ] **Step 4: Queue changes** in `queue.js`

1. Both `runTurn({...})` calls pass `kind: session.kind`.
2. Title update becomes `if (newTitle && session.kind !== 'setup') { ... }`.
3. `buildRecoveryPrompt`: replace the fixed re-orient sentence with

```js
    + (session.kind === 'setup'
      ? 'Re-orient yourself from SETUP.md and the files in core/ before acting. '
      : 'Re-orient yourself from the project tracker and the matching application folder before acting. ')
    + 'Then handle the new message below as normal.\n\n'
```

Check the existing `buildRecoveryPrompt` tests still pass: they pass sessions without `kind`, which must take the application branch (it does, since `undefined !== 'setup'`).

- [ ] **Step 5: Run tests**

Run: `cd portal && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add portal/src/agent.js portal/src/queue.js portal/test/agent.test.js portal/test/queue.test.js
git commit -m "Setup sessions get their own prompt and recovery context"
```

---

### Task 5: CV upload

**Files:**
- Create: `portal/src/upload.js`
- Modify: `portal/src/server.js`
- Test: `portal/test/upload.test.js` (new)

**Interfaces:**
- Produces:
  - `UPLOAD_EXTENSIONS` (array), `MAX_UPLOAD_BYTES = 15 * 1024 * 1024`
  - `safeUploadName(raw) => string | null` (null when the final extension is not allowed)
  - `saveUpload(projectDir, rawName, buffer) => string` relative path like `core/source/cv.pdf`; throws `Error` with `.code` of `'bad_type'` or `'outside'`
  - Route `POST /api/sessions/:id/upload` (header `X-Filename`, raw body) → `{ path }`

- [ ] **Step 1: Write the failing tests** (`portal/test/upload.test.js`)

```js
import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const projectDir = mkdtempSync(join(tmpdir(), 'proj-'));
process.env.PROJECT_DIR = projectDir;
process.env.DB_PATH = ':memory:';
process.env.PORTAL_USERS_FILE = '/nonexistent-portal-users.json';
process.env.ALLOWED_EMAILS = 'owner@test.com,other@test.com';
process.env.COOKIE_SECRET = 'testsecret';
const { safeUploadName, saveUpload } = await import('../src/upload.js');
const { createApp } = await import('../src/server.js');
const { makeCookie } = await import('../src/auth.js');
const { getDb, newId } = await import('../src/db.js');

test('names are reduced to a safe basename with an allowed final extension', () => {
  assert.equal(safeUploadName('My CV (2026).pdf'), 'My CV -2026-.pdf');
  assert.equal(safeUploadName('../../etc/cv.docx'), 'cv.docx');
  assert.equal(safeUploadName('C:\\Users\\a\\cv.PDF'), 'cv.PDF');
  assert.equal(safeUploadName('%%%.pdf'), 'upload.pdf');
  assert.equal(safeUploadName('.pdf'), 'upload.pdf');
  assert.equal(safeUploadName('cv.pdf.exe'), null);
  assert.equal(safeUploadName('cv'), null);
  assert.equal(safeUploadName(''), null);
});

test('saveUpload writes into core/source and suffixes clashes', () => {
  const a = saveUpload(projectDir, 'cv.pdf', Buffer.from('one'));
  const b = saveUpload(projectDir, 'cv.pdf', Buffer.from('two'));
  const c = saveUpload(projectDir, 'cv.pdf', Buffer.from('three'));
  assert.deepEqual([a, b, c], ['core/source/cv.pdf', 'core/source/cv-2.pdf', 'core/source/cv-3.pdf']);
  assert.equal(readFileSync(join(projectDir, b), 'utf8'), 'two');
});

test('saveUpload refuses a core/source that leads outside the project', () => {
  const other = mkdtempSync(join(tmpdir(), 'proj-'));
  const outside = mkdtempSync(join(tmpdir(), 'outside-'));
  mkdirSync(join(other, 'core'));
  symlinkSync(outside, join(other, 'core', 'source'));
  assert.throws(() => saveUpload(other, 'cv.pdf', Buffer.from('x')), e => e.code === 'outside');
  assert.equal(existsSync(join(outside, 'cv.pdf')), false);
});

const server = createApp({ send: async () => {} }).listen(0);
const base = `http://localhost:${server.address().port}`;
test.after(() => server.close());
const cookieFor = e => `jskit=${makeCookie(e)}`;
function mk(kind, email = 'owner@test.com') {
  const id = newId();
  getDb().prepare('insert into sessions (id, user_email, title, kind) values (?, ?, ?, ?)').run(id, email, 't', kind);
  return id;
}
const upload = (id, name, body, email = 'owner@test.com') => fetch(`${base}/api/sessions/${id}/upload`, {
  method: 'POST',
  headers: { cookie: cookieFor(email), 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent(name) },
  body,
});

test('upload route saves to the setup session owner project', async () => {
  const r = await upload(mk('setup'), 'Résumé.pdf', Buffer.from('%PDF'));
  assert.equal(r.status, 200);
  const { path } = await r.json();
  assert.equal(path, 'core/source/R-sum-.pdf');
  assert.equal(readFileSync(join(projectDir, path), 'utf8'), '%PDF');
});

test('upload route refusals', async () => {
  assert.equal((await upload(mk('application'), 'cv.pdf', Buffer.from('x'))).status, 409);
  assert.equal((await upload(mk('setup', 'other@test.com'), 'cv.pdf', Buffer.from('x'))).status, 404);
  assert.equal((await upload(mk('setup'), 'cv.exe', Buffer.from('x'))).status, 415);
  assert.equal((await upload(mk('setup'), 'cv.pdf', Buffer.alloc(0))).status, 400);
  assert.equal((await upload(mk('setup'), 'big.pdf', Buffer.alloc(15 * 1024 * 1024 + 1))).status, 413);
});
```

Note: `Résumé.pdf` sanitises to `R-sum-.pdf` because runs of disallowed characters collapse to one `-`. `other@test.com` shares `PROJECT_DIR` in legacy mode, which does not matter for the 404 test because ownership is checked first.

- [ ] **Step 2: Run to verify they fail**

Run: `cd portal && node --test test/upload.test.js`
Expected: FAIL (`Cannot find module '../src/upload.js'`).

- [ ] **Step 3: Implement `portal/src/upload.js`**

```js
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';

export const UPLOAD_EXTENSIONS = ['pdf', 'doc', 'docx', 'odt', 'rtf', 'pages', 'txt', 'md'];
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

// The browser's name is untrusted: keep only the last path segment (either
// slash, since Windows browsers send backslashes), judge the type by the
// final extension alone, and allow a small plain character set in the stem.
export function safeUploadName(raw) {
  const base = String(raw || '').split(/[\\/]/).pop();
  const dot = base.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = base.slice(dot + 1);
  if (!UPLOAD_EXTENSIONS.includes(ext.toLowerCase())) return null;
  const stem = base.slice(0, dot).replace(/[^A-Za-z0-9._ -]+/g, '-').replace(/^[.\s-]+$/, '').trim();
  return `${stem || 'upload'}.${ext}`;
}

function refuse(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// Writes into <projectDir>/core/source/ and returns the path relative to the
// project. A clash gets -2, -3 before the extension rather than overwriting,
// because a person re-sending "CV.pdf" may mean a different file.
export function saveUpload(projectDir, rawName, buffer) {
  const name = safeUploadName(rawName);
  if (!name) throw refuse('bad_type', `allowed types: ${UPLOAD_EXTENSIONS.join(', ')}`);
  const dir = join(projectDir, 'core', 'source');
  mkdirSync(dir, { recursive: true });
  const root = realpathSync(projectDir);
  const real = realpathSync(dir);
  if (!real.startsWith(root + sep)) throw refuse('outside', 'core/source is outside the project');
  const dot = name.lastIndexOf('.');
  let candidate = name;
  for (let n = 2; existsSync(join(real, candidate)); n++) {
    candidate = `${name.slice(0, dot)}-${n}${name.slice(dot)}`;
  }
  writeFileSync(join(real, candidate), buffer, { flag: 'wx' });
  return `core/source/${candidate}`;
}
```

Check the `%%%.pdf` case by hand against the regex: stem `%%%` becomes `-`, which the second replace empties, so `upload.pdf`. `.pdf` has an empty stem, so `upload.pdf`. `My CV (2026)` becomes `My CV -2026-`.

- [ ] **Step 4: Add the route** in `server.js` (import `express` is already there; import `saveUpload, MAX_UPLOAD_BYTES` from `./upload.js`):

```js
  // Setup sessions only: the CV that SETUP.md asks for. Raw body rather than
  // multipart, so no new dependency; the name travels in X-Filename.
  app.post('/api/sessions/:id/upload', requireAuth,
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
    (req, res) => {
      const session = getOwnSession(getDb(), req.params.id, req.userEmail);
      if (!session) return res.status(404).json({ error: 'not found' });
      if (session.kind !== 'setup') return res.status(409).json({ error: 'uploads are for Getting started only' });
      if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'empty file' });
      let name;
      try { name = decodeURIComponent(String(req.headers['x-filename'] || '')); } catch { name = ''; }
      try {
        res.json({ path: saveUpload(getUser(req.userEmail).projectDir, name, req.body) });
      } catch (err) {
        if (err.code === 'bad_type') return res.status(415).json({ error: err.message });
        if (err.code === 'outside') return res.status(400).json({ error: err.message });
        throw err;
      }
    });
```

Express 5's `express.raw` answers an over-limit body with 413 itself. The global `express.json` only parses `application/json`, so it leaves this body alone.

- [ ] **Step 5: Run tests**

Run: `cd portal && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add portal/src/upload.js portal/src/server.js portal/test/upload.test.js
git commit -m "CV upload into core/source for Getting started sessions"
```

---

### Task 6: Front end: Getting started landing, paperclip, Quit

**Files:**
- Create: `portal/public/setup.js`
- Modify: `portal/public/app.js`, `portal/public/style.css`
- Test: `portal/test/setup-ui.test.js` (new)

**Interfaces:**
- Consumes: `GET /api/setup`, `POST /api/setup/start`, `POST /api/sessions/:id/upload`, `POST /api/quit`, `meta.local`, `session.kind`.
- Produces: `attachNote(path) => string` in `public/setup.js`.

- [ ] **Step 1: Write the failing test** (`portal/test/setup-ui.test.js`)

```js
import test from 'node:test';
import assert from 'node:assert';
const { attachNote, appendNote } = await import('../public/setup.js');

test('attachNote names the saved path', () => {
  assert.equal(attachNote('core/source/cv.pdf'), "I've attached my CV: core/source/cv.pdf");
});

test('appendNote adds the note on its own line after any draft text', () => {
  assert.equal(appendNote('', 'N'), 'N');
  assert.equal(appendNote('Here you go', 'N'), 'Here you go\nN');
  assert.equal(appendNote('Here you go\n', 'N'), 'Here you go\nN');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd portal && node --test test/setup-ui.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `portal/public/setup.js`**

```js
/* The line an upload adds to the reply box. The person can edit it before
   sending, and the upload only reaches Claude inside a message. */
export const attachNote = path => `I've attached my CV: ${path}`;

export const appendNote = (text, note) => (text.trim() ? `${text.replace(/\n+$/, '')}\n${note}` : note);
```

- [ ] **Step 4: Run the test**

Run: `cd portal && node --test test/setup-ui.test.js`
Expected: PASS.

- [ ] **Step 5: Wire `app.js`**

1. `import { attachNote, appendNote } from './setup.js';` and a module-level `let LOCAL = false;`.
2. In `main()`, after reading meta: `LOCAL = meta.local === true;`. Replace `route(); window.onhashchange = route;` with:

```js
  window.onhashchange = route;
  // While SETUP.md exists, the landing page is the Getting started chat.
  if (!location.hash) {
    try {
      const setup = await (await api('/setup')).json();
      if (setup.pending) {
        const id = setup.sessionId || (await (await api('/setup/start', { method: 'POST' })).json()).id;
        if (id) { location.hash = id; return; } // onhashchange renders it
      }
    } catch { /* fall through to the list */ }
  }
  route();
```

3. A quit helper, used by both top bars:

```js
/* Local mode only. The server answers, then exits once any reply in progress
   has finished, so the page says goodbye rather than showing a dead tab. */
function quitLink() {
  return LOCAL ? '<button id="quit" class="linkish">Quit Jawbs</button>' : '';
}
function bindQuit() {
  const b = document.getElementById('quit');
  if (!b) return;
  b.onclick = async () => {
    if (!confirm('Quit Jawbs? Anything Jawbs is working on will finish first. Open Jawbs again from its icon.')) return;
    await api('/quit', { method: 'POST' }).catch(() => {});
    app.innerHTML = `<h1>${esc(TITLE)}</h1><p>Jawbs is closing. You can close this tab.</p>`;
  };
}
```

4. `renderList()`: fetch setup state alongside sessions and hide the new-application box while pending:

```js
  const [sessions, setup] = await Promise.all([
    api('/sessions').then(r => r.json()),
    api('/setup').then(r => r.json()).catch(() => ({ pending: false })),
  ]);
```

Replace the `<div class="new-app">...</div>` literal with `${setup.pending ? `<p class="muted">Finish <a href="#${setup.sessionId || ''}">Getting started</a> first, then you can send Jawbs job descriptions here.</p>` : `...existing new-app markup...`}` and guard `bindSubmit(document.getElementById('jd'), ...)` with `if (!setup.pending)`. Put `${quitLink()}` inside `.topbar` before the cog button, and call `bindQuit()` at the end.

5. `renderSession()`: for `s.kind === 'setup'`, replace the back arrow's label with "All conversations", add `${quitLink()}` to the chat bar, and add a paperclip before the Send button:

```js
    ${s.kind === 'setup' ? `<input id="file" type="file" accept=".pdf,.doc,.docx,.odt,.rtf,.pages,.txt,.md" hidden>
      <button id="attach" class="secondary" title="Attach your CV">&#128206; Attach a file</button>` : ''}
```

After `bindSubmit(...)`:

```js
  const attach = document.getElementById('attach');
  if (attach) {
    const input = document.getElementById('file');
    attach.onclick = () => input.click();
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      attach.disabled = true;
      attach.textContent = 'Uploading...';
      try {
        const r = await fetch(`/api/sessions/${id}/upload`, {
          method: 'POST', headers: { 'x-filename': encodeURIComponent(file.name) }, body: file,
        });
        const out = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(out.error || `upload failed (${r.status})`);
        const box = document.getElementById('reply');
        box.value = appendNote(box.value, attachNote(out.path));
        box.focus();
      } catch (e) {
        alert(/\b413\b/.test(e.message) ? 'That file is too big. The limit is 15 MB.' : `Sorry, that did not upload: ${e.message}`);
      } finally {
        input.value = '';
        attach.disabled = false;
        attach.innerHTML = '&#128206; Attach a file';
      }
    };
  }
  bindQuit();
```

Note: the ten-second poll re-renders while `working`, which would wipe a half-typed reply; that is existing behaviour for all sessions and out of scope.

- [ ] **Step 6: Style** — append to `style.css`:

```css
.linkish { background: none; border: none; color: inherit; text-decoration: underline; padding: 0; font: inherit; cursor: pointer; opacity: .7; }
#attach { margin-right: .5rem; }
```

- [ ] **Step 7: Run all tests**

Run: `cd portal && npm test`
Expected: PASS.

- [ ] **Step 8: Browser check** (scratch portal, never 8710)

```bash
S=$(mktemp -d); mkdir -p $S/proj $S/data; echo '# Setup incomplete' > $S/proj/SETUP.md
printf '{ "me@test.com": { "name": "Test", "projectDir": "%s/proj", "admin": true } }\n' "$S" > $S/data/users.json
cd portal && EXPOSURE=local BIND_HOST=127.0.0.1 PORT=59717 BASE_URL=http://localhost:59717 \
  PORTAL_USERS_FILE=$S/data/users.json DB_PATH=$S/data/p.db EMAIL_PROVIDER=log SUBSCRIPTIONS=claude-only \
  AGENT_RUNNER=cli AGENT_CMD=false PORTAL_TITLE=Jawbs node src/server.js &
```

Drive Playwright's cached Chromium from a `.cjs` script requiring `/home/spacetimejam/shareverified/node_modules/playwright` (the Playwright MCP cannot run here). Check: opening `http://localhost:59717/` lands on "Getting started"; the new-application box is absent from the list; attaching a small PDF puts the note in the reply box and the file in `$S/proj/core/source/`; "Quit Jawbs" stops the process. Stop the server by the PID from `ss -ltnp | grep 59717`, never `pkill -f`.

- [ ] **Step 9: Commit**

```bash
git add portal/public/setup.js portal/public/app.js portal/public/style.css portal/test/setup-ui.test.js
git commit -m "Portal: Getting started landing, CV attach button, Quit Jawbs"
```

---

### Task 7: Bundled default CV template

**Files:**
- Create: `template/render/templates/lib.typ`, `main.typ`, `cover-letter.typ`, `VANTAGE-LICENSE`
- Modify: `template/render/templates/configuration.yaml` (theme comment only), `template/render/render.sh`, `template/render/README.md`, `setup/SETUP.md.tmpl`, `setup/test/run-tests.sh`

**Interfaces:**
- Consumes: the kit content model already in `configuration.yaml` (`contacts.{name,phone,email,location,website,linkedin}`, `position`, `role`, `about[]`, `key_skills[]`, `education[].{qualification,course,institution,dates}`, `jobs[].{position,company,from,to,intro,description[]}`) and `cover-letter.yaml` (`contacts`, `role`, `date`, `recipient?`, `subject?`, `greeting`, `paragraphs[]`, `signoff`).
- Produces: `render/templates/main.typ` and `cover-letter.typ` in every new project, so `render.sh` works out of the box.

- [ ] **Step 1: Update the render tests first** in `setup/test/run-tests.sh`

Replace the block that begins `# With no vendored template, render.sh must fail` (both the missing-`main.typ` and missing-`cover-letter.typ` checks) with:

```bash
# The kit ships a default template, so a new project has both files.
check "default CV template ships" test -f "$TARGET1/render/templates/main.typ"
check "default letter template ships" test -f "$TARGET1/render/templates/cover-letter.typ"
check "template licence ships" test -f "$TARGET1/render/templates/VANTAGE-LICENSE"

# Removing a template still fails with a pointer at the README.
mkdir -p "$TARGET1/applications/dummy-role"
rm "$TARGET1/render/templates/cover-letter.typ"
RENDER_OUT2="$(bash "$TARGET1/render/render.sh" dummy-role 2>&1)"
RENDER_RC2=$?
check "render.sh fails without a letter template" test "$RENDER_RC2" -ne 0
if echo "$RENDER_OUT2" | grep -q "Choosing your template"; then pass; else fail "missing-template message should point at 'Choosing your template'"; fi

# With typst present, the skeleton renders to a one-page CV and a letter.
if command -v typst >/dev/null 2>&1 && python3 -c 'import yaml' >/dev/null 2>&1; then
  RWORK_T="$(mktemp -d)"
  bash "$SETUP_DIR/setup.sh" --answers "$TEST_DIR/answers.env" --target "$RWORK_T/p" --skip-deps >/dev/null 2>&1
  mkdir -p "$RWORK_T/p/applications/demo"
  cp "$RWORK_T/p/render/templates/configuration.yaml" "$RWORK_T/p/applications/demo/cv.yaml"
  cp "$RWORK_T/p/render/templates/cover-letter.yaml" "$RWORK_T/p/applications/demo/cover-letter.yaml"
  # The skeleton letter is deliberately short, so the 66% page-fill rule in
  # cover-letter.typ stops it: the CV renders and the letter is refused.
  bash "$RWORK_T/p/render/render.sh" demo >"$RWORK_T/out.txt" 2>&1
  check "CV pdf produced" test -f "$RWORK_T/p/applications/demo/CV - Alex Example - Senior Widget Analyst.pdf"
  check "short letter refused by the page-fill rule" grep -q "cover letter too short" "$RWORK_T/out.txt"
  rm -rf "$RWORK_T"
fi
```

(The old "touch main.typ" sequence goes: the templates now exist. `answers.env` has `USER_NAME="Alex Example"`; check it does, and adjust the expected PDF name if not.)

- [ ] **Step 2: Run to verify it fails**

Run: `bash setup/test/run-tests.sh`
Expected: FAIL on "default CV template ships" and the two following checks.

- [ ] **Step 3: Create `template/render/templates/VANTAGE-LICENSE`**

The MIT licence text, copyright line `Copyright (c) 2024 Sardor Mamadaliev`, followed by the standard MIT permission and warranty paragraphs verbatim (https://opensource.org/license/mit). Add one line above it: `The layout in lib.typ and main.typ derives from @preview/vantage-cv:1.0.0, used under this licence.`

- [ ] **Step 4: Create `template/render/templates/lib.typ`**

```typst
// Layout helpers for the kit's default CV and cover letter. Derived from
// @preview/vantage-cv:1.0.0 (see VANTAGE-LICENSE), vendored so rendering needs
// no network. Fonts default to ones bundled with Typst itself, so nothing has
// to be installed; override them in the yaml `theme:` block.

#let default-accent = rgb("#2b4c6f")
#let default-body-font = "New Computer Modern"
#let default-heading-font = "Libertinus Serif"

// Theme dials from a loaded yaml, with the defaults above.
#let theme-of(cfg) = {
  let t = cfg.at("theme", default: (:))
  if t == none { t = (:) }
  (
    accent: rgb(t.at("accent", default: default-accent.to-hex())),
    body-font: t.at("body_font", default: default-body-font),
    heading-font: t.at("heading_font", default: default-heading-font),
  )
}

// Contact row built only from the fields actually present, so nothing is
// invented. Links are real links; location is plain text.
#let contact-row(contacts) = {
  let parts = ()
  if "email" in contacts and contacts.email != "" { parts.push(link("mailto:" + contacts.email, contacts.email)) }
  if "phone" in contacts and contacts.phone != "" { parts.push(contacts.phone) }
  if "location" in contacts and contacts.location != "" { parts.push(contacts.location) }
  if "website" in contacts { parts.push(link(contacts.website.url, contacts.website.displayText)) }
  if "linkedin" in contacts { parts.push(link(contacts.linkedin.url, contacts.linkedin.displayText)) }
  text(8.5pt, parts.join(h(6pt) + sym.dot.c + h(6pt)))
}

#let cv-page(name: "", position: "", contacts: (:), role: "", theme: (:), left-side, right-side) = {
  set document(title: "CV - " + name + if role != "" { " - " + role } else { "" }, author: name)
  set text(9.8pt, font: theme.body-font, lang: "en", region: "gb")
  set page(paper: "a4", margin: (x: 1.2cm, y: 1.2cm))
  set list(tight: false, spacing: 1.1em)

  show heading.where(level: 2): it => block(above: 1.1em, below: 0.6em, text(
    fill: theme.accent, font: theme.heading-font, weight: "semibold", size: 11pt,
    [#it.body #v(-7pt) #line(length: 100%, stroke: 0.5pt + theme.accent)],
  ))
  show heading.where(level: 3): it => text(weight: "bold", it.body)

  text(20pt, font: theme.heading-font, weight: "bold")[#name]
  v(-6pt)
  text(12pt, fill: luma(60))[#position]
  v(2pt)
  contact-row(contacts)
  v(0.9em)

  grid(columns: (7fr, 4fr), column-gutter: 2em, left-side, right-side)
}
```

- [ ] **Step 5: Create `template/render/templates/main.typ`**

```typst
// The kit's default CV. Presentation lives here; content lives in the yaml.
// Render with render/render.sh <slug>, which passes --input config=<cv.yaml>.
// Replace this design whenever you like: see "Choosing your template" in
// render/README.md. Date ranges read "from to to" in the yaml's own words.
#import "lib.typ": cv-page, theme-of

#let cfg = yaml(sys.inputs.at("config", default: "/render/templates/configuration.yaml"))
#let theme = theme-of(cfg)

#cv-page(
  name: cfg.contacts.name,
  position: cfg.at("position", default: ""),
  contacts: cfg.contacts,
  role: cfg.at("role", default: ""),
  theme: theme,
  [
    #if "about" in cfg [
      == Profile
      #for p in cfg.about [ #p #parbreak() ]
    ]

    == Experience
    #for job in cfg.jobs [
      === #job.position
      #h(1fr) #text(9pt, fill: luma(90))[#job.from to #job.to] \
      #emph(job.company)
      #if "intro" in job [ \ #job.intro ]
      #for point in job.at("description", default: ()) [
        - #point
      ]
      #v(5pt)
    ]
  ],
  [
    #if "key_skills" in cfg [
      == Key skills
      #for s in cfg.key_skills [ - #s ]
    ]

    #if "education" in cfg [
      == Education
      #for edu in cfg.education [
        #strong(edu.at("qualification", default: ""))
        #if "course" in edu [ #edu.course ] \
        #edu.at("institution", default: "")
        #if "dates" in edu [ \ #text(9pt, fill: luma(90))[#edu.dates] ]
        #parbreak()
      ]
    ]
  ],
)
```

- [ ] **Step 6: Create `template/render/templates/cover-letter.typ`**

```typst
// The kit's default cover letter, sharing the CV's letterhead and theme.
// Content lives in a per-role cover-letter.yaml.
#import "lib.typ": contact-row, theme-of

#let cfg = yaml(sys.inputs.at("config", default: "/render/templates/cover-letter.yaml"))
#let theme = theme-of(cfg)

#let role-part = if "role" in cfg { " - " + cfg.role } else { "" }
#set document(title: "Cover Letter - " + cfg.contacts.name + role-part, author: cfg.contacts.name)
#set text(10.5pt, font: theme.body-font, lang: "en", region: "gb")
#set page(paper: "a4", margin: (x: 1.9cm, y: 1.4cm))
#set par(justify: false, leading: 0.95em, spacing: 1.85em)

#stack(
  spacing: 18pt,
  text(20pt, font: theme.heading-font, weight: "bold")[#cfg.contacts.name],
  contact-row(cfg.contacts),
  line(length: 100%, stroke: 0.5pt + theme.accent),
)

#v(14pt)
#align(right)[#emph(str(cfg.date))]
#parbreak()
#if "recipient" in cfg [ #cfg.recipient #parbreak() ]
#if "subject" in cfg { text(weight: "bold")[#cfg.subject]; parbreak() }
#cfg.greeting
#parbreak()
#for p in cfg.paragraphs { p; parbreak() }
#v(4pt)
#cfg.signoff
#linebreak()
#cfg.contacts.name

// Length guard (render/README.md, "Cover letters fill the page"): a letter
// must end at least 66% of the way down and should reach 75%. render.sh reads
// the marker back and reports the fill after every render.
#context [
  #metadata((
    page: here().position().page,
    fill-pct: calc.round(here().position().y / 297mm * 100, digits: 1),
  )) <letter-end>
]
#context {
  let pos = locate(<letter-end>).position()
  if pos.page == 1 and pos.y < 297mm * 0.66 {
    panic("cover letter too short: it ends " + repr(calc.round(pos.y / 297mm * 100, digits: 1))
      + "% down the page. It must reach at least 66% (aim for 75%). Extend or add paragraphs in cover-letter.yaml.")
  }
}
```

- [ ] **Step 7: Render check by hand**

```bash
cd /tmp && rm -rf kt && mkdir kt && cp -R ~/j4dev/template/render kt/render && cd kt
typst compile --root . render/templates/main.typ cv.pdf
typst compile --root . render/templates/cover-letter.typ cl.pdf
```

Expected: `cv.pdf` compiles with no errors and is one page (the skeleton still contains `{{USER_NAME}}` tokens, which render as text). The letter fails with "cover letter too short", which is the page-fill rule working on the short skeleton; to see a letter, add two long paragraphs to a copy of `cover-letter.yaml` and pass it with `--input config=/<copy>`. Use the scratchpad directory rather than `/tmp` if the session provides one.

- [ ] **Step 8: Wording changes**

- `render.sh`: the two missing-template messages change from "The kit does not ship a CV design. Pick and vendor a Typst template first:" to "The default template is missing. Restore it from the kit's template/render/templates/, or vendor another:" (same for the letter). Keep the "Choosing your template" pointer.
- `render/README.md`: the opening paragraph becomes: "Typst rendering for send-ready CV and cover letter PDFs. A default design is included in `render/templates/` (derived from the MIT-licensed vantage-cv layout, using fonts that ship with Typst), so rendering works as soon as Typst is installed. You can swap it for a Typst Universe template whenever you like: see "Choosing your template" below. The content model and the hard rules stay the same whichever template you use." Adjust the sentence "Until you have set up a template, render.sh will stop..." to "If a template file goes missing, render.sh will stop...".
- `configuration.yaml` theme comment: replace the example keys with `accent`, `body_font`, `heading_font`, and say the default template reads exactly these three.
- `setup/SETUP.md.tmpl` task 10 becomes:

```
10. The project ships with a default CV and cover letter design in
    `render/templates/`. Render a test CV from `core/master-cv.md` (copy the
    skeleton `configuration.yaml` into a dummy application folder, fill it from
    the master CV, and run `render/render.sh <slug>`), check it fits one page,
    and show it to {{USER_NAME}}. In a terminal session, offer to switch to a
    different design from Typst Universe (https://typst.app/universe) or to
    replicate their existing CV's look, following "Choosing your template" in
    `render/README.md`.
```

- [ ] **Step 9: Run tests**

Run: `bash setup/test/run-tests.sh`
Expected: `Failed: 0`.

- [ ] **Step 10: Commit**

```bash
git add template/render setup/SETUP.md.tmpl setup/test/run-tests.sh
git commit -m "Ship a default CV and cover letter template so new projects render at once"
```

---

### Task 8: Typst on macOS without Homebrew

**Files:**
- Modify: `template/render/install-typst.sh`, `setup/setup.sh` (typst dependency block)
- Test: `setup/test/run-tests.sh`

**Interfaces:**
- Produces: `install-typst.sh` honours `TYPST_UNAME_S` / `TYPST_UNAME_M` overrides and `TYPST_PRINT_ASSET=1` (print the chosen asset and exit), so tests can check the mapping without downloading.

- [ ] **Step 1: Write the failing tests** (append to `run-tests.sh` before the Summary)

```bash
# --- install-typst.sh asset selection ----------------------------------------
IT="$SETUP_DIR/../template/render/install-typst.sh"
asset() { TYPST_PRINT_ASSET=1 TYPST_UNAME_S="$1" TYPST_UNAME_M="$2" bash "$IT"; }
check "linux x86_64 asset" test "$(asset Linux x86_64)" = "typst-x86_64-unknown-linux-musl"
check "linux arm64 asset" test "$(asset Linux aarch64)" = "typst-aarch64-unknown-linux-musl"
check "mac arm64 asset" test "$(asset Darwin arm64)" = "typst-aarch64-apple-darwin"
check "mac intel asset" test "$(asset Darwin x86_64)" = "typst-x86_64-apple-darwin"
```

- [ ] **Step 2: Run to verify they fail**

Run: `bash setup/test/run-tests.sh`
Expected: 4 new failures.

- [ ] **Step 3: Implement** in `install-typst.sh`, replacing the header comment's macOS line with "Works on Linux and macOS." and the `case "$(uname -m)"` block with:

```bash
OS="${TYPST_UNAME_S:-$(uname -s)}"
ARCH="${TYPST_UNAME_M:-$(uname -m)}"
case "$OS/$ARCH" in
  Linux/x86_64)        ASSET="typst-x86_64-unknown-linux-musl"; EXT="tar.xz" ;;
  Linux/aarch64)       ASSET="typst-aarch64-unknown-linux-musl"; EXT="tar.xz" ;;
  Darwin/arm64)        ASSET="typst-aarch64-apple-darwin"; EXT="tar.xz" ;;
  Darwin/x86_64)       ASSET="typst-x86_64-apple-darwin"; EXT="tar.xz" ;;
  *) echo "unsupported system: $OS $ARCH" >&2; exit 1 ;;
esac
if [ "${TYPST_PRINT_ASSET:-}" = "1" ]; then echo "$ASSET"; exit 0; fi
```

Move `DEST=...; mkdir -p "$DEST"` below this block so the print mode creates nothing. Use `$EXT` in the download URL and the downloaded filename. Before committing, confirm the macOS asset names and extension against the latest release's asset list (`curl -s https://api.github.com/repos/typst/typst/releases/latest | grep '"name"'`); if the Darwin assets are `.tar.xz` keep as written, otherwise adjust `EXT` and the extraction line (`tar -xf` handles both `.tar.xz` and `.tar.gz`; a `.zip` needs `unzip -q`). `install -m 0755` exists on macOS.

- [ ] **Step 4: Offer the installer on macOS too** in `setup.sh`'s typst block: remove the `Darwin)` branch that only prints `brew install typst`, so every OS goes through the offer-to-run path. Change the prompt to `"  Install Typst into ~/.local/bin now? [y/N]: "`. In the python3-missing branch, add a macOS hint:

```bash
    case "$(uname)" in
      Darwin) echo "  On macOS, run: xcode-select --install   and accept the prompt, then re-run setup." >&2 ;;
    esac
```

- [ ] **Step 5: Run tests**

Run: `bash setup/test/run-tests.sh`
Expected: `Failed: 0`.

- [ ] **Step 6: Commit**

```bash
git add template/render/install-typst.sh setup/setup.sh setup/test/run-tests.sh
git commit -m "Install Typst on macOS without Homebrew"
```

---

### Task 9: The wizard menu and `JAWBS_MODE`

**Files:**
- Modify: `setup/setup.sh`
- Create: `setup/test/answers-local.env`, `setup/test/answers-terminal.env`
- Test: `setup/test/run-tests.sh`

**Interfaces:**
- Produces: `JAWBS_MODE` (`local | terminal | shared`) resolved after answers are gathered; `PORTAL` is kept in step (`yes` only for `shared`) because `substitute_all` and SETUP.md's "Portal:" line read it. SETUP.md's wizard-answers line becomes `- How Jawbs is used: {{JAWBS_MODE}}` (add `JAWBS_MODE` to `substitute_all`'s token list and sed expressions).
- Consumes (Task 10): the wizard calls `bash "$SETUP_DIR/jawbs-local.sh" "$ABS_TARGET"` when `JAWBS_MODE=local`. In this task, add the call guarded by `[ -f "$SETUP_DIR/jawbs-local.sh" ]` and `[ "${JAWBS_SKIP_LOCAL:-no}" != "yes" ]`; tests set `JAWBS_SKIP_LOCAL=yes` until Task 10 lands.

- [ ] **Step 1: Test fixtures**

`setup/test/answers-local.env`: a copy of `answers.env` with the `PORTAL=...` line replaced by `JAWBS_MODE="local"`.
`setup/test/answers-terminal.env`: a copy with `JAWBS_MODE="terminal"` and no `PORTAL` line.

- [ ] **Step 2: Write the failing tests** (new section in `run-tests.sh` before the Summary)

```bash
# --- JAWBS_MODE ---------------------------------------------------------------
MWORK="$(mktemp -d)"
run_mode() { # run_mode <answers> <target>
  PORTAL_REGISTRY="$MWORK/users.json" JAWBS_SKIP_LOCAL=yes \
    bash "$SETUP_DIR/setup.sh" --answers "$1" --target "$2" --skip-deps >"$2.out" 2>&1
}
run_mode "$TEST_DIR/answers-terminal.env" "$MWORK/t" || fail "terminal mode exited non-zero"
check "terminal mode registers nobody" test ! -f "$MWORK/users.json"
check "terminal mode has no portal task" sh -c "! grep -q 'If you chose the portal' '$MWORK/t/SETUP.md'"
check "SETUP.md records the mode" grep -q "How Jawbs is used: terminal" "$MWORK/t/SETUP.md"

run_mode "$TEST_DIR/answers-local.env" "$MWORK/l" || fail "local mode exited non-zero"
check "local mode has no remote-access task" sh -c "! grep -q 'If you chose the portal' '$MWORK/l/SETUP.md'"
check "SETUP.md records local" grep -q "How Jawbs is used: local" "$MWORK/l/SETUP.md"

# PORTAL=yes still means shared, PORTAL=no still means terminal.
run_mode "$TEST_DIR/answers-portal.env" "$MWORK/s" || fail "PORTAL=yes alias exited non-zero"
check "PORTAL=yes is shared" grep -q "How Jawbs is used: shared" "$MWORK/s/SETUP.md"
check "shared keeps the portal task" grep -q "If you chose the portal" "$MWORK/s/SETUP.md"
run_mode "$TEST_DIR/answers.env" "$MWORK/n" || fail "PORTAL=no alias exited non-zero"
check "PORTAL=no is terminal" grep -q "How Jawbs is used: terminal" "$MWORK/n/SETUP.md"

printf 'JAWBS_MODE="sideways"\n' | cat "$TEST_DIR/answers-terminal.env" - > "$MWORK/bad.env"
if run_mode "$MWORK/bad.env" "$MWORK/b"; then fail "an unknown JAWBS_MODE should stop setup"; else pass; fi
rm -rf "$MWORK"
```

Also update the existing interactive-flow tests, if any feed stdin answers through the portal question (search `run-tests.sh` for `printf` piped into `setup.sh`): Run 0 pipes a single newline for the folder question only, with `--answers`, so it is unaffected.

- [ ] **Step 3: Run to verify they fail**

Run: `bash setup/test/run-tests.sh`
Expected: new failures ("How Jawbs is used" not found, unknown mode accepted).

- [ ] **Step 4: Implement** in `setup.sh`

1. Interactive branch: replace the `ask PORTAL ...` line and its `case` with:

```bash
  echo
  echo "How would you like to work with Jawbs?"
  echo
  echo "  1) In your web browser, on this computer (recommended)"
  echo "     Jawbs opens like an app. You chat with it in a browser window."
  echo
  echo "  2) In a terminal, with Claude Code"
  echo "     For people comfortable typing commands. Nothing extra is installed."
  echo
  echo "  3) On a shared Jawbs that someone else runs"
  echo "     Only choose this if the person who runs it asked you to."
  echo "     They will send you the web address."
  echo
  ask_menu JAWBS_CHOICE "" "browser" "terminal" "shared"
  case "$JAWBS_CHOICE" in
    browser) JAWBS_MODE="local" ;;
    terminal) JAWBS_MODE="terminal" ;;
    shared) JAWBS_MODE="shared"
      ask PORTAL_ADMIN "Should this person receive failure alerts? [y/N]" "no" ;;
  esac
```

`ask_menu` echoes its prompt first; passing `""` prints an empty line, which is fine. Its options print as `1) browser` etc. under the block above; that duplication is acceptable but tidier is to add an optional quiet mode. Do this: give `ask_menu` a leading `--quiet` flag that skips printing the prompt and the options (bash 3.2: `if [ "$1" = "--quiet" ]; then quiet=yes; shift; else quiet=no; fi`), and call `ask_menu --quiet JAWBS_CHOICE "" browser terminal shared`.

2. After the answers are gathered (before the CREATIVE normalisation), resolve the mode:

```bash
# JAWBS_MODE is the current answer; PORTAL=yes/no in older answers files maps
# onto it so they keep working. PORTAL stays in step for substitute_all.
if [ -z "${JAWBS_MODE:-}" ]; then
  case "${PORTAL:-no}" in
    y|Y|yes|Yes|YES) JAWBS_MODE="shared" ;;
    *) JAWBS_MODE="terminal" ;;
  esac
fi
case "$JAWBS_MODE" in
  local|terminal|shared) ;;
  *) echo "Unknown JAWBS_MODE: $JAWBS_MODE (expected local, terminal or shared)" >&2; exit 1 ;;
esac
if [ "$JAWBS_MODE" = "shared" ]; then PORTAL="yes"; else PORTAL="no"; fi
```

3. Remove `PORTAL` from the "Missing answer" loop's variable list (it is now derived).
4. Replace the later `case "$PORTAL" in y|Y... PORTAL="yes"` normalisation block with nothing (already normalised), and change `if [ "$PORTAL" = "yes" ]; then` (registration and SETUP.md task) to `if [ "$JAWBS_MODE" = "shared" ]; then`.
5. The dependency block's node check runs for `shared` or `local`: change its `case "$PORTAL"` to `case "$JAWBS_MODE" in shared|local)`.
6. Before `# --- Initialise git`, do nothing; after git init and before the final "Done" message:

```bash
if [ "$JAWBS_MODE" = "local" ] && [ "${JAWBS_SKIP_LOCAL:-no}" != "yes" ] && [ -f "$SETUP_DIR/jawbs-local.sh" ]; then
  echo
  bash "$SETUP_DIR/jawbs-local.sh" "$(cd "$TARGET_DIR" && pwd)" || true
fi
```

7. The closing "Next step" message: for `local`, print instead:

```bash
if [ "$JAWBS_MODE" = "local" ]; then
  echo "Jawbs should now be open in your web browser, ready to start."
  echo "Next time, double-click Jawbs on your Desktop or in your Applications."
else
  ...existing next-step text...
fi
```

8. `setup/lib.sh` `substitute_all`: add `mode_esc="$(sed_escape "${JAWBS_MODE:-}")"` and `-e "s/{{JAWBS_MODE}}/$mode_esc/g"`, and list `JAWBS_MODE` in its header comment. `SETUP.md.tmpl`: replace `- Portal: {{PORTAL}}` with `- How Jawbs is used: {{JAWBS_MODE}}`.

- [ ] **Step 5: Run tests**

Run: `bash setup/test/run-tests.sh`
Expected: `Failed: 0`. Then read the diff for bash 3.2 compatibility by eye.

- [ ] **Step 6: Commit**

```bash
git add setup/setup.sh setup/lib.sh setup/SETUP.md.tmpl setup/test
git commit -m "Wizard: ask how the person will use Jawbs, in plain words"
```

---

### Task 10: `setup/jawbs-local.sh`

**Files:**
- Create: `setup/jawbs-local.sh`
- Modify: `setup/lib.sh` (add `detect_subscriptions`, `write_local_env`, `registry_has_other`)
- Test: `setup/test/run-tests.sh`

**Interfaces:**
- Consumes: `register_portal_user` (lib.sh), `install_launcher` (Task 11; call guarded by `command -v install_launcher` / `type install_launcher` until then).
- Produces:
  - `detect_subscriptions` → sets `SUBSCRIPTIONS_FOUND` to `both` or `claude-only` and `CODEX_BIN_FOUND` to the codex path (empty when none). It sets variables rather than printing, because `$(...)` would run it in a subshell and lose `CODEX_BIN_FOUND`
  - `write_local_env <env_file> <subscriptions> [codex_bin]` → returns 1 without writing if the file exists
  - `registry_has_other <registry> <email>` → 0 when the registry has any entry whose key is not `<email>`
  - `jawbs-local.sh <project_dir>`: reads name and email from the project's `SETUP.md` "Wizard answers" section; env overrides for tests: `PORTAL_REGISTRY`, `JAWBS_ENV_FILE` (default `$KIT_DIR/portal/.env`), `JAWBS_SKIP_NPM=yes`, `JAWBS_SKIP_LAUNCH=yes`, `JAWBS_NODE` (node binary to require, default `node`)

- [ ] **Step 1: Write the failing tests** (new section in `run-tests.sh`)

```bash
# --- jawbs-local.sh -----------------------------------------------------------
LWORK="$(mktemp -d)"
PORTAL_REGISTRY="$LWORK/users.json" JAWBS_SKIP_LOCAL=yes \
  bash "$SETUP_DIR/setup.sh" --answers "$TEST_DIR/answers-local.env" --target "$LWORK/proj" --skip-deps >/dev/null 2>&1
mkdir -p "$LWORK/fakebin"
# A codex that is signed in.
printf '#!/bin/sh\n[ "$1 $2" = "login status" ] && exit 0\nexit 1\n' > "$LWORK/fakebin/codex"
chmod +x "$LWORK/fakebin/codex"
run_local() { # run_local <env-file> [PATH]
  HOME="$LWORK/home" PORTAL_REGISTRY="$LWORK/users.json" JAWBS_ENV_FILE="$1" \
  JAWBS_SKIP_NPM=yes JAWBS_SKIP_LAUNCH=yes PATH="${2:-$PATH}" \
    bash "$SETUP_DIR/jawbs-local.sh" "$LWORK/proj" >"$1.out" 2>&1
}
mkdir -p "$LWORK/home"
# A fake claude, so the test does not depend on the host having one.
printf '#!/bin/sh\nexit 0\n' > "$LWORK/fakebin/claude"; chmod +x "$LWORK/fakebin/claude"

run_local "$LWORK/env1" "$LWORK/fakebin:$PATH" || fail "jawbs-local.sh exited non-zero"
check ".env written" test -f "$LWORK/env1"
check ".env is local" grep -q '^EXPOSURE=local$' "$LWORK/env1"
check ".env binds loopback" grep -q '^BIND_HOST=127.0.0.1$' "$LWORK/env1"
check ".env base url" grep -q '^BASE_URL=http://localhost:8710$' "$LWORK/env1"
check ".env logs email" grep -q '^EMAIL_PROVIDER=log$' "$LWORK/env1"
check "signed-in codex means both" grep -q '^SUBSCRIPTIONS=both$' "$LWORK/env1"
check "codex path recorded" grep -q "^CODEX_BIN=$LWORK/fakebin/codex$" "$LWORK/env1"
check "user registered" grep -q 'alex@example.com' "$LWORK/users.json"

printf 'EXPOSURE=private\n' > "$LWORK/env2"
run_local "$LWORK/env2" "$LWORK/fakebin:$PATH"
check "existing .env left alone" test "$(cat "$LWORK/env2")" = "EXPOSURE=private"
check "existing .env explained" grep -q "already has settings" "$LWORK/env2.out"

# Signed-out codex means claude-only.
printf '#!/bin/sh\nexit 1\n' > "$LWORK/fakebin/codex"
run_local "$LWORK/env3" "$LWORK/fakebin:$PATH"
check "signed-out codex means claude-only" grep -q '^SUBSCRIPTIONS=claude-only$' "$LWORK/env3"

# Someone else already registered: stop politely, exit 0.
printf '{ "someone@else.com": { "name": "S", "projectDir": "/x" } }\n' > "$LWORK/users.json"
run_local "$LWORK/env4" "$LWORK/fakebin:$PATH" || fail "registry clash should still exit 0"
check "clash writes no .env" test ! -f "$LWORK/env4"
check "clash explained" grep -q "another person" "$LWORK/env4.out"
rm -f "$LWORK/users.json"

# No node: instructions, exit 0.
JAWBS_NODE=definitely-not-node run_local "$LWORK/env5" "$LWORK/fakebin:$PATH" || fail "missing node should still exit 0"
check "missing node explained" grep -q "Node" "$LWORK/env5.out"
check "missing node writes no .env" test ! -f "$LWORK/env5"
rm -rf "$LWORK"
```

- [ ] **Step 2: Run to verify they fail**

Run: `bash setup/test/run-tests.sh`
Expected: failures (script missing).

- [ ] **Step 3: lib.sh helpers** (append)

```bash
# detect_subscriptions
# Sets SUBSCRIPTIONS_FOUND to "both" when a signed-in Codex is found, else
# "claude-only", and CODEX_BIN_FOUND to the binary's path (empty when there is
# none). Call it directly, not in $(...): a subshell would lose both variables. The portal
# only drafts through ChatGPT under "both", and refuses to start under "both"
# without Codex, so guessing high would stop the portal.
detect_subscriptions() {
  CODEX_BIN_FOUND=""
  if command -v codex >/dev/null 2>&1; then
    CODEX_BIN_FOUND="$(command -v codex)"
  elif [ -x "$HOME/.local/bin/codex" ]; then
    CODEX_BIN_FOUND="$HOME/.local/bin/codex"
  fi
  if [ -n "$CODEX_BIN_FOUND" ] && "$CODEX_BIN_FOUND" login status </dev/null >/dev/null 2>&1; then
    SUBSCRIPTIONS_FOUND="both"
  else
    SUBSCRIPTIONS_FOUND="claude-only"
  fi
}

# write_local_env <env_file> <subscriptions> [codex_bin]
# Writes the portal .env for EXPOSURE=local. Never overwrites: returns 1 and
# writes nothing when the file exists.
write_local_env() {
  wle_file="$1"; wle_subs="$2"; wle_codex="${3:-}"
  [ -e "$wle_file" ] && return 1
  {
    echo "# Written by the setup wizard for Jawbs on this computer. See docs/portal.md."
    echo "EXPOSURE=local"
    echo "BIND_HOST=127.0.0.1"
    echo "PORT=8710"
    echo "BASE_URL=http://localhost:8710"
    echo "EMAIL_PROVIDER=log"
    echo "PORTAL_TITLE=Jawbs"
    echo "AGENT_RUNNER=claude-sdk"
    echo "SUBSCRIPTIONS=$wle_subs"
    if [ -n "$wle_codex" ] && [ "$wle_codex" != "$HOME/.local/bin/codex" ]; then
      echo "CODEX_BIN=$wle_codex"
    fi
  } > "$wle_file"
}

# registry_has_other <registry> <email>
# True when the registry holds anyone other than <email>. No node, no file or
# an unreadable file all count as "no one else".
registry_has_other() {
  [ -f "$1" ] || return 1
  command -v node >/dev/null 2>&1 || return 1
  RHO_FILE="$1" RHO_EMAIL="$2" node -e '
    const u = JSON.parse(require("fs").readFileSync(process.env.RHO_FILE, "utf8"));
    const me = process.env.RHO_EMAIL.trim().toLowerCase();
    process.exit(Object.keys(u).some(k => k !== me) ? 0 : 1);
  ' 2>/dev/null
}
```

Note the test expects `CODEX_BIN=<fakebin>/codex` because the fake is on PATH and is not `$HOME/.local/bin/codex`.

- [ ] **Step 4: Create `setup/jawbs-local.sh`**

```bash
#!/usr/bin/env bash
# Set up Jawbs to run in the browser on this computer, for the project given.
# Called by setup.sh when the person chooses option 1, and safe to re-run by
# hand after installing something that was missing:
#   setup/jawbs-local.sh <project folder>
# Never exits non-zero for a missing prerequisite: it explains and stops.
# Bash 3.2 compatible.
set -u

SETUP_DIR="$(cd "$(dirname "$0")" && pwd)"
KIT_DIR="$(dirname "$SETUP_DIR")"
. "$SETUP_DIR/lib.sh"

PROJECT="${1:?usage: jawbs-local.sh <project folder>}"
PROJECT="$(cd "$PROJECT" && pwd)"
PORTAL_REGISTRY="${PORTAL_REGISTRY:-$KIT_DIR/portal/data/users.json}"
ENV_FILE="${JAWBS_ENV_FILE:-$KIT_DIR/portal/.env}"
NODE_BIN="${JAWBS_NODE:-node}"
RERUN="Once it is installed, run this to finish: $SETUP_DIR/jawbs-local.sh $PROJECT"

# Name and email come from the wizard's record in SETUP.md, so a re-run
# needs no questions.
answer() { sed -n "s/^- $1: //p" "$PROJECT/SETUP.md" 2>/dev/null | head -1; }
USER_NAME="$(answer Name)"
USER_EMAIL="$(answer Email)"
if [ -z "$USER_NAME" ] || [ -z "$USER_EMAIL" ]; then
  echo "Could not read your name and email from $PROJECT/SETUP.md, so Jawbs was not set up."
  exit 0
fi

echo "Setting up Jawbs on this computer..."

# 1. Prerequisites.
if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  echo "Jawbs needs Node (version 18 or newer), which is not installed."
  echo "  macOS: download the installer from https://nodejs.org"
  echo "  Linux: sudo apt install -y nodejs npm"
  echo "$RERUN"
  exit 0
fi
if ! "$NODE_BIN" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)'; then
  echo "Jawbs needs Node 18 or newer, but this computer has $("$NODE_BIN" --version)."
  echo "$RERUN"
  exit 0
fi
if ! command -v claude >/dev/null 2>&1; then
  echo "Jawbs uses Claude Code, which is not installed."
  echo "  Install it from https://claude.com/claude-code, then run: claude"
  echo "  and sign in once."
  echo "$RERUN"
  exit 0
fi

# 2. A second person on the same kit copy would share one no-sign-in portal.
if registry_has_other "$PORTAL_REGISTRY" "$USER_EMAIL"; then
  echo "This copy of the kit already runs Jawbs for another person."
  echo "Jawbs on a computer serves one person, so a second person needs their"
  echo "own copy of the kit (git clone it again into another folder)."
  exit 0
fi

# 3. Install.
if [ "${JAWBS_SKIP_NPM:-no}" != "yes" ]; then
  echo "Installing Jawbs (this can take a minute)..."
  if ! (cd "$KIT_DIR/portal" && npm ci --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund >/dev/null 2>&1); then
    echo "Installing failed. Try again with: cd $KIT_DIR/portal && npm install"
    echo "$RERUN"
    exit 0
  fi
fi

# 4. Settings.
detect_subscriptions
if write_local_env "$ENV_FILE" "$SUBSCRIPTIONS_FOUND" "$CODEX_BIN_FOUND"; then
  echo "Settings written to $ENV_FILE."
else
  echo "$ENV_FILE already has settings, so it was left as it is."
fi

# 5. Register.
register_portal_user "$PORTAL_REGISTRY" "$USER_EMAIL" "$USER_NAME" "$PROJECT" "yes" >/dev/null

# 6. Launcher, icons, first launch.
if type install_launcher >/dev/null 2>&1; then
  install_launcher "$KIT_DIR" "$(command -v "$NODE_BIN")"
  if [ "${JAWBS_SKIP_LAUNCH:-no}" != "yes" ]; then
    "$KIT_DIR/bin/jawbs-open" || true
  fi
fi
exit 0
```

`chmod +x setup/jawbs-local.sh`. Check the "Wizard answers" lines in `SETUP.md.tmpl` are `- Name: {{USER_NAME}}` and `- Email: {{USER_EMAIL}}` (they are); the `sed` reads them after substitution.

- [ ] **Step 5: Run tests**

Run: `bash setup/test/run-tests.sh`
Expected: `Failed: 0`. Read the script for bash 3.2 compatibility by eye.

- [ ] **Step 6: Commit**

```bash
git add setup/jawbs-local.sh setup/lib.sh setup/test/run-tests.sh
git commit -m "setup/jawbs-local.sh: install, configure and register Jawbs for this computer"
```

---

### Task 11: Launcher and icons

**Files:**
- Modify: `setup/lib.sh` (add `install_launcher`), `.gitignore` (add `bin/jawbs-open`)
- Create: `setup/assets/jawbs.png` (512x512)
- Test: `setup/test/run-tests.sh`

**Interfaces:**
- Produces: `install_launcher <kit_dir> <node_path>` writes `<kit_dir>/bin/jawbs-open` and installs icons for `${JAWBS_OS:-$(uname -s)}` (`Darwin` or `Linux`) under `$HOME`. Desktop dir: `$JAWBS_DESKTOP_DIR`, else `xdg-user-dir DESKTOP` on Linux when available, else `$HOME/Desktop`.

- [ ] **Step 1: Create the icon** (one-off, commit the PNG)

```bash
python3 - <<'EOF'
from PIL import Image, ImageDraw, ImageFont
im = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
d.rounded_rectangle((16, 16, 496, 496), radius=110, fill=(43, 76, 111, 255))
try:
    f = ImageFont.truetype('DejaVuSans-Bold.ttf', 300)
except OSError:
    f = ImageFont.load_default()
d.text((256, 270), 'J', font=f, fill=(255, 255, 255, 255), anchor='mm')
im.save('setup/assets/jawbs.png')
EOF
```

(Run from the repo root after `mkdir -p setup/assets`.)

- [ ] **Step 2: Write the failing tests**

```bash
# --- install_launcher ---------------------------------------------------------
IWORK="$(mktemp -d)"
mkdir -p "$IWORK/kit/bin" "$IWORK/kit/setup/assets" "$IWORK/home"
cp "$SETUP_DIR/assets/jawbs.png" "$IWORK/kit/setup/assets/"
(
  HOME="$IWORK/home" JAWBS_OS=Linux JAWBS_DESKTOP_DIR="$IWORK/home/Desktop" PATH="/opt/fake:$PATH"
  export HOME JAWBS_OS JAWBS_DESKTOP_DIR PATH
  install_launcher "$IWORK/kit" "/opt/node/bin/node" >/dev/null 2>&1
)
L="$IWORK/kit/bin/jawbs-open"
check "launcher written" test -x "$L"
check "launcher bakes absolute node" grep -q '^NODE="/opt/node/bin/node"$' "$L"
check "launcher bakes setup PATH" grep -q '^export PATH="/opt/fake:' "$L"
check "launcher bakes kit dir" grep -q "^KIT=\"$IWORK/kit\"$" "$L"
check "linux menu entry" test -f "$IWORK/home/.local/share/applications/jawbs.desktop"
check "linux desktop entry is executable" test -x "$IWORK/home/Desktop/jawbs.desktop"
check "desktop entry runs the launcher" grep -q "^Exec=\"$L\"$" "$IWORK/home/.local/share/applications/jawbs.desktop"
check "launcher is valid bash" bash -n "$L"

rm -rf "$IWORK/home" && mkdir -p "$IWORK/home"
(
  HOME="$IWORK/home" JAWBS_OS=Darwin JAWBS_DESKTOP_DIR="$IWORK/home/Desktop"
  export HOME JAWBS_OS JAWBS_DESKTOP_DIR
  install_launcher "$IWORK/kit" "/opt/node/bin/node" >/dev/null 2>&1
)
APP="$IWORK/home/Applications/Jawbs.app"
check "mac app bundle" test -f "$APP/Contents/Info.plist"
check "mac app executable" test -x "$APP/Contents/MacOS/Jawbs"
check "mac app runs the launcher" grep -q "$L" "$APP/Contents/MacOS/Jawbs"
check "mac desktop shortcut" test -e "$IWORK/home/Desktop/Jawbs.app"

# Review focus 5: the launcher starts node with a GUI's minimal PATH.
cat > "$IWORK/fake-node" <<'EOF'
#!/bin/sh
echo "started $*" >> "$FAKE_NODE_LOG"
EOF
chmod +x "$IWORK/fake-node"
(
  HOME="$IWORK/home" JAWBS_OS=Linux JAWBS_DESKTOP_DIR="$IWORK/home/Desktop"
  export HOME JAWBS_OS JAWBS_DESKTOP_DIR
  install_launcher "$IWORK/kit" "$IWORK/fake-node" >/dev/null 2>&1
)
mkdir -p "$IWORK/kit/portal/data"
env -i HOME="$IWORK/home" PATH="/usr/bin:/bin" FAKE_NODE_LOG="$IWORK/node.log" JAWBS_PORT=59717 JAWBS_WAIT_SECS=1 JAWBS_NO_BROWSER=yes JAWBS_NO_DIALOG=yes \
  /bin/bash "$L" >/dev/null 2>&1
sleep 1
check "launcher starts node from a bare PATH" grep -q "started src/server.js" "$IWORK/node.log"
rm -rf "$IWORK"
```

- [ ] **Step 3: Run to verify they fail**

Run: `bash setup/test/run-tests.sh`
Expected: failures (`install_launcher: command not found`).

- [ ] **Step 4: Implement `install_launcher`** in `lib.sh`

```bash
# install_launcher <kit_dir> <node_path>
# Writes <kit_dir>/bin/jawbs-open with absolute paths baked in, then installs
# a Jawbs icon in Applications (macOS) or the app menu (Linux), and on the
# Desktop. Apps started from the Dock or a desktop menu do not get the login
# shell's PATH, so the PATH at setup time is baked in too: without it the
# agent could not find typst, python3 or codex. JAWBS_OS and
# JAWBS_DESKTOP_DIR override detection, for tests.
install_launcher() {
  il_kit="$1"; il_node="$2"
  il_os="${JAWBS_OS:-$(uname -s)}"
  il_bin="$il_kit/bin/jawbs-open"
  mkdir -p "$il_kit/bin"
  {
    echo '#!/usr/bin/env bash'
    echo '# Generated by setup/lib.sh install_launcher. Opens Jawbs, starting it first'
    echo '# if it is not already running. Safe to double-click repeatedly.'
    printf 'KIT="%s"\n' "$il_kit"
    printf 'NODE="%s"\n' "$il_node"
    printf 'export PATH="%s"\n' "$PATH"
    printf 'OS="%s"\n' "$il_os"
    cat <<'EOF'
PORT="${JAWBS_PORT:-8710}"
URL="http://localhost:$PORT"
LOG="$KIT/portal/data/jawbs.log"
WAIT="${JAWBS_WAIT_SECS:-15}"

up() { curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/meta" 2>/dev/null | grep -q '"local":true'; }
open_browser() {
  [ "${JAWBS_NO_BROWSER:-}" = "yes" ] && return 0
  if [ "$OS" = "Darwin" ]; then open "$URL"; else xdg-open "$URL" >/dev/null 2>&1 & fi
}
complain() {
  msg="Jawbs did not start. Details are in $LOG"
  [ "${JAWBS_NO_DIALOG:-}" = "yes" ] && { echo "$msg" >&2; return; }
  if [ "$OS" = "Darwin" ]; then
    osascript -e "display alert \"Jawbs\" message \"$msg\" as critical" >/dev/null 2>&1 || echo "$msg" >&2
  elif command -v zenity >/dev/null 2>&1; then
    zenity --error --title=Jawbs --text="$msg" >/dev/null 2>&1
  elif command -v notify-send >/dev/null 2>&1; then
    notify-send Jawbs "$msg"
  else
    echo "$msg" >&2
  fi
}

if up; then open_browser; exit 0; fi
mkdir -p "$(dirname "$LOG")"
( cd "$KIT/portal" && nohup "$NODE" src/server.js >>"$LOG" 2>&1 & )
i=0
while [ "$i" -lt "$WAIT" ]; do
  if up; then open_browser; exit 0; fi
  sleep 1
  i=$((i + 1))
done
complain
exit 1
EOF
  } > "$il_bin"
  chmod +x "$il_bin"

  il_icon="$il_kit/setup/assets/jawbs.png"
  if [ -n "${JAWBS_DESKTOP_DIR:-}" ]; then
    il_desk="$JAWBS_DESKTOP_DIR"
  elif [ "$il_os" = "Linux" ] && command -v xdg-user-dir >/dev/null 2>&1; then
    il_desk="$(xdg-user-dir DESKTOP)"
  else
    il_desk="$HOME/Desktop"
  fi
  mkdir -p "$il_desk"

  if [ "$il_os" = "Darwin" ]; then
    il_app="$HOME/Applications/Jawbs.app"
    mkdir -p "$il_app/Contents/MacOS" "$il_app/Contents/Resources"
    cat > "$il_app/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Jawbs</string>
  <key>CFBundleDisplayName</key><string>Jawbs</string>
  <key>CFBundleIdentifier</key><string>local.jawbs.launcher</string>
  <key>CFBundleExecutable</key><string>Jawbs</string>
  <key>CFBundleIconFile</key><string>jawbs</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
EOF
    printf '#!/bin/bash\nexec "%s"\n' "$il_bin" > "$il_app/Contents/MacOS/Jawbs"
    chmod +x "$il_app/Contents/MacOS/Jawbs"
    # sips and iconutil ship with macOS; elsewhere (tests) the icon is skipped.
    if command -v iconutil >/dev/null 2>&1 && command -v sips >/dev/null 2>&1 && [ -f "$il_icon" ]; then
      il_set="$(mktemp -d)/jawbs.iconset"
      mkdir -p "$il_set"
      for il_s in 16 32 128 256 512; do
        sips -z "$il_s" "$il_s" "$il_icon" --out "$il_set/icon_${il_s}x${il_s}.png" >/dev/null 2>&1
        il_d=$((il_s * 2))
        sips -z "$il_d" "$il_d" "$il_icon" --out "$il_set/icon_${il_s}x${il_s}@2x.png" >/dev/null 2>&1
      done
      iconutil -c icns "$il_set" -o "$il_app/Contents/Resources/jawbs.icns" >/dev/null 2>&1 || true
    fi
    # A Finder alias shows the app's icon; a symlink is the fallback.
    rm -rf "$il_desk/Jawbs.app"
    if ! osascript -e "tell application \"Finder\" to make alias file to POSIX file \"$il_app\" at POSIX file \"$il_desk\"" \
        -e "tell application \"Finder\" to set name of result to \"Jawbs.app\"" >/dev/null 2>&1; then
      ln -s "$il_app" "$il_desk/Jawbs.app"
    fi
    echo "Jawbs is in your Applications folder and on your Desktop."
  else
    il_apps="$HOME/.local/share/applications"
    mkdir -p "$il_apps"
    il_entry="$il_apps/jawbs.desktop"
    {
      echo "[Desktop Entry]"
      echo "Type=Application"
      echo "Name=Jawbs"
      echo "Comment=Your job search, in the browser"
      printf 'Exec="%s"\n' "$il_bin"
      printf 'Icon=%s\n' "$il_icon"
      echo "Terminal=false"
      echo "Categories=Office;"
    } > "$il_entry"
    chmod +x "$il_entry"
    cp "$il_entry" "$il_desk/jawbs.desktop"
    chmod +x "$il_desk/jawbs.desktop"
    if command -v gio >/dev/null 2>&1; then
      gio set "$il_desk/jawbs.desktop" metadata::trusted true >/dev/null 2>&1 || true
    fi
    echo "Jawbs is in your applications menu and on your Desktop."
  fi
}
```

Notes for the implementer:
- In the minimal-PATH test the fake node is started with `nohup` from the baked `PATH`, which includes the host PATH at test time; `env -i` proves the launcher does not rely on the caller's PATH. `up` fails (nothing listens on 59717), so after `WAIT=1` the launcher calls `complain` (suppressed by `JAWBS_NO_DIALOG`) and exits 1; the test only asserts node was started. `curl` must be on `/usr/bin` (it is on macOS and on standard Linux).
- Test mode `JAWBS_OS=Darwin` on Linux: `osascript` is absent, so the Desktop shortcut falls back to the symlink, which the test accepts (`test -e`).
- Add `bin/jawbs-open` to the repo `.gitignore`: it holds machine-specific paths.

- [ ] **Step 5: Run tests**

Run: `bash setup/test/run-tests.sh`
Expected: `Failed: 0`. Read `install_launcher` for bash 3.2 compatibility by eye (heredocs, `printf`, `$(( ))` are fine).

- [ ] **Step 6: Commit**

```bash
git add setup/lib.sh setup/assets/jawbs.png setup/test/run-tests.sh .gitignore
git commit -m "Jawbs launcher and icons for macOS and Linux"
```

---

### Task 12: Docs

**Files:**
- Modify: `docs/portal.md`, `docs/first-session.md`, `portal/.env.example`, `CLAUDE.md`, `README.md` (only if it describes getting started; check first)

- [ ] **Step 1: `portal/.env.example`**: the `EXPOSURE` comment gains a third value:

```
# Is the portal reachable from the public internet? private | public | local
# "local" is Jawbs on your own computer: no sign-in, one person, loopback only
# (BIND_HOST=127.0.0.1, BASE_URL=http://localhost:<PORT>). The setup wizard's
# option 1 writes this for you; see docs/portal.md "Using Jawbs on your own computer".
```

- [ ] **Step 2: `docs/portal.md`**: add a section after "Requirements" titled "Using Jawbs on your own computer" covering: choosing option 1 in the wizard; what setup does (the six steps from the spec's Part 2, in plain words); opening Jawbs from the icon, and Quit Jawbs; where the log is (`portal/data/jawbs.log`); re-running `setup/jawbs-local.sh <project>` after installing something missing; the Getting started conversation and attaching a CV; one person per copy of the kit; and this security paragraph verbatim:

> There is no sign-in. Anyone or anything that can act as your user account on this computer can use Jawbs, including other programs you run. Jawbs listens only on this computer (127.0.0.1) and refuses requests addressed to any other host name, which stops websites you visit from reaching it through your browser. Do not change `BIND_HOST` or put a proxy in front of a local Jawbs: publish it with `docs/portal-remote-access.md` instead, which switches to emailed sign-in links.

Also add `local` to the `EXPOSURE` bullet in "Setup walkthrough".

- [ ] **Step 3: `docs/first-session.md`**: under "How to start", add first: "**If you chose Jawbs in your browser**, setup opens it for you. Next time, double-click Jawbs on your Desktop or in Applications. It opens on a conversation called Getting started, which works through the same steps as below; attach your CV with the Attach a file button when Jawbs asks for it." Keep the terminal instructions as the second route. In the "What the session covers" list, item 6 becomes: "**Test render.** The kit includes a CV design, so the assistant renders a test CV from your master CV for you to look at. In a terminal session you can also choose a different design from Typst Universe."

- [ ] **Step 4: `CLAUDE.md`**: add two Key decisions bullets (no em or en dashes):

```
- **Jawbs on your own computer has no sign-in.** `EXPOSURE=local` serves the one registered user without a cookie (`requireAuth` in `auth.js`), binds loopback only, and preflight refuses to start with any other bind, more than one user, or a non-localhost `BASE_URL` (owner decision, 2026-09-28, chosen over a launcher-minted login link). `localHostGuard` in `portal/src/local.js` is load-bearing, not hardening: with no sign-in, a Host check on every route (static files included) plus an Origin check on writes is the only thing stopping DNS rebinding from letting any website drive the agent. The wizard's option 1 runs `setup/jawbs-local.sh`, which writes `portal/.env`, registers the user and installs `bin/jawbs-open` (generated, gitignored, with node and PATH baked in because GUI launches do not get the login shell's PATH) plus icons. One local person per kit checkout. Spec: `docs/superpowers/specs/2026-09-28-jawbs-local-mode-design.md`.
- **Intake can run in the portal.** A session with `kind = 'setup'` ("Getting started") works through the project's `SETUP.md` with `setupPrompt` in `agent.js`; setup is pending exactly while `SETUP.md` exists, so the portal stores no progress. While pending, the landing page is that conversation and the new application box is hidden. Uploads (`POST /api/sessions/:id/upload`, setup sessions only, 15 MB, document types) land in `core/source/`. The kit now ships a default CV and letter template (derived from vantage-cv, MIT) so session C renders without a template choice; choosing a Typst Universe design stays a terminal task.
```

Also update the Layout section's `setup/` bullet to mention `jawbs-local.sh`, and the portal bullet to say it can also run locally per person.

- [ ] **Step 5: Dash check**

Run: `grep -nP '[\x{2013}\x{2014}]' docs/portal.md docs/first-session.md CLAUDE.md portal/.env.example | head`
Expected: no new lines from this task (pre-existing ones, if any, are out of scope).

- [ ] **Step 6: Commit**

```bash
git add docs/portal.md docs/first-session.md portal/.env.example CLAUDE.md
git commit -m "docs: Jawbs on your own computer, and intake in the portal"
```

---

### Task 13: End-to-end check and macOS checklist

**Files:**
- Create: `docs/superpowers/plans/2026-09-28-jawbs-local-mode-mac-checklist.md`

- [ ] **Step 1: Full test runs**

Run: `cd portal && npm test` then `bash setup/test/run-tests.sh`
Expected: all pass; record the counts.

- [ ] **Step 2: Scratch end-to-end on Linux** (a throwaway clone, never `~/j4`, never port 8710)

```bash
E=$(mktemp -d) && git clone -q ~/j4dev "$E/kit" && cd "$E/kit"
cp -R ~/j4dev/portal/node_modules portal/   # saves the npm install
```

Edit nothing in the clone except: run the wizard with an answers file that sets `JAWBS_MODE=local`, `HOME="$E/home"`, `JAWBS_SKIP_LAUNCH=yes`, `JAWBS_SKIP_NPM=yes`, and `PORTAL_REGISTRY` left at its default (the clone's own `portal/data/users.json`). Then change `PORT`/`BASE_URL` in the clone's `portal/.env` to 59717 and run `JAWBS_PORT=59717 JAWBS_NO_BROWSER=yes bin/jawbs-open`. Check with Playwright's cached Chromium (see Task 6 Step 8) that `http://localhost:59717/` shows the Getting started conversation and that Claude's first turn arrives (this runs a real Claude turn; it needs the host's Claude login and costs one turn). Attach a small PDF, confirm it lands in `<project>/core/source/`. Press Quit Jawbs and confirm the port closes. Remove `$E`.

- [ ] **Step 3: Write the macOS checklist** for the owner, covering: fresh clone; `./setup/setup.sh`, option 1; Node or Claude Code missing paths (message, then `setup/jawbs-local.sh` re-run); Typst install offer; Jawbs.app in `~/Applications` with icon and the Desktop alias; double-click opens the browser with no Terminal window; second double-click just reopens the page; Safari, Chrome and Firefox each load the page (no sign-in involved, so the Secure-cookie concern does not arise); Getting started first turn; attach CV; Quit Jawbs; double-click restarts it; `portal/data/jawbs.log` exists; the test CV render in session C produces a PDF download.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-09-28-jawbs-local-mode-mac-checklist.md
git commit -m "docs: macOS checklist for Jawbs local mode"
```
