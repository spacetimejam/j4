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
