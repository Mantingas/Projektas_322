import { describe, expect, it } from 'vitest';
import { DICTS, type Lang } from '@/i18n';
import { buildPilotHtml, mask, metricsOf, pilotLedgerCsv, type PilotData } from '@/lib/pilotReport';
import { emptyMeta, type Missed, type Review } from '@/engine/pilot/types';
import type { PilotFinding, PilotImport } from '@/engine/pilot/metrics';

const langs: Lang[] = ['lt', 'pl', 'en'];
const D = (l: Lang) => DICTS[l] as Record<string, string>;
const f = (id: string, o: Partial<PilotFinding> = {}): PilotFinding => ({ id, rule: 'unapplied_credit', status: 'candidate', side: 'payable', currency: 'EUR', label: 'UAB Secret Supplier', exposure: 1000, exposureKind: 'possible_excess', records: 2, ...o });
const rv = (id: string, o: Partial<Review> = {}): Review => ({ id, decision: 'confirmed', category: 'unapplied_credit', side: 'payable', evidenceStatus: 'candidate', calculatedAmount: 1000, currency: 'EUR', reconciliation: 'checked', reason: '', confirmedDiscrepancy: 900, recoverable: 800, recovered: null, recoveredEvidence: '', prevented: null, preventedEvidence: '', minutes: 12, reviewer: 'AB', reviewedAt: 1, ...o });
const base = (o: Partial<PilotData> = {}): PilotData => ({ findings: [f('a'), f('b', { rule: 'duplicate_payment' })], potential: [{ side: 'payable', currency: 'EUR', total: 1500 }], reviews: [rv('a'), rv('b', { decision: 'false_positive', reason: 'was a deposit', confirmedDiscrepancy: null, recoverable: null })], missed: [], meta: { ...emptyMeta(), organisation: '<b>Org</b>' }, imports: [] as PilotImport[], withheldOther: 3, ...o });

describe('pilot report', () => {
  it('answers the seven questions, is script-free and request-free, and escapes everything', () => {
    const html = buildPilotHtml(base(), 'en');
    for (const q of ['1. What did the system find?', '2. What was independently confirmed?', '3. What did it miss?', '4. How much verified value exists?', '5. How much review time was needed?', '6. Which limitations prevent confident conclusions?', '7. What additional evidence is needed?']) expect(html).toContain(q);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('&lt;b&gt;Org&lt;/b&gt;');
  });

  it('without attested real data it says so prominently and shows status NOT STARTED', () => {
    const html = buildPilotHtml(base(), 'en');
    expect(html).toContain('NOT REAL-WORLD VALIDATION');
    expect(html).toContain('NOT STARTED');
    expect(html).toContain('describes test data only');
  });

  it('value tiers are listed separately with definitions; no grand total exists; unevidenced recovery is excluded and disclosed', () => {
    const d = base({ reviews: [rv('a', { recovered: 500, recoveredEvidence: '' })] });
    const html = buildPilotHtml(d, 'en');
    expect(html).toContain('Potential exposure (flagged by the app)');
    expect(html).toContain('Actually recovered (with evidence)');
    expect(html).toContain('Not a fact and not money');
    expect(html).toContain('Left out for lack of evidence');
    expect(html).not.toMatch(/grand total|total value|total savings/i);
    expect(metricsOf(d).tiers[0]).toMatchObject({ exposure: 1500, confirmedDiscrepancy: 900, recoverable: 800, recovered: 0 });
  });

  it('counterparty names are masked by default and appear only when redaction is switched off', () => {
    const d = base();
    const masked = buildPilotHtml(d, 'en', true), csvMasked = pilotLedgerCsv(d, 'en', true);
    expect(masked).not.toContain('Secret Supplier'); expect(csvMasked).not.toContain('Secret Supplier');
    expect(masked).toContain(mask('UAB Secret Supplier'));
    expect(mask('UAB Secret Supplier')).toBe(mask('  uab secret supplier '));
    expect(buildPilotHtml(d, 'en', false)).toContain('UAB Secret Supplier');
    expect(pilotLedgerCsv(d, 'en', false)).toContain('UAB Secret Supplier');
  });

  it('the review ledger lists every finding and every known miss, with decision, reconciliation, reason, amounts, time, and is formula-safe', () => {
    const d = base({ missed: [{ id: 'm', description: '=HYPERLINK("http://x","y")', category: 'duplicate_payment', amount: 5, currency: 'EUR', sourceRefs: '+cmd', findingId: '', reason: '@x', addedAt: 1 } as Missed] });
    const csv = pilotLedgerCsv(d, 'en', true);
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(1 + 2 + 1);
    expect(csv).toContain('was a deposit'); expect(csv).toContain('checked'); expect(csv).toContain('HYPERLINK');
    expect(csv).not.toMatch(/(^|;|\r\n)"?[=+@\t]/);
  });

  it('LT and PL reports are complete without raw keys; every pilot key exists in all languages', () => {
    for (const l of ['lt', 'pl'] as const) expect(buildPilotHtml(base(), l), l).not.toMatch(/\b(pilot|trust|itrust)\.[a-z_.]+/);
    const keys = Object.keys(D('en')).filter((k) => k.startsWith('pilot.') || k === 'nav.pilot');
    expect(keys.length).toBeGreaterThan(150);
    expect(keys.filter((k) => !langs.every((l) => (D(l)[k] ?? '').length > 0))).toEqual([]);
    for (const l of ['lt', 'pl'] as Lang[]) { const same = keys.filter((k) => D(l)[k] === D('en')[k]); expect(same.length / keys.length, `${l}: ${same.slice(0, 5)}`).toBeLessThan(0.04); }
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    for (const k of keys) for (const l of ['lt', 'pl'] as Lang[]) expect(ph(D(l)[k]!), `${l} ${k}`).toBe(ph(D('en')[k]!));
  });

  it('never states a rate it cannot support, and never says validated', () => {
    const html = buildPilotHtml(base({ reviews: [], findings: [f('a')] }), 'en');
    expect(html).toContain('Not available: no confirmed or rejected findings yet');
    expect(html).toContain('Recall cannot be computed');
    for (const l of langs) for (const [k, v] of Object.entries(D(l))) if (k.startsWith('pilot.')) expect(v, `${l} ${k}`).not.toMatch(/\bvalidated\b|commercially validated|zwalidowan|patvirtint\w+ komerciškai/i);
  });
});
