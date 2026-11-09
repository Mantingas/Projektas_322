import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import { buildInventoryFixtures, type IFixture } from '../tests/fixtures/inventoryFormats';
import { END, valueAt } from '../tests/fixtures/inventory';
import { isLocal, trackRequests } from './helpers';

const eur = (n: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' }).format(n);
let fx: IFixture[] = [];
test.beforeAll(async () => { fx = await buildInventoryFixtures(); });
const get = (id: string) => fx.find((f) => f.id === id)!;
const file = (f: IFixture, over: { name?: string; text?: string } = {}) => ({ name: over.name ?? f.fileName, mimeType: 'text/csv', buffer: over.text !== undefined ? Buffer.from(over.text) : Buffer.from(f.bytes) });

async function pickFile(page: Page, f: ReturnType<typeof file>, opts: { mode?: string; asOf?: string; confirm?: boolean } = {}) {
  await page.getByTestId('tab-import').click();
  if (await page.getByTestId('import-result').count()) await page.getByRole('button', { name: 'Choose file' }).click();
  await page.getByTestId('file-input').setInputFiles(f);
  await page.getByTestId('mapping-table').waitFor();
  if (opts.asOf) await page.getByTestId('asof-input').fill(opts.asOf);
  if (await page.getByTestId('currency-select').count()) await page.getByTestId('currency-select').selectOption('EUR');
  if (opts.mode) await page.getByTestId('mode-select').selectOption(opts.mode);
  await expect(page.getByTestId('import-preview')).toBeVisible();
  if (opts.confirm) await page.getByTestId('confirm-checkbox').check();
}
async function commit(page: Page) {
  await page.getByTestId('confirm-import').click();
  await page.getByTestId('import-result').waitFor();
}
async function start(page: Page) {
  await page.goto('/app/');
  await page.getByTestId('lang-en').click();
}
/** snapshots (5 dates) + movements, then open the inventory view */
async function loadAll(page: Page) {
  await start(page);
  await pickFile(page, file(get('lt-snapshot-history')));
  await commit(page);
  await pickFile(page, file(get('lt-movements')));
  await commit(page);
  await page.getByTestId('view-insights').click();
  await page.getByTestId('kpi-i_value').waitFor();
}

test.describe('inventory: import recognises the data type and asks for what is missing', () => {
  test('historical snapshots: module and dataset type are recognised, fields mapped, min-stock and value kept', async ({ page }) => {
    await start(page);
    await pickFile(page, file(get('lt-snapshot-history')));
    await expect(page.getByTestId('module-inventory')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('inventory-kind')).toHaveAttribute('data-kind', 'history');
    await expect(page.getByTestId('inventory-kind')).toContainText('Historical snapshots');
    await expect(page.getByTestId('inventory-kind')).toContainText('5 snapshot dates');
    const rows = page.getByTestId('mapping-table').locator('tbody tr');
    await expect(rows.filter({ hasText: 'Likučio data' }).locator('select')).toHaveValue('snapshot_date');
    await expect(rows.filter({ hasText: 'Minimalus likutis' }).locator('select')).toHaveValue('min_stock');
    await expect(rows.filter({ hasText: 'Likučio vertė' }).locator('select')).toHaveValue('stock_value');
    const options = (await page.getByTestId('map-0').locator('option').allTextContents()).join('|');
    expect(options).toContain('Stock value');
    expect(options).not.toContain('Customer name');
    // from the file alone: value is supported, history-based metrics need movements – and the screen says so
    await expect(page.getByTestId('diag-metric-i_value')).toHaveAttribute('data-available', 'true');
    await expect(page.getByTestId('diag-metric-i_turnover')).toHaveAttribute('data-available', 'false');
    await expect(page.getByTestId('diag-metric-i_turnover')).toContainText('Needs a movement file');
  });

  test('movements file: type column read, signs normalised, unrecognised wording would be kept as unknown', async ({ page }) => {
    await start(page);
    await pickFile(page, file(get('lt-movements')));
    await expect(page.getByTestId('inventory-kind')).toHaveAttribute('data-kind', 'movements');
    await expect(page.getByTestId('diag-validation')).toContainText('Quantity sign set from the movement type');
    const rows = page.getByTestId('mapping-table').locator('tbody tr');
    await expect(rows.filter({ hasText: 'Judėjimo tipas' }).locator('select')).toHaveValue('movement_type');
    await expect(rows.filter({ hasText: 'Į sandėlį' }).locator('select')).toHaveValue('warehouse_to');
  });

  test('a balance without a date column cannot be confirmed until the as-of date is entered; without costs only quantity metrics are offered', async ({ page }) => {
    await start(page);
    const f = get('lt-snapshot-nodate');
    await page.getByTestId('file-input').setInputFiles(file(f));
    await page.getByTestId('mapping-table').waitFor();
    await expect(page.getByTestId('asof-input')).toBeVisible();
    await expect(page.getByTestId('confirm-import')).toBeDisabled();
    await expect(page.getByText('Enter the snapshot date to continue.')).toBeVisible();
    await page.getByTestId('asof-input').fill(END);
    await expect(page.getByTestId('inventory-kind')).toHaveAttribute('data-kind', 'snapshot');
    await expect(page.getByTestId('diag-metric-i_value')).toHaveAttribute('data-available', 'false');
    await expect(page.getByTestId('diag-metric-i_stockout')).toHaveAttribute('data-available', 'true');
    await page.getByTestId('confirm-import').click();
    await page.getByTestId('import-result').waitFor();
    await page.getByTestId('view-insights').click();
    await page.getByTestId('kpi-i_skus').waitFor();
    // value, turnover, slow-moving … are withheld, and each says why
    await expect(page.getByTestId('kpi-card-i_value')).toHaveCount(0);
    const hidden = page.locator('details', { hasText: 'Metrics not shown' });
    await hidden.locator('summary').click();
    await expect(hidden).toContainText('Cost or value is missing on too many lines');
    await expect(hidden).toContainText('Needs a movement file');
    await expect(page.getByTestId('limitations')).toContainText('No movement file is loaded');
    await expect(page.getByTestId('kpi-i_stockout')).toHaveText('1'); // below its minimum (from the file)
  });
});

test.describe('inventory: dashboard values reconcile with the independent calculation', () => {
  test('KPIs, previous snapshot, slow / non-moving value and stockout count', async ({ page }) => {
    await loadAll(page);
    await expect(page.getByTestId('inventory-view')).toBeVisible();
    const snaps = get('lt-snapshot-history').snaps;
    await expect(page.getByTestId('kpi-i_value')).toHaveText(eur(valueAt(snaps, END)));
    await expect(page.getByTestId('kpi-prev-i_value')).toHaveText(eur(valueAt(snaps, '2025-10-31')));
    await expect(page.getByTestId('kpi-i_nonmoving')).toHaveText(eur(4000)); // 500 × 8.00, no movement for 180 days
    await expect(page.getByTestId('kpi-i_slow')).toHaveText(eur(2500)); // 1000 × 2.50, > 180 days of cover
    await expect(page.getByTestId('kpi-i_stockout')).toHaveText('3');
    await expect(page.getByTestId('kpi-i_skus')).toHaveText('11');
    await expect(page.getByTestId('inv-asof')).toContainText('15/12/2025');
    // the quantity KPI is withheld because the stock mixes pieces, kg and g – and says so
    await expect(page.getByTestId('kpi-card-i_quantity')).toHaveCount(0);
  });

  test('drill-down: the lines behind the stock value add up to the KPI; filters change both consistently', async ({ page }) => {
    await loadAll(page);
    const snaps = get('lt-snapshot-history').snaps;
    await page.getByTestId('drill-i_value').click();
    await expect(page.getByTestId('drill-total')).toHaveText(eur(valueAt(snaps, END)));
    await expect(page.getByTestId('drill-drawer').locator('th', { hasText: 'Warehouse' })).toBeVisible();
    await expect(page.getByTestId('drill-drawer').locator('th', { hasText: 'Type' })).toBeVisible();
    await page.getByTestId('drill-close').click();
    // filter by warehouse through the picker
    await page.getByTestId('filter-warehouse').fill('Kaunas');
    await page.getByTestId('filter-warehouse').press('Enter');
    const kaunas = snaps.filter((s) => s.date === END && s.wh === 'Kaunas').reduce((s, x) => s + (x.value ?? 0), 0);
    await expect.poll(async () => page.getByTestId('kpi-i_value').count()).toBe(0); // 1 of 4 Kaunas lines has no cost → value withheld, never partial
    await page.getByTestId('filter-reset').click();
    await expect(page.getByTestId('kpi-i_value')).toHaveText(eur(valueAt(snaps, END)));
    void kaunas;
  });

  test('turnover and days on hand come from the movements, with the arithmetic explained', async ({ page }) => {
    await loadAll(page);
    await expect(page.getByTestId('kpi-i_turnover')).toBeVisible();
    await expect(page.getByTestId('kpi-i_doh')).toBeVisible();
    await page.getByTestId('kpi-card-i_turnover').getByRole('button', { name: 'How is this calculated?' }).click();
    await expect(page.getByTestId('kpi-card-i_turnover')).toContainText('transfers, adjustments and receipts are not counted');
  });
});

test.describe('inventory: insights, tables and charts', () => {
  test('the planted situations appear as insights with evidence, and nothing else', async ({ page }) => {
    await loadAll(page);
    await page.getByTestId('mode-analyst').click();
    const list = page.getByTestId('insight-list');
    for (const id of ['non_moving', 'slow_moving', 'stockout_risk', 'negative_stock', 'stock_inconsistent', 'valuation_anomaly', 'value_concentration']) {
      await expect(list.locator(`[data-insight-id="inventory.${id}"]`), id).toHaveCount(1);
    }
    await expect(list.locator('[data-insight-id="inventory.value_increase"]')).toHaveCount(0);
    await expect(list.locator('[data-insight-id="inventory.non_moving"]')).toContainText('Senos prekės');
    await expect(list.locator('[data-insight-id="inventory.non_moving"]')).toContainText(eur(4000));
    // no insight talks about savings: slow and excess stock are tied-up capital
    await expect(list.locator('[data-testid="savings-badge"]')).toHaveCount(0);
    await list.locator('[data-insight-id="inventory.stockout_risk"]').getByTestId('insight-details-btn').click();
    await expect(list.locator('[data-insight-id="inventory.stockout_risk"]').getByTestId('risk-table')).toBeVisible();
    await expect(list.locator('[data-insight-id="inventory.stockout_risk"]').getByTestId('insight-details')).toContainText('warning, not a forecast');
  });

  test('slow-moving and stockout tables, ABC, flows (transfers not counted), reconciliation and the data-used panel', async ({ page }) => {
    await loadAll(page);
    await page.getByTestId('mode-analyst').click();
    const slow = page.getByTestId('slow-table').first();
    await expect(slow.locator('[data-testid="slow-row"][data-state="non_moving"]')).toContainText('Senos prekės');
    await expect(slow.locator('[data-testid="slow-row"][data-state="slow"]')).toContainText('Skardinės');
    const risk = page.getByTestId('risk-table').first();
    await expect(risk.locator('[data-reason="below_min"]')).toContainText('Sūris');
    await expect(risk.locator('[data-reason="low_cover"]')).toContainText('Sviestas');
    await expect(risk.locator('[data-reason="out_of_stock"]')).toContainText('Sultys');
    await expect(page.getByTestId('abc-card')).toBeVisible();
    await expect(page.getByTestId('flow-transfers')).toContainText('Transfers (not counted)');
    await expect(page.getByTestId('recon-table')).toContainText('Kava 250 g');
    await expect(page.getByTestId('recon-row').first()).toContainText('-7');
    await expect(page.getByTestId('inv-sources')).toContainText('Historical snapshots');
    await expect(page.getByTestId('inv-sources')).toContainText('Inventory movements');
    // a slow-moving row opens the exact stock lines
    await slow.locator('[data-testid="slow-row"][data-state="slow"] button').click();
    await expect(page.getByTestId('drill-total')).toHaveText(eur(2500));
    await page.keyboard.press('Escape');
    // charts supported by the data
    for (const id of ['trend', 'warehouses', 'movements']) await expect(page.getByTestId(`chart-${id}`).first()).toBeVisible();
    await page.getByTestId('chart-trend').locator('summary').click();
    await expect(page.getByTestId('chart-trend').locator('tbody tr')).toHaveCount(5);
  });

  test('metric unit policy is explicit; sugar in kg and g joins only when switched on', async ({ page }) => {
    await loadAll(page);
    await expect(page.getByTestId('limitations')).toContainText('1 items with stock do not appear in the movement file');
    await page.getByTestId('unit-metric').check();
    await expect(page.getByTestId('limitations')).toContainText('Exact metric conversions');
    await expect(page.getByTestId('limitations')).not.toContainText('do not appear in the movement file');
    await page.getByTestId('unit-strict').check();
    await expect(page.getByTestId('limitations')).not.toContainText('Exact metric conversions');
  });
});

test.describe('inventory: import safety, reports and privacy', () => {
  test('a conflicting snapshot is held; the conflict review shows it as inventory; the dashboard changes only when the user decides', async ({ page }) => {
    await loadAll(page);
    const f = get('lt-snapshot-history');
    const text = Buffer.from(f.bytes).toString('utf8').split('\r\n').map((l) => (l.startsWith(`${END};Vilnius;P01;`) ? l.replace(';600;', ';500;').replace(';480,00;', ';400,00;') : l)).join('\r\n');
    await pickFile(page, file(f, { name: 'likuciai_pataisyti.csv', text }), { mode: 'unknown' });
    await expect(page.getByTestId('pv-held')).toBeVisible();
    await commit(page);
    await expect(page.getByTestId('stat-held')).not.toHaveText('0');
    await page.getByTestId('review-conflicts').click();
    await expect(page.getByTestId('cr-module')).toHaveText('Inventory');
    await expect(page.getByTestId('cr-stored')).toContainText('480.00');
    await expect(page.getByTestId('cr-held')).toContainText('400.00');
    await page.getByTestId('tab-insights').click();
    await page.getByTestId('module-view-inventory').click();
    const snaps = f.snaps;
    await expect(page.getByTestId('kpi-i_value')).toHaveText(eur(valueAt(snaps, END)));
    await expect(page.getByTestId('limitations')).toContainText('are held for your review and are NOT included in any figure');
    await page.getByTestId('tab-history').click();
    await page.getByTestId('cr-use-new').first().click();
    await page.getByTestId('tab-insights').click();
    await expect(page.getByTestId('kpi-i_value')).toHaveText(eur(valueAt(snaps, END) - 80));
  });

  test('the management summary and the CSV are produced locally, escaped, without scripts', async ({ page }) => {
    await loadAll(page);
    const [html] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-html').click()]);
    const body = fs.readFileSync(await html.path(), 'utf8');
    expect(body).toContain('Inventory management summary');
    expect(body).not.toMatch(/<script/i);
    expect(body).toContain('Senos prekės');
    expect(body).toContain('capital tied up, not losses');
    const [csv] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv').click()]);
    const c = fs.readFileSync(await csv.path(), 'utf8');
    expect(c).toContain('Senos prekės');
  });

  test('no business data leaves the browser while importing and analysing stock', async ({ page }) => {
    const reqs = trackRequests(page);
    await loadAll(page);
    await page.getByTestId('mode-analyst').click();
    await page.getByTestId('chart-movements').waitFor();
    const origin = new URL(page.url()).origin;
    expect(reqs.filter((r) => !isLocal(r.url(), origin)).map((r) => r.url())).toEqual([]);
    expect(reqs.filter((r) => r.method() !== 'GET' && r.method() !== 'HEAD').map((r) => r.url())).toEqual([]);
  });

  test('inventory, sales and purchasing keep separate histories; the module switch keeps all three', async ({ page }) => {
    await loadAll(page);
    await page.getByTestId('tab-import').click();
    await page.getByRole('button', { name: 'Choose file' }).click();
    await page.getByTestId('file-input').setInputFiles('public/samples/sample_lt_pirkimai.csv');
    await page.getByTestId('mapping-table').waitFor();
    await expect(page.getByTestId('module-purchasing')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('confirm-import').click();
    await page.getByTestId('import-result').waitFor();
    await page.getByTestId('view-insights').click();
    await page.getByTestId('kpi-p_spend').waitFor();
    await page.getByTestId('module-view-inventory').click();
    await page.getByTestId('kpi-i_value').waitFor();
    await page.getByTestId('tab-history').click();
    await expect(page.getByTestId('history-table').locator('[data-testid="hist-module"]')).toHaveCount(3);
  });
});

test.describe('inventory: layout and languages', () => {
  test('mobile width: no horizontal scrolling in either mode', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await loadAll(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.getByTestId('mode-analyst').click();
    await page.getByTestId('slow-table').first().waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });

  test('Polish and Lithuanian interfaces show no untranslated inventory keys', async ({ page }) => {
    await loadAll(page);
    for (const l of ['pl', 'lt'] as const) {
      await page.getByTestId(`lang-${l}`).click();
      await page.getByTestId('mode-analyst').click();
      await page.getByTestId('slow-table').first().waitFor();
      const text = await page.getByTestId('inventory-view').innerText();
      expect(text).not.toMatch(/\b(inv|ich|abc|sl|st|rk|fl|rc|irule|iunavail|inventory|mt|ian|irep|lim|metric|explain|mu)\.[a-z_]+/);
    }
    await page.getByTestId('lang-pl').click();
    await expect(page.getByTestId('kpi-card-i_nonmoving')).toContainText('Wartość nierotujących zapasów');
    await page.getByTestId('lang-lt').click();
    await expect(page.getByTestId('kpi-card-i_nonmoving')).toContainText('Nejudančių atsargų vertė');
  });
});
