
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

export type LinkModule = 'sales' | 'purchasing' | 'inventory' | 'payables' | 'finance';
export type LinkKind = 'product' | 'counterparty';

export interface EntityEnd {
  module: LinkModule;
  /** normalised key inside that module (e.g. "sku:p01") */
  key: string;
  label: string;
}

export interface EntityLink {
  id: string;
  kind: LinkKind;
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
  ambiguous: { module: LinkModule; code: string; names: string[] }[];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

interface Ref {
  code?: string;
  names: Set<string>;
  label: string;
}

/** Entity key of a product row inside any module (`sku:<code>` when a code exists, else `name:<name>`). */
export const productKeyOf = (r: ProductRow): string | undefined => (r.productId ? `sku:${norm(r.productId)}` : r.productName ? `name:${norm(r.productName)}` : undefined);
/** Entity key of a counterparty (customer / supplier / debtor / creditor) row: `cp:<id>` when an identifier exists, else `cpname:<name>`. */
export const counterpartyKeyOf = (r: { id?: string; name?: string }): string | undefined => (r.id ? `cp:${norm(r.id)}` : r.name ? `cpname:${norm(r.name)}` : undefined);

type ColRow = { code?: string; name?: string };
function collect(rows: ColRow[], keyOf: (r: ColRow) => string | undefined): Map<string, Ref> {
  const m = new Map<string, Ref>();
  for (const r of rows) {
    const code = r.code ? norm(r.code) : undefined;
    const name = r.name ? norm(r.name) : undefined;
    const key = keyOf(r);
    if (!key) continue;
    const e = m.get(key) ?? { code, names: new Set<string>(), label: r.name ?? r.code ?? key };
    if (name) e.names.add(name);
    m.set(key, e);
  }
  return m;
}

type ProductRow = { productId?: string; productName?: string };

const prodCol = (r: ProductRow): ColRow => ({ code: r.productId, name: r.productName });
const prodKey = (r: ColRow) => productKeyOf({ productId: r.code, productName: r.name });
const cpCol = (r: { id?: string; name?: string }): ColRow => ({ code: r.id, name: r.name });
const cpKey = (r: ColRow) => counterpartyKeyOf({ id: r.code, name: r.name });

/** Proposes product links between ANY two modules, from equal verified codes only. */
export function proposeLinks(left: { module: LinkModule; rows: ProductRow[] }, right: { module: LinkModule; rows: ProductRow[] }): LinkProposal {
  return proposeEntities('product', { module: left.module, rows: left.rows.map(prodCol) }, { module: right.module, rows: right.rows.map(prodCol) }, prodKey);
}

/** Proposes customer / supplier ↔ debtor / creditor links between two modules from equal verified identifiers only. */
export function proposeCounterpartyLinks(left: { module: LinkModule; rows: { id?: string; name?: string }[] }, right: { module: LinkModule; rows: { id?: string; name?: string }[] }): LinkProposal {
  return proposeEntities('counterparty', { module: left.module, rows: left.rows.map(cpCol) }, { module: right.module, rows: right.rows.map(cpCol) }, cpKey);
}

function proposeEntities(kind: LinkKind, left: { module: LinkModule; rows: ColRow[] }, right: { module: LinkModule; rows: ColRow[] }, keyOf: (r: ColRow) => string | undefined): LinkProposal {
  const s = collect(left.rows, keyOf);
  const p = collect(right.rows, keyOf);
  const out: LinkProposal = { proposed: [], unverified: [], ambiguous: [] };
  const amb = new Set<string>();
  for (const [module, map] of [[left.module, s], [right.module, p]] as const) {
    for (const [k, r] of map) if (r.code && r.names.size > 1) { out.ambiguous.push({ module, code: r.code, names: [...r.names] }); amb.add(`${module}|${k}`); }
  }
  for (const [ks, rs] of s) {
    if (!rs.code || amb.has(`${left.module}|${ks}`)) continue;
    const rp = p.get(ks);
    if (!rp || amb.has(`${right.module}|${ks}`)) continue;
    out.proposed.push({
      id: `${kind}:${left.module}-${right.module}:${ks}`, kind, a: { module: left.module, key: ks, label: rs.label }, b: { module: right.module, key: ks, label: rp.label },
      basis: 'identifier_equal', status: 'proposed', evidence: `equal ${kind === 'product' ? 'product code' : 'identifier'} "${rs.code}" on both sides`,
    });
  }
  // same NAME without a shared code is NOT evidence of identity
  const byName = new Map<string, { key: string; label: string }>();
  for (const [kp, rp] of p) for (const n of rp.names) byName.set(n, { key: kp, label: rp.label });
  for (const [ks, rs] of s) {
    for (const n of rs.names) {
      const hit = byName.get(n);
      if (!hit || out.proposed.some((l) => l.a.key === ks && l.b.key === hit.key)) continue;
      if (ks === hit.key && (ks.startsWith('sku:') || ks.startsWith('cp:'))) continue; // same code: handled above
      out.unverified.push({ a: { module: left.module, key: ks, label: rs.label }, b: { module: right.module, key: hit.key, label: hit.label }, reason: 'same_name_only' });
    }
  }
  return out;
}

export const proposeProductLinks = (sales: ProductRow[], purchases: ProductRow[]): LinkProposal => proposeLinks({ module: 'sales', rows: sales }, { module: 'purchasing', rows: purchases });
/** Inventory ↔ sales / purchasing (e.g. "which stock item is this sale / purchase about?"). */
export const proposeInventoryLinks = (inventory: ProductRow[], other: { module: 'sales' | 'purchasing'; rows: ProductRow[] }): LinkProposal => proposeLinks({ module: 'inventory', rows: inventory }, other);

/**
 * The ONLY way another module may reach an item: through a link the user CONFIRMED. Proposed, rejected and name-only candidates never resolve.
 * Returns the counterpart in `to`, or undefined.
 */
export function confirmedCounterpart(links: EntityLink[], from: EntityEnd, to: LinkModule, kind?: LinkKind): EntityEnd | undefined {
  for (const l of links) {
    if (l.status !== 'confirmed' || (kind && l.kind !== kind)) continue;
    if (l.a.module === from.module && l.a.key === from.key && l.b.module === to) return l.b;
    if (l.b.module === from.module && l.b.key === from.key && l.a.module === to) return l.a;
  }
  return undefined;
}

/** Only an explicit user decision changes a link's status. */
export function decideLink(link: EntityLink, decision: 'confirmed' | 'rejected', byUser: true): EntityLink {
  void byUser;
  return { ...link, status: decision, basis: decision === 'confirmed' ? 'user_confirmed' : link.basis };
}
