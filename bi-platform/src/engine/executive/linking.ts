import { proposeCounterpartyLinks, proposeLinks, type EntityEnd, type EntityLink, type LinkKind, type LinkModule } from '../entities/links';
import type { FinanceRecord, InventoryRecord, PurchaseRecord, SalesRecord } from '../types';

export interface LinkSources { sales: SalesRecord[]; purchases: PurchaseRecord[]; inventory: InventoryRecord[]; finance: FinanceRecord[] }
export interface NameOnlyCandidate { id: string; kind: LinkKind; a: EntityEnd; b: EntityEnd }
export interface AmbiguousCode { module: LinkModule; code: string; names: string[]; kind: LinkKind }
export interface LinkWorkflow {
  /** equal verified identifiers on both sides: waiting for the user (a name check is shown next to them) */
  proposed: (EntityLink & { namesDiffer: boolean })[];
  /** same name, no shared identifier: can only become a link if the user confirms it knowingly */
  nameOnly: NameOnlyCandidate[];
  ambiguous: AmbiguousCode[];
  /** decisions already taken */
  decided: EntityLink[];
}

const pRows = (rs: { productId?: string; productName?: string }[]) => rs.filter((r) => r.productId || r.productName).map((r) => ({ productId: r.productId, productName: r.productName }));
const uniqRows = <T extends object>(rs: T[]): T[] => [...new Map(rs.map((r) => [JSON.stringify(r), r])).values()];

/**
 * Everything the user can be asked about. Links are proposed ONLY from equal identifiers; a shared name is shown as a candidate but is never
 * applied unless the user confirms it. Pairs the user already decided are not asked again.
 */
export function linkWorkflow(src: LinkSources, decided: EntityLink[]): LinkWorkflow {
  const done = new Set(decided.map((d) => d.id));
  const pairs: { kind: LinkKind; res: ReturnType<typeof proposeLinks> }[] = [];
  const sales = uniqRows(pRows(src.sales)), purch = uniqRows(pRows(src.purchases)), inv = uniqRows(pRows(src.inventory));
  if (sales.length && purch.length) pairs.push({ kind: 'product', res: proposeLinks({ module: 'sales', rows: sales }, { module: 'purchasing', rows: purch }) });
  if (sales.length && inv.length) pairs.push({ kind: 'product', res: proposeLinks({ module: 'sales', rows: sales }, { module: 'inventory', rows: inv }) });
  if (purch.length && inv.length) pairs.push({ kind: 'product', res: proposeLinks({ module: 'purchasing', rows: purch }, { module: 'inventory', rows: inv }) });
  const cust = uniqRows(src.sales.filter((r) => r.customerId || r.customerName).map((r) => ({ id: r.customerId, name: r.customerName })));
  const supp = uniqRows(src.purchases.filter((r) => r.supplierId || r.supplierName).map((r) => ({ id: r.supplierId, name: r.supplierName })));
  const ar = uniqRows(src.finance.filter((r) => r.side === 'receivable' && (r.counterpartyId || r.counterpartyName)).map((r) => ({ id: r.counterpartyId, name: r.counterpartyName })));
  const ap = uniqRows(src.finance.filter((r) => r.side === 'payable' && (r.counterpartyId || r.counterpartyName)).map((r) => ({ id: r.counterpartyId, name: r.counterpartyName })));
  if (cust.length && ar.length) pairs.push({ kind: 'counterparty', res: proposeCounterpartyLinks({ module: 'sales', rows: cust }, { module: 'finance', rows: ar }) });
  if (supp.length && ap.length) pairs.push({ kind: 'counterparty', res: proposeCounterpartyLinks({ module: 'purchasing', rows: supp }, { module: 'finance', rows: ap }) });

  const out: LinkWorkflow = { proposed: [], nameOnly: [], ambiguous: [], decided };
  for (const { kind, res } of pairs) {
    for (const l of res.proposed) {
      if (done.has(l.id)) continue;
      out.proposed.push({ ...l, namesDiffer: l.a.label.trim().toLowerCase() !== l.b.label.trim().toLowerCase() });
    }
    for (const u of res.unverified) {
      const id = `manual:${kind}:${u.a.module}-${u.b.module}:${u.a.key}|${u.b.key}`;
      if (!done.has(id)) out.nameOnly.push({ id, kind, a: u.a, b: u.b });
    }
    for (const a of res.ambiguous) out.ambiguous.push({ ...a, kind });
  }
  const seen = new Set<string>();
  out.ambiguous = out.ambiguous.filter((a) => { const k = `${a.module}|${a.code}|${a.kind}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return out;
}
