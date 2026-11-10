import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import { customerLink, makeExecutive, productLinks, seedPayload } from '../tests/fixtures/executive';
import { isLocal, seedDatabase, trackRequests } from './helpers';

const d = makeExecutive();

async function pilot(page: Page, full = true) {
  await page.goto('/app/');
  await page.getByTestId('lang-en').click();
  const p = seedPayload(d, [...productLinks(), customerLink()]);
  const row = (id: string, fin: string, extra: Record<string, unknown> = {}) => ({ ...p.imports.find((i) => i.id === 'imp_f')!, id, fileName: `${fin}.csv`, financeKind: fin, financeSide: 'payable', stats: { ...p.imports[3]!.stats, dateMin: '2025-01-01', dateMax: '2025-12-31', warnings: {}, errors: {} }, ...extra });
  const imports = [...p.imports.filter((i) => i.id !== 'imp_f'), row('imp_f', 'open_items', { stats: { ...p.imports[3]!.stats, dateMin: '2025-12-15', dateMax: '2025-12-15', warnings: {}, errors: {} } }), ...(full ? [row('imp_inv', 'invoices'), row('imp_cn', 'credit_notes'), row('imp_pay', 'payments')] : [])];
  await seedDatabase(page, { ...p, imports });
  await page.reload();
  await page.getByTestId('lang-en').click();
  await page.getByTestId('tab-pilot').click();
  await page.getByTestId('pilot-findings').waitFor();
}

test.describe('pilot validation workflow', () => {
  test('starts as NOT STARTED with real data unattested; datasets and checklist reflect the imports', async ({ page, baseURL }) => {
    const reqs = trackRequests(page);
    await pilot(page);
    await expect(page.getByTestId('pilot-status-value')).toHaveText('NOT STARTED');
    await expect(page.getByTestId('pilot-status')).toContainText('nothing here is a real-world result');
    for (const k of ['invoices', 'credit_notes', 'payments', 'open_items']) await expect(page.getByTestId(`pilot-ds-${k}`)).toHaveAttribute('data-present', 'true');
    await expect(page.getByTestId('check-real_data')).toHaveAttribute('data-ok', 'false');
    await expect(page.getByTestId('check-snapshot')).toHaveAttribute('data-ok', 'false');   // documented snapshot date missing
    await expect(page.getByTestId('pr-precision')).toContainText('Not available');
    await expect(page.getByTestId('pr-recall')).toContainText('no denominator');
    await expect(page.getByTestId('pilot-saved')).toContainText('no baseline');
    expect(reqs.filter((r) => !isLocal(r.url(), baseURL!))).toEqual([]);
  });

  test('missing datasets are shown as missing', async ({ page }) => {
    await pilot(page, false);
    await expect(page.getByTestId('pilot-ds-invoices')).toHaveAttribute('data-present', 'false');
    await expect(page.getByTestId('check-invoices')).toHaveAttribute('data-ok', 'false');
  });

  test('a reviewer confirms one finding and rejects another; results stay qualified and tiers stay separate', async ({ page }) => {
    await pilot(page);
    const rows = page.getByTestId('pilot-finding');
    const total = await rows.count();
    expect(total).toBeGreaterThan(2);
    await page.getByTestId('pf-reviewer').fill('AB');
    // 1st: confirmed with amounts
    await rows.nth(0).getByTestId('pf-open').click();
    await expect(rows.nth(0).getByTestId('evidence-panel')).toBeVisible();
    await rows.nth(0).getByTestId('pf-dec').selectOption('confirmed');
    await rows.nth(0).getByTestId('pf-recon').fill('Matched to ledger entry and bank line');
    await rows.nth(0).getByTestId('pf-conf').fill('1600');
    await rows.nth(0).getByTestId('pf-recble').fill('1500');
    await rows.nth(0).getByTestId('pf-recd').fill('500');          // recovered WITHOUT evidence → must be left out
    await rows.nth(0).getByTestId('pf-min').fill('15');
    await rows.nth(0).getByTestId('pf-savereview').click();
    await page.getByTestId('pf-filter-all').click();
    await expect(page.getByTestId('pilot-finding').first().getByTestId('pf-decision')).toHaveAttribute('data-testid', 'pf-decision');
    await expect(page.locator('[data-testid=pilot-finding][data-decision=confirmed]')).toHaveCount(1);
    await expect(page.getByTestId('pr-precision')).toContainText('1 of 1');
    await expect(page.getByTestId('pilot-results')).toContainText('Fewer than 30 decisions');
    await expect(page.getByTestId('pilot-results')).toContainText('describes test data only');
    const tier = page.getByTestId('pilot-tier').first();
    await expect(tier.getByTestId('tier-confirmed')).toContainText('1,600.00');
    await expect(tier.getByTestId('tier-recoverable')).toContainText('1,500.00');
    await expect(tier.getByTestId('tier-recovered')).toContainText('0.00');                  // no evidence → not counted
    await expect(page.getByTestId('pilot-tiers')).toContainText('Left out for lack of evidence');
    await expect(page.getByTestId('pilot-tiers')).toContainText('never added together');
    // 2nd: false positive needs a reason (a warning appears without one)
    const second = page.getByTestId('pilot-finding').nth(1);
    await second.getByTestId('pf-open').click();
    await second.getByTestId('pf-dec').selectOption('false_positive');
    await second.getByTestId('pf-savereview').click();
    await expect(page.getByTestId('pilot-warnings')).toContainText('has no reason');
    await expect(page.getByTestId('pr-precision')).toContainText('1 of 2');
    // status is still NOT STARTED: the data are not attested as real
    await expect(page.getByTestId('pilot-status-value')).toHaveText('NOT STARTED');
  });

  test('attesting real data, facts, baseline and the reference list changes status and completeness; time saved needs everything', async ({ page }) => {
    await pilot(page);
    const before = await page.getByTestId('pilot-pct').innerText();
    await page.getByTestId('pf-reviewer').fill('AB');
    await page.getByTestId('pf-real').check();
    await page.getByTestId('pf-snapdate').fill('2025-12-15');
    await page.getByTestId('pf-snapsrc').fill('AP open items report');
    await page.getByTestId('pf-baseline').fill('600');
    await page.getByTestId('pf-prep').fill('60');
    await page.getByTestId('pf-complete').check();
    await page.getByTestId('pf-save').click();
    await expect(page.getByTestId('pf-saved')).toBeVisible();
    await expect(page.getByTestId('check-real_data')).toHaveAttribute('data-ok', 'true');
    await expect(page.getByTestId('check-snapshot')).toHaveAttribute('data-ok', 'true');
    await expect(page.getByTestId('check-baseline')).toHaveAttribute('data-ok', 'true');
    expect(await page.getByTestId('pilot-pct').innerText()).not.toBe(before);
    await expect(page.getByTestId('pilot-status-value')).toHaveText('NOT STARTED');         // attested, but nothing decided yet
    await expect(page.getByTestId('pilot-saved')).toContainText('until every finding is reviewed');
    // decide one finding → in progress
    const row = page.getByTestId('pilot-finding').first();
    await row.getByTestId('pf-open').click();
    await row.getByTestId('pf-dec').selectOption('inconclusive');
    await row.getByTestId('pf-reason').fill('bank statement not available');
    await row.getByTestId('pf-savereview').click();
    await expect(page.getByTestId('pilot-status-value')).toHaveText('In progress');
    // an empty attested reference list gives no recall denominator; adding known problems gives one
    await expect(page.getByTestId('pr-recall')).toContainText('nothing to measure against');
    await page.getByTestId('ms-desc').fill('Duplicate payment of invoice X (found in the books)');
    await page.getByTestId('ms-amount').fill('300');
    await page.getByTestId('ms-reason').fill('payment had no invoice reference');
    await page.getByTestId('ms-add').click();
    await expect(page.getByTestId('pr-recall')).toContainText('0 of 1');
    await expect(page.getByTestId('pilot-missed-list').locator('[data-found=false]')).toHaveCount(1);
    const find = page.getByTestId('ms-finding');
    await page.getByTestId('ms-desc').fill('A problem the app did find');
    await find.selectOption({ index: 1 });
    await page.getByTestId('ms-add').click();
    await expect(page.getByTestId('pr-recall')).toContainText('1 of 2');
  });

  test('reports are produced locally, mask names by default, and state the provenance', async ({ page }) => {
    await pilot(page);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('pilot-export-html').click()]);
    const html = fs.readFileSync((await dl.path())!, 'utf8');
    expect(html).toContain('NOT REAL-WORLD VALIDATION');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('Tiekėjas Vienas');
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByTestId('pilot-export-csv').click()]);
    const csv = fs.readFileSync((await dl2.path())!, 'utf8');
    expect(csv).toContain('Evidence status');
    expect(csv).toContain('Supplier-');
    expect(csv).not.toContain('Tiekėjas');
  });

  test('PL and LT show no raw keys; mobile does not scroll sideways', async ({ page }) => {
    await pilot(page);
    for (const l of ['pl', 'lt']) {
      await page.getByTestId(`lang-${l}`).click();
      await page.getByTestId('pilot-status-value').waitFor();
      expect(await page.locator('main').innerText(), l).not.toMatch(/\b(pilot|trust|itrust|exe)\.[a-z_.]+/);
    }
    await page.getByTestId('lang-en').click();
    await page.setViewportSize({ width: 390, height: 800 });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
});
