import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { AppDB } from '@/db/db';
import { clearReview, exportBackup, restoreBackup, saveMissed, savePilotMeta, saveReview, wipeAll } from '@/db/store';
import { pilotMetrics, type PilotFinding, type PilotImport } from '@/engine/pilot/metrics';
import { emptyMeta, type Missed, type PilotMeta, type Review } from '@/engine/pilot/types';

const f = (id: string, o: Partial<PilotFinding> = {}): PilotFinding => ({ id, rule: 'unapplied_credit', status: 'candidate', side: 'payable', currency: 'EUR', label: 'X', exposure: 100, exposureKind: 'possible_excess', records: 2, ...o });
const rv = (id: string, o: Partial<Review> = {}): Review => ({ id, decision: 'confirmed', category: 'unapplied_credit', side: 'payable', evidenceStatus: 'candidate', calculatedAmount: 100, currency: 'EUR', reconciliation: 'checked in the books', reason: '', confirmedDiscrepancy: 100, recoverable: null, recovered: null, recoveredEvidence: '', prevented: null, preventedEvidence: '', minutes: 10, reviewer: 'AB', reviewedAt: 1, ...o });
const ms = (id: string, o: Partial<Missed> = {}): Missed => ({ id, description: 'd', category: 'duplicate_payment', amount: 50, currency: 'EUR', sourceRefs: 'PAY-1', findingId: '', reason: 'no reference', addedAt: 1, ...o });
const meta = (o: Partial<PilotMeta> = {}): PilotMeta => ({ ...emptyMeta(), ...o });
const imp = (financeKind: string, o: Partial<PilotImport> = {}): PilotImport => ({ fileName: 'f', financeKind, financeSide: 'payable', dateMin: '2025-01-01', dateMax: '2025-12-31', added: 10, importedAt: 1, warnings: 0, errors: 0, ...o });
const run = (o: Partial<Parameters<typeof pilotMetrics>[0]> = {}) => pilotMetrics({ findings: [], potential: [], reviews: [], missed: [], meta: meta(), imports: [], ...o });

describe('pilot metrics keep the value tiers apart and refuse numbers without a denominator', () => {
  it('counts decisions; precision is over decided findings only and is indicative below 30', () => {
    const m = run({ findings: [f('a'), f('b'), f('c'), f('d'), f('w', { status: 'withheld' })], reviews: [rv('a'), rv('b', { decision: 'false_positive', reason: 'was a deposit' }), rv('c', { decision: 'inconclusive', reason: 'no bank data' })] });
    expect(m.review).toMatchObject({ confirmed: 1, falsePositive: 1, inconclusive: 1, awaiting: 1 });
    expect(m.findings).toMatchObject({ total: 5, reviewable: 4, withheld: 1 });
    expect(m.precision).toEqual({ value: 0.5, confirmed: 1, decided: 2, indicative: true });
    expect(run({ findings: [f('a')] }).precision).toMatchObject({ value: null, reason: 'no_decisions' });
    const many = Array.from({ length: 40 }, (_, i) => f(`x${i}`));
    expect(run({ findings: many, reviews: many.map((x, i) => rv(x.id, { decision: i < 30 ? 'confirmed' : 'false_positive', reason: 'r' })) }).precision).toMatchObject({ value: 0.75, indicative: false });
  });

  it('recall exists only when the reviewer attests the reference list is complete and it has entries', () => {
    const findings = [f('a'), f('b')];
    const missed = [ms('m1', { findingId: 'a' }), ms('m2'), ms('m3', { findingId: 'gone' })];
    expect(run({ findings, missed }).recall).toMatchObject({ value: null, reason: 'list_not_attested', known: 3, found: 1 });
    expect(run({ findings, missed, meta: meta({ missedListComplete: true }) }).recall).toMatchObject({ value: 1 / 3, known: 3, found: 1 });
    expect(run({ findings, missed: [], meta: meta({ missedListComplete: true }) }).recall).toMatchObject({ value: null, reason: 'no_known_problems' });
    expect(run({ findings, missed, meta: meta({ missedListComplete: true }) }).missed).toEqual({ total: 3, found: 1, notFound: 2 });
  });

  it('exposure, confirmed discrepancy, recoverable, recovered and prevented are separate numbers per side and currency – never summed', () => {
    const findings = [f('a'), f('b'), f('c', { currency: 'PLN' })];
    const reviews = [rv('a', { confirmedDiscrepancy: 80, recoverable: 60, recovered: 20, recoveredEvidence: 'bank stmt 5 Mar', prevented: 10, preventedEvidence: 'payment stopped' }), rv('b', { confirmedDiscrepancy: 40 }), rv('c', { confirmedDiscrepancy: 7 })];
    const m = run({ findings, reviews, potential: [{ side: 'payable', currency: 'EUR', total: 500 }, { side: 'payable', currency: 'PLN', total: 90 }] });
    expect(m.tiers).toEqual([
      { side: 'payable', currency: 'EUR', exposure: 500, confirmedDiscrepancy: 120, recoverable: 60, recovered: 20, prevented: 10 },
      { side: 'payable', currency: 'PLN', exposure: 90, confirmedDiscrepancy: 7, recoverable: 0, recovered: 0, prevented: 0 },
    ]);
    expect(JSON.stringify(m)).not.toMatch(/"(total|grandTotal|value)Value"/);
  });

  it('recovered or prevented money without independent evidence is left out and flagged', () => {
    const m = run({ findings: [f('a')], reviews: [rv('a', { recoverable: 100, recovered: 100, recoveredEvidence: '  ', prevented: 5, preventedEvidence: '' })] });
    expect(m.tiers[0]).toMatchObject({ recovered: 0, prevented: 0 });
    expect(m.excluded).toEqual({ recoveredWithoutEvidence: 100, preventedWithoutEvidence: 5 });
    expect(m.warnings).toContain('amounts_without_evidence');
    expect(run({ findings: [f('a')], reviews: [rv('a', { recoverable: 10, recovered: 50, recoveredEvidence: 'x' })] }).warnings).toContain('recovered_exceeds_recoverable');
  });

  it('review quality is checked: no reconciliation, no reason for rejection, a rejected VERIFIED finding, orphaned reviews', () => {
    const m = run({ findings: [f('a', { status: 'verified' }), f('b')], reviews: [rv('a', { decision: 'false_positive', reason: '' }), rv('b', { reconciliation: '' }), rv('gone')] });
    expect(m.warnings).toEqual(expect.arrayContaining(['confirmed_without_reconciliation', 'rejected_without_reason', 'verified_rejected', 'orphaned_reviews']));
    expect(m.review.orphaned).toBe(1);
  });

  it('time saved needs a baseline, the preparation time and every finding reviewed; it can be negative', () => {
    const fs = [f('a'), f('b')];
    expect(run({ findings: fs, reviews: [rv('a', { minutes: 30 }), rv('b', { minutes: 20 })] }).time).toMatchObject({ verificationMinutes: 50, avgMinutes: 25, savedMinutes: null, savedReason: 'no_baseline' });
    expect(run({ findings: fs, reviews: [rv('a')], meta: meta({ baselineMinutes: 600, prepMinutes: 60 }) }).time).toMatchObject({ savedMinutes: null, savedReason: 'reviews_pending' });
    expect(run({ findings: fs, reviews: [rv('a', { minutes: 30 }), rv('b', { minutes: 20 })], meta: meta({ baselineMinutes: 600, prepMinutes: 60 }) }).time.savedMinutes).toBe(490);
    expect(run({ findings: fs, reviews: [rv('a', { minutes: 300 }), rv('b', { minutes: 300 })], meta: meta({ baselineMinutes: 240, prepMinutes: 60 }) }).time.savedMinutes).toBe(-420);
  });

  it('completeness and commercial status: NOT STARTED without attested real data, never "validated"', () => {
    expect(run().commercialStatus).toBe('not_started');
    expect(run().warnings).toContain('not_real_data');
    const full = meta({ realDataAttested: true, snapshotDate: '2025-12-31', snapshotSource: 'AP open items report', baselineMinutes: 600, prepMinutes: 60, missedListComplete: true, reviewer: 'AB' });
    const imports = [imp('invoices'), imp('credit_notes'), imp('payments'), imp('open_items', { dateMin: '2025-12-31', dateMax: '2025-12-31' })];
    const done = run({ findings: [f('a')], reviews: [rv('a')], meta: full, imports });
    expect(done.completeness).toBe(1);
    expect(done.commercialStatus).toBe('evidence_complete');
    expect(done.checks.every((c) => c.ok)).toBe(true);
    // real data attested but nothing decided yet
    expect(run({ meta: full, imports }).commercialStatus).toBe('not_started');
    // attested + decided but the snapshot date in the file differs from the documented one
    const off = run({ findings: [f('a')], reviews: [rv('a')], meta: full, imports: [imports[0]!, imports[1]!, imports[2]!, imp('open_items', { dateMin: '2025-11-30', dateMax: '2025-11-30' })] });
    expect(off.checks.find((c) => c.id === 'snapshot')!.ok).toBe(false);
    expect(off.commercialStatus).toBe('in_progress');
    // a short period fails the 12-month check
    expect(run({ meta: full, imports: [imp('invoices', { dateMax: '2025-03-31' }), imp('payments', { dateMax: '2025-03-31' })] }).checks.find((c) => c.id === 'period')!.ok).toBe(false);
    // receivable-side files do not satisfy the supplier-side pilot
    expect(run({ meta: full, imports: [imp('invoices', { financeSide: 'receivable' })] }).checks.find((c) => c.id === 'invoices')!.ok).toBe(false);
  });
});

describe('review data is local, audited, backed up, restored and wiped; schema v8 migrates from v7', () => {
  const fresh = () => new AppDB('pm-' + Math.random().toString(36).slice(2));
  it('reviews, missed cases and pilot facts round-trip through backup/restore and are removed by "delete everything"', async () => {
    const a = fresh();
    await saveReview(a, rv('a')); await saveMissed(a, ms('m1')); await savePilotMeta(a, meta({ organisation: 'Org', realDataAttested: true }));
    expect((await a.audit.toArray()).some((x) => x.action === 'review_decision' && x.detail.decision === 'confirmed')).toBe(true);
    const backup = JSON.parse(JSON.stringify(await exportBackup(a)));
    const b = fresh();
    await restoreBackup(b, { ...backup, sales: backup.sales ?? [] });
    expect([await b.reviews.count(), await b.missed.count(), (await b.pilot.get('meta'))!.organisation]).toEqual([1, 1, 'Org']);
    await clearReview(b, 'a');
    expect((await b.audit.toArray()).some((x) => x.detail.decision === 'cleared')).toBe(true);
    await wipeAll(a);
    expect([await a.reviews.count(), await a.missed.count(), await a.pilot.count()]).toEqual([0, 0, 0]);
  });
  it('a database created at schema 7 upgrades to 8 without losing data', async () => {
    const name = 'mig-' + Math.random().toString(36).slice(2);
    const v7 = new Dexie(name);
    v7.version(7).stores({ imports: 'id, checksum, importedAt', sales: 'key, importId, date, docKey, heldBy', mappings: 'signature', settings: 'key', audit: '++id, at, importId', purchases: 'key, importId, date, docKey, heldBy', inventory: 'key, importId, date, docKey, heldBy', finance: 'key, importId, date, docKey, heldBy', universal: 'id, importId', links: 'id, status, kind' });
    await v7.table('settings').put({ key: 'k', value: 1 });
    await v7.table('links').put({ id: 'l1', status: 'confirmed', kind: 'product' });
    v7.close();
    const v8 = new AppDB(name);
    await v8.open();
    expect(v8.verno).toBe(8);
    expect((await v8.settings.get('k'))!.value).toBe(1);
    expect((await v8.links.get('l1'))!.status).toBe('confirmed');
    await saveReview(v8, rv('x'));
    expect(await v8.reviews.count()).toBe(1);
  });
  it('backups made before schema 8 (without review tables) still restore', async () => {
    const a = fresh(); const backup = JSON.parse(JSON.stringify(await exportBackup(a)));
    delete backup.reviews; delete backup.missed; delete backup.pilot;
    await expect(restoreBackup(fresh(), backup)).resolves.toBeUndefined();
  });
});
