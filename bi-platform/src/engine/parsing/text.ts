import { MAX_CELL_CHARS } from './limits';

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Strips control characters and caps length of any text taken from an untrusted file. */
export function sanitizeText(s: string): string {
  const t = s.replace(CONTROL, '');
  return t.length > MAX_CELL_CHARS ? t.slice(0, MAX_CELL_CHARS) : t;
}
