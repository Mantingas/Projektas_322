/**
 * Synthetic "ground truth" sales data. NOTHING here is real company data.
 * Amounts are integer cents so control calculations are exact.
 */
export interface TruthLine {
  date: string;
  doc: string;
  customer: string;
  customerId: string;
  sku: string;
  product: string;
  qty: number;
  net: number; // cents
  vat: number; // cents
  cost: number; // cents, total cost of the line
  person: string;
}

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LT = {
  vat: 0.21,
  customers: [
    'UAB Baltic Trade', 'UAB Šilainių prekyba', 'AB Žalgiris Maistas', 'MB Ąžuolas', 'UAB Vilniaus duona', 'UAB Kauno statyba',
    'UAB Čiobreliai', 'UAB Gintaro pienas', 'IĮ Jonas Petraitis', 'UAB Nemuno žuvys', 'UAB Ūkininkų turgus', 'AB Klaipėdos baldai',
    'UAB Šviesa LT', 'UAB Dzūkijos medus', 'MB Žemaitijos mėsa', 'UAB Aukštaitijos sūris', 'UAB Panevėžio logistika', 'UAB Ąžuolynas',
    'UAB Rūta Vilnius', 'UAB Medeinos namai', 'UAB Saulėtekio centras', 'UAB Jūrų prekyba', 'UAB Pušyno projektai', 'UAB Verslo ratas',
  ],
  products: [
    'Pienas 2,5 % 1 l', 'Sviestas 82 %', 'Varškė 9 %', 'Sūris Džiugas', 'Duona ruginė', 'Batonas', 'Obuolių sultys', 'Mineralinis vanduo',
    'Kava malta 500 g', 'Arbata juoda', 'Cukrus 1 kg', 'Miltai kvietiniai', 'Aliejus rapsų', 'Makaronai', 'Ryžiai', 'Dešrelės',
    'Šaldyta žuvis', 'Kiaušiniai L', 'Medus 400 g', 'Šokoladas pieninis', 'Sausainiai', 'Žirniai konservuoti', 'Agurkai marinuoti', 'Padažas pomidorų',
  ],
  persons: ['Jonas Kazlauskas', 'Rūta Šimkutė', 'Mantas Žukauskas', 'Ieva Ąžuolaitė'],
  prefix: 'SF',
};

const PL = {
  vat: 0.23,
  customers: [
    'Hurtownia Żubr Sp. z o.o.', 'Piekarnia Źródło', 'Zakłady Mięsne Łużycka', 'Sklep Ćwikła', 'Przedsiębiorstwo Ługowski', 'Delikatesy Świt',
    'PHU Kowalski', 'Spółdzielnia Mleczarska Łańcut', 'Gospodarstwo Rolne Śliwa', 'Bar Mleczny Pod Różą', 'Market Żabka Partner', 'Sieć Sklepów Górnik',
    'Hurt-Pol Sp. j.', 'Cukiernia Śnieżka', 'Firma Handlowa Wójcik', 'Restauracja Złota Łódź', 'Przetwórnia Owoców Łęczyca', 'Dystrybucja Północ',
    'Warzywniak Świętokrzyski', 'Zajazd Pod Dębem', 'PPUH Nowak', 'Kuchnia Łódzka', 'Szkoła Podstawowa nr 5', 'Catering Żurawia',
  ],
  products: [
    'Mleko 3,2% 1 l', 'Masło extra 82%', 'Twaróg półtłusty', 'Ser Oscypek', 'Chleb żytni', 'Bułka pszenna', 'Sok jabłkowy', 'Woda mineralna',
    'Kawa mielona 500 g', 'Herbata czarna', 'Cukier 1 kg', 'Mąka pszenna', 'Olej rzepakowy', 'Makaron świderki', 'Ryż biały', 'Kiełbasa śląska',
    'Ryba mrożona', 'Jaja klasa L', 'Miód 400 g', 'Czekolada mleczna', 'Ciastka maślane', 'Groszek konserwowy', 'Ogórki kiszone', 'Sos pomidorowy',
  ],
  persons: ['Piotr Wiśniewski', 'Zofia Łukasiewicz', 'Łukasz Dąbrowski', 'Małgorzata Żak'],
  prefix: 'FV',
};

export type Locale = 'lt' | 'pl';

export function makeTruth(locale: Locale, seed = 42): TruthLine[] {
  const L = locale === 'lt' ? LT : PL;
  const rand = rng(seed + (locale === 'pl' ? 1000 : 0));
  const out: TruthLine[] = [];
  const start = Date.UTC(2025, 8, 1);
  const days = 106; // 2025-09-01 … 2025-12-15
  // customer 0 is a dominant customer; customers 3–8 stop buying after 2025-11-05 (a real decline pattern)
  const weights = L.customers.map((_, i) => (i === 0 ? 14 : i < 3 ? 5 : i < 9 ? 4 : 1.2));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const pick = (dateIso: string) => {
    for (let tries = 0; tries < 20; tries++) {
      let x = rand() * wsum;
      let idx = 0;
      for (; idx < weights.length; idx++) {
        x -= weights[idx]!;
        if (x <= 0) break;
      }
      idx = Math.min(idx, weights.length - 1);
      if (idx >= 3 && idx <= 8 && dateIso > '2025-11-05') continue;
      return idx;
    }
    return 0;
  };
  const basePrice = L.products.map((_, i) => 3 + ((i * 37) % 23) + rand() * 5);
  let docNo = 1000;
  for (let d = 0; d < days; d++) {
    const dt = new Date(start + d * 86400000);
    const dow = dt.getUTCDay();
    if (dow === 0) continue;
    const iso = dt.toISOString().slice(0, 10);
    const docs = dow === 6 ? 1 : 3 + Math.floor(rand() * 3);
    for (let k = 0; k < docs; k++) {
      const ci = pick(iso);
      const lines = 1 + Math.floor(rand() * 3);
      docNo++;
      const doc = `${L.prefix}-${docNo}`;
      for (let l = 0; l < lines; l++) {
        const pi = Math.floor(rand() * L.products.length);
        const qty = 1 + Math.floor(rand() * 40);
        const net = Math.round(qty * basePrice[pi]! * (0.9 + rand() * 0.2) * 100);
        const lowMargin = pi === 5 || pi === 10; // two products sold at ~break-even
        const cost = Math.round(net * (lowMargin ? 0.97 + rand() * 0.05 : 0.55 + rand() * 0.3));
        out.push({
          date: iso, doc, customer: L.customers[ci]!, customerId: `K${String(ci + 1).padStart(4, '0')}`,
          sku: `P${String(pi + 1).padStart(4, '0')}`, product: L.products[pi]!, qty, net, vat: Math.round(net * L.vat), cost,
          person: L.persons[(ci + pi) % L.persons.length]!,
        });
      }
    }
  }
  // credit notes (returns) – negative lines
  for (const [dayOffset, ci, pi] of [[20, 1, 3], [60, 2, 7], [95, 0, 12]] as const) {
    const iso = new Date(start + dayOffset * 86400000).toISOString().slice(0, 10);
    const net = -Math.round(3000 + rand() * 1500) * 100;
    out.push({
      date: iso, doc: `KR-${dayOffset}`, customer: L.customers[ci]!, customerId: `K${String(ci + 1).padStart(4, '0')}`,
      sku: `P${String(pi + 1).padStart(4, '0')}`, product: L.products[pi]!, qty: -10, net, vat: Math.round(net * L.vat), cost: Math.round(net * 0.7),
      person: L.persons[0]!,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.doc.localeCompare(b.doc));
}

// ---------- independent control calculations (do NOT use engine code) ----------

export interface Control {
  lines: number;
  netCents: number;
  grossCents: number;
  documents: number;
  topCustomer: string;
  topProduct: string;
  dateMin: string;
  dateMax: string;
}

export function control(truth: TruthLine[]): Control {
  let net = 0;
  let gross = 0;
  const docs = new Set<string>();
  const byCust = new Map<string, number>();
  const byProd = new Map<string, number>();
  for (const t of truth) {
    net += t.net;
    gross += t.net + t.vat;
    docs.add(t.doc);
    byCust.set(t.customer, (byCust.get(t.customer) ?? 0) + t.net);
    byProd.set(t.product, (byProd.get(t.product) ?? 0) + t.net);
  }
  const best = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  const dates = truth.map((t) => t.date).sort();
  return { lines: truth.length, netCents: net, grossCents: gross, documents: docs.size, topCustomer: best(byCust), topProduct: best(byProd), dateMin: dates[0]!, dateMax: dates[dates.length - 1]! };
}
