import { expect, test, type Page } from '@playwright/test';
import { customerLink, makeExecutive, productLinks, seedPayload } from '../tests/fixtures/executive';
import { isLocal, seedDatabase, trackRequests } from './helpers';

const d = makeExecutive();
const head = 'Data;Dokumento Nr.;Klientas;Prekė;Kiekis;Suma be PVM';
const row = (date: string, i: number) => `${date};DOC-${i};Klientas ${i % 3};Prekė ${i % 4};${1 + (i % 3)};${(10 + i).toFixed(2).replace('.', ',')}`;
const file = (name: string, text: string) => ({ name, mimeType: 'text/csv', buffer: Buffer.from('﻿' + text) });

async function start(page: Page) { await page.goto('/app/'); await page.getByTestId('lang-en').click(); }
async function overview(page: Page) {
  await start(page);
  await seedDatabase(page, seedPayload(d, [...productLinks(), customerLink()]));
  await page.reload();
  await page.getByTestId('lang-en').click();
  await page.getByTestId('tab-overview').click();
  await page.getByTestId('exec-trust').waitFor();
}

test.describe('import: what you should know before trusting a file', () => {
  test('a clean file shows an all-clear; currency, VAT basis, dates and coverage are stated', async ({ page }) => {
    await start(page);
    await page.getByTestId('tab-import').click();
    await page.getByTestId('file-input').setInputFiles(file('clean.csv', head + '\r\n' + Array.from({ length: 15 }, (_, i) => row(`2025-03-${String(1 + i).padStart(2, '0')}`, i)).join('\r\n')));
    await page.getByTestId('mapping-table').waitFor();
    await page.getByTestId('currency-select').selectOption('EUR');
    await expect(page.getByTestId('import-trust')).toBeVisible();
    await expect(page.getByTestId('trust-allclear')).toBeVisible();
    await expect(page.getByTestId('trust-item-currency')).toContainText('EUR');
    await expect(page.getByTestId('trust-item-vat_basis')).toContainText('excluding VAT');
    await expect(page.getByTestId('trust-item-dates')).toContainText('year-month-day');
    await expect(page.getByTestId('trust-item-coverage')).toContainText('15 rows');
  });

  test('ambiguous day/month dates and an unstated VAT basis ask for confirmation; the date choice changes the preview', async ({ page }) => {
    await start(page);
    await page.getByTestId('tab-import').click();
    const rows = Array.from({ length: 12 }, (_, i) => row(`0${1 + (i % 9)}/0${1 + ((i + 2) % 9)}/2025`, i));
    await page.getByTestId('file-input').setInputFiles(file('amb.csv', 'Data;Dokumento Nr.;Klientas;Prekė;Kiekis;Suma\r\n' + rows.join('\r\n')));
    await page.getByTestId('mapping-table').waitFor();
    await page.getByTestId('currency-select').selectOption('EUR');
    await expect(page.getByTestId('trust-item-date_order')).toHaveAttribute('data-level', 'confirm');
    await expect(page.getByTestId('trust-item-vat_basis')).toHaveAttribute('data-level', 'confirm');
    await expect(page.getByTestId('trust-item-vat_basis')).toContainText('basis unknown');
    const before = await page.getByTestId('trust-item-coverage').innerText();
    const sel = page.locator('[data-testid^=date-order-]').first();
    await sel.selectOption('mdy');
    await expect(page.getByTestId('trust-item-coverage')).not.toHaveText(before);
    await expect(page.getByTestId('trust-item-date_order')).toContainText('month/day/year');
  });
});

test.describe('overview: evidence you can inspect', () => {
  test('every finding shows its evidence status; the evidence panel lists status, calculation, basis, assumptions, limits and what is missing', async ({ page, baseURL }) => {
    const reqs = trackRequests(page);
    await overview(page);
    const badges = page.getByTestId('exec-insights').getByTestId('evidence-status');
    expect(await badges.count()).toBeGreaterThanOrEqual(5);
    for (const s of await badges.evaluateAll((els) => els.map((e) => e.getAttribute('data-status')))) expect(['verified', 'candidate', 'estimate', 'withheld']).toContain(s);
    const first = page.locator('[data-testid=exec-insight]').first();
    await first.getByTestId('insight-details-btn').click();
    const panel = first.getByTestId('evidence-panel');
    for (const w of ['Evidence', 'Supported by records', 'Calculation', 'Currency and amount basis', 'Assumptions', 'Limitations', 'Evidence that is missing', 'Why this status']) await expect(panel).toContainText(w);
    await expect(panel).toContainText('does not mean the underlying business records were audited');
    expect(reqs.filter((r) => !isLocal(r.url(), baseURL!))).toEqual([]);
  });

  test('financial items to verify: exposure per currency and side, composition, evidence with records and an evidence CSV', async ({ page }) => {
    await overview(page);
    const pot = page.getByTestId('exec-trust').getByTestId('trust-potential').first();
    await expect(pot).toBeVisible();
    await expect(page.getByTestId('exec-trust')).toContainText('not recovered, saved or confirmed-recoverable');
    const f = page.getByTestId('exec-trust').getByTestId('trust-finding').first();
    await expect(f).toBeVisible();
    await expect(f.getByTestId('evidence-status')).toBeVisible();
    await f.getByTestId('trust-open').click();
    const panel = f.getByTestId('evidence-panel');
    await expect(panel.getByTestId('evidence-records').locator('tbody tr').first()).toBeVisible();
    await expect(panel).toContainText('debts.csv');
    await expect(panel).toContainText('Receivable / payable reports do not state whether amounts include VAT');
    const [dl] = await Promise.all([page.waitForEvent('download'), panel.getByTestId('evidence-export').click()]);
    expect(dl.suggestedFilename()).toBe('evidence.csv');
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByTestId('exec-trust').getByTestId('trust-export-all').click()]);
    expect(dl2.suggestedFilename()).toBe('evidence-all.csv');
  });

  test('a finding that is withheld shows why; withheld conclusions are listed with reasons', async ({ page }) => {
    await overview(page);
    await expect(page.getByTestId('exec-withheld')).toBeVisible();
    await page.getByTestId('exec-withheld').locator('summary').click();
    const items = page.getByTestId('exec-withheld').locator('li');
    expect(await items.count()).toBeGreaterThan(0);
    for (const t of await items.allInnerTexts()) expect(t).toMatch(/: .+: .+/);
  });

  test('the analyst view of receivables / payables carries the same evidence-classified findings', async ({ page }) => {
    await overview(page);
    await page.getByTestId('tab-insights').click();
    await page.getByTestId('module-view-finance').click();
    await page.getByTestId('mode-analyst').click();
    await expect(page.getByTestId('fin-trust')).toBeVisible();
    await expect(page.getByTestId('fin-trust').getByTestId('trust-potential')).toBeVisible();
  });

  test('PL and LT show no raw keys; mobile has no horizontal scroll', async ({ page }) => {
    await overview(page);
    for (const l of ['pl', 'lt']) {
      await page.getByTestId(`lang-${l}`).click();
      await page.getByTestId('exec-trust').waitFor();
      await page.getByTestId('exec-trust').getByTestId('trust-open').first().click();
      expect(await page.locator('main').innerText(), l).not.toMatch(/\b(trust|itrust|exe|cross|lnk|rule|frule|funavail|cert|sev|mod)\.[a-z_]+/);
    }
    await page.getByTestId('lang-en').click();
    await page.setViewportSize({ width: 390, height: 800 });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
});
