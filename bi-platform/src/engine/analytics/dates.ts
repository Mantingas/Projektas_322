/** Small UTC calendar helpers (ISO yyyy-mm-dd strings only). */
export const toMs = (iso: string) => Date.parse(iso + 'T00:00:00Z');
export const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => fromMs(toMs(iso) + n * 86400000);
export const daysBetween = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / 86400000);
/** Inclusive number of days. */
export const lengthDays = (from: string, to: string) => daysBetween(from, to) + 1;
export const monthStart = (iso: string) => iso.slice(0, 8) + '01';
export const monthEnd = (iso: string) => {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  return fromMs(Date.UTC(y, m, 0));
};
export const addMonths = (iso: string, n: number) => {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  return fromMs(Date.UTC(y, m - 1 + n, 1));
};
export const addYears = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const dim = new Date(Date.UTC(y + n, m, 0)).getUTCDate();
  return fromMs(Date.UTC(y + n, m - 1, Math.min(d, dim)));
};
/** Monday of the ISO week. */
export const weekStart = (iso: string) => {
  const dow = (new Date(toMs(iso)).getUTCDay() + 6) % 7; // Mon=0
  return addDays(iso, -dow);
};
export const min = (a: string, b: string) => (a < b ? a : b);
export const max = (a: string, b: string) => (a > b ? a : b);
