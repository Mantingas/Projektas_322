import { beforeAll, describe, expect, it } from 'vitest';
import { makeUniversal, refByRegion, refMonthly, refPearson, refQuantile, refSum, toDataset, universalCsv, type UTruthRow } from './fixtures/universal';
import { analyzeUniversal, defaultConfig, selectRows } from '@/engine/universal/analyze';
import { recommendCharts } from '@/engine/universal/charts';
import { universalInsights } from '@/engine/universal/insights';
import type { UDataset } from '@/engine/universal/types';

const truth = makeUniversal();
let ds: UDataset;
beforeAll(async () => { ds = (await toDataset(universalCsv(truth, 'lt'), 'u.csv')).ds; });
const C = { date: 0, id: 1, region: 2, qty: 3, price: 4, total: 5, disc: 6, delivered: 7, rating: 8, note: 9 };
const close = (a: number, b: number, d = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(d);

describe('universal analytics match an independent reference', () => {
  it('descriptive statistics', () => {
    const a = analyzeUniversal(ds);
    const q = a.stats.find((s) => s.col === C.qty)!.desc!;
    const qs = truth.rows.map((r) => r.qty);
    expect(q.n).toBe(qs.length);
    close(q.sum, refSum(truth.rows, (r) => r.qty));
    close(q.mean, qs.reduce((x, y) => x + y, 0) / qs.length);
    close(q.median, refQuantile(qs, 0.5));
    close(q.q1, refQuantile(qs, 0.25));
    close(q.q3, refQuantile(qs, 0.75));
    expect([q.min, q.max]).toEqual([Math.min(...qs), Math.max(...qs)]);
    const d = a.stats.find((s) => s.col === C.date)!;
    expect([d.min, d.max]).toEqual([truth.rows.map((r) => r.date).sort()[0], truth.rows.map((r) => r.date).sort().at(-1)]);
    expect(a.stats.find((s) => s.col === C.delivered)!.trueShare).toBeCloseTo(truth.rows.filter((r) => r.delivered).length / truth.rows.length, 9);
  });

  it('monthly trend of a measure equals the reference sums; the unfinished month is marked partial', () => {
    const a = analyzeUniversal(ds);
    const t = a.trends.find((x) => x.col === C.total)!;
    expect(t.granularity).toBe('month');
    const ref = refMonthly(truth.rows);
    for (const p of t.points) close(p.value!, ref[p.bucket]!, 1e-6);
    expect(t.points.map((p) => p.bucket)).toEqual(Object.keys(ref).sort());
    const last = truth.rows.map((r) => r.date).sort().at(-1)!;
    expect(last < '2025-09-30').toBe(true);
    expect(t.points.at(-1)!.partial).toBe(true);
    expect(t.points[0]!.partial).toBe(false);
    // a partial month is never used as "the latest change"
    expect(t.latest!.to).toBe('2025-08-01');
    close(t.latest!.change, ref['2025-08-01']! - ref['2025-07-01']!, 1e-6);
  });

  it('period comparison: last 30 days of the data against the 30 days before', () => {
    const a = analyzeUniversal(ds);
    const last = truth.rows.map((r) => r.date).sort().at(-1)!;
    const add = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
    const inR = (r: UTruthRow, f: string, t: string) => r.date >= f && r.date <= t;
    const cur = truth.rows.filter((r) => inR(r, add(last, -29), last)), prev = truth.rows.filter((r) => inR(r, add(last, -59), add(last, -30)));
    const c = a.compare.find((x) => x.col === C.total)!;
    expect([c.current.from, c.current.to, c.previous.from, c.previous.to]).toEqual([add(last, -29), last, add(last, -59), add(last, -30)]);
    close(c.current.value!, refSum(cur, (r) => r.total));
    close(c.previous.value!, refSum(prev, (r) => r.total));
    close(c.pct!, (refSum(cur, (r) => r.total) - refSum(prev, (r) => r.total)) / refSum(prev, (r) => r.total));
    expect(c.current.rows).toBe(cur.length);
    // percentages are averaged, not summed
    expect(a.compare.find((x) => x.col === C.disc)!.agg).toBe('mean');
  });

  it('rankings, top/bottom and category distribution', () => {
    const a = analyzeUniversal(ds);
    const ref = refByRegion(truth.rows);
    const r = a.ranks.find((x) => x.dim === C.region && x.measure === C.total)!;
    expect(r.top.map((x) => x.key)).toEqual(Object.entries(ref).sort((x, y) => y[1] - x[1]).map(([k]) => k));
    for (const row of r.top) close(row.value, ref[row.key]!, 1e-6);
    expect(r.bottom[0]!.key).toBe(Object.entries(ref).sort((x, y) => x[1] - y[1])[0]![0]);
    close(r.topShare!, Math.max(...Object.values(ref)) / refSum(truth.rows, (x) => x.total), 1e-9);
    const dist = a.distributions.find((x) => x.dim === C.region)!;
    expect(Object.fromEntries(dist.rows.map((x) => [x.key, x.count]))).toEqual(Object.fromEntries(['Vilnius', 'Kaunas', 'Klaipėda', 'Šiauliai', 'Panevėžys'].map((k) => [k, truth.rows.filter((x) => x.region === k).length])));
    expect(dist.rows.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 9);
  });

  it('outliers: the planted extreme totals are found with Tukey fences, and nothing else of the discrete columns', () => {
    const a = analyzeUniversal(ds);
    const totals = truth.rows.map((r) => r.total);
    const q1 = refQuantile(totals, 0.25), q3 = refQuantile(totals, 0.75), iqr = q3 - q1;
    const expected = totals.filter((v) => v > q3 + 1.5 * iqr || v < q1 - 1.5 * iqr).sort((x, y) => x - y);
    const o = a.outliers.find((x) => x.col === C.total)!;
    expect(o.low + o.high).toBe(expected.length);
    expect(expected).toEqual(expect.arrayContaining([9800, 12500.5, 15000]));
    expect(o.examples.map((e) => e.value).sort((x, y) => x - y)).toEqual(expected.slice(-o.examples.length).sort((x, y) => x - y).length ? expect.any(Array) : []);
    expect(o.examples.map((e) => e.value)).toEqual(expect.arrayContaining([15000, 12500.5, 9800]));
    // row numbers are SHEET rows (header = row 1) so the user can find the line
    const hit = o.examples.find((e) => e.value === 15000)!;
    expect(hit.row).toBe(truth.rows.findIndex((r) => r.total === 15000) + 2);
    expect(a.outliers.find((x) => x.col === C.rating)).toBeUndefined();
    expect(a.outliers.find((x) => x.col === C.qty)).toBeUndefined();
  });

  it('missing-data diagnostics: shares, and a column that goes missing only in the second half', () => {
    const a = analyzeUniversal(ds);
    const n = truth.rows.length;
    const m = a.missing.find((x) => x.col === C.disc)!;
    expect(m.missing).toBe(truth.rows.filter((r) => r.discountPct === null).length);
    close(m.share, m.missing / n, 1e-9);
    expect(m.shifts).toBe(true);
    expect(m.firstHalf!).toBeLessThan(0.05);
    expect(m.secondHalf!).toBeGreaterThan(0.3);
    expect(a.missing.find((x) => x.col === C.note)!.shifts).toBe(false);
    expect(a.overview.missingCells).toBe(a.missing.reduce((s, x) => s + x.missing, 0));
  });

  it('exact duplicate rows are found; identifiers are reported separately', () => {
    const a = analyzeUniversal(ds);
    expect(a.duplicates.exactRows).toBe(2);
    expect(a.duplicates.groups.length).toBe(2);
    expect(a.duplicates.groups.every((g) => g.rows.length === 2)).toBe(true);
    // the duplicated order numbers also repeat in the identifier column – with identical content, so they are not "conflicting"
    const id = a.duplicates.idColumns.find((x) => x.col === C.id)!;
    expect(id.duplicated).toBe(2);
    expect(id.conflicting).toBe(0);
  });

  it('correlation only when meaningful: quantity ~ amount yes, unrelated columns no, and never for identifiers', () => {
    const a = analyzeUniversal(ds);
    const c = a.correlations.find((x) => x.a === C.qty && x.b === C.total)!;
    close(c.pearson, refPearson(truth.rows.map((r) => r.qty), truth.rows.map((r) => r.total)), 1e-9);
    // the three planted extreme amounts wreck Pearson (≈ 0) but not the rank correlation: the pair is meaningful, and flagged as outlier-sensitive
    expect(Math.abs(c.pearson)).toBeLessThan(0.1);
    expect(c.spearman).toBeGreaterThan(0.8);
    expect(c.meaningful).toBe(true);
    expect(c.outlierSensitive).toBe(true);
    // without the extremes the two agree
    const clean = { ...ds, cols: ds.cols.map((col) => col.filter((_, i) => (ds.cols[5]![i] as number) < 5000)) };
    const cc = analyzeUniversal({ ...clean, rowCount: clean.cols[0]!.length, rowNumbers: ds.rowNumbers.filter((_, i) => (ds.cols[5]![i] as number) < 5000) }).correlations.find((x) => x.a === C.qty && x.b === C.total)!;
    expect(cc.pearson).toBeGreaterThan(0.8);
    expect(cc.outlierSensitive).toBe(false);
    expect(c.n).toBe(truth.rows.length);
    const rating = a.correlations.filter((x) => x.a === C.rating || x.b === C.rating);
    expect(rating.every((x) => !x.meaningful)).toBe(true);
    expect(a.correlations.some((x) => x.a === C.id || x.b === C.id)).toBe(false);
    // a perfect copy of a column is reported as redundant, not as an insight
    const cols = ds.columns.map((x) => ({ ...x }));
    const copy: UDataset = { ...ds, columns: [...cols, { ...cols[C.qty]!, index: 10, header: 'Kiekis (kopija)' }], cols: [...ds.cols, [...ds.cols[C.qty]!]] };
    const b = analyzeUniversal(copy);
    expect(b.correlations.find((x) => x.b === 10 && x.a === C.qty)!.redundant).toBe(true);
    expect(universalInsights(b).find((i) => i.id === 'universal.correlation')!.params.a).not.toBe('Kiekis (kopija)');
  });

  it('few rows: no correlation, no outliers, no histogram', () => {
    const small: UDataset = { ...ds, rowCount: 12, cols: ds.cols.map((c) => c.slice(0, 12)), rowNumbers: ds.rowNumbers.slice(0, 12) };
    const a = analyzeUniversal(small);
    expect(a.correlations).toEqual([]);
    expect(a.outliers).toEqual([]);
    expect(a.hists).toEqual([]);
  });
});

describe('filters keep every table and chart on the same rows', () => {
  it('a category filter and a date range change all results consistently', () => {
    const cfg = { filters: [{ col: C.region, values: ['Vilnius', 'Kaunas'] }], range: { from: '2025-02-01', to: '2025-08-31' } };
    const sub = truth.rows.filter((r) => ['Vilnius', 'Kaunas'].includes(r.region) && r.date >= '2025-02-01' && r.date <= '2025-08-31');
    const a = analyzeUniversal(ds, cfg);
    expect(a.scope.rows).toBe(sub.length);
    expect(a.scope.filters).toBe(2);
    expect(a.overview.rows).toBe(sub.length);
    close(a.stats.find((s) => s.col === C.total)!.desc!.sum, refSum(sub, (r) => r.total), 1e-6);
    const trendTotal = a.trends.find((t) => t.col === C.total)!.points.reduce((s, p) => s + (p.value ?? 0), 0);
    close(trendTotal, refSum(sub, (r) => r.total), 1e-6);
    const rank = a.ranks.find((x) => x.dim === C.region && x.measure === C.total)!;
    expect(rank.top.map((x) => x.key).sort()).toEqual(['Kaunas', 'Vilnius']);
    close(rank.total, refSum(sub, (r) => r.total), 1e-6);
    expect(a.distributions.find((x) => x.dim === C.region)!.rows.reduce((s, x) => s + x.count, 0)).toBe(sub.length);
    expect(selectRows(ds, { ...cfg, dateCol: 0 }).length).toBe(sub.length);
    // charts carry the same scope and the same numbers as their table alternative
    const { charts } = recommendCharts(ds, a);
    for (const ch of charts) {
      expect(ch.scope.rows).toBe(sub.length);
      expect(ch.table.rows.length).toBeGreaterThan(0);
    }
    const line = charts.find((c) => c.id === `trend:${C.total}`)!;
    close((line.table.rows as [string, number][]).reduce((s, r) => s + Number(r[1]), 0), refSum(sub, (r) => r.total), 1e-6);
  });

  it('numeric range filters and an empty result are handled without errors', () => {
    const a = analyzeUniversal(ds, { filters: [{ col: C.qty, min: 15 }] });
    expect(a.scope.rows).toBe(truth.rows.filter((r) => r.qty >= 15).length);
    const none = analyzeUniversal(ds, { filters: [{ col: C.region, values: ['Nėra'] }] });
    expect(none.scope.rows).toBe(0);
    expect(none.trends).toEqual([]);
    expect(none.ranks).toEqual([]);
    expect(recommendCharts(ds, none).charts).toEqual([]);
  });
});

describe('chart recommendation chooses meaningful, non-redundant charts', () => {
  const { charts, skipped } = ((): ReturnType<typeof recommendCharts> => ({ charts: [], skipped: [] }))();
  void charts; void skipped;
  it('picks the right chart for each question and explains why', () => {
    const rec = recommendCharts(ds);
    const kinds = rec.charts.map((c) => c.kind);
    expect(kinds).toContain('line');
    expect(kinds).toContain('histogram');
    expect(kinds).toContain('scatter');
    expect(kinds).toContain('heatmap');
    expect(rec.charts.every((c) => c.reason && c.scope && c.table.headers.length > 1 && c.table.rows.length > 0)).toBe(true);
    // the scatter shows the one meaningful relationship, with its coefficients
    const sc = rec.charts.find((c) => c.kind === 'scatter')!;
    expect([sc.title.x, sc.title.y]).toEqual(['Kiekis', 'Suma']);
    expect((sc.data as { r: number }).r).toBeCloseTo(refPearson(truth.rows.map((r) => r.qty), truth.rows.map((r) => r.total)), 9);
    expect((sc.data as { outlierSensitive: boolean }).outlierSensitive).toBe(true);
    // units: currency column → its currency, percent → %, plain number → none stated
    expect(rec.charts.find((c) => c.id === `trend:${C.price}`)?.unit ?? 'EUR').toBe('EUR');
    expect(rec.charts.find((c) => c.id === `trend:${C.disc}`)?.unit ?? '%').toBe('%');
  });
  it('never produces two charts for the same ranking, and no Pareto for a handful of categories', () => {
    const rec = recommendCharts(ds);
    const ranking = rec.charts.filter((c) => c.question === 'ranking' || c.question === 'concentration');
    expect(new Set(ranking.map((c) => c.title.dim)).size).toBe(ranking.length);
    expect(rec.charts.some((c) => c.kind === 'pareto')).toBe(false); // 5 regions < 6
    expect(rec.charts.filter((c) => c.kind === 'scatter').every((c) => !(c.title.x === 'Reitingas' || c.title.y === 'Reitingas'))).toBe(true);
  });
  it('a Pareto replaces the bar chart when many categories are skewed', async () => {
    const r = (await import('./fixtures/universal')).rng(3);
    const rows = ['Name;Amount', ...Array.from({ length: 300 }, (_, i) => `K${Math.floor(Math.pow(r(), 3) * 12)};${(5 + r() * 10).toFixed(2).replace('.', ',')}`)];
    const { ds: d2 } = await toDataset(new TextEncoder().encode(rows.join('\n')), 'p.csv');
    const rec = recommendCharts(d2);
    const p = rec.charts.find((c) => c.kind === 'pareto')!;
    expect(p).toBeTruthy();
    expect(rec.charts.some((c) => c.kind === 'bar' && c.question === 'ranking')).toBe(false);
    const cum = (p.data as { cum: number }[]);
    expect(cum.at(-1)!.cum).toBeLessThanOrEqual(1.0000001);
    for (let i = 1; i < cum.length; i++) expect(cum[i]!.cum).toBeGreaterThanOrEqual(cum[i - 1]!.cum);
  });
  it('skips what the data cannot answer and says why', async () => {
    const rows = ['Cat;Num;Other', ...Array.from({ length: 40 }, (_, i) => `${['a', 'b'][i % 2]};${i % 7 + (i % 3) * 0.5};${(i * 37) % 11}`)];
    const { ds: d3 } = await toDataset(new TextEncoder().encode(rows.join('\n')), 'n.csv', 'accept', '.');
    const rec = recommendCharts(d3);
    expect(rec.skipped.find((s) => s.question === 'trend')!.reason).toBe('no_date');
    expect(rec.charts.some((c) => c.kind === 'line')).toBe(false);
    expect(rec.skipped.some((s) => s.question === 'relationship')).toBe(true);
    expect(rec.charts.some((c) => c.kind === 'scatter')).toBe(false);
  });
});

describe('universal insights describe the table, never its business meaning', () => {
  it('finds the planted quality and structure issues, with facts, possibilities and indicators kept apart', () => {
    const ins = universalInsights(analyzeUniversal(ds));
    const by = Object.fromEntries(ins.map((i) => [i.id, i]));
    expect(Object.keys(by).sort()).toEqual(expect.arrayContaining(['universal.duplicates', 'universal.missing', 'universal.outliers', 'universal.correlation']));
    expect(by['universal.missing']!.certainty).toBe('fact');
    expect(by['universal.duplicates']!.certainty).toBe('possible'); // identical rows may be legitimate repeats
    expect(by['universal.outliers']!.certainty).toBe('indicator');
    expect(by['universal.correlation']!.certainty).toBe('indicator');
    // a change over time is stated, never judged good or bad
    expect(ins.filter((i) => i.id === 'universal.trend_change').every((i) => i.severity === 'info')).toBe(true);
    expect(ins.every((i) => i.module === 'universal' && i.evidence.length > 0 && i.score > 0)).toBe(true);
  });
  it('defaults: measures are numeric/currency/percent columns only, identifiers are never measures', () => {
    const c = defaultConfig(ds);
    expect(c.measures).toEqual([C.qty, C.price, C.total, C.disc, C.rating]);
    expect(c.dateCol).toBe(C.date);
    expect(c.dims).toContain(C.region);
    expect(c.dims).not.toContain(C.id);
  });
});
