import { describe, expect, it } from 'vitest';
import { confirmedCounterpart, decideLink, proposeInventoryLinks, proposeProductLinks } from '@/engine/entities/links';
import { inventoryData } from './fixtures/inventoryRecords';

describe('cross-module foundations: inventory ↔ sales / purchasing (design contract, no joins)', () => {
  const inv = inventoryData('lt').records.filter((r) => r.kind === 'snapshot');
  const purchases = [{ productId: 'p01', productName: 'Pienas 1 l' }, { productId: 'P77', productName: 'Sūris' }, { productName: 'Sviestas 200 g' }, { productId: 'P09', productName: 'Sultys' }];
  const sales = [{ productId: 'P05', productName: 'Planšetė' }, { productName: 'Kava 250 g' }];

  it('inventory items are proposed for linking ONLY through equal product codes – and stay "proposed"', () => {
    const r = proposeInventoryLinks(inv, { module: 'purchasing', rows: purchases });
    expect(r.proposed.map((l) => l.a.key).sort()).toEqual(['sku:p01', 'sku:p09']);
    expect(r.proposed.every((l) => l.status === 'proposed' && l.a.module === 'inventory' && l.b.module === 'purchasing')).toBe(true);
  });

  it('the same name without a shared code is an unverified candidate, never a link', () => {
    const r = proposeInventoryLinks(inv, { module: 'sales', rows: [{ productName: 'Kava 250 g' }, { productId: 'ZZ', productName: 'Sūris' }] });
    expect(r.proposed).toEqual([]);
    expect(r.unverified.map((u) => u.a.label)).toEqual(expect.arrayContaining(['Kava 250 g', 'Sūris']));
    expect(r.unverified.every((u) => u.reason === 'same_name_only')).toBe(true);
  });

  it('ambiguous codes on the inventory side are never proposed', () => {
    const amb = [...inv, { ...inv[0]!, productName: 'Visai kita prekė' }];
    const r = proposeInventoryLinks(amb, { module: 'sales', rows: sales });
    expect(r.ambiguous.some((a) => a.module === 'inventory' && a.code === 'p01')).toBe(true);
    expect(r.proposed.find((l) => l.a.key === 'sku:p01')).toBeUndefined();
  });

  it('another module reaches an inventory item only through a link the USER confirmed', () => {
    const r = proposeInventoryLinks(inv, { module: 'purchasing', rows: purchases });
    const link = r.proposed.find((l) => l.a.key === 'sku:p01')!;
    const from = { module: 'inventory' as const, key: 'sku:p01', label: '' };
    expect(confirmedCounterpart(r.proposed, from, 'purchasing')).toBeUndefined(); // proposed ≠ confirmed
    const rejected = decideLink(link, 'rejected', true);
    expect(confirmedCounterpart([rejected], from, 'purchasing')).toBeUndefined();
    const ok = decideLink(link, 'confirmed', true);
    expect(confirmedCounterpart([ok], from, 'purchasing')).toMatchObject({ module: 'purchasing', key: 'sku:p01' });
    expect(confirmedCounterpart([ok], { module: 'purchasing', key: 'sku:p01', label: '' }, 'inventory')).toMatchObject({ module: 'inventory' });
    expect(confirmedCounterpart([ok], from, 'sales')).toBeUndefined();
  });

  it('the original sales ↔ purchasing contract is unchanged', () => {
    const r = proposeProductLinks([{ productId: 'A', productName: 'x' }], [{ productId: 'a', productName: 'x' }]);
    expect(r.proposed).toHaveLength(1);
    expect(r.proposed[0]!.a.module).toBe('sales');
  });
});
