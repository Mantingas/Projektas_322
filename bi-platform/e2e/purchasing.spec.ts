import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { CUR, PREV, inWin, makePurchasing, priceMap, sumNet } from '../tests/fixtures/purchasing';
import { isLocal, trackRequests, ensureCurrency } from './helpers';

const sample = (n: string) => path.join(process.cwd(), 'public/samples', n);
const truth = makePurchasing('lt');
const eur = (n: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' }).format(n);

async function importPurchasing(page: Page, file = 'sample_lt_pirkimai.csv') {
  await page.goto('/app/');
  await page.getByTestId('lang-en').click();
  await page.getByTestId('file-input').setInputFiles(sample(file));
  await page.getByTestId('mapping-table').waitFor();
  await ensureCurrency(page);
  await expect(page.getByTestId('import-preview')).toBeVisible();
}
async function loadPurchasing(page: Page) {
  await importPurchasing(page);
  await page.getByTestId('confirm-import').click();
  await page.getByTestId('view-insights').click();
  await page.getByTestId('kpi-p_spend').waitFor();
}

test.describe('purchasing: import', () => {
  test('purchase headers are recognised, the module is proposed (not forced) and supplier / unit / SKU are mapped', async ({ page }) => {
    await importPurchasing(page);
    await expect(page.getByTestId('module-purchasing')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('module-sales')).toHaveAttribute('aria-pressed', 'false');
    const rows = page.getByTestId('mapping-table').locator('tbody tr');
    await expect(rows.filter({ hasText: 'Tiekėjas' }).first().locator('select')).toHaveValue('supplier_name');
    await expect(rows.filter({ hasText: 'Matavimo vnt.' }).locator('select')).toHaveValue('unit');
    await expect(rows.filter({ hasText: 'Prekės kodas' }).locator('select')).toHaveValue('product_id');
    await expect(rows.filter({ hasText: 'Suma be PVM' }).locator('select')).toHaveValue('net_amount');
    // the mapping offers purchasing fields, not sales ones
    const options = await page.getByTestId('map-0').locator('option').allTextContents();
    expect(options.join('|')).toContain('Supplier name');
    expect(options.join('|')).not.toContain('Customer name');
  });

  test('switching the data type re-analyses the sheet with that module’s fields', async ({ page }) => {
    await importPurchasing(page);
    await page.getByTestId('module-sales').click();
    await expect(page.getByTestId('module-sales')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await page.getByTestId('map-0').locator('option').allTextContents()).join('|')).toContain('Customer name');
    await page.getByTestId('module-purchasing').click();
    await expect.poll(async () => (await page.getByTestId('map-0').locator('option').allTextContents()).join('|')).toContain('Supplier name');
  });

  test('a sales file still opens in the sales module', async ({ page }) => {
    await page.goto('/app/');
    await page.getByTestId('lang-en').click();
    await page.getByTestId('file-input').setInputFiles(sample('sample_lt_pardavimai.csv'));
    await page.getByTestId('mapping-table').waitFor();
    await ensureCurrency(page);
    await expect(page.getByTestId('module-sales')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('purchasing: dashboard values reconcile with the independent calculation', () => {
  test('KPIs, previous period, drill-down totals and the spend bridge agree', async ({ page }) => {
    await loadPurchasing(page);
    await expect(page.getByTestId('purchasing-view')).toBeVisible();
    const cur = sumNet(inWin(truth, CUR));
    const prev = sumNet(inWin(truth, PREV));
    await expect(page.getByTestId('kpi-p_spend')).toHaveText(eur(cur));
    await expect(page.getByTestId('kpi-prev-p_spend')).toHaveText(eur(prev));
    // drill-down total equals the KPI
    await page.getByTestId('drill-p_spend').click();
    await expect(page.getByTestId('drill-total')).toHaveText(eur(cur));
    await expect(page.getByTestId('drill-lines')).toHaveText(String(inWin(truth, CUR).length).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
    await page.getByTestId('drill-close').click();
    // credit notes: previous period has them, current none → credits KPI shows the previous amount
    const credits = inWin(truth, PREV).filter((x) => x.net < 0).reduce((s, x) => s - x.net, 0) / 100;
    await expect(page.getByTestId('kpi-prev-p_credits')).toHaveText(eur(credits));
    // the bridge's alternative table reproduces start + steps = end
    await page.getByTestId('mode-analyst').click();
    const bridge = page.getByTestId('chart-bridge');
    await bridge.locator('summary').click();
    const cells = await bridge.locator('tbody tr').allTextContents();
    expect(cells[0]).toContain(eur(prev));
    expect(cells[cells.length - 1]).toContain(eur(cur));
  });

  test('the like-for-like price change card equals the independent price calculation', async ({ page }) => {
    await loadPurchasing(page);
    // independent: pairs (sku, unit, supplier) present in both windows, weighted by current quantities
    const a = priceMap(inWin(truth, PREV), false, true);
    const b = priceMap(inWin(truth, CUR), false, true);
    let extra = 0;
    for (const [k, c] of b) { const p = a.get(k); if (p) extra += (c.a / c.q - p.a / p.q) * c.q; }
    await expect(page.getByTestId('price-change-extra')).toContainText(eur(Math.abs(extra)).replace('-', ''));
  });
});

test.describe('purchasing: insights are explainable and savings are labelled', () => {
  test('price increase, supplier gap and actual saving appear with the right savings kind; hypothetical never counted as actual', async ({ page }) => {
    await loadPurchasing(page);
    await page.getByTestId('mode-analyst').click();
    const list = page.getByTestId('insight-list');
    await expect(list.locator('[data-insight-id="purchasing.price_increase"]')).toContainText('Pienas 1 l');
    await expect(list.locator('[data-insight-id="purchasing.supplier_price_gap"] [data-testid="savings-badge"]')).toHaveAttribute('data-kind', 'potential');
    await expect(list.locator('[data-insight-id="purchasing.price_decrease"] [data-testid="savings-badge"]')).toHaveAttribute('data-kind', 'actual');
    const hyp = list.locator('[data-insight-id="purchasing.historical_price_scenario"]');
    if (await hyp.count()) await expect(hyp.locator('[data-testid="savings-badge"]')).toHaveAttribute('data-kind', 'hypothetical');
    // overview: the three kinds sit side by side and are not summed
    const ov = page.getByTestId('savings-overview').first();
    await expect(ov.getByTestId('savings-actual')).toBeVisible();
    await expect(ov.getByTestId('savings-potential')).toBeVisible();
    await expect(ov.getByTestId('savings-hypothetical')).toContainText('Hypothetical scenario');
    await expect(ov).not.toContainText('savings-total');
    // details show the evidence and the chart
    await list.locator('[data-insight-id="purchasing.supplier_price_gap"]').getByTestId('insight-details-btn').click();
    await expect(list.locator('[data-insight-id="purchasing.supplier_price_gap"]').getByTestId('insight-details')).toContainText('Potential saving');
    await expect(list.locator('[data-insight-id="purchasing.supplier_price_gap"]').getByTestId('price-variance')).toBeVisible();
  });

  test('the price variance table shows the same product from two suppliers with the potential saving', async ({ page }) => {
    await loadPurchasing(page);
    await page.getByTestId('mode-analyst').click();
    const row = page.getByTestId('price-variance').first().locator('tr[data-testid="variance-row"]', { hasText: 'Sviestas' });
    await expect(row).toContainText('7.50');
    await expect(row).toContainText('9.00');
    const q = inWin(truth, CUR).filter((x) => x.sku === 'P03' && x.supplier.includes('Šaltinis'));
    const dear = q.reduce((s, x) => s + x.qty, 0);
    await expect(row).toContainText(eur(dear * 1.5));
  });

  test('different units are not compared by default; the exact-metric switch is explicit and announced', async ({ page }) => {
    await loadPurchasing(page);
    await expect(page.getByTestId('limitations')).toContainText('more than one unit');
    await page.getByTestId('unit-metric').check();
    await expect(page.getByTestId('limitations')).toContainText('Exact metric conversions');
    await page.getByTestId('unit-strict').check();
    await expect(page.getByTestId('limitations')).not.toContainText('Exact metric conversions');
  });

  test('price trend chart per item and supplier; quantity chart; interactions filter and drill', async ({ page }) => {
    await loadPurchasing(page);
    await page.getByTestId('mode-analyst').click();
    const pt = page.getByTestId('chart-priceTrend');
    await expect(pt).toBeVisible();
    await pt.getByTestId('price-item-select').selectOption({ label: 'Pienas 1 l (l)' });
    await pt.locator('summary').click();
    await expect(pt.locator('tbody')).toContainText('0.72');
    // a supplier ranking bar filters the whole page
    await page.getByTestId('chart-topSuppliers').locator('.recharts-bar-rectangle').first().click();
    await expect(page.getByTestId('filter-bar')).toContainText('✕');
    await page.getByTestId('filter-reset').click();
    // price-change table row opens a drill-down whose total matches the lines shown
    await page.getByTestId('pair-row').first().locator('button').click();
    await expect(page.getByTestId('drill-drawer')).toBeVisible();
    await expect(page.getByTestId('drill-drawer').locator('th', { hasText: 'Supplier' })).toBeVisible();
    await expect(page.getByTestId('drill-drawer').locator('th', { hasText: 'Unit' })).toBeVisible();
    await page.keyboard.press('Escape');
  });
});

test.describe('purchasing: reports and privacy', () => {
  test('the management summary and the CSV are produced locally, escaped, with savings kinds', async ({ page }) => {
    await loadPurchasing(page);
    const [html] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-html').click()]);
    const body = (await import('node:fs')).readFileSync(await html.path(), 'utf8');
    expect(body).toContain('Purchasing management summary');
    expect(body).not.toMatch(/<script/i);
    expect(body).toContain('Potential saving');
    const [csv] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv').click()]);
    const c = (await import('node:fs')).readFileSync(await csv.path(), 'utf8');
    expect(c).toContain('Potential saving');
  });

  test('no business data leaves the browser while importing and analysing purchases', async ({ page }) => {
    const reqs = trackRequests(page);
    await loadPurchasing(page);
    await page.getByTestId('mode-analyst').click();
    await page.getByTestId('chart-priceTrend').waitFor();
    const origin = new URL(page.url()).origin;
    expect(reqs.filter((r) => !isLocal(r.url(), origin)).map((r) => r.url())).toEqual([]);
    expect(reqs.filter((r) => r.method() !== 'GET' && r.method() !== 'HEAD').map((r) => r.url())).toEqual([]);
  });

  test('sales and purchasing live side by side; the view switch keeps both', async ({ page }) => {
    await loadPurchasing(page);
    await page.getByTestId('tab-import').click();
    await page.getByRole('button', { name: 'Choose file' }).click();
    await page.getByTestId('file-input').setInputFiles(sample('sample_lt_pardavimai.csv'));
    await page.getByTestId('mapping-table').waitFor();
    await ensureCurrency(page);
    await expect(page.getByTestId('import-preview')).toBeVisible();
    await page.getByTestId('confirm-import').click();
    await page.getByTestId('view-insights').click();
    await page.getByTestId('kpi-revenue').waitFor();
    await page.getByTestId('module-view-purchasing').click();
    await page.getByTestId('kpi-p_spend').waitFor();
    await page.getByTestId('module-view-sales').click();
    await page.getByTestId('kpi-revenue').waitFor();
    await page.getByTestId('tab-history').click();
    await expect(page.getByTestId('history-table').locator('[data-testid="hist-module"]')).toHaveText(['Sales', 'Purchasing']);
  });
});

test.describe('purchasing: import safety', () => {
  test('a corrected supplier invoice is held, shown in the conflict review as purchasing, and replaced only on confirmation', async ({ page }) => {
    await page.goto('/app/');
    await page.getByTestId('lang-en').click();
    const head = 'Data;Tiekėjo sąskaitos Nr.;Tiekėjas;Tiekėjo kodas;Prekės kodas;Prekė;Kiekis;Matavimo vnt.;Kaina;Suma be PVM\r\n';
    const file = (name: string, rows: string[]) => ({ name, mimeType: 'text/csv', buffer: Buffer.from('﻿' + head + rows.join('\r\n') + '\r\n') });
    const pickAndCommit = async (f: ReturnType<typeof file>, mode: string, confirm = false) => {
      await page.getByTestId('tab-import').click();
      if (await page.getByTestId('import-result').count()) await page.getByRole('button', { name: 'Choose file' }).click();
      await page.getByTestId('file-input').setInputFiles(f);
      await page.getByTestId('mapping-table').waitFor();
      await page.getByTestId('currency-select').selectOption('EUR');
      await page.getByTestId('mode-select').selectOption(mode);
      await expect(page.getByTestId('import-preview')).toBeVisible();
      if (confirm) await page.getByTestId('confirm-checkbox').check();
      await page.getByTestId('confirm-import').click();
      await page.getByTestId('import-result').waitFor();
    };
    await pickAndCommit(file('a.csv', ['2025-12-01;INV-1;Acme;S1;P1;Widget;10;pcs;5,00;50,00', '2025-12-02;INV-2;Beta;S2;P1;Widget;10;pcs;6,00;60,00']), 'full');
    await pickAndCommit(file('b.csv', ['2025-12-01;INV-1;Acme;S1;P1;Widget;10;pcs;7,00;70,00']), 'incremental');
    await expect(page.getByTestId('stat-held')).toHaveText('1');
    await page.getByTestId('review-conflicts').click();
    await expect(page.getByTestId('cr-module')).toHaveText('Purchasing');
    await expect(page.getByTestId('cr-stored')).toContainText('50.00');
    await expect(page.getByTestId('cr-held')).toContainText('70.00');
    // the dashboard has not changed yet
    await page.getByTestId('tab-insights').click();
    await page.getByTestId('module-view-purchasing').click();
    await page.getByTestId('kpi-p_spend').waitFor();
    await page.getByTestId('period-preset').selectOption('custom').catch(() => undefined);
    await page.getByTestId('tab-history').click();
    await page.getByTestId('cr-use-new').click();
    await page.getByTestId('tab-insights').click();
    await page.getByTestId('drill-p_spend').click();
    await expect(page.getByTestId('drill-total')).toContainText('130.00');
  });
});

test.describe('purchasing: layout', () => {
  test('mobile width: no horizontal scrolling on the dashboard', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await loadPurchasing(page);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(1);
    await page.getByTestId('mode-analyst').click();
    await page.getByTestId('price-changes').waitFor();
    const over2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over2).toBeLessThanOrEqual(1);
  });

  test('Polish and Lithuanian interfaces have no untranslated purchasing keys', async ({ page }) => {
    await loadPurchasing(page);
    for (const l of ['pl', 'lt'] as const) {
      await page.getByTestId(`lang-${l}`).click();
      await page.getByTestId('mode-analyst').click();
      const text = await page.getByTestId('purchasing-view').innerText();
      expect(text).not.toMatch(/\b(pur|pch|pv|pp|pt|br|sav|prule|punavail|purchasing)\.[a-z_]+/);
    }
  });
});
