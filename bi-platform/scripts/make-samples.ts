// Writes synthetic sample files to public/samples. All data is generated; none of it is real.
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildFixtures } from '../tests/fixtures/formats';
import { buildPurchasingFixtures } from '../tests/fixtures/purchasingFormats';
import { buildInventoryFixtures } from '../tests/fixtures/inventoryFormats';
import { buildFinanceFixtures } from '../tests/fixtures/financeFormats';

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
const pNames: Record<string, string> = {
  'lt-csv-utf8': 'sample_lt_pirkimai.csv',
  'pl-csv-1250': 'sample_pl_zakupy.csv',
  'en-xlsx-title': 'sample_en_purchases.xlsx',
};
for (const f of await buildPurchasingFixtures()) {
  const name = pNames[f.id];
  if (name) writeFileSync(`public/samples/${name}`, f.bytes);
}
const iNames: Record<string, string> = {
  'lt-snapshot-history': 'sample_lt_likuciai.csv',
  'lt-movements': 'sample_lt_judejimai.csv',
  'pl-valuation-1250': 'sample_pl_wycena_zapasow.csv',
  'en-movements-signed': 'sample_en_stock_movements.csv',
};
for (const f of await buildInventoryFixtures()) {
  const name = iNames[f.id];
  if (name) writeFileSync(`public/samples/${name}`, f.bytes);
}
const fNames: Record<string, string> = {
  'ar-open-items-history': 'sample_lt_gautinos_atviros.csv',
  'ar-payments': 'sample_lt_mokejimai.csv',
  'ar-invoices': 'sample_lt_saskaitos.csv',
  'ap-open-items': 'sample_en_ap_open_items.csv',
  'pl-aging-ap': 'sample_pl_wiekowanie_zobowiazan.csv',
};
for (const f of await buildFinanceFixtures()) {
  const name = fNames[f.id];
  if (name) writeFileSync(`public/samples/${name}`, f.bytes);
}
console.log('samples written');
