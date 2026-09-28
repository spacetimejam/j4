import test from 'node:test';
import assert from 'node:assert/strict';
const {
  DRAFT_MODEL, DRAFT_EFFORT, DRAFT_TIMEOUT_MS, EXIT, DRAFT_SCHEMA,
  buildDraftArgs, buildDraftPrompt, classifyFailure, parseDraft,
} = await import('../src/drafting.js');

const GOOD = {
  cv: {
    position: 'Strategy, made measurable',
    tagline: 'A strategist of fourteen years.',
    jobs: [{ company: 'Purpose', position: 'Associate Director', bullets: ['Led the programme.'] }],
    capabilities: [{ name: 'Strategy', note: 'Setting strategy.' }],
  },
  cover_letter: { paragraphs: ['First.', 'Second.'] },
  gaps: [],
};

test('defaults are GPT-6 Astra at low effort with a timeout under the Bash tool ceiling', () => {
  assert.equal(DRAFT_MODEL, 'gpt-6-astra');
  assert.equal(DRAFT_EFFORT, 'low');
  assert.ok(DRAFT_TIMEOUT_MS < 600000);
  assert.deepEqual(EXIT, { ok: 0, usage: 2, usage_limit: 3, auth: 4, error: 5 });
});

test('args pin model, effort, read-only sandbox and keep the user config out', () => {
  const args = buildDraftArgs({ schemaPath: '/tmp/s.json', prompt: 'P' });
  assert.deepEqual(args, [
    'exec', '--json', '--ephemeral', '--ignore-user-config', '--sandbox', 'read-only',
    '--skip-git-repo-check', '-m', 'gpt-6-astra', '-c', 'model_reasoning_effort="low"',
    '--output-schema', '/tmp/s.json', 'P',
  ]);
});

test('prompt names the files to read and the redraft input only on a redraft', () => {
  const first = buildDraftPrompt({ slug: 'acme-designer', redraft: false });
  for (const f of ['applications/acme-designer/brief.md', 'core/voice.md', 'core/profile.md',
    'applications/acme-designer/spec.md', 'applications/acme-designer/fit.md',
    'templates/cover-letters/README.md']) assert.ok(first.includes(f), f);
  assert.ok(!first.includes('draft.json'));
  assert.match(first, /no fabrication/i);
  assert.ok(buildDraftPrompt({ slug: 'acme-designer', redraft: true }).includes('applications/acme-designer/draft.json'));
});

test('schema is strict: every object closed and every property required', () => {
  const walk = node => {
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
      Object.values(node.properties).forEach(walk);
    }
    if (node.type === 'array') walk(node.items);
  };
  walk(DRAFT_SCHEMA);
});

test('parseDraft accepts the schema shape and rejects anything else', () => {
  assert.deepEqual(parseDraft(JSON.stringify(GOOD)), GOOD);
  assert.equal(parseDraft('not json'), null);
  assert.equal(parseDraft(JSON.stringify({ ...GOOD, gaps: 'none' })), null);
  assert.equal(parseDraft(JSON.stringify({ ...GOOD, cover_letter: { paragraphs: [] } })), null);
  assert.equal(parseDraft(JSON.stringify({ ...GOOD, cv: { ...GOOD.cv, jobs: [{ company: 'X' }] } })), null);
});

test('a 401 is auth', () => {
  const f = classifyFailure('unexpected status 401 Unauthorized: Missing bearer or basic authentication in header');
  assert.equal(f.kind, 'auth');
  assert.equal(f.resets_at, null);
});

test('a usage limit is usage_limit, with a reset when codex gives a relative one', () => {
  const now = new Date('2026-09-28T10:00:00Z');
  const f = classifyFailure("You've hit your usage limit. Try again in 45 minutes.", now);
  assert.equal(f.kind, 'usage_limit');
  assert.equal(f.resets_at, '2026-09-28T10:45:00.000Z');
  assert.equal(classifyFailure('usage_limit_reached', now).resets_at, null);
});

test('status digits inside a request id do not decide the kind', () => {
  assert.equal(classifyFailure('stream disconnected, request id: req_7ed401c82d7429a').kind, 'error');
  assert.equal(classifyFailure("You've hit your usage limit (request id: req_a401b)").kind, 'usage_limit');
});

test('anything unrecognised is error, and an empty reason still says something', () => {
  assert.equal(classifyFailure('model overloaded').kind, 'error');
  assert.ok(classifyFailure('').detail.length > 0);
  assert.ok(classifyFailure('x'.repeat(2000)).detail.length <= 500);
});

import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { runDraft, main } = await import('../src/drafting.js');

// Same shape as the fake in codex.test.js, plus a kill() that closes the child.
function fakeSpawn({ lines = [], exitCode = 0, stderr = '', spawnError = null, hang = false } = {}) {
  const calls = [];
  const impl = (bin, args, opts) => {
    calls.push({ bin, args, opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    let decoder = null;
    child.stdout.setEncoding = enc => { decoder = new StringDecoder(enc); };
    child.stderr = new EventEmitter();
    child.kill = () => setImmediate(() => child.emit('close', null));
    setImmediate(() => {
      if (spawnError) { child.emit('error', spawnError); return; }
      const buf = Buffer.from(lines.map(l => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
      child.stdout.emit('data', decoder ? decoder.write(buf) : buf);
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      if (!hang) child.emit('close', exitCode);
    });
    return child;
  };
  impl.calls = calls;
  return impl;
}

const okLines = draft => [
  { type: 'thread.started', thread_id: 'thread-1' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: JSON.stringify(draft) } },
  { type: 'turn.completed', usage: {} },
];

function mkApp({ brief = true, draft = false } = {}) {
  const project = mkdtempSync(join(tmpdir(), 'draft-proj-'));
  const appDir = join(project, 'applications', 'acme-designer');
  mkdirSync(appDir, { recursive: true });
  if (brief) writeFileSync(join(appDir, 'brief.md'), 'Lead with measurement.');
  if (draft) writeFileSync(join(appDir, 'draft.json'), JSON.stringify(GOOD));
  return { project, appDir };
}

const deps = extra => ({
  now: () => new Date('2026-09-28T10:00:00Z'),
  codexBin: '/fake/codex',
  codexVersion: async () => 'codex-cli 0.158.0',
  ...extra,
});

const authLines = () => readFileSync(new URL('./fixtures/codex-draft-auth.jsonl', import.meta.url), 'utf8').trim().split('\n');

test('a successful draft writes draft.json and provenance, run read-only in the project', async () => {
  const { project, appDir } = mkApp();
  const spawnImpl = fakeSpawn({ lines: okLines(GOOD) });
  const r = await runDraft({ appDir }, deps({ spawnImpl }));
  assert.deepEqual(r.draft, GOOD);
  assert.deepEqual(JSON.parse(readFileSync(join(appDir, 'draft.json'), 'utf8')), GOOD);
  const prov = JSON.parse(readFileSync(join(appDir, 'draft-provenance.json'), 'utf8'));
  assert.equal(prov.model, 'gpt-6-astra');
  assert.equal(prov.effort, 'low');
  assert.equal(prov.codex_version, 'codex-cli 0.158.0');
  assert.equal(prov.drafted_at, '2026-09-28T10:00:00.000Z');
  assert.equal(prov.thread_id, 'thread-1');
  assert.match(prov.brief_sha256, /^[0-9a-f]{64}$/);
  const [call] = spawnImpl.calls;
  assert.equal(call.bin, '/fake/codex');
  assert.equal(call.opts.cwd, project);
  assert.equal(call.opts.stdio[0], 'ignore');
  assert.ok(!call.args.at(-1).includes('draft.json'), 'first draft is not a redraft');
});

test('an existing draft.json makes it a redraft', async () => {
  const { appDir } = mkApp({ draft: true });
  const spawnImpl = fakeSpawn({ lines: okLines(GOOD) });
  await runDraft({ appDir }, deps({ spawnImpl }));
  assert.ok(spawnImpl.calls[0].args.at(-1).includes('applications/acme-designer/draft.json'));
});

test('reconnect errors before a good final message do not fail the draft', async () => {
  const { appDir } = mkApp();
  const lines = [{ type: 'error', message: 'Reconnecting... 1/5 (stream disconnected)' }, ...okLines(GOOD)];
  const r = await runDraft({ appDir }, deps({ spawnImpl: fakeSpawn({ lines }) }));
  assert.deepEqual(r.draft, GOOD);
});

test('the captured auth failure is auth and writes no draft', async () => {
  const { appDir } = mkApp();
  const r = await runDraft({ appDir }, deps({ spawnImpl: fakeSpawn({ lines: authLines(), exitCode: 1 }) }));
  assert.equal(r.failure.kind, 'auth');
  assert.ok(!existsSync(join(appDir, 'draft.json')));
});

test('copy that does not fit the schema is an error, not a draft', async () => {
  const { appDir } = mkApp();
  const r = await runDraft({ appDir }, deps({ spawnImpl: fakeSpawn({ lines: okLines({ nope: true }) }) }));
  assert.equal(r.failure.kind, 'error');
  assert.ok(!existsSync(join(appDir, 'draft.json')));
});

test('a missing codex binary is an error naming CODEX_BIN', async () => {
  const { appDir } = mkApp();
  const spawnError = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
  const r = await runDraft({ appDir }, deps({ spawnImpl: fakeSpawn({ spawnError }) }));
  assert.equal(r.failure.kind, 'error');
  assert.match(r.failure.detail, /CODEX_BIN/);
});

test('a draft that runs past the timeout is stopped and reported', async () => {
  const { appDir } = mkApp();
  const r = await runDraft({ appDir }, deps({ spawnImpl: fakeSpawn({ hang: true }), timeoutMs: 20 }));
  assert.equal(r.failure.kind, 'error');
  assert.match(r.failure.detail, /longer than/);
});

test('a folder outside applications/ or without brief.md is a usage error', async () => {
  const { project, appDir } = mkApp({ brief: false });
  assert.match((await runDraft({ appDir }, deps({ spawnImpl: fakeSpawn() }))).usage, /brief\.md/);
  assert.match((await runDraft({ appDir: project }, deps({ spawnImpl: fakeSpawn() }))).usage, /application folder/);
});

test('main maps outcomes to exit codes and prints one JSON document', async () => {
  const out = [];
  const stdout = s => out.push(s);
  assert.equal(await main([], deps({ stdout })), 2);
  const { appDir } = mkApp();
  assert.equal(await main([appDir], deps({ stdout, spawnImpl: fakeSpawn({ lines: okLines(GOOD) }) })), 0);
  assert.deepEqual(JSON.parse(out.at(-1)), GOOD);
  assert.equal(await main([appDir], deps({ stdout, spawnImpl: fakeSpawn({ lines: authLines(), exitCode: 1 }) })), 4);
  assert.equal(JSON.parse(out.at(-1)).kind, 'auth');
});
