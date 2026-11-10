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
    // lands on the overview, scrolled to the findings with their evidence
    await expect(page.getByTestId('tab-overview')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('exec-trust')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('exec-trust').getByText(/Gama pienas/).first()).toBeVisible();
    await expect(page.getByTestId('exec-trust')).toBeInViewport({ timeout: 10_000 });
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

test.describe('final review checks', () => {
  test('the hero example cannot be mistaken for a confirmed real loss: synthetic label + plain-language status note in every language, engine status kept', async ({ page }) => {
    await page.goto('/');
    for (const [lang, note] of [['lt', /nepatvirtina tikro nuostolio/], ['pl', /Nie potwierdza|nie potwierdza/], ['en', /does not confirm a real loss/]] as const) {
      await page.getByTestId(`lang-${lang}`).click();
      await expect(page.getByTestId('hero-finding-label')).toBeVisible();
      await expect(page.getByTestId('hero-finding-status-note')).toContainText(note);
      await expect(page.getByTestId('hero-finding')).toHaveAttribute('data-status', 'verified'); // the engine's own classification is untouched
    }
  });

  test('the pilot block offers no signup: no form, no input, no mail or tel link, no e-mail address – and says so', async ({ page }) => {
    await page.goto('/');
    const pilot = page.getByTestId('pilot');
    await expect(page.getByTestId('pilot-note')).toBeVisible();
    await expect(pilot.locator('form, input, textarea, button, a[href^="mailto:"], a[href^="tel:"]')).toHaveCount(0);
    expect(await pilot.innerText()).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    for (const lang of ['pl', 'en']) { await page.getByTestId(`lang-${lang}`).click(); await expect(page.getByTestId('pilot-note')).toBeVisible(); }
  });

  test('the demo is the primary action: first in the page, a filled button next to an outline one', async ({ page }) => {
    await page.goto('/');
    const demo = page.getByTestId('cta-demo'), own = page.getByTestId('cta');
    const [a, b] = [await demo.boundingBox(), await own.boundingBox()];
    expect(a!.y).toBeLessThanOrEqual(b!.y + 1);
    expect(await demo.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    expect(await own.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  });

  test('what the demo shows equals what the landing page shows (same finding, amount, status and records)', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('lang-lt').click();
    const heroAmount = (await page.getByTestId('hero-finding-amount').innerText()).trim();
    await page.getByTestId('hero-finding-evidence').locator('summary').click();
    const heroRecords = (await page.getByTestId('evidence-records').innerText()).replace(/\s+/g, ' ');
    await page.getByTestId('cta-demo').click();
    await expect(page.getByTestId('demo-banner')).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 });
    const row = page.getByTestId('trust-finding').filter({ hasText: 'Gama pienas' }).filter({ has: page.locator('[data-testid=trust-amount]') }).first();
    await expect(row).toHaveAttribute('data-rule', 'unapplied_credit', { timeout: 30_000 });
    await expect(row).toHaveAttribute('data-status', 'verified');
    expect((await row.getByTestId('trust-amount').innerText()).trim()).toBe(heroAmount);
    await row.getByTestId('trust-open').click();
    const appRecords = (await page.getByTestId('evidence-records').first().innerText()).replace(/\s+/g, ' ');
    for (const part of ['KR-3', '300,00', 'sample_lt_saskaitos.csv', 'sample_lt_gautinos_atviros.csv']) { expect(heroRecords).toContain(part); expect(appRecords).toContain(part); }
  });

  test('isolation under stress: refresh, repeated open / leave, restart, worker operations – the visitor’s real database stays byte-for-byte identical', async ({ page, context }) => {
    // a second, clean visitor who never used the app: demo must not even create the real database
    const clean = await context.browser()!.newContext();
    const cp = await clean.newPage();
    await cp.goto('/');
    await cp.getByTestId('cta-demo').click();
    await expect(cp.getByTestId('demo-banner')).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 });
    expect((await cp.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))).sort()).toEqual(['bi-platform-demo']);
    await clean.close();

    // a visitor with real data in every kind of store the demo also writes to
    await page.goto('/app/');
    await page.getByTestId('tab-settings').click();
    await page.evaluate(async () => {
      const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('bi-platform'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const rows: Record<string, unknown[]> = {
        imports: [{ id: 'real-1', fileName: 'my-private.xlsx', checksum: 'abc', importedAt: 1, added: 1, module: 'sales', stats: { currencies: ['EUR'] }, mapping: { columns: {} } }],
        sales: [{ key: 'real-k1', importId: 'real-1', date: '2025-01-01', docKey: 'd1', amount: 123.45 }],
        finance: [{ key: 'real-f1', importId: 'real-1', date: '2025-01-01', docKey: 'f1', amount: 99 }],
        settings: [{ key: 'own-marker', value: 'mine' }],
        links: [{ id: 'real-link', status: 'confirmed', kind: 'product' }],
      };
      await new Promise<void>((res, rej) => { const tx = db.transaction(Object.keys(rows), 'readwrite'); for (const [s, rs] of Object.entries(rows)) for (const r of rs) tx.objectStore(s).put(r); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
      db.close();
    });
    const dump = () => page.evaluate(async () => {
      const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('bi-platform'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const out: Record<string, unknown> = { version: db.version };
      for (const s of Array.from(db.objectStoreNames).sort()) out[s] = await new Promise((res) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result); });
      db.close();
      return JSON.stringify(out);
    });
    const before = await dump();
    expect(before).toContain('my-private.xlsx');

    const demoCount = () => page.evaluate(async () => {
      const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('bi-platform-demo'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const n = await new Promise<number>((res) => { const q = db.transaction('imports').objectStore('imports').count(); q.onsuccess = () => res(q.result); });
      db.close();
      return n;
    });
    const ready = () => expect(page.getByTestId('demo-banner')).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 });

    for (let round = 0; round < 3; round++) {
      await page.goto('/');
      await page.getByTestId('cta-demo').click();
      await ready();
      expect(await demoCount()).toBe(7);                       // opened again: never duplicated
      await page.reload();                                      // refresh inside demo
      await ready();
      expect(await demoCount()).toBe(7);
      if (round === 1) { await page.getByTestId('demo-restart').click(); await ready(); expect(await demoCount()).toBe(7); }
      await page.getByTestId('tab-history').click();            // worker-backed views run against the demo DB only
      await page.getByTestId('tab-overview').click();
      await page.getByTestId('demo-exit').click();
      await expect(page).toHaveURL(/\/app\/$/);
    }
    expect(await dump()).toBe(before);
    // and the own workspace still shows the visitor's own import, not the demo
    await page.getByTestId('tab-history').click();
    await expect(page.getByText('my-private.xlsx')).toBeVisible();
    await expect(page.getByText('sample_lt_pardavimai.csv')).toHaveCount(0);
  });
});

