import type { Page, Request } from '@playwright/test';

/** Records every network request the page makes. */
export function trackRequests(page: Page) {
  const reqs: Request[] = [];
  page.on('request', (r) => reqs.push(r));
  return reqs;
}

export const isLocal = (url: string, origin: string) => url.startsWith(origin) || url.startsWith('blob:') || url.startsWith('data:');

/**
 * Main-thread watchdog: records every task longer than 50 ms and the worst timer delay. Used by the large-file test; the watchdog test below
 * proves that it really sees blocking, so the 120 000-line test cannot go blind.
 */
export async function installWatchdog(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __long: number[]; __gap: number };
    w.__long = []; w.__gap = 0;
    new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__long.push(e.duration))).observe({ entryTypes: ['longtask'] });
    let last = performance.now();
    setInterval(() => { const n = performance.now(); w.__gap = Math.max(w.__gap, n - last - 50); last = n; }, 50);
  });
}
export async function readWatchdog(page: Page) {
  const { long, gap } = await page.evaluate(() => { const w = window as unknown as { __long: number[]; __gap: number }; return { long: w.__long, gap: w.__gap }; });
  return { worst: Math.max(0, ...long), gap, tasks: long.length };
}

/** Writes already-normalised records straight into the app's IndexedDB (what imports would have stored), then the page is reloaded to read them. */
export async function seedDatabase(page: Page, data: { imports: unknown[]; sales: unknown[]; purchases: unknown[]; inventory: unknown[]; finance: unknown[]; links?: unknown[] }) {
  await page.evaluate(async (d) => {
    const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('bi-platform'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const stores = ['imports', 'sales', 'purchases', 'inventory', 'finance', 'links'];
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(stores, 'readwrite');
      for (const s of stores) { const os = tx.objectStore(s); os.clear(); for (const row of (d as Record<string, unknown[]>)[s] ?? []) os.put(row); }
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, data);
}
