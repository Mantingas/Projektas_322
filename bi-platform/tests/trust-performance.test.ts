import { describe, expect, it } from 'vitest';
import { Book, type CP } from './fixtures/trust';
import { analyseSettlement } from '@/engine/trust/settlement';
import { rng } from './fixtures/universal';

describe('settlement analysis stays fast on large ledgers', () => {
  it('120 000 finance records (invoices, payments, credit notes, open items) are analysed in a few seconds', () => {
    const r = rng(11);
    const b = new Book();
    const cps: CP[] = Array.from({ length: 400 }, (_, i) => ({ id: `S${i}`, name: `Tiekėjas ${i}` }));
    for (let i = 0; i < 40_000; i++) {
      const cp = cps[Math.floor(r() * cps.length)]!;
      const amt = Math.round((100 + r() * 9000) * 100) / 100;
      b.invoice(cp, `INV-${i}`, '2025-03-01', '2025-04-01', amt);
      if (r() < 0.9) b.payment(cp, `INV-${i}`, '2025-04-05', r() < 0.01 ? amt * 2 : amt);
      if (r() < 0.1) b.credit(cp, `KR-${i}`, '2025-03-10', Math.round(amt * 0.1 * 100) / 100, r() < 0.5 ? `INV-${i}` : undefined);
      if (r() < 0.25) b.open('2025-12-01', cp, `INV-${i}`, r() < 0.05 ? -Math.round(amt * 0.1 * 100) / 100 : amt, amt);
    }
    const recs = b.records;
    expect(recs.length).toBeGreaterThan(80_000);
    const t0 = performance.now();
    const res = analyseSettlement(recs, 'payable', 'EUR');
    const ms = performance.now() - t0;
    expect(res.findings.length).toBeGreaterThan(100);
    expect(ms).toBeLessThan(8000);
  }, 60_000);
});
