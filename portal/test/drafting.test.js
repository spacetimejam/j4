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
