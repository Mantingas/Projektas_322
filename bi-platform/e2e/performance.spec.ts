import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { installWatchdog, readWatchdog } from './helpers';
import { rng } from '../tests/fixtures/universal';

/**
 * Large-file measurements. Files are handed to the browser as FILE PATHS (like a real file picker) – never as in-memory buffers, whose injection
 * cost lands on the page's main thread and is a test-harness artefact. Data are deterministic with realistic skew: a few customers / products carry
 * most of the revenue, seasonal dates, repeated documents with several lines, a share of credit notes. The measurements are written to
 * test-results/perf-<rows>.json; docs/PHASE7_VALIDATION.md records the conditions they were taken under.
 */
const HEAD = 'Data;Dokumento Nr.;Klientas;Prekė;Kiekis;Suma be PVM\r\n';
function make(rows: number): string {
  const r = rng(rows);
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    const day = Math.floor(r() * 700);
    const season = 1 + 0.4 * Math.sin((day / 365) * 2 * Math.PI);
    const cust = Math.floor(Math.pow(r(), 2.2) * 800);          // skew: a few big customers
    const prod = Math.floor(Math.pow(r(), 1.8) * 1500);
    const qty = 1 + Math.floor(r() * 9 * season);
    const price = 5 + (prod % 97) + r() * 3;
    const credit = r() < 0.03 ? -1 : 1;
    const d = new Date(Date.UTC(2024, 0, 1) + day * 86400000).toISOString().slice(0, 10);
    out.push(`${d};DOC-${Math.floor(i / 3)};Customer ${cust};Product ${prod};${qty * credit};${(qty * price * credit).toFixed(2).replace('.', ',')}`);
  }
  return '﻿' + HEAD + out.join('\r\n') + '\r\n';
}

for (const rows of [10_000, 50_000, 120_000]) {
  test(`${rows.toLocaleString('en')} rows: import, analysis, report and responsiveness`, async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    await page.goto('/app/');
    await page.getByTestId('lang-en').click();
    await installWatchdog(page);
    const p = testInfo.outputPath(`perf-${rows}.csv`);
    fs.writeFileSync(p, make(rows));
    const bytes = fs.statSync(p).size;
    const t0 = Date.now();
    await page.getByTestId('file-input').setInputFiles(p);
    await page.getByTestId('mapping-table').waitFor({ timeout: 120_000 });
    const tParsed = Date.now();
    await page.getByTestId('currency-select').selectOption('EUR');
    await expect(page.getByTestId('import-preview')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('import-trust')).toBeVisible();
    const tPreview = Date.now();
    await page.getByTestId('confirm-import').click();
    await page.getByTestId('import-result').waitFor({ timeout: 180_000 });
    const tImported = Date.now();
    await page.getByTestId('view-insights').click();
    await page.getByTestId('kpi-revenue').waitFor({ timeout: 120_000 });
    const tAnalysed = Date.now();
    await page.getByTestId('mode-analyst').click();
    await expect(page.getByTestId('chart-trend')).toBeVisible();
    const tAnalyst = Date.now();
    // the executive overview over the same data (builds every module, ranks, composes)
    await page.getByTestId('tab-overview').click();
    await page.getByTestId('exec-kpis').waitFor({ timeout: 120_000 });
    const tOverview = Date.now();
    const tr0 = Date.now();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('exec-export-html').click()]);
    await dl.path();
    const tReport = Date.now() - tr0;
    const w = await readWatchdog(page);
    const heap = await page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0);
    const m = {
      rows, fileMB: +(bytes / 1048576).toFixed(2), parseMappingMs: tParsed - t0, previewMs: tPreview - tParsed, importCommitMs: tImported - tPreview, salesDashboardMs: tAnalysed - tImported, analystViewMs: tAnalyst - tAnalysed, overviewMs: tOverview - tAnalyst, reportMs: tReport,
      longestMainThreadTaskMs: Math.round(w.worst), worstTimerDelayMs: Math.round(w.gap), longTasks: w.tasks, jsHeapMB: +(heap / 1048576).toFixed(1), cpus: (await page.evaluate(() => navigator.hardwareConcurrency)),
    };
    fs.writeFileSync(`test-results/perf-${rows}.json`, JSON.stringify(m, null, 1));
    console.log(`PERF ${JSON.stringify(m)}`);
    // the limit of the Phase 6 large-file test is kept: application tasks stay under 600 ms
    expect(w.worst).toBeLessThan(600);
    expect(w.gap).toBeLessThan(600);
  });
}
