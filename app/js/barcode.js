// Barcode helpers: GTIN validation, UPC-E expansion, lookup variants and GS1 parsing.
// GS1 DataBar / GS1-128 / GS1 DataMatrix codes on fresh food can carry the expiry date
// (AI 17) or best-before date (AI 15), which we use to pre-fill the expiry field.
import { isValidISODate } from './dates.js';

const GTIN_LENGTHS = new Set([8, 12, 13, 14]);
const GS = '\x1d';

export function gtinCheckDigit(body) {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGTIN(code) {
  if (!/^\d+$/.test(code ?? '') || !GTIN_LENGTHS.has(code.length)) return false;
  return gtinCheckDigit(code.slice(0, -1)) === Number(code.at(-1));
}

/** Expand an 8-digit UPC-E code to its 12-digit UPC-A form (null if not UPC-E). */
export function upcEtoUpcA(upce) {
  if (!/^[01]\d{7}$/.test(upce ?? '')) return null;
  const ns = upce[0];
  const [d1, d2, d3, d4, d5, d6] = upce.slice(1, 7);
  const check = upce[7];
  let body;
  if ('012'.includes(d6)) body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  else if (d6 === '3') body = `${d1}${d2}${d3}00000${d4}${d5}`;
  else if (d6 === '4') body = `${d1}${d2}${d3}${d4}00000${d5}`;
  else body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  return `${ns}${body}${check}`;
}

/** Codes to try against product databases, most likely first. */
export function lookupCandidates(code) {
  const out = [];
  const add = (c) => {
    if (c && !out.includes(c)) out.push(c);
  };
  let c = String(code ?? '').trim();
  if (/^0\d{13}$/.test(c)) c = c.slice(1);
  add(c);
  if (/^\d{12}$/.test(c)) add(`0${c}`);
  if (/^0\d{12}$/.test(c)) add(c.slice(1));
  return out;
}

const FIXED_LENGTH = {
  '00': 20, '01': 16, '02': 16, '03': 16, '04': 18,
  11: 8, 12: 8, 13: 8, 14: 8, 15: 8, 16: 8, 17: 8, 18: 8, 19: 8, 20: 4,
  31: 10, 32: 10, 33: 10, 34: 10, 35: 10, 36: 10, 41: 16,
};

function aiDigits(prefix) {
  const n = Number(prefix);
  if (n <= 22 || n === 30 || n === 37 || n >= 90) return 2;
  if ((n >= 23 && n <= 29) || (n >= 40 && n <= 42)) return 3;
  return 4;
}

/** Parse GS1 element strings, either "(01)…(17)…" or raw with GS separators. */
export function parseGS1(text) {
  const s = String(text ?? '').replace(/^\][A-Za-z]\d/, '');
  const out = {};
  if (s.startsWith('(')) {
    const re = /\((\d{2,4})\)([^(]*)/g;
    let m;
    while ((m = re.exec(s))) out[m[1]] = m[2].replaceAll(GS, '').trim();
    return Object.keys(out).length ? out : null;
  }
  let i = 0;
  while (i < s.length) {
    if (s[i] === GS) {
      i++;
      continue;
    }
    const prefix = s.slice(i, i + 2);
    if (!/^\d\d$/.test(prefix)) return null;
    const aiLen = aiDigits(prefix);
    const ai = s.slice(i, i + aiLen);
    i += aiLen;
    const fixed = FIXED_LENGTH[prefix];
    let value;
    if (fixed) {
      value = s.slice(i, i + fixed - aiLen);
      i += fixed - aiLen;
      if (value.length !== fixed - aiLen) return null;
    } else {
      const end = s.indexOf(GS, i);
      value = end === -1 ? s.slice(i) : s.slice(i, end);
      i = end === -1 ? s.length : end + 1;
    }
    out[ai] = value;
  }
  return Object.keys(out).length ? out : null;
}

/** GS1 YYMMDD date to ISO. A day of "00" means the last day of that month. */
export function gs1DateToISO(value) {
  if (!/^\d{6}$/.test(value ?? '')) return null;
  const year = 2000 + Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  let day = Number(value.slice(4, 6));
  if (month < 1 || month > 12) return null;
  if (day === 0) day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isValidISODate(iso) ? iso : null;
}

const GS1_FORMATS = /^(code_128|databar|data_matrix|qr_code)/;

function looksLikeGS1(text, format) {
  if (/^\(\d{2,4}\)/.test(text)) return true;
  if (!GS1_FORMATS.test(format)) return false;
  return /^01\d{14}/.test(text) && isValidGTIN(text.slice(2, 16));
}

/**
 * Normalise a scanned value into a product code (+ expiry date when the barcode has one).
 * `format` uses BarcodeDetector names such as "ean_13", "upc_e" or "databar_expanded".
 */
export function normalizeScan(rawValue, format = '') {
  const text = String(rawValue ?? '').trim().replace(/^\][A-Za-z]\d/, '');
  if (looksLikeGS1(text, format)) {
    const gs1 = parseGS1(text);
    if (gs1?.['01']) {
      return {
        code: gs1['01'].replace(/^0(?=\d{13}$)/, ''),
        expiry: gs1DateToISO(gs1['17']) ?? gs1DateToISO(gs1['15']) ?? gs1DateToISO(gs1['16']),
      };
    }
  }
  const compact = text.replace(/[\s-]+/g, '');
  if (format === 'upc_e' && /^[01]\d{7}$/.test(compact)) {
    return { code: upcEtoUpcA(compact), expiry: null };
  }
  if (format.startsWith('databar') && /^\d{14}$/.test(compact)) {
    return { code: compact.replace(/^0(?=\d{13}$)/, ''), expiry: null };
  }
  return { code: /^\d+$/.test(compact) ? compact : text, expiry: null };
}
