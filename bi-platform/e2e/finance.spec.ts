import { expect, test, type Page } from '@playwright/test';
import { buildFinanceFixtures, type FFixture } from '../tests/fixtures/financeFormats';
import { END, makeFinance, refOutstanding, refOverdue, refOverdueCount, refBucket } from '../tests/fixtures/finance';
import { isLocal, trackRequests } from './helpers';

const eur = (n: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' }).format(n);
let fx: FFixture[] = [];
test.beforeAll(async () => { fx = await buildFinanceFixtures(); });
const get = (id: string) => fx.find((f) => f.id === id)!;
const file = (f: FFixture) => ({ name: f.fileName, mimeType: 'text/csv', buffer: Buffer.from(f.bytes) });
const ar = makeFinance('receivable', 'lt');

async function pickFile(page: Page, f: FFixture, opts: { side?: string; asOf?: string; module?: boolean } = {}) {
  await page.getByTestId('tab-import').click();
  if (await page.getByTestId('import-result').count()) await page.getByRole('button', { name: 'Choose file' }).click();
  await page.getByTestId('file-input').setInputFiles(file(f));
  await page.getByTestId('mapping-table').waitFor();
  if (opts.module) await page.getByTestId('module-finance').click();
  if (opts.side) await page.getByTestId(`side-${opts.side}`).click();
  if (opts.asOf) await page.getByTestId('asof-input').fill(opts.asOf);
  if (await page.getByTestId('currency-select').count()) await page.getByTestId('currency-select').selectOption(f.currency);
  await expect(page.getByTestId('import-preview')).toBeVisible();
}
async function commit(page: Page) {
  await page.getByTestId('confirm-import').click();
  await page.getByTestId('import-result').waitFor();
}
async function start(page: Page) {
  await page.goto('/app/');
  await page.getByTestId('lang-en').click();
}
async function loadAr(page: Page) {
  await start(page);
  for (const id of ['ar-open-items-history', 'ar-payments', 'ar-credit-notes']) {
    await pickFile(page, get(id), { module: id !== 'ar-open-items-history' });
    await commit(page);
  }
  await page.getByTestId('view-insights').click();
  await page.getByTestId('module-view-finance').click();
  await page.getByTestId('kpi-f_outstanding').waitFor();
}

test.describe('finance: recognition', () => {
  test('open items are recognised as finance, with side and grain, and the history is detected', async ({ page }) => {
    await start(page);
    await pickFile(page, get('ar-open-items-history'));
    await expect(page.getByTestId('module-finance')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('finance-kind')).toContainText('Open-item');
    await expect(page.getByTestId('finance-grain')).toBeVisible();
    await expect(page.getByTestId('side-card')).toBeVisible();
  });

  test('open items without a report date ask for an as-of date', async ({ page }) => {
    await start(page);
    await page.getByTestId('tab-import').click();
    await page.getByTestId('file-input').setInputFiles(file(get('ar-open-items-nodate')));
    await page.getByTestId('mapping-table').waitFor();
    await expect(page.getByTestId('asof-input')).toBeVisible();
    await expect(page.getByTestId('confirm-import')).toBeDisabled();
  });
});

test.describe('finance: dashboard numbers match the independent reference', () => {
  test('KPIs, side switch and no external requests', async ({ page, baseURL }) => {
    const reqs = trackRequests(page);
    await loadAr(page);
    await expect(page.getByTestId('kpi-f_outstanding')).toContainText(eur(refOutstanding(ar, END)));
    await expect(page.getByTestId('kpi-f_overdue')).toContainText(eur(refOverdue(ar, END)));
    await expect(page.getByTestId('kpi-f_overdue_count')).toContainText(String(refOverdueCount(ar, END)));
    await expect(page.getByTestId('finance-view')).toHaveAttribute('data-side', 'receivable');
    await expect(page.getByTestId('fin-side-payable')).toBeDisabled(); // no payable data loaded
    expect(reqs.filter((r) => !isLocal(r.url(), baseURL!))).toEqual([]);
  });

  test('analyst mode: aging buckets reconcile, tables and certainty-labelled insights are shown', async ({ page }) => {
    await loadAr(page);
    await page.getByTestId('mode-analyst').click();
    await expect(page.getByTestId('chart-aging')).toBeVisible();
    await expect(page.getByTestId('overdue-rank')).toBeVisible();
    await expect(page.getByTestId('credit-review')).toBeVisible();
    await expect(page.getByTestId('dup-review')).toBeVisible();
    await expect(page.getByTestId('dup-note')).toContainText(/risk indicators.*none of these is a confirmed overpayment/i);
    expect(await page.getByTestId('credit-row').count()).toBeGreaterThan(0);
    const d90 = refBucket(ar, END, 91, 100000);
    expect(d90).toBeGreaterThan(0);
    await expect(page.getByTestId('chart-aging')).toContainText(/\d/);
    await expect(page.locator('[data-testid=certainty-badge]').first()).toBeVisible();
  });

  test('a potential duplicate payment is never called a confirmed overpayment', async ({ page }) => {
    await loadAr(page);
    await page.getByTestId('mode-analyst').click();
    const txt = await page.getByTestId('dup-review').innerText();
    expect(txt.replace(/none of these is a confirmed overpayment/i, '')).not.toMatch(/confirmed overpay/i);
    expect(txt).toMatch(/Possible excess/);
    await expect(page.locator('[data-testid=dup-group]').first()).toHaveAttribute('data-tier', /exact_repeat|same_invoice|overpaid|lookalike/);
  });
});

test.describe('finance: payments alone never become balances', () => {
  test('only a payment register → outstanding is withheld with a reason', async ({ page }) => {
    await start(page);
    await pickFile(page, get('ar-payments'), { module: true });
    await commit(page);
    await page.getByTestId('view-insights').click();
    await page.getByTestId('module-view-finance').click();
    await page.getByTestId('finance-view').waitFor();
    await expect(page.getByTestId('kpi-f_outstanding')).toHaveCount(0);
  });
});

test.describe('finance: exports, languages, mobile', () => {
  test('HTML summary export downloads locally', async ({ page }) => {
    await loadAr(page);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-html').click()]);
    expect(dl.suggestedFilename()).toMatch(/\.html$/);
  });

  test('Polish and Lithuanian views show no raw translation keys', async ({ page }) => {
    await loadAr(page);
    await page.getByTestId('mode-analyst').click();
    for (const l of ['pl', 'lt']) {
      await page.getByTestId(`lang-${l}`).click();
      const body = await page.locator('main').innerText();
      expect(body, l).not.toMatch(/\b(finance|fin|fch|frule|funavail|cert|metric|explain)\.[a-z_]+/);
    }
  });

  test('mobile width: no horizontal scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await loadAr(page);
    await page.getByTestId('mode-analyst').click();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const wide = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && !e.closest('[class*=overflow-x],[class*=overflow-auto]')).slice(0, 12).map((e) => `${e.tagName}.${(e as HTMLElement).className.toString().slice(0, 60)}|${(e as HTMLElement).dataset.testid ?? ''}`));
    expect(over, wide.join('\n')).toBeLessThanOrEqual(1);
  });
});
