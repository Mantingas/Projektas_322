import { beforeAll, describe, expect, it } from 'vitest';
import { buildFixtures, type Fixture } from './fixtures/formats';
import { control } from './fixtures/truth';
import { runFixture } from './helpers';
import { computeKpis } from '@/engine/sales/kpi';

let fixtures: Fixture[] = [];
beforeAll(async () => {
  fixtures = await buildFixtures();
});

describe('11 realistic LT/PL/EN formats', () => {
  it('has at least 10 formats', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(10);
  });

  it.each(Array.from({ length: 11 }, (_, i) => i))('format #%i is understood and matches independent control totals', async (i) => {
    const f = fixtures[i]!;
    const r = await runFixture(f);
    const c = control(f.truth);

    // mapping proposal needs no manual correction
    const mapped = new Set(r.analysis.proposal.entries.map((e) => e.field));
    for (const field of f.expectFields) expect(mapped.has(field), `${f.id}: ${field} not proposed`).toBe(true);
    if (f.expectHeaderRow !== undefined) expect(r.analysis.table.headerRow).toBe(f.expectHeaderRow);

    // nothing silently lost
    expect(r.stats.errors, f.id).toEqual({});
    expect(r.records.length, f.id).toBe(c.lines);
    expect(r.stats.dateMin).toBe(c.dateMin);
    expect(r.stats.dateMax).toBe(c.dateMax);
    expect(r.stats.currencies).toEqual([f.expectCurrency]);

    // revenue equals control (basis net unless the file only has an unspecified amount)
    const basis = r.records[0]!.basis;
    expect(basis).toBe(f.expectBasis);
    const kpis = computeKpis(r.records, { currency: f.expectCurrency, basis })!;
    expect(Math.round(kpis.revenue * 100)).toBe(c.netCents);

    // distinct documents (if the file has document numbers)
    if (f.expectFields.includes('document_id')) expect(kpis.documents).toBe(c.documents);

    // top customer & product from normalised records == control
    const tally = (pick: (x: (typeof r.records)[number]) => string | undefined) => {
      const m = new Map<string, number>();
      for (const x of r.records) m.set(pick(x)!, (m.get(pick(x)!) ?? 0) + x.amount);
      return [...m.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    };
    expect(tally((x) => x.customerName)).toBe(c.topCustomer);
    expect(tally((x) => x.productName)).toBe(c.topProduct);

    // margin only where cost data exists
    expect(Boolean(kpis.margin), f.id).toBe(Boolean(f.expectCost));
  });

  it('records never carry invented values', async () => {
    const r = await runFixture(fixtures[0]!); // no cost column
    expect(r.records.every((x) => x.cost === undefined)).toBe(true);
  });

  it('title rows and totals rows are excluded', async () => {
    const r = await runFixture(fixtures[5]!);
    expect(r.analysis.table.skippedTotalRows).toBe(1);
    expect(r.stats.warnings.total_row).toBe(1);
  });

  it('plain "Suma" is never assumed to be net of VAT', async () => {
    const r = await runFixture(fixtures[8]!);
    expect(r.records[0]!.basis).toBe('unknown');
    expect(r.analysis.proposal.warnings.some((w) => w.code === 'amount_basis_unknown')).toBe(true);
  });
});
