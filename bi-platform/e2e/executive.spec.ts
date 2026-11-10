import { expect, test, type Page } from '@playwright/test';
import { customerLink, makeExecutive, productLinks, seedPayload } from '../tests/fixtures/executive';
import { END, refOutstanding, refOverdue } from '../tests/fixtures/finance';
import { isLocal, seedDatabase, trackRequests } from './helpers';

const d = makeExecutive();
const eur = (n: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' }).format(n);

async function openOverview(page: Page, links = [...productLinks(), customerLink()], data = d) {
  await page.goto('/app/');
  await page.getByTestId('lang-en').click();
  await seedDatabase(page, seedPayload(data, links));
  await page.reload();
  await page.getByTestId('lang-en').click();
  await page.getByTestId('tab-overview').click();
  await page.getByTestId('exec-kpis').waitFor();
}

test.describe('executive overview', () => {
  test('empty state: nothing is shown until something is imported', async ({ page }) => {
    await page.goto('/app/');
    await page.getByTestId('lang-en').click();
    await page.getByTestId('tab-overview').click();
    await expect(page.getByTestId('no-exec-data')).toBeVisible();
    await expect(page.getByTestId('executive-view')).toHaveAttribute('data-empty', 'true');
  });

  test('KPI cards match the source data; every card names its module, currency and period; nothing is a grand total', async ({ page, baseURL }) => {
    const reqs = trackRequests(page);
    await openOverview(page);
    const cards = page.locator('[data-testid^=exec-kpi-][data-module]');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(4);
    expect(count).toBeLessThanOrEqual(8);
    await expect(page.getByTestId('exec-kpi-finance-receivable-f_outstanding').getByTestId('exec-kpi-value')).toHaveText(eur(refOutstanding(d.ar, END)));
    await expect(page.getByTestId('exec-kpi-finance-receivable-f_overdue').getByTestId('exec-kpi-value')).toHaveText(eur(refOverdue(d.ar, END)));
    await expect(page.getByTestId('exec-kpi-finance-payable-f_outstanding').getByTestId('exec-kpi-value')).toHaveText(eur(refOutstanding(d.ap, END)));
    await expect(page.getByTestId('exec-kpi-inventory-i_value').getByTestId('exec-kpi-value')).toHaveText(eur(d.inventory.reduce((s, r) => s + r.value!, 0)));
    const salesWin = d.sales.filter((s) => s.date >= '2025-11-16').reduce((s, r) => s + r.amount, 0);
    await expect(page.getByTestId('exec-kpi-sales-sales').getByTestId('exec-kpi-value')).toHaveText(eur(salesWin));
    await expect(page.getByTestId('exec-nomix')).toContainText('never added together');
    await expect(page.getByTestId('exec-last-import')).toContainText('Last import');
    expect(reqs.filter((r) => !isLocal(r.url(), baseURL!))).toEqual([]);
  });

  test('5–10 ranked findings, each classed and sourced; cross-module findings disclose their basis', async ({ page }) => {
    await openOverview(page);
    const list = page.getByTestId('exec-insights').locator('[data-testid=exec-insight]');
    const n = await list.count();
    expect(n).toBeGreaterThanOrEqual(5);
    expect(n).toBeLessThanOrEqual(10);
    await expect(page.getByTestId('exec-class').first()).toHaveAttribute('data-class', /fact|risk|opportunity|scenario/);
    const cross = page.locator('[data-testid=exec-insight]', { has: page.locator('[data-source=cross]') }).first();
    await expect(cross).toBeVisible();
    await cross.getByTestId('insight-details-btn').click();
    const disc = cross.getByTestId('cross-disclosure');
    for (const word of ['Data sources', 'Confirmed relationships', 'Period', 'Calculation', 'Confidence', 'Limitations']) await expect(disc).toContainText(word);
    await expect(disc.getByTestId('cross-link').first()).toBeVisible();
    await cross.getByTestId('exec-rank').locator('summary').click();
    await expect(cross.getByTestId('exec-rank')).toContainText('Financial materiality');
    // an opportunity is never worded as guaranteed
    await expect(page.getByTestId('exec-opportunities')).toContainText('never a guaranteed');
  });

  test('drill-down opens the source records behind a KPI and the module behind a finding', async ({ page }) => {
    await openOverview(page);
    await page.getByTestId('exec-kpi-finance-receivable-f_overdue').getByTestId('exec-kpi-drill').click();
    await expect(page.getByRole('dialog').or(page.locator('[data-testid=drill-drawer]')).first()).toBeVisible();
    await expect(page.locator('body')).toContainText(/Underlying records|View records|Lines/);
    await page.keyboard.press('Escape');
    await page.getByTestId('exec-open-module').first().click();
    await expect(page.getByTestId('tab-insights')).toHaveAttribute('aria-selected', 'true');
  });

  test('without confirmed links no cross-module finding exists; confirming links in the workflow creates them; undoing removes them', async ({ page }) => {
    await openOverview(page, []);
    await expect(page.locator('[data-source=cross]')).toHaveCount(0);
    await expect(page.getByTestId('links-proposed')).toBeVisible();
    await expect(page.getByTestId('link-proposed').first()).toContainText('equal');
    // names alone: listed apart, never proposed
    await expect(page.getByTestId('links-nameonly')).toContainText('Sprocket');
    await expect(page.getByTestId('links-proposed')).not.toContainText('Sprocket');
    await page.getByTestId('link-confirm-all').click();
    await expect(page.getByTestId('links-decided')).toBeVisible();
    await expect(page.locator('[data-source=cross]').first()).toBeVisible();
    const withLinks = await page.locator('[data-source=cross]').count();
    expect(withLinks).toBeGreaterThan(0);
    // rejecting everything again: back to none
    const undo = page.getByTestId('link-undo');
    while (await undo.count()) { await undo.first().click(); await page.waitForTimeout(150); }
    await expect(page.locator('[data-source=cross]')).toHaveCount(0);
    // a rejected link is remembered and not proposed again
    await page.getByTestId('link-reject').first().click();
    await expect(page.locator('[data-testid=link-decided][data-status=rejected]')).toHaveCount(1);
  });

  test('decisions survive a reload (stored on this device only)', async ({ page }) => {
    await openOverview(page, []);
    await page.getByTestId('link-confirm').first().click();
    await expect(page.locator('[data-testid=link-decided][data-status=confirmed]')).toHaveCount(1);
    await page.reload();
    await page.getByTestId('lang-en').click();
    await page.getByTestId('tab-overview').click();
    await expect(page.locator('[data-testid=link-decided][data-status=confirmed]')).toHaveCount(1);
  });

  test('coverage shows what is present, its period, series and last import', async ({ page }) => {
    await openOverview(page);
    for (const m of ['sales', 'purchasing', 'inventory', 'finance']) await expect(page.getByTestId(`cov-${m}`)).toHaveAttribute('data-present', 'true');
    await expect(page.getByTestId('cov-sales')).toContainText('EUR · net');
    await expect(page.getByTestId('cov-finance')).toContainText('Receivables');
    await expect(page.getByTestId('exec-trends')).toBeVisible();
    await expect(page.getByTestId('exec-trends')).toContainText('not added or overlaid');
  });

  test('exports are produced locally; PL and LT show no raw keys; mobile does not scroll sideways', async ({ page }) => {
    await openOverview(page);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('exec-export-html').click()]);
    expect(dl.suggestedFilename()).toMatch(/\.html$/);
    for (const l of ['pl', 'lt']) {
      await page.getByTestId(`lang-${l}`).click();
      await page.getByTestId('exec-kpis').waitFor();
      expect(await page.locator('main').innerText(), l).not.toMatch(/\b(exe|cross|lnk|metric|explain|finance|inventory|purchasing|sales|fin|uni|cert|sev|mod)\.[a-z_]+/);
    }
    await page.getByTestId('lang-en').click();
    await page.setViewportSize({ width: 390, height: 800 });
    await page.waitForTimeout(300);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(1);
  });
});
