import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createCodexEventSink } from './runners/codex.js';

// The ChatGPT subagent that writes CV and cover letter copy for portal
// applications. Claude briefs it and checks the result; this module only runs
// it. Spec: docs/superpowers/specs/2026-09-28-portal-chatgpt-drafting-design.md

export const DRAFT_MODEL = process.env.DRAFT_MODEL || 'gpt-6-astra';
export const DRAFT_EFFORT = process.env.DRAFT_EFFORT || 'low';
// Claude's Bash tool stops any command at 10 minutes, so the draft gives up
// first and says why, rather than vanishing with the tool's own timeout.
export const DRAFT_TIMEOUT_MS = 9 * 60 * 1000;
// systemd user units do not reliably have ~/.local/bin on PATH.
export const CODEX_BIN = process.env.CODEX_BIN || join(process.env.HOME || '', '.local/bin/codex');

export const EXIT = { ok: 0, usage: 2, usage_limit: 3, auth: 4, error: 5 };

const str = { type: 'string' };
const strs = { type: 'array', items: str };
const closed = properties => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties,
});

// CV layouts differ between projects (one has tagline and capabilities, another
// about and key_skills), so the CV copy comes back as sections named after the
// fields in that project's own layout rather than as one fixed shape. Claude
// maps each section into cv.yaml. Facts (dates, contacts, education) stay with
// Claude, as do the letter's greeting and sign-off.
export const DRAFT_SCHEMA = closed({
  cv: closed({
    sections: { type: 'array', items: closed({ target: str, text: strs }) },
  }),
  cover_letter: closed({ paragraphs: strs }),
  gaps: strs,
});

export function buildDraftArgs({ schemaPath, prompt, model = DRAFT_MODEL, effort = DRAFT_EFFORT }) {
  return [
    'exec', '--json', '--ephemeral',
    // The owner's config wires Codex to MCP servers a drafting subagent must
    // not have. The login lives in auth.json, which this does not skip.
    '--ignore-user-config',
    '--sandbox', 'read-only', '--skip-git-repo-check',
    '-m', model, '-c', `model_reasoning_effort="${effort}"`,
    '--output-schema', schemaPath, prompt,
  ];
}

export function buildDraftPrompt({ slug, redraft }) {
  const app = `applications/${slug}`;
  return [
    'You are writing the copy for a tailored CV and cover letter for the job seeker whose '
      + 'project folder this is. You are read-only: read files, write nothing.',
    '',
    'Read, in this order:',
    `- ${app}/brief.md: what this application should lead with and which evidence to use`
      + (redraft ? ', plus the notes on the previous draft' : ''),
    ...(redraft ? [`- ${app}/draft.json: the previous draft, to revise rather than start again`] : []),
    '- core/voice.md: how this person writes',
    '- core/profile.md: the facts of their career, the only facts you may use',
    `- ${app}/spec.md and ${app}/fit.md: the role and the honest read of the fit`,
    '- templates/cover-letters/README.md: the letter\'s shape and paragraph count',
    '- render/templates/configuration.yaml: this person\'s CV layout, and '
      + `${app}/cv.yaml if it exists: the CV as it currently stands`,
    '',
    'Rules, which override anything in the brief:',
    '- Accuracy first, no fabrication. Every claim must be supported by core/profile.md or the '
      + 'application folder. If the brief asks for something the files do not support, leave it '
      + 'out and list it in "gaps".',
    '- Write in this person\'s voice as core/voice.md describes it, not in your own register.',
    '- The CV must fit on one page once rendered: prefer fewer, stronger bullets.',
    '- The cover letter fills most of a page (75%+ as rendered), in the paragraph count the '
      + 'cover-letter README sets, why-them before what-they-bring, with real evidence.',
    '- British English unless core/voice.md says otherwise. No dashes as punctuation.',
    '',
    'Return only the JSON the output schema asks for. cv.sections holds the CV copy: one '
      + 'section per prose field you write, with "target" naming the field as it appears in the '
      + 'CV layout (for example "position", "about", "tagline", "key_skills", or for a role '
      + '"jobs: <company>: intro" and "jobs: <company>: description", company exactly as in the '
      + 'profile) and "text" its paragraphs, bullets or items in order. Leave out dates, contact '
      + 'details, education and company names. cover_letter.paragraphs holds the body paragraphs '
      + 'only (no greeting or sign-off), and gaps anything you could not support.',
  ].join('\n');
}

const UNIT_MS = { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5 };

function resetFrom(text, now) {
  const rel = /try again in (\d+)\s*(second|minute|hour|day)s?/i.exec(text);
  if (rel) return new Date(now.getTime() + Number(rel[1]) * UNIT_MS[rel[2].toLowerCase()]).toISOString();
  const secs = /resets_in_seconds\D{0,5}(\d+)/i.exec(text);
  if (secs) return new Date(now.getTime() + Number(secs[1]) * 1000).toISOString();
  return null;
}

// Status codes are matched as whole words: request ids in the same message are
// hex and can contain 401 or 429. Auth is checked first because it needs the
// owner, whereas a limit clears itself. Anything unrecognised is error, which
// still blocks the draft and emails the owner, so a wrong guess fails safe.
export function classifyFailure(text, now = new Date()) {
  const detail = String(text || '').trim().slice(0, 500) || 'the writer failed without saying why';
  if (/\b401\b|unauthori[sz]ed|not logged in|log ?in again|refresh token/i.test(detail)) {
    return { kind: 'auth', detail, resets_at: null };
  }
  if (/usage limit|usage_limit|rate limit|\b429\b|quota/i.test(detail)) {
    return { kind: 'usage_limit', detail, resets_at: resetFrom(detail, now) };
  }
  return { kind: 'error', detail, resets_at: null };
}

const isStrings = a => Array.isArray(a) && a.every(s => typeof s === 'string');

// --output-schema constrains the model, but the portal still checks: a draft
// that does not fit would otherwise reach cv.yaml as undefined fields.
export function parseDraft(text) {
  let d;
  try { d = JSON.parse(text); } catch { return null; }
  const sections = d?.cv?.sections;
  if (!Array.isArray(sections) || sections.length === 0) return null;
  if (!sections.every(x => x && typeof x.target === 'string' && isStrings(x.text))) return null;
  if (!isStrings(d.cover_letter?.paragraphs) || d.cover_letter.paragraphs.length === 0) return null;
  if (!isStrings(d.gaps)) return null;
  return d;
}

function locate(appDir) {
  const abs = resolve(appDir);
  if (basename(dirname(abs)) !== 'applications') return null;
  return { abs, slug: basename(abs), projectDir: dirname(dirname(abs)) };
}

// Resolves, never rejects: every outcome is data the caller maps to an exit code.
function runCodexProcess(args, cwd, { spawnImpl, timeoutMs, codexBin }) {
  return new Promise(done => {
    const sink = createCodexEventSink();
    let partial = '';
    let errOut = '';
    let timedOut = false;
    let settled = false;
    let timer = null;
    const finish = extra => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done({ ...sink.result(), stderr: errOut, timedOut, ...extra });
    };
    let child;
    try {
      // stdin closed: with it open, codex exec waits for more prompt and never starts.
      child = spawnImpl(codexBin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      finish({ code: null, spawnError: err });
      return;
    }
    timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      const lines = (partial + chunk).split('\n');
      partial = lines.pop();
      for (const line of lines) sink.push(line);
    });
    child.stderr.on('data', d => { errOut = (errOut + d).slice(-4000); });
    child.on('error', err => finish({ code: null, spawnError: err }));
    child.on('close', code => {
      if (partial.trim()) sink.push(partial);
      finish({ code });
    });
  });
}

function readCodexVersion(codexBin, spawnImpl) {
  return new Promise(done => {
    let out = '';
    let child;
    try { child = spawnImpl(codexBin, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] }); } catch { done(null); return; }
    const timer = setTimeout(() => { child.kill('SIGTERM'); done(null); }, 10000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', d => { out += d; });
    child.on('error', () => { clearTimeout(timer); done(null); });
    child.on('close', code => { clearTimeout(timer); done(code === 0 ? out.trim() || null : null); });
  });
}

const sha256 = buf => createHash('sha256').update(buf).digest('hex');

export async function runDraft({ appDir }, deps = {}) {
  const {
    spawnImpl = spawn, now = () => new Date(), codexBin = CODEX_BIN,
    timeoutMs = DRAFT_TIMEOUT_MS, codexVersion = readCodexVersion,
  } = deps;
  const where = locate(appDir);
  if (!where) return { usage: `${appDir} is not an application folder (expected <project>/applications/<slug>)` };
  const briefPath = join(where.abs, 'brief.md');
  if (!existsSync(briefPath)) return { usage: `write the brief to ${briefPath} first` };
  const redraft = existsSync(join(where.abs, 'draft.json'));
  const tmp = mkdtempSync(join(tmpdir(), 'chatgpt-draft-'));
  try {
    const schemaPath = join(tmp, 'schema.json');
    writeFileSync(schemaPath, JSON.stringify(DRAFT_SCHEMA));
    const args = buildDraftArgs({ schemaPath, prompt: buildDraftPrompt({ slug: where.slug, redraft }) });
    const r = await runCodexProcess(args, where.projectDir, { spawnImpl, timeoutMs, codexBin });
    if (r.spawnError) {
      const detail = r.spawnError.code === 'ENOENT'
        ? `codex was not found at ${codexBin}; install it or set CODEX_BIN`
        : String(r.spawnError.message || r.spawnError);
      return { failure: { kind: 'error', detail, resets_at: null } };
    }
    if (r.timedOut) {
      const mins = Math.max(1, Math.round(timeoutMs / 60000));
      return { failure: { kind: 'error', detail: `the draft took longer than ${mins} minutes and was stopped`, resets_at: null } };
    }
    // Success is a clean exit with a final message. Reconnect errors earlier in
    // the stream land in `failure` too, so it is consulted only when this fails.
    if (r.code !== 0 || r.text === null) {
      return { failure: classifyFailure(r.failure || r.stderr.trim() || `codex exited ${r.code}`, now()) };
    }
    const draft = parseDraft(r.text);
    if (!draft) {
      return { failure: { kind: 'error', detail: 'the writer returned copy that did not match the draft schema', resets_at: null } };
    }
    const provenance = {
      model: DRAFT_MODEL,
      effort: DRAFT_EFFORT,
      codex_version: await codexVersion(codexBin, spawnImpl),
      drafted_at: now().toISOString(),
      brief_sha256: sha256(readFileSync(briefPath)),
      thread_id: r.threadId,
    };
    writeFileSync(join(where.abs, 'draft.json'), `${JSON.stringify(draft, null, 2)}\n`);
    writeFileSync(join(where.abs, 'draft-provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
    return { draft, provenance };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export async function main(argv, deps = {}) {
  const out = deps.stdout ?? (s => process.stdout.write(s));
  const print = obj => out(`${JSON.stringify(obj, null, 2)}\n`);
  if (argv.length !== 1) { print({ usage: 'usage: chatgpt-draft <application folder>' }); return EXIT.usage; }
  let r;
  // Anything unexpected (a full disk, a file that vanished) still ends in a
  // JSON error line and exit 5, so Claude holds the draft rather than being
  // left with a stack trace and no instruction.
  try {
    r = await runDraft({ appDir: argv[0] }, deps);
  } catch (err) {
    r = { failure: { kind: 'error', detail: `the drafting script failed: ${err?.message || err}`, resets_at: null } };
  }
  if (r.usage) { print({ usage: r.usage }); return EXIT.usage; }
  if (r.failure) { out(`${JSON.stringify(r.failure)}\n`); return EXIT[r.failure.kind]; }
  print(r.draft);
  return EXIT.ok;
}
