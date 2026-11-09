/**
 * Synthetic purchasing ground truth (integer cents / exact decimals). NOTHING here is real data.
 * Planted patterns (see comments) let tests compare the engine with independent reference calculations.
 */
export interface PLine {
  date: string;
  doc: string;
  supplier: string;
  supplierId: string;
  sku: string;
  product: string;
  qty: number;
  unit: string; // as written in the file
  price: number; // listed unit price (per `unit`)
  net: number; // line amount in cents (after discount); negative for credit notes
  discount: number; // cents
  credit: boolean;
  warehouse: string;
}

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SUP = {
  lt: ['UAB Žemaitijos pienas', 'AB Vilniaus malūnas', 'UAB Baltijos ūkis', 'MB Šaltinis', 'UAB Nemuno gėrimai', 'UAB Ąžuolo pakuotė'],
  pl: ['Mleczarnia Łódzka', 'Młyn Żuraw Sp. z o.o.', 'Hurtownia Śląska', 'Zakład Źródło', 'Napoje Północ', 'Opakowania Ćwik'],
};
const PROD = {
  lt: ['Pienas 1 l', 'Miltai kvietiniai', 'Sviestas 82 %', 'Cukrus', 'Kefyras 1 l', 'Sūris Džiugas', 'Aliejus rapsų', 'Dėžės kartoninės', 'Obuolių sultys', 'Ryžiai', 'Kiaušiniai L', 'Druska'],
  pl: ['Mleko 1 l', 'Mąka pszenna', 'Masło extra', 'Cukier', 'Kefir 1 l', 'Ser Oscypek', 'Olej rzepakowy', 'Kartony', 'Sok jabłkowy', 'Ryż', 'Jaja L', 'Sól'],
};
const WAREHOUSE = { lt: ['Vilnius', 'Kaunas'], pl: ['Łódź', 'Katowice'] };
export type PLocale = 'lt' | 'pl';

export const FIRST = '2025-09-01';
export const LAST = '2025-12-15';
// the two 30-day comparison windows used by the "r30" preset anchored on LAST
export const CUR = { from: '2025-11-16', to: '2025-12-15' };
export const PREV = { from: '2025-10-17', to: '2025-11-15' };

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function makePurchasing(locale: PLocale, seed = 7): PLine[] {
  const S = SUP[locale];
  const P = PROD[locale];
  const W = WAREHOUSE[locale];
  const rand = rng(seed + (locale === 'pl' ? 500 : 0));
  const out: PLine[] = [];
  let docNo = 5000;
  const price = (v: number) => Math.round(v * 10000) / 10000;
  const add = (o: Partial<PLine> & Pick<PLine, 'date' | 'supplier' | 'sku' | 'product' | 'qty' | 'unit' | 'price'>) => {
    const gross = Math.round(o.qty * o.price * 100);
    const disc = o.discount ?? 0;
    out.push({ doc: o.doc ?? `${locale === 'lt' ? 'TS' : 'FZ'}-${++docNo}`, supplierId: `S${S.indexOf(o.supplier) + 1}`, net: gross - disc, discount: disc, credit: false, warehouse: W[docNo % 2]!, ...o } as PLine);
  };
  const start = Date.UTC(2025, 8, 1);
  for (let d = 0; d < 106; d++) {
    const dt = start + d * 86400000;
    const dow = new Date(dt).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const date = iso(dt);
    const late = date >= '2025-11-16';
    const afterMid = date >= '2025-11-16'; // price-change date for planted increases

    // P01 milk (kg-like, here "l"): supplier S1, +20 % price from 2025-11-16 (many lines in both windows)
    add({ date, supplier: S[0]!, sku: 'P01', product: P[0]!, qty: 80 + Math.floor(rand() * 40), unit: 'l', price: price(afterMid ? 0.72 : 0.6) });
    // P02 flour: supplier S2, −10 % in the latest window
    if (d % 2 === 0) add({ date, supplier: S[1]!, sku: 'P02', product: P[1]!, qty: 200 + Math.floor(rand() * 100), unit: 'kg', price: price(late ? 0.9 : 1.0) });
    // P03 butter: bought from S3 (cheap) and S4 (dear) in the SAME period, prices flat → cross-supplier gap of 20 %
    if (d % 3 === 0) add({ date, supplier: S[2]!, sku: 'P03', product: P[2]!, qty: 40 + Math.floor(rand() * 20), unit: 'kg', price: 7.5 });
    if (d % 3 === 1) add({ date, supplier: S[3]!, sku: 'P03', product: P[2]!, qty: 30 + Math.floor(rand() * 20), unit: 'kg', price: 9.0 });
    // P04 sugar: S1 sells per kg (1.20), S2 per g (0.0012) – the SAME physical price, different units
    if (d % 4 === 0) add({ date, supplier: S[0]!, sku: 'P04', product: P[3]!, qty: 500 + Math.floor(rand() * 200), unit: 'kg', price: 1.2 });
    if (d % 4 === 2) add({ date, supplier: S[1]!, sku: 'P04', product: P[3]!, qty: 300000, unit: 'g', price: 0.0012 });
    // P06 kefir: prices flat per supplier (S3 2.0 / S4 2.5) but the MIX shifts to the dearer supplier in the latest window
    if (d % 2 === 1) add({ date, supplier: late ? S[3]! : S[2]!, sku: 'P06', product: P[4]!, qty: 60 + Math.floor(rand() * 10), unit: 'l', price: late ? 2.5 : 2.0 });
    if (d % 6 === 1) add({ date, supplier: late ? S[2]! : S[3]!, sku: 'P06', product: P[4]!, qty: 10 + Math.floor(rand() * 5), unit: 'l', price: late ? 2.0 : 2.5 });
    // P05 cheese: stable quantities (10–20 kg); one planted outlier below
    if (d % 3 === 2) add({ date, supplier: S[4]!, sku: 'P05', product: P[5]!, qty: 10 + Math.floor(rand() * 11), unit: 'kg', price: 11 });
    // P07 oil with a 5 % discount on the line (amount already net of it)
    if (d % 5 === 0) { const q = 50 + Math.floor(rand() * 10); add({ date, supplier: S[4]!, sku: 'P07', product: P[6]!, qty: q, unit: 'l', price: 2.2, discount: Math.round(q * 2.2 * 100 * 0.05) }); }
    // P08 cartons in boxes from S6 (price flat)
    if (d % 7 === 0) add({ date, supplier: S[5]!, sku: 'P08', product: P[7]!, qty: 20 + Math.floor(rand() * 10), unit: 'dėž.', price: 14 });
    // P09 juice: price DROPS at a supplier but we also lower quantity (volume effect)
    if (d % 4 === 1) add({ date, supplier: S[4]!, sku: 'P09', product: P[8]!, qty: late ? 40 : 90, unit: 'l', price: 1.3 });
    // P10 rice: NEW item, only in the latest window
    if (late && d % 5 === 3) add({ date, supplier: S[1]!, sku: 'P10', product: P[9]!, qty: 100, unit: 'kg', price: 1.6 });
    // P11 eggs: DISCONTINUED, only before the latest window
    if (!late && d % 5 === 3) add({ date, supplier: S[2]!, sku: 'P11', product: P[10]!, qty: 30, unit: 'pcs', price: 0.2 });
  }
  // ambiguous code: "P99" used for two different products
  add({ date: '2025-11-20', supplier: S[2]!, sku: 'P99', product: P[11]!, qty: 100, unit: 'kg', price: 0.4 });
  add({ date: '2025-11-22', supplier: S[3]!, sku: 'P99', product: 'Mineralinis vanduo', qty: 100, unit: 'l', price: 0.3 });
  // unusual quantity: P05 normally 10–20 kg, once 400 kg in the latest window
  add({ date: '2025-12-09', supplier: S[4]!, sku: 'P05', product: P[5]!, qty: 400, unit: 'kg', price: 11, doc: `${locale === 'lt' ? 'TS' : 'FZ'}-ODD1` });
  // spending anomaly: one whole week (2025-12-01 … 07) with large extra purchases
  for (let i = 1; i <= 5; i++) add({ date: `2025-12-0${i}`, supplier: S[5]!, sku: 'P08', product: P[7]!, qty: 700, unit: 'dėž.', price: 14 });
  // credit notes: four in the PREVIOUS window, none in the latest
  for (const [date, n] of [['2025-10-20', 1], ['2025-10-27', 2], ['2025-11-04', 3], ['2025-11-11', 4]] as const) {
    add({ date, supplier: S[4]!, sku: 'P09', product: P[8]!, qty: -200, unit: 'l', price: 1.3, doc: `${locale === 'lt' ? 'KR' : 'KFZ'}-${n}`, credit: true });
  }
  // concentration: S1 buys are already dominant through P01/P04 volumes
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.doc.localeCompare(b.doc));
}

// ───────────── independent control calculations (plain loops, no engine code) ─────────────
export const inWin = (rows: PLine[], r: { from: string; to: string }) => rows.filter((x) => x.date >= r.from && x.date <= r.to);
export const sumNet = (rows: PLine[]) => rows.reduce((s, x) => s + x.net, 0) / 100;

export function byKey<T>(rows: PLine[], key: (x: PLine) => string, val: (x: PLine) => number = (x) => x.net / 100) {
  const m = new Map<string, number>();
  for (const x of rows) m.set(key(x), (m.get(key(x)) ?? 0) + val(x));
  return m;
}

/** weighted unit price per (sku, unit-in-kg-or-l-or-as-is, supplier) – only positive lines, converting g→kg when `metric` is on */
export function priceMap(rows: PLine[], metric = false, bySupplier = true) {
  const m = new Map<string, { a: number; q: number; lines: number }>();
  for (const x of rows) {
    if (x.net <= 0 || x.qty <= 0) continue;
    let unit = x.unit;
    let q = x.qty;
    if (metric && unit === 'g') { unit = 'kg'; q = x.qty / 1000; }
    const k = `${x.sku}|${unit}${bySupplier ? '|' + x.supplier : ''}`;
    const e = m.get(k) ?? { a: 0, q: 0, lines: 0 };
    e.a += x.net / 100; e.q += q; e.lines++;
    m.set(k, e);
  }
  return m;
}
