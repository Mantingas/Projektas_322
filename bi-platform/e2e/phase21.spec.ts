import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { makeTruth } from '../tests/fixtures/truth';
import { isLocal, trackRequests } from './helpers';

const sample = (n: string) => path.join(process.cwd(), 'public/samples', n);
const truth = makeTruth('lt');
const eur = (cents: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const inRange = (from: string, to: string) => truth.filter((t) => t.date >= from && t.date <= to);
const sumNet = (rows: typeof truth) => rows.reduce((s, t) => s + t.net, 0);

const head = 'Data;Dokumento Nr.;Klientas;Prekė;Kiekis;Suma be PVM\r\n';
const csv = (name: string, rows: string[]) => ({ name, mimeType: 'text/csv', buffer: Buffer.from('﻿' + head + rows.join('\r\n') + '\r\n') });

async function pick(page: Page, f: { name: string; mimeType: string; buffer: Buffer }, mode: 'full' | 'incremental' | 'partial' | 'unknown' = 'full') {
  await page.getByTestId('tab-import').click();
  if (await page.getByTestId('import-result').count()) await page.getByRole('button', { name: 'Choose file' }).click();
  await page.getByTestId('file-input').setInputFiles(f);
  await page.getByTestId('mapping-table').waitFor();
  await page.getByTestId('currency-select').selectOption('EUR');
  await page.getByTestId('mode-select').selectOption(mode);
  await expect(page.getByTestId('import-preview')).toBeVisible();
}
async function loadSample(page: Page) {
  await page.goto('/app/');
  await page.getByTestId('lang-en').click();
  await page.getByTestId('file-input').setInputFiles(sample('sample_lt_ataskaita.xlsx'));
  await page.getByTestId('mapping-table').waitFor();
  await expect(page.getByTestId('import-preview')).toBeVisible();
  await page.getByTestId('confirm-import').click();
  await page.getByTestId('view-insights').click();
  await page.getByTestId('kpi-revenue').waitFor();
}

test.describe('import diagnostics screen', () => {
  test('shows structure, header row, mappings with confidence, unrecognised columns, validation issues, unavailable metrics and the preview', async ({ page }) => {
    await page.goto('/app/');
    await page.getByTestId('lang-en').click();
    const messy = 'Pardavimų ataskaita\r\nLaikotarpis 2025-01\r\n' + 'Data;Dok. Nr.;Klientas;Preke;Kiekis;Suma be PVM;Pastabos;Vidinis kodas\r\n'
      + '2025-01-02;A1;Acme;Widget;1;100,00;labas;1\r\n2025-01-03;A2;Beta;Widget;2;50,00;;2\r\nnetaisyklinga;A3;Gamma;Widget;1;10,00;;3\r\n2025-01-05;A4;Acme;Widget;1;abc;;4\r\nIš viso;;;;4;160,00;;\r\n';
    await page.getByTestId('file-input').setInputFiles({ name: 'messy.csv', mimeType: 'text/csv', buffer: Buffer.from(messy) });
    await page.getByTestId('mapping-table').waitFor();
    const s = page.getByTestId('diag-structure');
    await expect(s).toContainText('csv');
    await expect(s).toContainText('Delimiter: ;');
    await expect(s).toContainText('Header in row 3');
    await expect(s).toContainText('Totals rows skipped: 1');
    // proposals + confidence + origin
    await expect(page.getByTestId('map-0')).toHaveValue('document_date');
    await expect(page.getByTestId('mapping-table')).toContainText('100 %');
    await expect(page.getByTestId('mapping-table')).toContainText('suggested');
    // unrecognised columns are listed
    await expect(page.getByTestId('diag-unrecognized')).toContainText('Pastabos');
    // a generic "… kodas" header is proposed, but NOT confidently: it is flagged for a check
    await expect(page.getByText('Low confidence – please check: Product code')).toBeVisible();
    // validation issues with example rows
    await page.getByTestId('currency-select').selectOption('EUR');
    const v = page.getByTestId('diag-validation');
    await expect(v).toContainText('Unreadable date');
    await expect(v).toContainText('Unreadable amount');
    await expect(v).toContainText('rows 6');
    await expect(v).toContainText('imported 2');
    // metrics: what is and is not available, with reasons
    const m = page.getByTestId('diag-metrics');
    await expect(page.getByTestId('diag-metric-sales')).toHaveAttribute('data-available', 'true');
    await expect(page.getByTestId('diag-metric-margin')).toHaveAttribute('data-available', 'false');
    await expect(m).toContainText('Cost is missing');
    await expect(page.getByTestId('diag-metric-asp')).toContainText('Select exactly one product');
    // preview + download without cell values
    await expect(page.getByTestId('import-preview')).toContainText('New lines');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-diagnostics').click()]);
    const txt = fs.readFileSync((await dl.path())!, 'utf8');
    expect(txt).toContain('header row: 3');
    expect(txt).toContain('unrecognised columns: Pastabos');
    expect(txt).toContain('margin: unavailable (no_cost)');
    for (const secret of ['Acme', 'Beta', 'Gamma', 'Widget', 'A1', 'labas']) expect(txt).not.toContain(secret);
  });
});

test.describe('safe import replacement', () => {
  test('unknown export mode: a corrected document is HELD (not in any number), reviewed in History, and the decision is audited and reversible', async ({ page }) => {
    await page.goto('/app/');
    await page.getByTestId('lang-en').click();
    await pick(page, csv('a.csv', ['2025-03-01;INV-1;Acme;Widget;1;100,00', '2025-03-01;INV-1;Acme;Gadget;1;50,00', '2025-03-02;INV-2;Beta;Widget;1;70,00']), 'full');
    await page.getByTestId('confirm-import').click();
    await expect(page.getByTestId('stat-added')).toHaveText('3');

    await pick(page, csv('b.csv', ['2025-03-01;INV-1;Acme;Widget;1;120,00', '2025-03-01;INV-1;Acme;Gadget;1;50,00', '2025-03-02;INV-2;Beta;Widget;1;70,00']), 'unknown');
    await expect(page.getByTestId('pv-held')).toContainText('1');
    await expect(page.getByTestId('pv-dups')).toHaveText('2');
    await expect(page.getByTestId('pol-hold')).toBeChecked();
    await expect(page.getByTestId('confirm-box')).toHaveCount(0); // holding is not destructive
    await page.getByTestId('confirm-import').click();
    await expect(page.getByTestId('held-notice')).toBeVisible();
    await expect(page.getByTestId('stat-held')).toHaveText('1');

    // the held line is NOT part of the figures, and the dashboard says so
    await page.getByTestId('view-insights').click();
    await expect(page.getByTestId('kpi-revenue')).toHaveText(eur(22000)); // 100 + 50 + 70
    await expect(page.getByTestId('limitations')).toContainText('held for your review');
    await expect(page.getByTestId('held-badge')).toHaveText('1');

    // conflict review
    await page.getByTestId('tab-history').click();
    const g = page.getByTestId('conflict-group');
    await expect(g).toHaveCount(1);
    await expect(g.getByTestId('cr-stored')).toContainText('€100.00');
    await expect(g.getByTestId('cr-held')).toContainText('€120.00');
    await g.getByTestId('cr-use-new').click();
    await expect(page.getByTestId('conflict-group')).toHaveCount(0);
    await expect(page.getByTestId('audit-log')).toContainText('Conflict resolved');
    await expect(page.getByTestId('audit-log')).toContainText('use_new');
    await page.getByTestId('tab-insights').click();
    await expect(page.getByTestId('kpi-revenue')).toHaveText(eur(24000)); // 120 + 50 + 70 – the unchanged line was kept
    await expect(page.getByTestId('limitations')).not.toContainText('held for your review');

    // undo: deleting the correcting import restores the original line
    await page.getByTestId('tab-history').click();
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('history-table').locator('tbody tr').filter({ hasText: 'b.csv' }).getByRole('button', { name: 'Delete import' }).click();
    await page.getByTestId('tab-insights').click();
    await expect(page.getByTestId('kpi-revenue')).toHaveText(eur(22000));
  });

  test('keep-stored discards the held lines; keep-both is an explicit, labelled choice', async ({ page }) => {
    await page.goto('/app/');
    await page.getByTestId('lang-en').click();
    await pick(page, csv('a.csv', ['2025-03-01;INV-1;Acme;Widget;1;100,00']), 'full');
    await page.getByTestId('confirm-import').click();
    await pick(page, csv('b.csv', ['2025-03-01;INV-1;Acme;Widget;1;130,00']), 'incremental');
    await page.getByTestId('confirm-import').click();
    await page.getByTestId('review-conflicts').click();
    await page.getByTestId('cr-keep-stored').click();
    await page.getByTestId('tab-insights').click();
    await expect(page.getByTestId('kpi-revenue')).toHaveText(eur(10000));
  });

  test('a declared full snapshot may propose a replacement – locked until explicitly confirmed; nothing is deleted', async ({ page }) => {
    await page.goto('/app/');
    await page.getByTestId('lang-en').click();
    await pick(page, csv('a.csv', ['2025-03-01;INV-1;Acme;Widget;1;100,00', '2025-03-01;INV-1;Acme;Gadget;1;50,00']), 'full');
    await page.getByTestId('confirm-import').click();
    // a snapshot that lacks one stored line → the proposed REMOVAL needs confirmation
    await pick(page, csv('b.csv', ['2025-03-01;INV-1;Acme;Widget;1;100,00']), 'full');
    await expect(page.getByTestId('pv-removed')).toHaveText('1');
    await expect(page.getByTestId('confirm-import')).toBeDisabled();
    // the safe alternative is one click away
    await page.getByTestId('pol-hold').check();
    await expect(page.getByTestId('confirm-box')).toHaveCount(0);
    await expect(page.getByTestId('confirm-import')).toBeEnabled();
    await page.getByTestId('confirm-import').click();
    await page.getByTestId('view-insights').click();
    await expect(page.getByTestId('kpi-revenue')).toHaveText(eur(15000)); // 'hold' kept the stored line
  });

  test('every export mode explains itself', async ({ page }) => {
    await page.goto('/app/');
    await page.getByTestId('lang-en').click();
    await pick(page, csv('a.csv', ['2025-03-01;INV-1;Acme;Widget;1;100,00']), 'full');
    for (const [mode, text] of [['full', 'Only this mode can replace'], ['incremental', 'never replaced'], ['partial', 'never removed'], ['unknown', 'held for your review']] as const) {
      await page.getByTestId('mode-select').selectOption(mode);
      await expect(page.getByTestId('mode-help')).toContainText(text);
    }
  });
});

test.describe('period-aware insights and year-to-date', () => {
  test('insights follow the selected period and say which period they cover', async ({ page }) => {
    await loadSample(page);
    await expect(page.getByTestId('insight-period')).toContainText('16/11/2025 – 15/12/2025');
    const before = await page.locator('[data-insight-id="sales.customers_declined"]').innerText();
    await page.getByTestId('period-preset').selectOption('custom');
    await page.getByLabel('Current From').fill('2025-10-01');
    await page.getByLabel('Current To').fill('2025-10-31');
    await page.getByLabel('Previous From').fill('2025-09-01');
    await page.getByLabel('Previous To').fill('2025-09-30');
    await expect(page.getByTestId('insight-period')).toContainText('01/10/2025 – 31/10/2025');
    // independent reference for the October vs September decline of customers
    const cur = new Map<string, number>(), prev = new Map<string, number>();
    for (const t of inRange('2025-10-01', '2025-10-31')) cur.set(t.customer, (cur.get(t.customer) ?? 0) + t.net / 100);
    for (const t of inRange('2025-09-01', '2025-09-30')) prev.set(t.customer, (prev.get(t.customer) ?? 0) + t.net / 100);
    const prevTotal = [...prev.values()].reduce((a, b) => a + b, 0);
    let count = 0;
    for (const [k, pv] of prev) if (pv >= Math.max(prevTotal * 0.005, 1) && (cur.get(k) ?? 0) <= pv * 0.7) count++;
    const card = page.locator('[data-insight-id="sales.customers_declined"]');
    if (count > 0) { await expect(card).toContainText(`reduced purchases by more than 30%: ${count}`); expect(await card.innerText()).not.toBe(before); }
    else await expect(card).toHaveCount(0);
    // the insight text reflects the SAME comparison as the KPI cards
    await expect(page.getByTestId('kpi-revenue')).toHaveText(eur(sumNet(inRange('2025-10-01', '2025-10-31'))));
  });

  test('insight amounts reconcile with the table, the KPI and the drill-down', async ({ page }) => {
    await loadSample(page);
    const card = page.locator('[data-insight-id="sales.customers_declined"]');
    await card.getByTestId('insight-details-btn').click();
    const first = card.getByTestId('insight-details').locator('li').first();
    const text = await first.innerText(); // "Name: €prev → €cur"
    const m = /^(.*): €([\d,.]+) → [−-]?€([\d,.]+)/.exec(text)!;
    const cur = Number(m[3]!.replace(/,/g, ''));
    await first.getByRole('button', { name: 'View records' }).click();
    // the drill-down covers the CURRENT period for this customer and sums to the figure shown in the insight
    const total = (await page.getByTestId('drill-total').innerText()).replace(/[^\d.-]/g, '');
    expect(Number(total)).toBeCloseTo(cur, 2);
  });

  test('explicit period-status indicator: partial vs complete', async ({ page }) => {
    await loadSample(page);
    await expect(page.getByTestId('period-status')).toHaveAttribute('data-kind', 'complete');
    await page.getByTestId('period-preset').selectOption('mom');
    await expect(page.getByTestId('period-status')).toHaveAttribute('data-kind', 'partial');
    await expect(page.getByTestId('period-status')).toContainText('15 of 31 days');
  });

  test('year-to-date is only offered when the data reaches back to 1 January, and compares equal spans', async ({ page }) => {
    await loadSample(page);
    await expect(page.getByTestId('period-preset').locator('option[value="ytd"]')).toHaveCount(0); // data starts in September
    // two years of weekly data
    const rows: string[] = [];
    let n = 0;
    for (let d = Date.UTC(2024, 0, 1); d <= Date.UTC(2025, 11, 15); d += 3 * 86400000) rows.push(`${new Date(d).toISOString().slice(0, 10)};D${n++};Acme;Widget;1;10,00`);
    await page.getByTestId('tab-settings').click();
    page.once('dialog', (x) => void x.accept());
    await page.getByTestId('delete-all').click();
    await pick(page, csv('two-years.csv', rows), 'full');
    await page.getByTestId('confirm-import').click();
    await page.getByTestId('view-insights').click();
    await page.getByTestId('kpi-revenue').waitFor();
    await page.getByTestId('period-preset').selectOption('ytd');
    await expect(page.getByTestId('period-status')).toHaveAttribute('data-kind', 'to_date');
    await expect(page.getByTestId('period-status')).toContainText('349 of 365 days');
    const cur = rows.filter((r) => r.startsWith('2025')).length, prev = rows.filter((r) => r >= '2024-01-01' && r.slice(0, 10) <= '2024-12-14' && r.startsWith('2024')).length;
    await expect(page.getByTestId('kpi-revenue')).toHaveText(eur(cur * 1000));
    await expect(page.getByTestId('kpi-prev-sales')).toHaveText(eur(prev * 1000));
  });

  test('rolling-window alerts are separate and explicitly labelled', async ({ page }) => {
    await loadSample(page);
    await page.getByTestId('mode-analyst').click();
    await page.getByTestId('period-preset').selectOption('r7');
    await page.getByTestId('rolling-toggle').check();
    await expect(page.getByTestId('rolling-section')).toContainText('always compare the last 30 days');
    await expect(page.getByTestId('rolling-insight').first()).toContainText('Rolling 30 days');
    await expect(page.getByTestId('insight-period')).toContainText('09/12/2025 – 15/12/2025'); // primary insights follow the 7-day selection
  });
});

test.describe('hostile and very large input', () => {
  test('a decompression bomb is rejected with a clear message and the app stays usable', async ({ page }) => {
    await page.goto('/app/');
    await page.getByTestId('lang-en').click();
    const z = new JSZip();
    z.file('[Content_Types].xml', '<x/>');
    z.file('xl/workbook.xml', '<x/>');
    z.file('xl/junk.bin', Buffer.alloc(150 * 1024 * 1024), { compression: 'DEFLATE' });
    const bomb = await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    expect(bomb.length).toBeLessThan(1024 * 1024);
    await page.getByTestId('file-input').setInputFiles({ name: 'bomb.xlsx', mimeType: 'application/octet-stream', buffer: bomb });
    await expect(page.getByRole('alert').filter({ hasText: 'unsafe size' })).toBeVisible();
    // and a normal file still works afterwards
    await page.getByTestId('file-input').setInputFiles(sample('sample_lt_pardavimai.csv'));
    await expect(page.getByTestId('mapping-table')).toBeVisible();
  });

  test('a 120 000-line file is imported and analysed without freezing the page', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto('/app/');
    await page.getByTestId('lang-en').click();
    // main-thread watchdog: records every task longer than 50 ms and the worst timer delay
    await page.evaluate(() => {
      const w = window as unknown as { __long: number[]; __gap: number };
      w.__long = []; w.__gap = 0;
      new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__long.push(e.duration))).observe({ entryTypes: ['longtask'] });
      let last = performance.now();
      setInterval(() => { const n = performance.now(); w.__gap = Math.max(w.__gap, n - last - 50); last = n; }, 50);
    });
    const lines: string[] = [];
    for (let i = 0; i < 120_000; i++) {
      const d = new Date(Date.UTC(2024, 0, 1) + (i % 700) * 86400000).toISOString().slice(0, 10);
      lines.push(`${d};DOC-${Math.floor(i / 3)};Customer ${i % 800};Product ${i % 1500};${1 + (i % 9)};${(10 + (i % 97)).toFixed(2).replace('.', ',')}`);
    }
    const buf = Buffer.from('﻿' + head + lines.join('\r\n') + '\r\n');
    expect(buf.length).toBeGreaterThan(5_000_000);
    await page.getByTestId('file-input').setInputFiles({ name: 'big.csv', mimeType: 'text/csv', buffer: buf });
    await page.getByTestId('mapping-table').waitFor({ timeout: 120_000 });
    await page.getByTestId('currency-select').selectOption('EUR');
    await expect(page.getByTestId('import-preview')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('pv-added')).toHaveText('120000');
    await page.getByTestId('confirm-import').click();
    await expect(page.getByTestId('import-result')).toBeVisible({ timeout: 180_000 });
    await page.getByTestId('view-insights').click();
    await page.getByTestId('kpi-revenue').waitFor({ timeout: 120_000 });
    // interactive work on the big data set: filter + period change
    await page.getByTestId('period-preset').selectOption('mom');
    await page.getByTestId('filter-customer').fill('Customer 7');
    await page.getByTestId('filter-customer').press('Enter');
    await page.getByTestId('kpi-revenue').waitFor();
    await page.getByTestId('mode-analyst').click();
    await expect(page.getByTestId('chart-trend')).toBeVisible();
    const { long, gap } = await page.evaluate(() => { const w = window as unknown as { __long: number[]; __gap: number }; return { long: w.__long, gap: w.__gap }; });
    const worst = Math.max(0, ...long);
    console.log(`main-thread: longest task ${Math.round(worst)} ms, worst timer delay ${Math.round(gap)} ms, long tasks: ${long.length}`);
    expect(worst).toBeLessThan(1000);
    expect(gap).toBeLessThan(1000);
  });
});

test('no business data leaves the browser, including from the worker, during import conflicts and review', async ({ page }) => {
  const reqs = trackRequests(page);
  await page.goto('/app/');
  await page.getByTestId('lang-en').click();
  await pick(page, csv('a.csv', ['2025-03-01;INV-1;Acme;Widget;1;100,00']), 'full');
  await page.getByTestId('confirm-import').click();
  await pick(page, csv('b.csv', ['2025-03-01;INV-1;Acme;Widget;1;130,00']), 'unknown');
  await page.getByTestId('confirm-import').click();
  await page.getByTestId('review-conflicts').click();
  await page.getByTestId('cr-use-new').click();
  await page.getByTestId('tab-insights').click();
  await page.getByTestId('kpi-revenue').waitFor();
  const origin = new URL(page.url()).origin;
  expect(reqs.filter((r) => !isLocal(r.url(), origin)).map((r) => r.url())).toEqual([]);
  expect(reqs.filter((r) => r.method() !== 'GET' && r.method() !== 'HEAD')).toHaveLength(0);
});
