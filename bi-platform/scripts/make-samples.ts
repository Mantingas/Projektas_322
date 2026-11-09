// Writes synthetic sample files to public/samples. All data is generated; none of it is real.
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildFixtures } from '../tests/fixtures/formats';

const names: Record<string, string> = {
  'lt-csv-utf8': 'sample_lt_pardavimai.csv',
  'pl-csv-1250': 'sample_pl_sprzedaz.csv',
  'en-xlsx-multisheet': 'sample_en_sales.xlsx',
  'lt-xlsx-title': 'sample_lt_ataskaita.xlsx',
};
mkdirSync('public/samples', { recursive: true });
for (const f of await buildFixtures()) {
  const name = names[f.id];
  if (name) writeFileSync(`public/samples/${name}`, f.bytes);
}
console.log('samples written');
