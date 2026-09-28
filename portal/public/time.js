/* Timestamps are stored as UTC, from SQLite's datetime('now'), and displayed
   as London wall-clock time. The zone is pinned to Europe/London rather than
   the viewer's own, so the portal reads the same whether the person is at home
   or abroad, and BST/GMT is handled by the zone data rather than a fixed
   offset. Storage stays UTC: it sorts correctly and never repeats an hour.

   One consequence worth knowing: on the night the clocks go back, the repeated
   hour renders twice, since the output carries no BST/GMT marker. */
const FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23', // h12 would render midnight as 24:xx in some ICU builds
});

export function formatLondon(stored) {
  if (!stored) return '';
  // "YYYY-MM-DD HH:MM:SS" carries no zone marker, and Date parses that shape as
  // LOCAL time, so the trailing Z is what makes this correct rather than a
  // no-op that happens to look right on a UTC host.
  const date = new Date(`${String(stored).replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return String(stored);
  const part = {};
  for (const { type, value } of FMT.formatToParts(date)) part[type] = value;
  return `${part.year}-${part.month}-${part.day} ${part.hour}:${part.minute}:${part.second}`;
}

/* The usage-limit notice gives the reset as a phrase that follows "at about",
   for example "01:10 BST tomorrow (Monday)". Unlike formatLondon it names the
   zone, taken from the zone data, because a person reading "01:10" on the night
   the clocks change cannot otherwise tell which 01:10 is meant. */
const RESET_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  weekday: 'long', day: 'numeric', month: 'long',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  timeZoneName: 'short',
});
const LONDON_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
});

function parseStoredUtc(stored) {
  if (!stored) return null;
  const date = new Date(`${String(stored).replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

// The London calendar day after `key` (YYYY-MM-DD), by calendar arithmetic
// rather than adding 24 hours, which is wrong on the days the clocks change.
function nextDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function formatResetLondon(stored, { exact = false, limitType = 'unknown' } = {}, now = new Date()) {
  const date = parseStoredUtc(stored);
  if (!date) return '';
  const part = {};
  for (const { type, value } of RESET_FMT.formatToParts(date)) part[type] = value;
  const time = `${part.hour}:${part.minute} ${part.timeZoneName}`;
  // A weekly limit read from the error text has an hour but no day.
  if (!exact && limitType === 'weekly') return `${time} on a day within the next week`;
  const day = LONDON_DAY.format(date);
  const today = LONDON_DAY.format(now);
  if (day === today) return `${time} today`;
  if (day === nextDayKey(today)) return `${time} tomorrow (${part.weekday})`;
  return `${time} on ${part.weekday} ${part.day} ${part.month}`;
}

export function resetHasPassed(stored, now = new Date()) {
  const date = parseStoredUtc(stored);
  return Boolean(date) && date <= now;
}
