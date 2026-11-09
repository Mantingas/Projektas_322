import type { CellValue } from '../types';

export type DateOrder = 'dmy' | 'mdy' | 'ymd';

const pad = (n: number) => String(n).padStart(2, '0');

export function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim;
}

export function toIso(y: number, m: number, d: number): string | null {
  return isValidYmd(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** Excel 1900 date system serial → ISO (handles the fictional 1900-02-29). */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const whole = Math.floor(serial);
  const days = whole > 59 ? whole - 1 : whole; // skip Lotus bug day
  const ms = Date.UTC(1899, 11, 31) + days * 86400000;
  const dt = new Date(ms);
  return toIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

const ISO_RE = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[T\s].*)?$/;
const DMY_RE = /^(\d{1,2})[-./\s](\d{1,2})[-./\s](\d{2}|\d{4})\.?(?:[T\s,].*)?$/;

interface Parts {
  a: number;
  b: number;
  y: number;
  ymd: boolean;
}

function split(text: string): Parts | null {
  const t = text.trim();
  let m = ISO_RE.exec(t);
  if (m) return { y: Number(m[1]), a: Number(m[2]), b: Number(m[3]), ymd: true };
  m = DMY_RE.exec(t);
  if (m) {
    let y = Number(m[3]);
    if (m[3]!.length === 2) y += y < 70 ? 2000 : 1900;
    return { a: Number(m[1]), b: Number(m[2]), y, ymd: false };
  }
  return null;
}

/** Decides day/month order for a column from its values. Default (no evidence): day first (LT/PL convention). */
export function inferDateOrder(values: CellValue[]): DateOrder {
  let ymd = 0;
  let dmy = 0;
  let mdy = 0;
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const p = split(v);
    if (!p) continue;
    if (p.ymd) {
      ymd++;
      continue;
    }
    if (p.a > 12) dmy++;
    else if (p.b > 12) mdy++;
  }
  if (ymd > 0 && ymd >= dmy && ymd >= mdy) return 'ymd';
  if (mdy > dmy) return 'mdy';
  return 'dmy';
}

export function parseDate(v: CellValue, order: DateOrder = 'dmy'): string | null {
  if (v === null || v === '' || typeof v === 'boolean') return null;
  if (typeof v === 'number') return excelSerialToIso(v);
  const p = split(v);
  if (!p) return null;
  if (p.ymd) return toIso(p.y, p.a, p.b);
  return order === 'mdy' ? toIso(p.y, p.a, p.b) : toIso(p.y, p.b, p.a);
}

/** True if the value *looks like* a date (used for profiling, no day/month ambiguity resolution). */
export function looksLikeDate(v: CellValue): boolean {
  if (typeof v === 'string') {
    const p = split(v);
    if (!p) return false;
    if (p.ymd) return isValidYmd(p.y, p.a, p.b);
    return isValidYmd(p.y, p.b, p.a) || isValidYmd(p.y, p.a, p.b);
  }
  return false;
}
