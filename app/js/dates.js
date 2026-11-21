// Date helpers. Expiry dates are stored as local calendar dates ("YYYY-MM-DD") so an item
// that expires on the 24th expires on the 24th regardless of time zone or DST changes.
export const DAY_MS = 86_400_000;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n) => String(n).padStart(2, '0');

export function parseISODate(iso) {
  const m = ISO_RE.exec(typeof iso === 'string' ? iso : '');
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

export const isValidISODate = (iso) => parseISODate(iso) !== null;

export function toISODate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const todayISO = (now = new Date()) => toISODate(new Date(now));

function dayNumber(iso) {
  const p = parseISODate(iso);
  if (!p) throw new RangeError(`Invalid date: ${iso}`);
  return Date.UTC(p.y, p.m - 1, p.d) / DAY_MS;
}

function fromDayNumber(n) {
  const dt = new Date(n * DAY_MS);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export const addDays = (iso, n) => fromDayNumber(dayNumber(iso) + n);

export function addMonths(iso, n) {
  const p = parseISODate(iso);
  if (!p) throw new RangeError(`Invalid date: ${iso}`);
  const first = new Date(Date.UTC(p.y, p.m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(p.d, lastDay));
  return fromDayNumber(first.getTime() / DAY_MS);
}

export const daysBetween = (fromISO, toISO) => dayNumber(toISO) - dayNumber(fromISO);

export const daysUntil = (iso, now = new Date()) => daysBetween(todayISO(now), iso);

export function parseTime(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(typeof hhmm === 'string' ? hhmm.trim() : '');
  if (!m) return [9, 0];
  return [Math.min(23, Number(m[1])), Math.min(59, Number(m[2]))];
}

/** Local Date for a calendar day at a wall-clock time, e.g. 2026-11-24 at "09:00". */
export function atLocalTime(iso, hhmm = '09:00') {
  const p = parseISODate(iso);
  if (!p) throw new RangeError(`Invalid date: ${iso}`);
  const [h, mi] = parseTime(hhmm);
  return new Date(p.y, p.m - 1, p.d, h, mi, 0, 0);
}

export function describeDaysLeft(days) {
  if (days < -1) return `Expired ${-days} days ago`;
  if (days === -1) return 'Expired yesterday';
  if (days === 0) return 'Expires today';
  if (days === 1) return 'Expires tomorrow';
  if (days < 14) return `Expires in ${days} days`;
  if (days < 60) return `Expires in ${Math.round(days / 7)} weeks`;
  if (days < 730) return `Expires in ${Math.round(days / 30.4)} months`;
  return `Expires in ${Math.round(days / 365)} years`;
}

export function shortDaysLeft(days) {
  if (days < 0) return 'Expired';
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  if (days < 14) return `${days} days`;
  if (days < 60) return `${Math.round(days / 7)} wks`;
  if (days < 730) return `${Math.round(days / 30.4)} mo`;
  return `${Math.round(days / 365)} yr`;
}

export function formatDate(iso, now = new Date()) {
  const p = parseISODate(iso);
  if (!p) return '';
  const date = new Date(p.y, p.m - 1, p.d);
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (p.y !== new Date(now).getFullYear()) opts.year = 'numeric';
  return new Intl.DateTimeFormat(undefined, opts).format(date);
}
