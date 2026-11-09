import { expect, test } from '@playwright/test';
import path from 'node:path';
import { isLocal, trackRequests } from './helpers';

const sample = (n: string) => path.join(process.cwd(), 'public/samples', n);

test.describe('import → insights → history → delete', () => {
  test('LT CSV end to end, offline-safe and persistent', async ({ page, context }) => {
    const reqs = trackRequests(page);
    await page.goto('/app/');
    await page.getByTestId('lang-en').click();

    await page.getByTestId('file-input').setInputFiles(sample('sample_lt_pardavimai.csv'));
    await expect(page.getByTestId('mapping-table')).toBeVisible();
    // proposals are visible before anything is imported
    await expect(page.getByTestId('map-0')).toHaveValue('document_date');
    const confirm = page.getByTestId('confirm-import');
    await expect(confirm).toBeEnabled();
    await page.getByTestId('mode-select').selectOption('full');
    await confirm.click();

    await expect(page.getByTestId('import-result')).toBeVisible();
    const added = Number(await page.getByTestId('stat-added').textContent());
    expect(added).toBeGreaterThan(500);

    await page.getByTestId('view-insights').click();
    await expect(page.getByTestId('kpi-revenue')).toBeVisible();
    expect(await page.getByTestId('insight').count()).toBeGreaterThanOrEqual(3);
    await expect(page.locator('[data-insight-id="sales.customers_declined"]')).toBeVisible();

    // re-importing the same file is flagged; importing anyway never doubles the numbers
    const revenueBefore = await page.getByTestId('kpi-revenue').textContent();
    await page.getByTestId('tab-import').click();
    await page.getByTestId('file-input').setInputFiles(sample('sample_lt_pardavimai.csv'));
    await expect(page.getByTestId('dup-file')).toBeVisible();
    await expect(page.getByTestId('confirm-import')).toBeDisabled();
    await page.getByTestId('import-anyway').click();
    await page.getByTestId('confirm-import').click();
    await expect(page.getByTestId('stat-added')).toHaveText('0');
    await page.getByTestId('view-insights').click();
    expect(await page.getByTestId('kpi-revenue').textContent()).toBe(revenueBefore);

    // history
    await page.getByTestId('tab-history').click();
    await expect(page.getByTestId('history-table').locator('tbody tr')).toHaveCount(2);

    // reload keeps the data (IndexedDB)
    await page.reload();
    await page.getByTestId('tab-insights').click();
    await expect(page.getByTestId('kpi-revenue')).toHaveText(revenueBefore!);

    // exports are generated locally
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv').click()]);
    expect(dl.suggestedFilename()).toBe('insights-report.csv');

    // delete everything
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('tab-settings').click();
    await page.getByTestId('delete-all').click();
    await expect(page.getByTestId('settings-msg')).toBeVisible();
    await expect(page.getByTestId('storage-stats')).toContainText('0');
    await page.getByTestId('tab-insights').click();
    await expect(page.getByTestId('no-data')).toBeVisible();

    // privacy: nothing but same-origin static assets was requested, and nothing was POSTed
    const origin = new URL(page.url()).origin;
    const external = reqs.filter((r) => !isLocal(r.url(), origin));
    expect(external.map((r) => r.url())).toEqual([]);
    expect(reqs.filter((r) => r.method() !== 'GET' && r.method() !== 'HEAD').map((r) => `${r.method()} ${r.url()}`)).toEqual([]);
    void context;
  });

  test('PL Windows-1250 CSV and Polish UI', async ({ page }) => {
    await page.goto('/app/');
    await page.getByTestId('lang-pl').click();
    await page.getByTestId('file-input').setInputFiles(sample('sample_pl_sprzedaz.csv'));
    await expect(page.getByTestId('mapping-table')).toContainText('Kontrahent');
    await expect(page.getByTestId('mapping-table')).toContainText('Wartość netto');
    await page.getByTestId('confirm-import').click();
    await page.getByTestId('view-insights').click();
    await expect(page.getByTestId('kpi-revenue')).toContainText('zł');
    await expect(page.getByTestId('insight').first()).toBeVisible();
  });

  test('XLSX with title rows and several sheets; user can correct the mapping', async ({ page }) => {
    await page.goto('/app/');
    await page.getByTestId('lang-lt').click();
    await page.getByTestId('file-input').setInputFiles(sample('sample_en_sales.xlsx'));
    // the "Notes" sheet is skipped automatically: a table with data is pre-selected
    await expect(page.getByTestId('sheet-select')).toHaveValue('1');
    // break the mapping, the button must be disabled, then repair it
    const dateSel = page.getByTestId('map-0');
    await dateSel.selectOption('');
    await expect(page.getByTestId('confirm-import')).toBeDisabled();
    await dateSel.selectOption('document_date');
    await expect(page.getByTestId('confirm-import')).toBeEnabled();
    await page.getByTestId('confirm-import').click();
    await expect(page.getByTestId('import-result')).toBeVisible();
    await page.getByTestId('view-insights').click();
    await expect(page.getByText('Marža').first()).toBeVisible(); // cost column present → margin KPI shown
  });

  test('rejects an unsupported file with a clear message', async ({ page }) => {
    await page.goto('/app/');
    await page.getByTestId('lang-en').click();
    await page.getByTestId('file-input').setInputFiles({ name: 'x.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await expect(page.getByText('Unsupported file type')).toBeVisible();
  });
});
