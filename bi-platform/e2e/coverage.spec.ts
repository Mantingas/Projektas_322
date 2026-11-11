import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 40 days of flat daily sales ending 2025-06-30: the previous 30-day window holds only 10 days of data. */
function flatCsv(): string {
  const rows = ['Data;Dokumento Nr.;Klientas;Prekė;Kiekis;Suma be PVM'];
  for (let d = 0; d < 40; d++) {
    const t = new Date(Date.UTC(2025, 5, 30) - (39 - d) * 86400000).toISOString().slice(0, 10);
    rows.push(`${t};S${d};K${d % 5};P${d % 4};1;100`);
  }
  return '﻿' + rows.join('\r\n');
}
const file = () => { const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cov-')), 'flat.csv'); fs.writeFileSync(p, flatCsv()); return p; };

test.describe('export period and comparison coverage', () => {
  test('undeclared: the change is withheld and the limitation says the coverage is UNKNOWN; declared: the comparison is allowed', async ({ page }) => {
    await page.goto('/app/');
    await page.getByTestId('lang-en').click();
    await page.getByTestId('file-input').setInputFiles(file());
    await expect(page.getByTestId('mapping-table')).toBeVisible();
    await expect(page.getByTestId('export-period')).toBeVisible();
    await page.getByTestId('mode-select').selectOption('full');
    await page.getByTestId('confirm-import').click();
    await expect(page.getByTestId('import-result')).toBeVisible();
    await page.getByTestId('view-insights').click();
    await expect(page.getByTestId('kpi-revenue')).toBeVisible();
    await expect(page.getByTestId('limitations')).toContainText('UNKNOWN');
    await expect(page.getByTestId('kpi-change-sales')).not.toContainText('200');
    await expect(page.locator('[data-insight-id="sales.revenue_change"]')).toHaveCount(0);

    // delete the import and import again with a declared export period that starts well before the first sale
    await page.getByTestId('tab-history').click();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: /delete/i }).first().click();
    await page.getByTestId('tab-import').click();
    await page.getByTestId('file-input').setInputFiles(file());
    await expect(page.getByTestId('mapping-table')).toBeVisible();
    await page.getByTestId('cover-from').fill('2025-01-01');
    await page.getByTestId('cover-to').fill('2025-06-30');
    await page.getByTestId('mode-select').selectOption('full');
    await page.getByTestId('confirm-import').click();
    await expect(page.getByTestId('import-result')).toBeVisible();
    await page.getByTestId('view-insights').click();
    await expect(page.getByTestId('kpi-revenue')).toBeVisible();
    await expect(page.getByTestId('limitations')).not.toContainText('UNKNOWN');
  });

  test('LT, PL and EN texts of the coverage notice have no raw keys and the page does not scroll sideways on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app/');
    await page.getByTestId('file-input').setInputFiles(file());
    await expect(page.getByTestId('export-period')).toBeVisible();
    for (const lang of ['lt', 'pl', 'en']) {
      await page.getByTestId(`lang-${lang}`).click();
      const text = await page.getByTestId('export-period').innerText();
      expect(text).not.toMatch(/import\.cover/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    }
  });
});
