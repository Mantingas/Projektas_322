/**
 * Which IndexedDB database this page / worker uses.
 * The public demo runs on synthetic sample files in a SEPARATE database ('bi-platform-demo'), so opening the demo can never read,
 * overwrite or delete a visitor's own imported data (stored in 'bi-platform').
 * Demo mode is switched on by `?demo=1` and kept for the browser tab (sessionStorage). The engine Web Worker is started with the
 * page sends the database name with every engine call, so the Web Worker always opens the same database as the page.
 */
export const REAL_DB = 'bi-platform';
export const DEMO_DB = 'bi-platform-demo';
const KEY = 'bi-demo';

export function isDemoMode(): boolean {
  try {
    if (typeof window === 'undefined') return false; // workers do not decide: the page names the database on every call
    if (new URLSearchParams(window.location.search).get('demo') === '1') window.sessionStorage.setItem(KEY, '1');
    return window.sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export const activeDbName = () => (isDemoMode() ? DEMO_DB : REAL_DB);

/** Leaves demo mode and returns to the visitor's own workspace. */
export function leaveDemo(): void {
  clearDemoFlag();
  window.location.assign('/app/');
}

/** Forgets demo mode (the visitor is back on the landing page or chose to use their own file). */
export function clearDemoFlag(): void {
  try { window.sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
