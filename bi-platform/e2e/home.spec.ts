import { expect, test } from '@playwright/test';
import { isLocal, trackRequests } from './helpers';

const noOverflow = (page: import('@playwright/test').Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const RAW_KEY = /\b(home|demo|trust|nav)\.[a-z_.]+\b/;

test.describe('landing page', () => {
  test('LT / PL / EN: result-oriented hero, synthetic example finding, stage notice, pilot block – no pricing, no raw keys, no sideways scroll on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    for (const [lang, title, stage] of [['lt', /Atraskite, ką verta patikrinti/, /dar nebuvo/], ['pl', /Sprawdź, co warto zweryfikować/, /jeszcze się nie odbyły/], ['en', /Find what is worth checking/, /No pilots/]] as const) {
      await page.getByTestId(`lang-${lang}`).click();
      await expect(page.getByTestId('hero-title')).toHaveText(title);
      await expect(page.getByTestId('hero-finding')).toBeVisible();
      await expect(page.getByTestId('hero-finding-label')).toContainText(/synthetic|sintetin|syntetyczn/i);
      await expect(page.getByTestId('hero-finding')).toHaveAttribute('data-status', 'verified');
      await expect(page.getByTestId('hero-finding-amount')).toContainText('300');
      await expect(page.getByTestId('stage')).toContainText(stage);
      await expect(page.getByTestId('pilot')).toBeVisible();
      for (const k of ['purchasing', 'debts', 'sales', 'inventory', 'universal']) await expect(page.getByTestId(`area-${k}`)).toBeVisible();
      const text = await page.locator('main').innerText();
      expect(text).not.toMatch(RAW_KEY);
      expect(text).not.toMatch(/29[,.]99|100 (įmonių|firm|companies)|ROI/i);
      expect(text).not.toMatch(/Works with demo data|Veikia su demonstraciniais|Działa na danych demonstracyjnych/i);
      expect(await noOverflow(page)).toBe(true);
    }
  });

  test('the example finding opens its evidence on the page (records with source file and row)', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('hero-finding-evidence').locator('summary').click();
    await expect(page.getByTestId('evidence-panel')).toBeVisible();
    await expect(page.getByTestId('evidence-records')).toContainText('sample_lt_saskaitos.csv');
    await expect(page.getByTestId('evidence-panel')).toHaveAttribute('data-status', 'verified');
  });

  test('desktop: first screen shows the headline, both calls to action and the example', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    for (const id of ['hero-title', 'cta-demo', 'cta', 'hero-finding']) await expect(page.getByTestId(id)).toBeInViewport();
    expect(await noOverflow(page)).toBe(true);
  });
});

test.describe('one-click demo', () => {
  test('opens with synthetic data, no sign-up and no network call, and shows the example credit with its evidence', async ({ page, baseURL }) => {
    const reqs = trackRequests(page);
    await page.goto('/');
    await page.getByTestId('cta-demo').click();
    await expect(page).toHaveURL(/\/app\/\?demo=1/);
    await expect(page.getByTestId('demo-banner')).toBeVisible();
    await expect(page.getByTestId('demo-banner')).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 });
    // lands on the debts view with the real finding and its evidence
    await expect(page.getByTestId('tab-insights')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('module-view-finance')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/Gama pienas/).first()).toBeVisible({ timeout: 30_000 });
    expect(reqs.filter((r) => !isLocal(r.url(), baseURL!))).toEqual([]);
  });

  test('never touches the visitor’s own data: it lives in another database, and leaving the demo returns to the own workspace', async ({ page }) => {
    await page.goto('/app/');
    await page.getByTestId('tab-settings').click();
    // put a marker into the visitor's real database
    await page.evaluate(async () => {
      const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('bi-platform'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      await new Promise<void>((res, rej) => { const tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put({ key: 'own-marker', value: 'mine' }); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
      db.close();
    });
    await page.goto('/');
    await page.getByTestId('cta-demo').click();
    await expect(page.getByTestId('demo-banner')).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 });
    const state = () => page.evaluate(async () => {
      const count = async (name: string, store: string) => {
        const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
        const n = db.objectStoreNames.contains(store) ? await new Promise<number>((res) => { const q = db.transaction(store).objectStore(store).count(); q.onsuccess = () => res(q.result); }) : -1;
        db.close();
        return n;
      };
      return { realSettings: await count('bi-platform', 'settings'), realImports: await count('bi-platform', 'imports'), demoImports: await count('bi-platform-demo', 'imports') };
    });
    const s = await state();
    expect(s.demoImports).toBeGreaterThanOrEqual(7);
    expect(s.realImports).toBe(0);
    expect(s.realSettings).toBe(1);
    // restart wipes only the demo
    await page.getByTestId('demo-restart').click();
    await expect(page.getByTestId('demo-banner')).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 });
    expect((await state()).realSettings).toBe(1);
    // leave: back in the own workspace, demo data not shown
    await page.getByTestId('demo-exit').click();
    await expect(page).toHaveURL(/\/app\/$/);
    await expect(page.getByTestId('demo-banner')).toHaveCount(0);
    await page.getByTestId('tab-history').click();
    await expect(page.getByTestId('demo-banner')).toHaveCount(0);
    expect((await state()).realSettings).toBe(1);
  });

  test('"try with your own file" from the landing page leaves demo mode even after a demo visit', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('cta-demo').click();
    await expect(page.getByTestId('demo-banner')).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 });
    await page.goto('/');
    await page.getByTestId('cta').click();
    await expect(page).toHaveURL(/\/app\/$/);
    await expect(page.getByTestId('demo-banner')).toHaveCount(0);
  });

  test('PL and EN demo banners have no raw keys; phone layout does not scroll sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByTestId('lang-pl').click();
    await page.getByTestId('cta-demo').click();
    await expect(page.getByTestId('demo-banner')).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 });
    await expect(page.getByTestId('demo-banner')).toContainText(/Demonstracja/);
    expect(await page.locator('main').innerText()).not.toMatch(RAW_KEY);
    expect(await noOverflow(page)).toBe(true);
    await page.getByTestId('lang-en').click();
    await expect(page.getByTestId('demo-banner')).toContainText(/Demo · synthetic data/);
  });
});
