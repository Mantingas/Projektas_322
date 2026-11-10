import { expect, test, type Page } from '@playwright/test';
import { makeUniversal, universalCsv, refByRegion } from '../tests/fixtures/universal';
import { isLocal, trackRequests } from './helpers';

const truth = makeUniversal();
const csv = (name = 'orders.csv') => ({ name, mimeType: 'text/csv', buffer: Buffer.from(universalCsv(truth, 'lt')) });
const n = (v: number) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(v);

async function start(page: Page) { await page.goto('/app/'); await page.getByTestId('lang-en').click(); }
async function importTable(page: Page, decide = true) {
  await page.getByTestId('tab-import').click();
  await page.getByTestId('import-mode-universal').click();
  await page.getByTestId('u-file-input').setInputFiles(csv());
  await page.getByTestId('u-mapping-table').waitFor();
  if (decide) await page.getByTestId('u-col-8').selectOption('numeric');
}
async function openView(page: Page) {
  await importTable(page);
  await page.getByTestId('u-confirm-import').click();
  await page.getByTestId('u-import-result').waitFor();
  await page.getByTestId('u-open-view').click();
  await page.getByTestId('universal-view').waitFor();
  await page.getByTestId('u-charts').waitFor();
}

test.describe('universal tables: import asks only about what is ambiguous', () => {
  test('column types are suggested, the uncertain one blocks the import until confirmed', async ({ page }) => {
    await start(page);
    await importTable(page, false);
    await expect(page.getByTestId('u-col-0')).toHaveValue('date');
    await expect(page.getByTestId('u-col-1')).toHaveValue('identifier');
    await expect(page.getByTestId('u-col-2')).toHaveValue('category');
    await expect(page.getByTestId('u-col-4')).toHaveValue('currency');
    await expect(page.getByTestId('u-col-6')).toHaveValue('percent');
    await expect(page.getByTestId('u-col-7')).toHaveValue('boolean');
    await expect(page.getByTestId('u-unresolved')).toHaveAttribute('data-open', '1');
    await expect(page.getByTestId('u-col-row-8')).toHaveAttribute('data-undecided', 'true');
    await expect(page.getByTestId('u-confirm-import')).toBeDisabled();
    await page.getByTestId('u-col-8').selectOption('category');
    await expect(page.getByTestId('u-unresolved')).toHaveAttribute('data-open', '0');
    await expect(page.getByTestId('u-confirm-import')).toBeEnabled();
    await expect(page.getByText('No business meaning (revenue, profit, debt', { exact: false })).toBeVisible();
  });
});

test.describe('universal tables: analysis', () => {
  test('overview, findings, charts with table alternatives and units, and filters that keep everything consistent', async ({ page, baseURL }) => {
    const reqs = trackRequests(page);
    await start(page);
    await openView(page);
    await expect(page.getByTestId('u-ov-rows')).toHaveText(n(truth.rows.length));
    await expect(page.getByTestId('u-ov-dups')).toHaveText('2');
    await expect(page.locator('[data-testid=u-insight]').first()).toBeVisible();
    for (const id of ['universal.missing', 'universal.duplicates', 'universal.outliers', 'universal.correlation']) await expect(page.locator(`[data-insight-id="${id}"]`)).toHaveCount(1);
    await expect(page.locator('[data-insight-id="universal.duplicates"] [data-testid=certainty-badge]')).toHaveAttribute('data-certainty', 'possible');
    // chart set: right kinds, each with scope, unit and a table alternative
    for (const id of ['trend:5', 'scatter:3:5']) await expect(page.getByTestId(`chart-${id}`)).toBeVisible();
    const trend = page.getByTestId('chart-trend:5');
    await expect(trend).toContainText('of 402 rows');
    await expect(trend).toContainText('sum');
    await trend.locator('summary').click();
    await expect(trend.locator('table tbody tr').first()).toBeVisible();
    await expect(page.getByTestId('chart-scatter:3:5')).toContainText('Pearson is much lower than Spearman');
    // filter: Vilnius only
    await page.getByTestId('u-filter-col').selectOption('2');
    await page.getByTestId('u-filter-val').selectOption({ label: /Vilnius/ as never }).catch(async () => { await page.getByTestId('u-filter-val').selectOption({ index: 1 }); });
    await page.getByTestId('u-filter-add').click();
    const vil = truth.rows.filter((r) => r.region === 'Vilnius');
    await expect(page.getByTestId('u-scope')).toContainText(`Showing ${vil.length} of ${truth.rows.length} rows`);
    await expect(page.getByTestId('u-ov-rows')).toHaveText(n(vil.length));
    await expect(page.getByTestId('chart-trend:5')).toContainText(`of ${truth.rows.length} rows`);
    await expect(page.getByTestId('chart-trend:5')).toContainText('filters applied');
    const ref = refByRegion(vil);
    expect(Object.keys(ref)).toEqual(['Vilnius']);
    await page.getByTestId('u-filter-chips').getByRole('button').first().click();
    await expect(page.getByTestId('u-ov-rows')).toHaveText(n(truth.rows.length));
    expect(reqs.filter((r) => !isLocal(r.url(), baseURL!))).toEqual([]);
  });

  test('quality tables show the planted problems with sheet rows', async ({ page }) => {
    await start(page);
    await openView(page);
    await expect(page.getByTestId('u-outliers')).toContainText('15,000');
    const row = truth.rows.findIndex((r) => r.total === 15000) + 2;
    await expect(page.getByTestId('u-outliers')).toContainText(`#${row}`);
    await expect(page.getByTestId('u-missing')).toContainText('Nuolaida');
    await expect(page.getByTestId('u-duplicates')).toContainText('#');
    await expect(page.getByTestId('u-correlations')).toContainText('Outlier-sensitive');
    await expect(page.getByTestId('u-compare')).toContainText('Change is stated, not judged');
  });

  test('delete removes the table; PL and LT show no raw keys; mobile does not scroll sideways', async ({ page }) => {
    await start(page);
    await openView(page);
    for (const l of ['pl', 'lt']) {
      await page.getByTestId(`lang-${l}`).click();
      expect(await page.locator('main').innerText(), l).not.toMatch(/\b(uni|utype|uch|universal|rel)\.[a-zA-Z_]+/);
    }
    await page.getByTestId('lang-en').click();
    await page.setViewportSize({ width: 390, height: 800 });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(1);
    await page.getByTestId('u-delete').click();
    await expect(page.getByTestId('no-universal-data')).toBeVisible();
  });

  test('a file that was already imported is not imported twice by accident', async ({ page }) => {
    await start(page);
    await openView(page);
    await page.getByTestId('tab-import').click();
    await page.getByTestId('import-mode-universal').click();
    await page.getByTestId('u-file-input').setInputFiles(csv('copy.csv'));
    await page.getByTestId('u-mapping-table').waitFor();
    await expect(page.getByTestId('u-duplicate')).toContainText('orders.csv');
    await page.getByTestId('u-col-8').selectOption('numeric');
    await expect(page.getByTestId('u-confirm-import')).toBeDisabled();
  });
});
