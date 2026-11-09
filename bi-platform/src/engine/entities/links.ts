import type { PurchaseRecord, SalesRecord } from '../types';

/**
 * Cross-module identity – DESIGN CONTRACT for linking sales, purchasing, inventory and supplier payables later.
 *
 *  • Two records are the same entity ONLY through an explicit link.
 *  • A link can be PROPOSED automatically only from equal, verified identifiers (a product code present on both sides);
 *    it is never "confirmed" without a user decision.
 *  • Equal NAMES prove nothing: they are listed as unverified candidates and never become links.
 *  • Codes that map to several different names on either side are ambiguous and are never proposed.
 *
 * Nothing here joins data or is used by any dashboard yet; it only defines what a safe join may be built on.
 */
export type Scheme = 'product_code';

export interface EntityEnd {
  module: 'sales' | 'purchasing' | 'inventory' | 'payables';
  /** normalised key inside that module (e.g. "sku:p01") */
  key: string;
  label: string;
}

export interface EntityLink {
  id: string;
  kind: 'product';
  a: EntityEnd;
  b: EntityEnd;
  /** how the link was established */
  basis: 'identifier_equal' | 'user_confirmed';
  /** proposed = waiting for the user; confirmed / rejected = the user decided */
  status: 'proposed' | 'confirmed' | 'rejected';
  evidence: string;
}

export interface UnverifiedCandidate {
  a: EntityEnd;
  b: EntityEnd;
  reason: 'same_name_only';
}

export interface LinkProposal {
  proposed: EntityLink[];
  unverified: UnverifiedCandidate[];
  /** Codes (on either side) that stand for more than one product name: never proposed. */
  ambiguous: { module: 'sales' | 'purchasing'; code: string; names: string[] }[];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

interface Ref {
  code?: string;
  names: Set<string>;
  label: string;
}

function collect(rows: { productId?: string; productName?: string }[]): Map<string, Ref> {
  const m = new Map<string, Ref>();
  for (const r of rows) {
    const code = r.productId ? norm(r.productId) : undefined;
    const name = r.productName ? norm(r.productName) : undefined;
    const key = code ? `sku:${code}` : name ? `name:${name}` : undefined;
    if (!key) continue;
    const e = m.get(key) ?? { code, names: new Set<string>(), label: r.productName ?? r.productId ?? key };
    if (name) e.names.add(name);
    m.set(key, e);
  }
  return m;
}

export function proposeProductLinks(sales: Pick<SalesRecord, 'productId' | 'productName'>[], purchases: Pick<PurchaseRecord, 'productId' | 'productName'>[]): LinkProposal {
  const s = collect(sales);
  const p = collect(purchases);
  const out: LinkProposal = { proposed: [], unverified: [], ambiguous: [] };
  const amb = new Set<string>();
  for (const [module, map] of [['sales', s], ['purchasing', p]] as const) {
    for (const [k, r] of map) if (r.code && r.names.size > 1) { out.ambiguous.push({ module, code: r.code, names: [...r.names] }); amb.add(`${module}|${k}`); }
  }
  for (const [ks, rs] of s) {
    if (!rs.code || amb.has(`sales|${ks}`)) continue;
    const rp = p.get(ks);
    if (!rp || amb.has(`purchasing|${ks}`)) continue;
    out.proposed.push({
      id: `product:${ks}`, kind: 'product', a: { module: 'sales', key: ks, label: rs.label }, b: { module: 'purchasing', key: ks, label: rp.label },
      basis: 'identifier_equal', status: 'proposed', evidence: `equal product code "${rs.code}" on both sides`,
    });
  }
  // same NAME without a shared code is NOT evidence of identity
  const byName = new Map<string, { key: string; label: string }>();
  for (const [kp, rp] of p) for (const n of rp.names) byName.set(n, { key: kp, label: rp.label });
  for (const [ks, rs] of s) {
    for (const n of rs.names) {
      const hit = byName.get(n);
      if (!hit || out.proposed.some((l) => l.a.key === ks && l.b.key === hit.key)) continue;
      if (ks === hit.key && ks.startsWith('sku:')) continue; // same code: handled above
      out.unverified.push({ a: { module: 'sales', key: ks, label: rs.label }, b: { module: 'purchasing', key: hit.key, label: hit.label }, reason: 'same_name_only' });
    }
  }
  return out;
}

/** Only an explicit user decision changes a link's status. */
export function decideLink(link: EntityLink, decision: 'confirmed' | 'rejected', byUser: true): EntityLink {
  void byUser;
  return { ...link, status: decision, basis: decision === 'confirmed' ? 'user_confirmed' : link.basis };
}
