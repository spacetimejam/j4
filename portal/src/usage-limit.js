/* A turn that fails because the Claude subscription's usage limit is reached
   is expected, not a fault: the user should be told and offered a retry, and
   no admin needs an email. This module lives on its own so that queue.js and
   the runner can both import it without importing each other, the same reason
   reply-schema.js exists. */

export class UsageLimitError extends Error {
  constructor(message, { resetsAt = null, exact = false, limitType = 'unknown' } = {}) {
    super(message);
    this.name = 'UsageLimitError';
    this.resetsAt = resetsAt;
    this.exact = exact;
    this.limitType = limitType;
  }
}

// "You've hit your session limit · resets 12:10am (UTC)", as the SDK words it.
// The kind is matched separately from the time so that a message whose time
// cannot be read is still recognised as a usage limit.
const KIND = /hit your (session|weekly) limit/i;
const RESET = /resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)/i;

function zoneOffsetMs(date, zone) {
  const part = {};
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  for (const { type, value } of fmt.formatToParts(date)) part[type] = value;
  const asUtc = Date.UTC(+part.year, +part.month - 1, +part.day, +part.hour, +part.minute, +part.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// The UTC instant at which the wall clock in `zone` reads the given time. The
// second pass corrects the guess when it lands on the other side of a clock
// change from the answer.
function wallClockToUtc(year, monthIndex, day, hour, minute, zone) {
  const guess = Date.UTC(year, monthIndex, day, hour, minute);
  let t = guess - zoneOffsetMs(new Date(guess), zone);
  t = guess - zoneOffsetMs(new Date(t), zone);
  return new Date(t);
}

// A session limit lasts five hours, so a stated time more than that far ahead
// must be the one that has only just passed (the text was read at or after the
// reset). Anything else takes the next occurrence after now.
const SESSION_WINDOW_MS = 5 * 3600 * 1000;

function nextOccurrence(hour, minute, zone, now, limitType) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
  } catch {
    return null; // an unknown zone name
  }
  const part = {};
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  for (const { type, value } of fmt.formatToParts(now)) part[type] = value;
  const earliest = limitType === 'session' ? now.getTime() - SESSION_WINDOW_MS : now.getTime();
  for (const offset of [-1, 0, 1]) {
    const candidate = wallClockToUtc(+part.year, +part.month - 1, +part.day + offset, hour, minute, zone);
    if (candidate.getTime() > earliest) return candidate;
  }
  return null;
}

export function parseUsageLimitText(text, now = new Date()) {
  const kind = KIND.exec(String(text || ''));
  if (!kind) return null;
  const limitType = kind[1].toLowerCase();
  const reset = RESET.exec(text);
  if (!reset) return { limitType, resetsAt: null };
  let hour = Number(reset[1]) % 12;
  if (reset[3].toLowerCase() === 'pm') hour += 12;
  const minute = reset[2] ? Number(reset[2]) : 0;
  return { limitType, resetsAt: nextOccurrence(hour, minute, reset[4].trim(), now, limitType) };
}

function limitTypeFromEvent(rateLimitType) {
  if (rateLimitType === 'five_hour') return 'session';
  if (String(rateLimitType || '').startsWith('seven_day')) return 'weekly';
  return null;
}

// The SDK types resetsAt only as a number. It has been Unix seconds, but a
// millisecond value would otherwise land thousands of years out.
function eventResetDate(resetsAt) {
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) return null;
  return new Date(resetsAt > 1e12 ? resetsAt : resetsAt * 1000);
}

// An assistant message marked error: 'rate_limit' counts on its own, with no
// reset time. On a subscription account that is the usage limit in practice;
// if a transient 429 ever shows the notice instead, the user's Retry fixes it.
export function toUsageLimitError(err, { rejected = null, rateLimited = false } = {}, now = new Date()) {
  const message = String(err?.message ?? err ?? '');
  const parsed = parseUsageLimitText(message, now);
  if (!rejected && !rateLimited && !parsed) return null;
  const exactReset = eventResetDate(rejected?.resetsAt);
  return new UsageLimitError(message, {
    resetsAt: exactReset ?? parsed?.resetsAt ?? null,
    exact: Boolean(exactReset),
    limitType: limitTypeFromEvent(rejected?.rateLimitType) ?? parsed?.limitType ?? 'unknown',
  });
}

export function toSqlUtc(date) {
  return date ? date.toISOString().slice(0, 19).replace('T', ' ') : null;
}
