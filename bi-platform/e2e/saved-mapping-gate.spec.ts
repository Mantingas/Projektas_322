import { expect, test, type Page } from '@playwright/test';
import { layoutSignature } from '../src/engine/mapping/mapper';
import { ensureCurrency } from './helpers';

const header = ['Data', 'Dokumento Nr.', 'Klientas', 'Prekė', 'Kiekis', 'Katalogo_kaina_be_PVM_EUR', 'Pardavimo_kaina_be_PVM_EUR', 'Pardavimo_suma_be_PVM_EUR', 'PVM_EUR'];
const file = (name: string, day: number) => ({ name, mimeType: 'text/csv', buffer: Buffer.from('﻿' + header.join(';') + '\r\n' + Array.from({ length: 6 }, (_, i) => `2025-03-${String(day + i).padStart(2, '0')};D${day}${i};Klientas ${i};Prekė ${i};2;10,00;9,00;18,00;3,78`).join('\r\n') + '\r\n') });
// what the old mapper remembered for this layout: the sold price as VAT, the list price as unit price
const BAD = { document_date: 'data', document_id: 'dokumento nr', customer_name: 'klientas', product_name: 'preke', quantity: 'kiekis', unit_price: 'katalogo kaina be pvm eur', vat_amount: 'pardavimo kaina be pvm eur', net_amount: 'pardavimo suma be pvm eur' };
const GOOD = { document_date: 'data', document_id: 'dokumento nr', customer_name: 'klientas', product_name: 'preke', quantity: 'kiekis', unit_price: 'pardavimo kaina be pvm eur', vat_amount: 'pvm eur', net_amount: 'pardavimo suma be pvm eur' };

async function seed(page: Page, fields: Record<string, string>) {
  await page.goto('/app/');
  await page.getByTestId('lang-en').click();
  await page.evaluate(async ({ signature, fields }) => {
    const open = () => new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('bi-platform'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    let db = await open();
    for (let i = 0; i < 50 && !db.objectStoreNames.contains('mappings'); i++) { db.close(); await new Promise((r) => setTimeout(r, 100)); db = await open(); }
    await new Promise<void>((res, rej) => { const tx = db.transaction('mappings', 'readwrite'); tx.objectStore('mappings').put({ signature, fields, defaultCurrency: 'EUR', updatedAt: 1 }); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    db.close();
  }, { signature: layoutSignature(header, 'sales'), fields });
  await page.reload();
}
async function load(page: Page, f: ReturnType<typeof file>) {
  await page.getByTestId('file-input').setInputFiles(f);
  await page.getByTestId('mapping-table').waitFor();
  await ensureCurrency(page);
}

test('a contradicting remembered mapping blocks the import until it is confirmed on purpose, or fixed', async ({ page }) => {
  await seed(page, BAD);
  await load(page, file('a.csv', 1));
  await expect(page.getByTestId('saved-suspect')).toBeVisible();
  await expect(page.getByTestId('saved-suspect')).toContainText('Pardavimo_kaina_be_PVM_EUR');
  await expect(page.getByTestId('import-preview')).toBeVisible();
  await expect(page.getByTestId('confirm-import')).toBeDisabled();
  // explicit confirmation allows it
  await page.getByTestId('saved-suspect-checkbox').check();
  await expect(page.getByTestId('confirm-import')).toBeEnabled();
  // changing any assignment cancels the confirmation
  await page.getByTestId('map-3').selectOption('');
  await expect(page.getByTestId('saved-suspect-checkbox')).not.toBeChecked();
  await expect(page.getByTestId('confirm-import')).toBeDisabled();
  // correcting the wrong ones removes the problem without a confirmation
  await page.getByTestId('map-6').selectOption('unit_price');
  await page.getByTestId('map-8').selectOption('vat_amount');
  await expect(page.getByTestId('map-5')).toHaveValue('');
  await expect(page.getByTestId('saved-suspect')).toHaveCount(0);
  await page.getByTestId('map-3').selectOption('product_name');
  await expect(page.getByTestId('confirm-import')).toBeEnabled();
});

test('the confirmation belongs to one import: the next file needs its own', async ({ page }) => {
  await seed(page, BAD);
  await load(page, file('a.csv', 1));
  await page.getByTestId('saved-suspect-checkbox').check();
  await expect(page.getByTestId('confirm-import')).toBeEnabled();
  await page.getByTestId('confirm-import').click();
  await page.getByTestId('import-result').waitFor();
  await page.getByRole('button', { name: 'Choose file' }).click();
  await load(page, file('b.csv', 10));
  await expect(page.getByTestId('saved-suspect')).toBeVisible();
  await expect(page.getByTestId('saved-suspect-checkbox')).not.toBeChecked();
  await expect(page.getByTestId('confirm-import')).toBeDisabled();
});

test('a sound remembered mapping needs nothing extra', async ({ page }) => {
  await seed(page, GOOD);
  await load(page, file('a.csv', 1));
  await expect(page.getByTestId('saved-suspect')).toHaveCount(0);
  await expect(page.getByTestId('import-preview')).toBeVisible();
  await expect(page.getByTestId('confirm-import')).toBeEnabled();
});
