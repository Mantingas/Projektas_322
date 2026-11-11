import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { kpi, runSales, type Cell } from './fixtures/salesCsv';
import { dimensionOf, disambiguateLabels } from '@/engine/analytics/filters';
import { customerOf, productOf } from '@/engine/sales/kpi';
import type { SalesRecord } from '@/engine/types';

const CH = ['Data', 'Dokumento Nr.', 'Kliento kodas', 'Klientas', 'Prekės kodas', 'Prekė', 'Kiekis', 'Suma be PVM'];
const D = '2025-06-10';

describe('I1 – a stable code wins over the name', () => {
  it('two different customers with the same name stay two customers (were merged)', async () => {
    const r = await runSales(CH, [[D, 'A1', 'C1', 'UAB Alfa', 'P1', 'Miltai', 1, 100], [D, 'A2', 'C2', 'UAB Alfa', 'P1', 'Miltai', 1, 300]]);
    expect(kpi(r.b, 'customers').current).toBe(2);
    const rows = r.b.model!.tables.customer!.rows;
    expect(rows).toHaveLength(2);
    expect(rows.map((x) => x.label).sort()).toEqual(['UAB Alfa · c1', 'UAB Alfa · c2']);      // told apart on screen
    expect(rows.map((x) => x.current).sort()).toEqual([100, 300]);
    expect(r.b.options.customer!.map((o) => o.label).sort()).toEqual(['UAB Alfa · c1', 'UAB Alfa · c2']);
  });
  it('one customer written in two ways with the same code stays one customer (was split)', async () => {
    const r = await runSales(CH, [[D, 'A1', 'C3', 'UAB Beta', 'P3', 'Sviestas', 1, 100], [D, 'A2', 'C3', 'Beta, UAB', 'P3', 'Sviestas 1 kg', 1, 100]]);
    expect(kpi(r.b, 'customers').current).toBe(1);
    expect(r.b.model!.tables.customer!.rows).toHaveLength(1);
    expect(r.b.model!.tables.product!.rows).toHaveLength(1);              // renamed product, same SKU
    expect(r.b.model!.tables.customer!.rows[0]!.current).toBe(200);
  });
  it('two SKUs with the same product name are two products', async () => {
    const r = await runSales(CH, [[D, 'A1', 'C1', 'K', 'P1', 'Miltai', 1, 100], [D, 'A2', 'C1', 'K', 'P2', 'Miltai', 1, 100]]);
    expect(r.b.model!.tables.product!.rows.map((x) => x.label).sort()).toEqual(['Miltai · p1', 'Miltai · p2']);
  });
  it('filtering by an entity key selects exactly that customer', async () => {
    const rows: Cell[][] = [[D, 'A1', 'C1', 'UAB Alfa', 'P1', 'Miltai', 1, 100], [D, 'A2', 'C2', 'UAB Alfa', 'P1', 'Miltai', 1, 300]];
    const r = await runSales(CH, rows, { preset: 'r30' }, { customers: ['id:c2'] });
    expect(kpi(r.b, 'sales').current).toBe(300);
  });
  it('without codes the normalised name is the identity, as before (case and spacing do not split)', async () => {
    const r = await runSales(['Data', 'Dokumento Nr.', 'Klientas', 'Prekė', 'Kiekis', 'Suma be PVM'], [[D, 'A1', 'UAB Alfa', 'P', 1, 100], [D, 'A2', ' uab  alfa', 'P', 1, 100]]);
    expect(kpi(r.b, 'customers').current).toBe(1);
  });
  it('the dashboard and the findings use the SAME identity function', () => {
    const rec = { key: 'k', date: D, customerId: 'C9', customerName: 'X', productId: 'S1', productName: 'Y', amount: 1, basis: 'net', currency: 'EUR', sourceRow: 1 } as SalesRecord;
    expect(customerOf(rec)).toEqual(dimensionOf.customer(rec));
    expect(productOf(rec)).toEqual(dimensionOf.product(rec));
    expect(dimensionOf.customer(rec)!.key).toBe('id:c9');
    expect(dimensionOf.customer({ ...rec, customerId: undefined })!.key).toBe('name:x');
  });
  it('disambiguateLabels only touches clashing labels of code-keyed entities', () => {
    expect(disambiguateLabels([{ key: 'id:a', label: 'X' }, { key: 'id:b', label: 'X' }, { key: 'name:y', label: 'Y' }, { key: 'name:z', label: 'Y' }])
      .map((x) => x.label)).toEqual(['X · a', 'X · b', 'Y', 'Y']);
  });
});
