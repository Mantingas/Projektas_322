import type { SettlementResult } from '@/engine/trust/types';

// The soundness invariants every classification must satisfy.
export function soundness(r: SettlementResult): string[] {
  const bad: string[] = [];
  for (const f of r.findings) {
    if (f.status === 'verified') {
      if (!f.records.some((x) => x.role === 'open_balance')) bad.push(`${f.id}: verified without an open-balance record`);
      if (f.exposure?.kind !== 'open_credit_balance') bad.push(`${f.id}: verified but exposure is ${f.exposure?.kind}`);
      if (f.assumptions.some((a) => a.key === 'trust.asm.credit_by_sign')) bad.push(`${f.id}: verified on a sign assumption`);
    }
    if (f.status === 'withheld' && (!f.withheldReason || f.exposure !== null)) bad.push(`${f.id}: withheld without reason or with an amount`);
    if (f.status !== 'withheld' && f.records.length === 0) bad.push(`${f.id}: no supporting records`);
    if (f.exposure?.kind === 'open_credit_balance' && !f.records.some((x) => x.role === 'open_balance')) bad.push(`${f.id}: open credit balance without the report line`);
    if (f.exposure && !(f.exposure.amount > 0)) bad.push(`${f.id}: non-positive exposure`);
    if (!f.limitations.length) bad.push(`${f.id}: no limitations disclosed`);
  }
  const sum = Math.round(r.potential.parts.reduce((s, p) => s + p.amount, 0) * 100) / 100;
  if (sum !== r.potential.total) bad.push(`potential total ${r.potential.total} ≠ parts ${sum}`);
  for (const p of r.potential.parts) { const f = r.findings.find((x) => x.id === p.id)!; if (!f || f.status === 'withheld' || f.exposure?.kind === 'investigate') bad.push(`${p.id}: ineligible part in the total`); }
  return bad;
}

