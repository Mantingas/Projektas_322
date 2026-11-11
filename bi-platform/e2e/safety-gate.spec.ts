import { expect, test, type Page } from '@playwright/test';

const seed = async (page: Page, rows: Record<string, unknown[]>) => page.evaluate(async (data) => {
  const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('bi-platform'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  await new Promise<void>((res, rej) => { const tx = db.transaction(Object.keys(data), 'readwrite'); for (const [s, rs] of Object.entries(data)) for (const r of rs) tx.objectStore(s).put(r); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  db.close();
}, rows);
const dump = (page: Page) => page.evaluate(async () => {
  const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('bi-platform'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const out: Record<string, unknown> = {};
  for (const s of Array.from(db.objectStoreNames).sort()) out[s] = await new Promise((res) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result); });
  db.close();
  return JSON.stringify(out);
});
const imp = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, fileName: name, checksum: id, importedAt: 1, added: 3, duplicates: 0, conflicts: 0, revisedDocs: 0, supersededLines: 0, staleLines: 0, module: 'sales', exportMode: 'full', stats: { rowsRead: 3, rowsImported: 3, rowsSkipped: 0, errors: {}, warnings: {}, examples: [], currencies: ['EUR'] }, mapping: { columns: {} }, ...extra });

test.describe('deleting data: the user is warned before anything irreversible, and demo mode never reaches the real data', () => {
  test('the old-import row is flagged and its delete confirmation is the strong one; cancelling deletes nothing', async ({ page }) => {
    await page.goto('/app/');
    await page.getByTestId('lang-en').click();
    await seed(page, { imports: [imp('old-1', 'old-rules.xlsx'), imp('new-1', 'new-rules.xlsx', { rules: 2 })] });
    await page.reload();
    await page.getByTestId('tab-history').click();
    await expect(page.getByTestId('hist-legacy')).toHaveCount(1);              // only the old-rules import is marked
    const before = await dump(page);
    const messages: string[] = [];
    page.on('dialog', (d) => { messages.push(d.message()); void d.dismiss(); });
    await page.getByRole('row', { name: /old-rules/ }).getByRole('button').click();
    await page.getByRole('row', { name: /new-rules/ }).getByRole('button').click();
    await expect.poll(() => messages.length).toBe(2);
    expect(messages[0]).toMatch(/CANNOT be undone/);
    expect(messages[0]).toMatch(/only stored copy/);
    expect(messages[0]).toMatch(/original file or a backup/);
    expect(messages[1]).toMatch(/cannot be undone/);
    expect(messages[1]).toMatch(/backup/);
    expect(await dump(page)).toBe(before);                                     // nothing was deleted
  });

  test('in demo mode a deletion touches only the demo database; the visitor’s own data stays byte-for-byte identical', async ({ page }) => {
    await page.goto('/app/');
    await seed(page, { imports: [imp('real-1', 'my-private.xlsx', { rules: 2 })] });
    const before = await dump(page);
    await page.goto('/');
    await page.getByTestId('cta-demo').click();
    await expect(page.getByTestId('demo-banner')).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 });
    await page.getByTestId('tab-history').click();
    await expect(page.getByTestId('history-table').getByRole('row')).toHaveCount(8);        // header + 7 demo imports
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('history-table').getByRole('row').nth(1).getByRole('button').click();
    await expect(page.getByTestId('history-table').getByRole('row')).toHaveCount(7);
    await expect(page.getByTestId('hist-legacy')).toHaveCount(0);                            // demo imports are made with the current rules
    await page.getByTestId('demo-exit').click();
    await expect(page).toHaveURL(/\/app\/$/);
    expect(await dump(page)).toBe(before);
  });
});
