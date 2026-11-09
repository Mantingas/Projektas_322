import { describe, expect, it } from 'vitest';
import { decideLink, proposeProductLinks } from '@/engine/entities/links';

describe('cross-module identity contract (nothing is joined; this defines what a safe join can rest on)', () => {
  const sales = [{ productId: 'P01', productName: 'Pienas 1 l' }, { productId: 'P02', productName: 'Miltai' }, { productName: 'Sviestas' }, { productId: 'X9', productName: 'Alfa' }, { productId: 'X9', productName: 'Beta' }];
  const purch = [{ productId: 'p01', productName: 'Pienas 1 l' }, { productId: 'P03', productName: 'Miltai' }, { productName: 'Sviestas' }, { productId: 'X9', productName: 'Alfa' }];

  it('an equal product CODE (ignoring case) is proposed, never confirmed', () => {
    const r = proposeProductLinks(sales, purch);
    const l = r.proposed.find((x) => x.a.key === 'sku:p01')!;
    expect(l).toMatchObject({ status: 'proposed', basis: 'identifier_equal', kind: 'product' });
    expect(r.proposed.every((x) => x.status === 'proposed')).toBe(true);
  });
  it('an equal NAME with different or missing codes is an unverified candidate, never a link', () => {
    const r = proposeProductLinks(sales, purch);
    expect(r.proposed.find((x) => x.a.label === 'Miltai')).toBeUndefined();
    expect(r.unverified.map((u) => `${u.a.label}→${u.b.label}`)).toEqual(expect.arrayContaining(['Miltai→Miltai', 'Sviestas→Sviestas']));
    expect(r.unverified.every((u) => u.reason === 'same_name_only')).toBe(true);
  });
  it('a code that stands for several products is ambiguous and is not proposed', () => {
    const r = proposeProductLinks(sales, purch);
    expect(r.ambiguous).toContainEqual(expect.objectContaining({ module: 'sales', code: 'x9' }));
    expect(r.proposed.find((x) => x.a.key === 'sku:x9')).toBeUndefined();
  });
  it('only an explicit user decision changes the status', () => {
    const l = proposeProductLinks(sales, purch).proposed[0]!;
    expect(decideLink(l, 'confirmed', true)).toMatchObject({ status: 'confirmed', basis: 'user_confirmed' });
    expect(decideLink(l, 'rejected', true).status).toBe('rejected');
    expect(l.status).toBe('proposed'); // the original is untouched
  });
  it('no identifiers at all → nothing is proposed', () => {
    const r = proposeProductLinks([{ productName: 'A' }], [{ productName: 'B' }]);
    expect(r).toEqual({ proposed: [], unverified: [], ambiguous: [] });
  });
});
