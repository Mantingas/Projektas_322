import { expect, test, type Page } from '@playwright/test';

const head = 'Data;Dokumento Nr.;Klientas;Prekė;Kiekis;Suma be PVM\r\n';
const file = (name: string, day: number) => ({ name, mimeType: 'text/csv', buffer: Buffer.from('﻿' + head + Array.from({ length: 6 }, (_, i) => `2025-03-${String(day + i).padStart(2, '0')};D${day}${i};Klientas ${i};Prekė ${i};2;${100 + i},00`).join('\r\n') + '\r\n') });
const pick = async (page: Page, f: ReturnType<typeof file>) => {
  await page.getByTestId('tab-import').click();
  if (await page.getByTestId('import-result').count()) await page.getByRole('button', { name: /Choose file|Pasirinkti failą|Wybierz plik/ }).click();
  await page.getByTestId('file-input').setInputFiles(f);
  await page.getByTestId('mapping-table').waitFor();
};

for (const lang of ['lt', 'pl'] as const) {
  test(`${lang}: a file with no currency stated asks for it instead of assuming one; a confirmed currency is remembered for the layout`, async ({ page }) => {
    await page.goto('/app/');
    await page.getByTestId(`lang-${lang}`).click();
    await pick(page, file('a.csv', 1));
    const select = page.getByTestId('currency-select');
    await expect(select).toHaveValue('');
    await expect(page.getByTestId('confirm-import')).toBeDisabled();
    await expect(page.getByTestId('import-preview')).toHaveCount(0);
    await select.selectOption('PLN');
    await expect(page.getByTestId('import-preview')).toBeVisible();
    await page.getByTestId('confirm-import').click();
    await page.getByTestId('import-result').waitFor();
    // same layout again: the earlier confirmation is offered as the choice
    await pick(page, file('b.csv', 10));
    await expect(page.getByTestId('currency-select')).toHaveValue('PLN');
    await expect(page.getByTestId('import-preview')).toBeVisible();
  });
}
