// Calendar export: one all-day event per item on its expiry date, with an alarm for each
// alert interval. Lets people without notification support (or who prefer their calendar)
// still get reminders. Alarms fire at the user's chosen time of day.
import { EXPIRED_STAGE, isActive, phraseFor, stagesFor } from './alerts.js';
import { addDays, parseTime } from './dates.js';

const encoder = new TextEncoder();

export function escapeText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/** Fold a content line at 75 octets without splitting a UTF-8 character (RFC 5545 3.1). */
export function foldLine(line) {
  if (encoder.encode(line).length <= 75) return line;
  const parts = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
      limit = 74; // continuation lines begin with a space
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** Signed minutes as an iCalendar duration, e.g. -3780 -> "-P2DT15H". */
export function formatDuration(minutes) {
  const sign = minutes < 0 ? '-' : '';
  let rest = Math.abs(Math.round(minutes));
  const days = Math.floor(rest / 1440);
  rest %= 1440;
  const hours = Math.floor(rest / 60);
  const mins = rest % 60;
  let out = `${sign}P${days ? `${days}D` : ''}`;
  if (hours || mins) out += `T${hours ? `${hours}H` : ''}${mins ? `${mins}M` : ''}`;
  return out === `${sign}P` ? 'PT0M' : out;
}

const compactDate = (iso) => iso.replaceAll('-', '');

function utcStamp(date) {
  return new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Alarm offset from the start of the expiry day for a stage at hh:mm. */
export function alarmTrigger(stage, notifyTime) {
  const [h, m] = parseTime(notifyTime);
  const dayOffset = stage === EXPIRED_STAGE ? 1 : -stage;
  return formatDuration(dayOffset * 1440 + h * 60 + m);
}

/**
 * Build an .ics file for the active items. `hints` maps item id -> recipe names and
 * `appUrl` (optional) links each event back to the item in the app.
 */
export function buildICS(items, settings, { now = new Date(), appUrl = '', hints = {} } = {}) {
  const stages = stagesFor(settings);
  const stamp = utcStamp(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pantry Pal//Food expiry dates//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Food expiry dates',
  ];
  for (const item of items) {
    if (!isActive(item)) continue;
    const label = `${item.emoji ? `${item.emoji} ` : ''}${item.name}`;
    const details = [
      item.brand && `Brand: ${item.brand}`,
      item.location && `Stored in: ${item.location}`,
      item.quantity && `Quantity: ${item.quantity}`,
      hints[item.id]?.length && `Recipe ideas: ${hints[item.id].join(', ')}`,
      item.notes && `Notes: ${item.notes}`,
    ].filter(Boolean);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${item.id}@pantry-pal`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compactDate(item.expiryDate)}`,
      `DTEND;VALUE=DATE:${compactDate(addDays(item.expiryDate, 1))}`,
      `SUMMARY:${escapeText(`${label} expires`)}`,
      'TRANSP:TRANSPARENT',
    );
    if (details.length) lines.push(`DESCRIPTION:${escapeText(details.join('\n'))}`);
    if (appUrl) lines.push(`URL:${appUrl}#/item/${encodeURIComponent(item.id)}`);
    for (const stage of stages) {
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeText(`${label} ${phraseFor(stage === EXPIRED_STAGE ? -1 : stage)}`)}`,
        `TRIGGER:${alarmTrigger(stage, settings.notifyTime)}`,
        'END:VALARM',
      );
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
