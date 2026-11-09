import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { makeTruth } from '../tests/fixtures/truth';
import { isLocal, trackRequests } from './helpers';

const sample = (n: string) => path.join(process.cwd(), 'public/samples', n);
const truth = makeTruth('lt');
const eur = (cents: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const inRange = (from: string, to: string) => truth.filter((t) => t.date >= from && t.date <= to);
const sumNet = (rows: typeof truth) => rows.reduce((s, t) => s + t.net, 0);
const R30 = { from: '2025-11-16', to: '2025-12-15' };

async function loadDashboard(page: Page) {
  await page.goto('/app/');
  await page.getByTestId('lang-en').click();
  await page.getByTestId('file-input').setInputFiles(sample('sample_lt_ataskaita.xlsx'));
  await page.getByTestId('mapping-table').waitFor();
  await page.getByTestId('confirm-import').click();
  await page.getByTestId('view-insights').click();
  await page.getByTestId('kpi-revenue').waitFor();
}

test('KPIs equal an independent calculation from the ground truth (Manager mode)', async ({ page }) => {
  await loadDashboard(page);
  const cur = inRange(R30.from, R30.to);
  const prev = inRange('2025-10-17', '2025-11-15');
  await expect(page.getByTestId('kpi-revenue')).toHaveText(eur(sumNet(cur)));
  await expect(page.getByTestId('kpi-prev-sales')).toHaveText(eur(sumNet(prev)));
  const orders = (rows: typeof truth) => { const m = new Map<string, number>(); rows.forEach((t) => m.set(t.doc, (m.get(t.doc) ?? 0) + t.net)); return [...m.values()].filter((v) => v > 0).length; };
  await expect(page.getByTestId('kpi-orders')).toHaveText(String(orders(cur)));
  const cust = (rows: typeof truth) => { const m = new Map<string, number>(); rows.forEach((t) => m.set(t.customer, (m.get(t.customer) ?? 0) + t.net)); return [...m.values()].filter((v) => v > 0).length; };
  await expect(page.getByTestId('kpi-customers')).toHaveText(String(cust(cur)));
  await expect(page.getByTestId('manager-summary')).toContainText('Net sales');
  await expect(page.getByTestId('list-risk')).toBeVisible();
  expect(await page.getByTestId('insight').count()).toBeGreaterThan(2);
  // KPI explanation is available and mentions the line count
  await page.getByTestId('kpi-card-sales').getByText('How is this calculated?').click();
  await expect(page.getByTestId('kpi-card-sales')).toContainText(String(cur.length));
});

test('partial periods are flagged; comparing against the whole previous period needs an explicit choice and warns', async ({ page }) => {
  await loadDashboard(page);
  await page.getByTestId('period-preset').selectOption('mom');
  await expect(page.getByTestId('period-warnings')).toContainText('incomplete: 15 of 31 days');
  const cur = inRange('2025-12-01', '2025-12-15');
  const prevLike = inRange('2025-11-01', '2025-11-15');
  await expect(page.getByTestId('kpi-revenue')).toHaveText(eur(sumNet(cur)));
  await expect(page.getByTestId('kpi-prev-sales')).toHaveText(eur(sumNet(prevLike)));
  await page.getByTestId('full-previous').check();
  await expect(page.getByTestId('period-warnings')).toContainText('WARNING');
  await expect(page.getByTestId('kpi-prev-sales')).toHaveText(eur(sumNet(inRange('2025-11-01', '2025-11-30'))));
  // other presets resolve
  for (const p of ['dod', 'wow', 'r7', 'r90', 'yoy', 'r30']) {
    await page.getByTestId('period-preset').selectOption(p);
    await expect(page.getByTestId('period-describe')).toBeVisible();
  }
  // yoy has no data a year earlier → no change is fabricated
  await page.getByTestId('period-preset').selectOption('yoy');
  await expect(page.getByTestId('period-warnings')).toContainText('no data in the previous period');
  await expect(page.getByTestId('kpi-change-sales')).toContainText('No comparison possible');
});

test('custom periods', async ({ page }) => {
  await loadDashboard(page);
  await page.getByTestId('period-preset').selectOption('custom');
  await page.getByLabel('Current From').fill('2025-10-01');
  await page.getByLabel('Current To').fill('2025-10-31');
  await page.getByLabel('Previous From').fill('2025-09-01');
  await page.getByLabel('Previous To').fill('2025-09-30');
  await expect(page.getByTestId('kpi-revenue')).toHaveText(eur(sumNet(inRange('2025-10-01', '2025-10-31'))));
  await expect(page.getByTestId('period-warnings')).toContainText('different lengths');
});

test('filters change KPIs, charts and tables consistently; drill-down explains the KPI', async ({ page }) => {
  await loadDashboard(page);
  const name = truth[0]!.customer;
  const rows = inRange(R30.from, R30.to).filter((t) => t.customer === name);
  await page.getByTestId('filter-customer').fill(name);
  await page.getByTestId('filter-customer').press('Enter');
  await expect(page.getByTestId('kpi-revenue')).toHaveText(eur(sumNet(rows)));
  await expect(page.getByTestId('limitations')).toContainText('Filters are active');
  // drill-down total == KPI, line count == independent count
  await page.getByTestId('drill-sales').click();
  await expect(page.getByTestId('drill-total')).toHaveText(eur(sumNet(rows)));
  await expect(page.getByTestId('drill-lines')).toHaveText(String(rows.length));
  await expect(page.getByTestId('drill-drawer')).toContainText('sample_lt_ataskaita.xlsx');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('drill-drawer')).toHaveCount(0);
  await page.getByTestId('filter-reset').click();
  await expect(page.getByTestId('kpi-revenue')).toHaveText(eur(sumNet(inRange(R30.from, R30.to))));
});

test('single-product filter unlocks average selling price; it is hidden otherwise', async ({ page }) => {
  await loadDashboard(page);
  await expect(page.getByTestId('kpi-card-asp')).toHaveCount(0);
  const prod = truth[0]!.product;
  await page.getByTestId('filter-product').fill(prod);
  await page.getByTestId('filter-product').press('Enter');
  const rows = inRange(R30.from, R30.to).filter((t) => t.product === prod);
  const asp = sumNet(rows) / 100 / rows.reduce((s, t) => s + t.qty, 0);
  await expect(page.getByTestId('kpi-asp')).toHaveText(new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' }).format(asp));
});

test('Analyst mode: all charts, sortable/searchable/paged tables, CSV export, row drill-down', async ({ page }) => {
  await loadDashboard(page);
  await page.getByTestId('mode-analyst').click();
  for (const id of ['trend', 'comparison', 'topCustomers', 'topProducts', 'category', 'waterfall', 'pareto']) await expect(page.getByTestId(`chart-${id}`).first()).toBeVisible();
  await expect(page.getByTestId('chart-salespeople')).toHaveCount(0); // no salesperson column in this file → no meaningless chart
  await page.getByTestId('chart-pareto').getByText('Show as table').click();
  await expect(page.getByTestId('chart-pareto').locator('table tbody tr').first()).toBeVisible();
  await expect(page.getByTestId('methodology')).toBeVisible();

  const table = page.getByTestId('table-customer');
  await expect(table.getByTestId('row-customer')).toHaveCount(10);
  await expect(page.getByTestId('table-page-customer')).toContainText('Page 1 of 3');
  await table.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('table-page-customer')).toContainText('Page 2 of 3');
  await table.getByTestId('table-search-customer').fill('baltic');
  await expect(table.getByTestId('row-customer')).toHaveCount(1);
  await table.getByTestId('table-search-customer').fill('');
  await table.getByRole('button', { name: 'Name' }).click(); // sort by name
  const names = await table.getByTestId('row-customer').locator('td:first-child').allTextContents();
  expect(names.length).toBe(10);
  expect(names).toEqual([...names].sort(new Intl.Collator('en-GB', { sensitivity: 'base', numeric: true }).compare).reverse());
  // drill from a row = row value
  const first = table.getByTestId('row-customer').first();
  const label = (await first.locator('td').first().textContent())!;
  const cur = inRange(R30.from, R30.to).filter((t) => t.customer === label);
  await first.getByTestId('row-drill-customer').click();
  await expect(page.getByTestId('drill-total')).toHaveText(eur(sumNet(cur)));
  await page.keyboard.press('Escape');
  // CSV export is formula-safe and has all rows
  const [dl] = await Promise.all([page.waitForEvent('download'), table.getByTestId('table-export-customer').click()]);
  const csv = fs.readFileSync((await dl.path())!, 'utf8');
  expect(csv.split('\r\n').filter(Boolean).length).toBe(25); // header + 24 customers
  for (const cell of csv.split(/[;\r\n]/)) expect(/^[=+\-@]/.test(cell.replace('﻿', '')) && !/^[+-]?\d/.test(cell)).toBe(false);
});

test('clicking a chart bar filters the whole dashboard', async ({ page }) => {
  await loadDashboard(page);
  await page.getByTestId('mode-analyst').click();
  await page.getByTestId('chart-topCustomers').locator('.recharts-bar-rectangle').first().click();
  await expect(page.getByTestId('filter-bar').getByRole('button', { name: /^Remove/ })).toHaveCount(1);
  await expect(page.getByTestId('limitations')).toContainText('Filters are active');
});

test('insight details: contributors, why, action, sufficiency, chart, association caveat, records', async ({ page }) => {
  await loadDashboard(page);
  const card = page.locator('[data-insight-id="sales.customers_declined"]');
  await card.getByTestId('insight-details-btn').click();
  const d = card.getByTestId('insight-details');
  for (const s of ['What changed', 'How much', 'Contributing entities', 'Why it matters', 'Suggested action', 'Data sufficiency', 'Relevant chart', 'not proven causes']) await expect(d).toContainText(s);
  await expect(d.getByTestId('chart-waterfall')).toBeVisible();
  await d.getByRole('button', { name: 'View records' }).first().click();
  await expect(page.getByTestId('drill-drawer')).toBeVisible();
  await expect(page.getByTestId('drill-lines')).not.toHaveText('0');
});

test('management summary is a readable, self-contained, script-free document', async ({ page, browser }) => {
  await loadDashboard(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-html').click()]);
  const html = fs.readFileSync((await dl.path())!, 'utf8');
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/https?:\/\//);
  for (const s of ['Sales management summary', 'KPI comparison', 'Data limitations', 'Methodology', '<svg', 'not proven causes', 'Net sales']) expect(html).toContain(s);
  expect(html).toContain(eur(sumNet(inRange(R30.from, R30.to))));
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  const requests = trackRequests(p2);
  await p2.setContent(html);
  const pdf = await p2.pdf({ format: 'A4', printBackground: true });
  expect(pdf.length).toBeGreaterThan(20_000);
  fs.writeFileSync(path.join(process.cwd(), 'test-results', 'management-summary.pdf'), pdf);
  await p2.screenshot({ path: path.join(process.cwd(), 'test-results', 'management-summary.png'), fullPage: true });
  expect(requests.filter((r) => !r.url().startsWith('data:') && !r.url().startsWith('about:'))).toEqual([]);
  await ctx.close();
});

test('localisation: PL and LT dashboards have no untranslated keys', async ({ page }) => {
  await loadDashboard(page);
  for (const [lang, word] of [['pl', 'Sprzedaż netto'], ['lt', 'Pardavimai be PVM']] as const) {
    await page.getByTestId(`lang-${lang}`).click();
    await expect(page.getByTestId('kpi-card-sales')).toContainText(word);
    await page.getByTestId('mode-analyst').click();
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/\b(ins|kpi|ch|tbl|per|pw|mgr|lim|rep|drill|flt|an|mu|explain|metric|dash|sales|rule|unavail|dim|dim1)\.[a-z_0-9]+/);
    await page.getByTestId('mode-manager').click();
  }
});

test('no business data leaves the browser during dashboard use', async ({ page }) => {
  const reqs = trackRequests(page);
  await loadDashboard(page);
  await page.getByTestId('mode-analyst').click();
  await page.getByTestId('drill-sales').click();
  await page.keyboard.press('Escape');
  await page.getByTestId('period-preset').selectOption('mom');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-html').click()]);
  await dl.path();
  const origin = new URL(page.url()).origin;
  expect(reqs.filter((r) => !isLocal(r.url(), origin)).map((r) => r.url())).toEqual([]);
  expect(reqs.filter((r) => r.method() !== 'GET' && r.method() !== 'HEAD')).toHaveLength(0);
  expect(reqs.filter((r) => r.url().includes('?') && /customer|amount|sum/i.test(r.url()))).toHaveLength(0);
});

test('mobile layout has no horizontal overflow and keeps controls usable', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await loadDashboard(page);
  for (const mode of ['manager', 'analyst'] as const) {
    await page.getByTestId(`mode-${mode}`).click();
    await page.waitForTimeout(300);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over, `${mode} overflow`).toBeLessThanOrEqual(1);
  }
  await page.getByTestId('mode-manager').click();
  await page.screenshot({ path: path.join(process.cwd(), 'test-results', 'mobile-manager.png'), fullPage: false });
  await ctx.close();
});

test.describe('imports: overlap, corrections and missing identifiers (UI)', () => {
  const head = 'Data;Dokumento Nr.;Klientas;Prekė;Kiekis;Suma be PVM\r\n';
  const file = (name: string, rows: string[]) => ({ name, mimeType: 'text/csv', buffer: Buffer.from('﻿' + head + rows.join('\r\n') + '\r\n') });
  async function pick(page: Page, f: ReturnType<typeof file>) {
    await page.getByTestId('tab-import').click();
    if (await page.getByTestId('import-result').count()) await page.getByRole('button', { name: 'Choose file' }).click();
    await page.getByTestId('file-input').setInputFiles(f);
    await page.getByTestId('mapping-table').waitFor();
    await page.getByTestId('currency-select').selectOption('EUR');
    await page.getByTestId('mode-select').selectOption('full');
  }
  test('a corrected invoice replaces the old line once and is reported; revenue is exact', async ({ page }) => {
    await page.goto('/app/');
    await page.getByTestId('lang-en').click();
    await pick(page, file('a.csv', ['2025-03-01;INV-1;Acme;Widget;1;100,00', '2025-03-01;INV-1;Acme;Gadget;1;50,00', '2025-03-02;INV-2;Beta;Widget;1;70,00']));
    await page.getByTestId('confirm-import').click();
    await expect(page.getByTestId('stat-added')).toHaveText('3');
    await pick(page, file('b.csv', ['2025-03-01;INV-1;Acme;Widget;1;120,00', '2025-03-01;INV-1;Acme;Gadget;1;50,00', '2025-03-02;INV-2;Beta;Widget;1;70,00']));
    await expect(page.getByTestId('pv-revised')).toContainText('1 (1)');
    await expect(page.getByTestId('pv-dups')).toHaveText('2');
    // replacing stored lines is destructive: the import button stays locked until the user confirms explicitly
    await expect(page.getByTestId('confirm-box')).toBeVisible();
    await expect(page.getByTestId('confirm-import')).toBeDisabled();
    await page.getByTestId('confirm-checkbox').check();
    await expect(page.getByTestId('confirm-import')).toBeEnabled();
    await page.getByTestId('confirm-import').click();
    await expect(page.getByTestId('stat-revised')).toHaveText('1');
    await page.getByTestId('view-insights').click();
    await page.getByTestId('period-preset').selectOption('r30');
    await expect(page.getByTestId('kpi-revenue')).toHaveText(eur(24000 - 0)); // 120 + 50 + 70
  });
  test('without document numbers the user is warned that overlapping data cannot be matched reliably', async ({ page }) => {
    const h = 'Data;Klientas;Prekė;Kiekis;Suma be PVM\r\n';
    const noId = (n: string, rows: string[]) => ({ name: n, mimeType: 'text/csv', buffer: Buffer.from(h + rows.join('\r\n') + '\r\n') });
    await page.goto('/app/');
    await page.getByTestId('lang-en').click();
    await page.getByTestId('file-input').setInputFiles(noId('x.csv', ['2025-03-01;Acme;Widget;1;100,00', '2025-03-02;Beta;Widget;1;70,00']));
    await page.getByTestId('mapping-table').waitFor();
    await page.getByTestId('currency-select').selectOption('EUR');
    await expect(page.getByTestId('overlap-risk')).toHaveCount(0); // nothing stored yet
    await page.getByTestId('confirm-import').click();
    await page.getByRole('button', { name: 'Choose file' }).click();
    await page.getByTestId('file-input').setInputFiles(noId('y.csv', ['2025-03-01;Acme;Widget;1;120,00']));
    await page.getByTestId('mapping-table').waitFor();
    await page.getByTestId('currency-select').selectOption('EUR');
    await expect(page.getByTestId('overlap-risk')).toBeVisible();
    await page.getByTestId('confirm-import').click();
    await page.getByTestId('view-insights').click();
    await expect(page.getByTestId('limitations')).toContainText('no document numbers');
    await expect(page.getByTestId('kpi-card-orders')).toHaveCount(0); // orders are not invented without identifiers
  });
});
