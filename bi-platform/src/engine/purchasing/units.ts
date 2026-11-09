import { normalizeHeader } from '../mapping/normalize';

export type UnitDimension = 'mass' | 'volume' | 'length' | 'count' | 'pack' | 'other' | 'unknown';

export interface UnitInfo {
  /** Canonical code shown to the user ("kg", "g", "pcs", "box" …). */
  code: string;
  dim: UnitDimension;
  /** Exact SI factor to the dimension's base unit (kg, l, m) – only for mass / volume / length. */
  toBase?: number;
}

const U = (code: string, dim: UnitDimension, toBase?: number): UnitInfo => ({ code, dim, toBase });

/** Words (normalised, no punctuation) → unit. Only units with an exact physical definition get a factor. */
const TABLE: Record<string, UnitInfo> = {};
const add = (info: UnitInfo, words: string[]) => words.forEach((w) => (TABLE[w] = info));
add(U('kg', 'mass', 1), ['kg', 'kgs', 'kilogramas', 'kilogramai', 'kilogram', 'kilogramy', 'kilograma']);
add(U('g', 'mass', 0.001), ['g', 'gr', 'gramas', 'gramai', 'gram', 'gramy']);
add(U('t', 'mass', 1000), ['t', 'tona', 'tonos', 'tone', 'tonne', 'ton', 'tony']);
add(U('l', 'volume', 1), ['l', 'ltr', 'litras', 'litrai', 'litr', 'litry', 'liter', 'litre', 'litres', 'liters']);
add(U('ml', 'volume', 0.001), ['ml', 'mililitras', 'mililitrai', 'mililitr', 'milliliter', 'millilitre']);
add(U('m', 'length', 1), ['m', 'metras', 'metrai', 'metr', 'metry', 'meter', 'metre']);
add(U('cm', 'length', 0.01), ['cm', 'centimetras', 'centymetr']);
add(U('mm', 'length', 0.001), ['mm', 'milimetras', 'milimetr']);
// pieces: one unit, no conversion to anything else
add(U('pcs', 'count'), ['vnt', 'vienetas', 'vienetai', 'vieneto', 'pcs', 'pc', 'piece', 'pieces', 'szt', 'sztuka', 'sztuki', 'ea', 'each', 'st', 'stk']);
// packaging units are DIFFERENT units: a box is not a pack is not a pallet, and none of them is a number of pieces without a stated rule
add(U('box', 'pack'), ['dezute', 'dezes', 'dez', 'box', 'boxes', 'karton', 'kartony', 'kart', 'ctn', 'carton']);
add(U('pack', 'pack'), ['pakuote', 'pakuotes', 'pak', 'pack', 'packs', 'package', 'opakowanie', 'opak', 'op', 'paczka']);
add(U('pallet', 'pack'), ['padas', 'paletė', 'palete', 'palet', 'paleta', 'palety', 'pallet', 'pallets']);
add(U('set', 'pack'), ['komplektas', 'kompl', 'komplekt', 'zestaw', 'set', 'sets']);

/** Normalises a unit cell. Unrecognised text is kept as its own unit (never merged with another). */
export function normalizeUnit(raw: string | undefined | null): UnitInfo | undefined {
  if (raw === undefined || raw === null) return undefined;
  const w = normalizeHeader(String(raw)).replace(/\s+/g, ' ');
  if (!w) return undefined;
  const hit = TABLE[w] ?? TABLE[w.replace(/ /g, '')];
  if (hit) return hit;
  return { code: w, dim: 'unknown' };
}

/**
 * How units are compared.
 *  strict – a price is comparable only with prices in the SAME unit (default).
 *  metric – ADDITIONALLY apply the exact SI definitions g→kg, t→kg, ml→l, cm/mm→m. Never touches pieces / packaging / unknown units.
 * There is no rule between pieces, boxes, packs or pallets: those need a rule the user states, which is not implemented.
 */
export type UnitPolicy = 'strict' | 'metric';

export function comparableUnit(code: string | undefined, policy: UnitPolicy): { unit: string | undefined; factor: number } {
  if (!code) return { unit: undefined, factor: 1 };
  if (policy === 'metric') {
    const info = Object.values(TABLE).find((u) => u.code === code);
    if (info?.toBase !== undefined) return { unit: info.dim === 'mass' ? 'kg' : info.dim === 'volume' ? 'l' : 'm', factor: info.toBase };
  }
  return { unit: code, factor: 1 };
}

/** Document-type cells that say "this is a credit note / return" (LT, PL, EN). "Korekta" is NOT included: a correction may raise the amount. */
const CREDIT_WORDS = ['kredit', 'kredyt', 'credit', 'zwrot', 'grazin', 'return', 'refund'];
export function isCreditType(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const n = normalizeHeader(String(raw));
  return CREDIT_WORDS.some((w) => n.includes(w));
}
