import { expect, test } from '@playwright/test';
import { isLocal, trackRequests } from './helpers';

const noOverflow = (page: import('@playwright/test').Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const RAW_KEY = /\b(home|demo|trust|nav)\.[a-z_.]+\b/;

test.describe('landing page', () => {
  test('LT / PL / EN: result-oriented hero, synthetic example finding, stage notice, pilot block – no pricing, no raw keys, no sideways scroll on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    for (const [lang, title, stage] of [['lt', /Atraskite, ką verta patikrinti/, /dar neatlikti/], ['pl', /Sprawdź, co warto zweryfikować/, /nie zostały jeszcze przeprowadzone/], ['en', /Find what is worth checking/, /not been carried out/]] as const) {
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
  test('the hero example cannot be mistaken for a confirmed real loss: synthetic label, status "supported by records", ONE caveat, engine status kept', async ({ page }) => {
    await page.goto('/');
    for (const [lang, badge, caveat] of [['lt', 'Pagrįsta įrašais', 'Ar tai tikras finansinis neatitikimas, reikia patikrinti'], ['pl', 'Poparte zapisami', 'trzeba sprawdzić'], ['en', 'Supported by records', 'has to be checked']] as const) {
      await page.getByTestId(`lang-${lang}`).click();
      await expect(page.getByTestId('hero-finding-label')).toBeVisible();
      await expect(page.getByTestId('hero-finding').getByTestId('evidence-status').first()).toHaveText(badge);
      await expect(page.getByTestId('hero-finding-caveat')).toContainText(caveat);
      await expect(page.getByTestId('hero-finding-status-note')).toHaveCount(0);   // no second warning on the card
      await expect(page.getByTestId('hero-finding')).toHaveAttribute('data-status', 'verified'); // the engine's own classification is untouched
      await expect(page.getByTestId('hero-finding').locator('[data-testid=evidence-status]').first()).toHaveAttribute('data-status', 'verified');
    }
  });

  test('compact page: five areas, four one-line steps, three privacy facts with the technical detail folded, a single pilot card', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByTestId('lang-lt').click();
    for (const k of ['purchasing', 'debts', 'sales', 'inventory', 'universal']) await expect(page.getByTestId(`area-${k}`)).toBeVisible();
    await expect(page.getByTestId('how').locator('li')).toHaveCount(4);
    await expect(page.getByTestId('privacy').locator('> ul > li')).toHaveCount(3);
    const details = page.getByTestId('privacy-details');
    await expect(details).not.toHaveAttribute('open', '');
    await details.locator('summary').click();
    await expect(details).toContainText('Web Worker'); await expect(details).toContainText('IndexedDB'); await expect(details).toContainText('talpinimo žurnalai');
    await expect(page.getByTestId('pilot').locator('li')).toHaveCount(2);
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(h).toBeLessThan(2900);                       // was ≈ 3770 px before the compaction
    expect(await noOverflow(page)).toBe(true);
  });

  test('no clipped button or link text anywhere on the landing page or the demo banner (390 px, LT / PL / EN)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const clipped = (root = 'body') => page.evaluate((r) => [...document.querySelectorAll(`${r} a, ${r} button, ${r} summary`)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1); }).map((e) => e.textContent?.trim().slice(0, 40)), root);
    await page.goto('/');
    for (const lang of ['lt', 'pl', 'en']) { await page.getByTestId(`lang-${lang}`).click(); await page.getByTestId('hero-finding-evidence').locator('summary').click(); expect(await clipped(), `landing ${lang}`).toEqual([]); await page.getByTestId('hero-finding-evidence').locator('summary').click(); }
    await page.getByTestId('cta-demo').click();
    await expect(page.getByTestId('demo-banner')).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 });
    for (const lang of ['pl', 'lt', 'en']) { await page.getByTestId(`lang-${lang}`).click(); expect(await clipped('[data-testid=demo-banner]'), `demo banner ${lang}`).toEqual([]); expect(await clipped('header'), `header ${lang}`).toEqual([]); }
  });

  test('without a published contact the pilot block is a plan: no invitation, no dead-end sentence, no form / link / address', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('lang-lt').click();
    const pilot = page.getByTestId('pilot');
    await expect(pilot).toBeVisible();
    await expect(page.getByTestId('pilot-contact')).toHaveCount(0);
    await expect(pilot.locator('form, input, textarea, button, a[href^="mailto:"], a[href^="tel:"]')).toHaveCount(0);
    const text = await pilot.innerText();
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(text).not.toMatch(/užsiregistruoti negalima|nie można się tu zapisać|nothing can be signed up|kol kas nėra paraiškų|Ieškome pirmųjų/i);
    await expect(pilot.getByRole('heading', { level: 2 })).toHaveText(/Ruošiame nemokamą pilotą/);
    await page.getByTestId('lang-pl').click();
    await expect(pilot.getByRole('heading', { level: 2 })).toHaveText(/Przygotowujemy bezpłatny pilotaż/);
    await page.getByTestId('lang-en').click();
    await expect(pilot.getByRole('heading', { level: 2 })).toHaveText(/We are preparing a free pilot/);
  });

  test('the demo banner has a clear, primary way back to the own workspace, also after a manual visit to /app/', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('lang-lt').click();
    await page.getByTestId('cta-demo').click();
    await expect(page.getByTestId('demo-banner')).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 });
    await expect(page.getByTestId('demo-exit')).toHaveText('Grįžti į savo darbo vietą');
    await page.goto('/app/');                                   // typed by hand: still the demo workspace, but clearly marked
    await expect(page.getByTestId('demo-banner')).toBeVisible();
    await expect(page.getByTestId('demo-exit')).toBeVisible();
    await page.getByTestId('demo-exit').click();
    await expect(page.getByTestId('demo-banner')).toHaveCount(0);
    await expect(page.getByTestId('tab-import')).toHaveAttribute('aria-selected', 'true');
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

