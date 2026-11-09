/** Lower-case, diacritic-free, punctuation-free form used for header comparison (LT/PL/EN). */
export function normalizeHeader(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ł/g, 'l')
    .replace(/ø/g, 'o')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokens(raw: string): string[] {
  const n = normalizeHeader(raw);
  return n ? n.split(' ') : [];
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  const prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[n]!;
}
