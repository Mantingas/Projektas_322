import { normalizeHeader } from '../mapping/normalize';
import type { MovementType } from '../types';

export interface MovementClass {
  type: MovementType;
  /** The wording itself fixes the direction (e.g. "transfer out", "return from customer"). */
  forcedSign?: 1 | -1;
  /** A plain "return": the direction can only be read from the sign of the quantity. */
  bySign?: boolean;
}

const has = (n: string, words: string[]) => words.some((w) => (` ${n} `).includes(` ${w} `));
/** Short ERP document codes only count when they are the WHOLE cell (e.g. "WZ", "PZ", "MM"). */
const exact = (n: string, codes: string[]) => codes.includes(n);

const OPENING = ['pradinis likutis', 'likutis pradzioje', 'pradzios likutis', 'bilans otwarcia', 'stan poczatkowy', 'opening balance', 'opening stock', 'initial balance', 'opening'];
const RETURN_FROM_CUSTOMER = ['is pirkejo', 'pirkejo grazinimas', 'pardavimo grazinimas', 'zwrot od klienta', 'zwrot od odbiorcy', 'zwrot sprzedazy', 'customer return', 'sales return', 'return from customer', 'return in'];
const RETURN_TO_SUPPLIER = ['tiekejui', 'grazinimas tiekejui', 'pirkimo grazinimas', 'zwrot do dostawcy', 'zwrot dostawcy', 'supplier return', 'purchase return', 'return to supplier', 'return out', 'vendor return'];
const RETURN = ['grazinimas', 'grazinta', 'grazinti', 'zwrot', 'return', 'returns', 'refund'];
const TRANSFER_OUT = ['perkelimas is', 'issiuntimas', 'transfer out', 'przesuniecie wydanie', 'przesuniecie z', 'mm wydanie', 'transfer issue', 'issued transfer'];
const TRANSFER_IN = ['perkelimas i', 'gavimas is sandelio', 'transfer in', 'przesuniecie przyjecie', 'przesuniecie do', 'mm przyjecie', 'transfer receipt', 'received transfer'];
const TRANSFER = ['perkelimas', 'pervezimas', 'pernesimas', 'tarp sandeliu', 'sandeliu perkelimas', 'przesuniecie', 'przesuniecie miedzymagazynowe', 'transfer', 'transfers', 'relocation', 'stock transfer', 'internal transfer'];
/** Write-offs always REDUCE stock, whatever the sign convention of the file. */
const WRITE_OFF = ['nurasymas', 'nurasyta', 'brokas', 'spisanie', 'strata', 'zlomowanie', 'ubytki', 'write off', 'writeoff', 'write down', 'scrap', 'damage', 'damaged', 'shrinkage'];
const ADJUSTMENT = [
  'inventorizacija', 'inventorizacijos', 'korekcija', 'pataisa', 'nurasymas', 'nurasyta', 'brokas', 'likucio korekcija', 'perkainavimas',
  'inwentaryzacja', 'korekta', 'korekta stanu', 'spisanie', 'strata', 'zlomowanie', 'ubytki', 'nadwyzka', 'niedobor',
  'adjustment', 'stocktake', 'stock take', 'stock count', 'cycle count', 'write off', 'writeoff', 'write down', 'scrap', 'damage', 'damaged', 'shrinkage', 'physical count',
];
const RECEIPT = [
  'pajamavimas', 'pajamos', 'gavimas', 'pirkimas', 'priimta', 'prekiu gavimas', 'pajamavimas is tiekejo', 'gamyba', 'pajamuota',
  'przyjecie', 'przychod', 'przyjecie zewnetrzne', 'dostawa', 'przyjecie towaru', 'zakup',
  'receipt', 'goods receipt', 'receiving', 'received', 'purchase', 'inbound', 'delivery', 'production',
];
const ISSUE = [
  'israsymas', 'pardavimas', 'sunaudojimas', 'islaidos', 'atidavimas', 'isduota', 'isdavimas', 'pardavimas klientui', 'sunaudota',
  'wydanie', 'rozchod', 'sprzedaz', 'zuzycie', 'wydanie zewnetrzne', 'wydanie towaru',
  'issue', 'goods issue', 'sale', 'sales', 'outbound', 'consumption', 'dispatch', 'shipment', 'shipped', 'issued', 'picked',
];

/** Short ERP codes. Whole cell only. */
const CODES: Record<string, MovementType> = { pz: 'receipt', pw: 'receipt', wz: 'issue', rw: 'adjustment', mm: 'transfer', bo: 'opening' };

/**
 * Cell text → canonical movement type (LT / PL / EN). Order matters: opening, return, transfer, adjustment, receipt, issue.
 * Anything not recognised is `unknown` – and unknown movements are never used as demand.
 */
export function classifyMovement(raw: string | undefined | null): MovementClass {
  if (raw === undefined || raw === null) return { type: 'unknown' };
  const n = normalizeHeader(String(raw));
  if (!n) return { type: 'unknown' };
  if (has(n, OPENING)) return { type: 'opening' };
  if (has(n, RETURN_FROM_CUSTOMER)) return { type: 'return', forcedSign: 1 };
  if (has(n, RETURN_TO_SUPPLIER)) return { type: 'return', forcedSign: -1 };
  if (has(n, RETURN)) return { type: 'return', bySign: true };
  if (has(n, TRANSFER_OUT)) return { type: 'transfer', forcedSign: -1 };
  if (has(n, TRANSFER_IN)) return { type: 'transfer', forcedSign: 1 };
  if (has(n, TRANSFER)) return { type: 'transfer' };
  if (has(n, WRITE_OFF)) return { type: 'adjustment', forcedSign: -1 };
  if (has(n, ADJUSTMENT)) return { type: 'adjustment' };
  if (has(n, RECEIPT)) return { type: 'receipt' };
  if (has(n, ISSUE)) return { type: 'issue' };
  if (exact(n, Object.keys(CODES))) return { type: CODES[n]! };
  return { type: 'unknown' };
}
