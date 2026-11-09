/**
 * Guard against committing real personal / company data in a compatibility fixture.
 * It cannot prove anonymisation – it catches the obvious leaks (e-mail, phone, IBAN, tax ids, long digit runs, URLs).
 */
export interface Finding {
  kind: string;
  sample: string;
}

const RULES: [string, RegExp][] = [
  ['email', /[\w.+-]+@[\w-]+\.[\w.-]+/],
  ['url', /https?:\/\/\S+|www\.\S+/i],
  ['iban', /\b[A-Z]{2}\d{2}[ ]?(?:[A-Z0-9]{4}[ ]?){3,7}[A-Z0-9]{1,4}\b/],
  ['phone', /(?:\+|00)\d{2,3}[ -]?\d{2,3}[ -]?\d{3}[ -]?\d{2,4}\b/],
  ['PL NIP', /\b\d{3}-\d{3}-\d{2}-\d{2}\b|\bPL\s?\d{10}\b/],
  ['LT VAT / company code', /\bLT\d{9,12}\b/],
  ['long digit run (company / personal id)', /\b\d{9,}\b/],
];

export function scanForPersonalData(text: string): Finding[] {
  const out: Finding[] = [];
  for (const [kind, re] of RULES) {
    const m = re.exec(text);
    if (m) out.push({ kind, sample: m[0].slice(0, 4) + '…' }); // never echo the full match
  }
  return out;
}
