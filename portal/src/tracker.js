import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* A minimal RFC 4180 reader. The tracker's Notes column is long prose full of
   commas and quoted passages, so splitting on commas would mangle most rows,
   and a dependency for one file read is not warranted. */
export function parseCsv(text) {
  const s = String(text ?? '').replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c !== '"') { field += c; continue; }
      if (s[i + 1] === '"') { field += '"'; i++; continue; }
      quoted = false;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  if (!header) return [];
  const keys = header.map(h => h.trim());
  return rows
    .filter(r => r.some(v => v.trim() !== ''))
    .map(r => Object.fromEntries(keys.map((k, n) => [k, (r[n] ?? '').trim()])));
}

/* Legacy values are kept in the map so an existing tracker reads correctly
   without being rewritten, and so a hand-typed row still lands somewhere
   sensible. Anything unrecognised deliberately yields no pill: a wrong stage
   is worse than none. */
const STAGES = {
  sourced: 'researching', researching: 'researching',
  drafting: 'applying', applied: 'applying', applying: 'applying',
  interviewing: 'interviewing', offer: 'interviewing',
  hired: 'hired',
  rejected: 'turned_down', withdrawn: 'turned_down', 'turned down': 'turned_down',
};

export function readTracker(projectDir) {
  if (!projectDir) return [];
  try {
    return parseCsv(readFileSync(join(projectDir, 'tracker', 'applications.csv'), 'utf8'));
  } catch {
    return []; // a missing or unreadable tracker simply means no pills
  }
}

/* Sessions are titled "<Role> at <Org>" by the agent's session-title directive.
   Split on the last " at ", since a role can contain the word. Org matches when
   either value is a prefix of the other, which is what lets a session titled
   "... at M+C Saatchi" find the tracker's "M+C Saatchi UK". */
export function stageFor(title, rows) {
  const t = String(title ?? '');
  const at = t.lastIndexOf(' at ');
  if (at < 0) return null;
  const role = t.slice(0, at).trim().toLowerCase();
  const org = t.slice(at + 4).trim().toLowerCase();
  if (!role || !org) return null;
  let match = null;
  for (const r of rows) {
    if ((r.Role || '').trim().toLowerCase() !== role) continue;
    const o = (r.Org || '').trim().toLowerCase();
    if (!o) continue;
    if (o === org) { match = r; break; }
    if (!match && (o.startsWith(org) || org.startsWith(o))) match = r;
  }
  if (!match) return null;
  return STAGES[(match.Status || '').trim().toLowerCase()] || null;
}
