import 'fake-indexeddb/auto';
import fs from 'node:fs';
import path from 'node:path';
import { AppDB } from '../src/db/db';
import { EngineSession } from '../src/lib/engineSession';
import { DEMO_FILES, importDemoFile } from '../src/lib/demo';
import type { TrustFinding } from '../src/engine/trust/types';

export interface DemoFinding { finding: TrustFinding; fileNames: Record<string, string>; sampleFiles: string[]; }

/** Runs the REAL engine over the synthetic sample files and picks the largest verified unapplied credit note. Deterministic. */
export async function buildDemoFinding(root = process.cwd()): Promise<DemoFinding> {
  const db = new AppDB('demo-finding-' + Math.random().toString(36).slice(2));
  const s = new EngineSession(db);
  // importDemoFile talks to the shared engine client; in Node there is no Worker, so it runs the same EngineSession in-process.
  const { setEngineForTests } = await import('../src/lib/engineClient');
  setEngineForTests(s);
  const load = async (name: string) => { const b = fs.readFileSync(path.join(root, 'public/samples', name)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
  for (const d of DEMO_FILES) if (!(await importDemoFile(d, load))) throw new Error(`demo file failed: ${d.file}`);
  const r = await s.buildFinance({ version: 0, side: 'receivable', filters: {} as never, period: { kind: 'all' } as never });
  const cands = (r.trust?.findings ?? []).filter((f) => f.rule === 'unapplied_credit' && f.status === 'verified' && f.exposure?.kind === 'open_credit_balance');
  cands.sort((a, b) => (b.exposure?.amount ?? 0) - (a.exposure?.amount ?? 0) || a.id.localeCompare(b.id));
  const f = cands[0];
  if (!f) throw new Error('no verified unapplied credit in the demo data');
  // import ids are random per run: replace them by the (public) sample file name so the output is stable
  const imports = await db.imports.toArray();
  const nameOf = new Map(imports.map((i) => [i.id, i.fileName]));
  const records = f.records.map((x) => ({ ...x, importId: x.importId ? nameOf.get(x.importId) ?? x.importId : undefined }));
  const names = [...new Set(records.map((x) => x.importId).filter(Boolean) as string[])].sort();
  return { finding: { ...f, records: records.map((x) => (x.importId === undefined ? (({ importId: _i, ...rest }) => rest)(x) : x)) as TrustFinding['records'] }, fileNames: Object.fromEntries(names.map((n) => [n, n])), sampleFiles: DEMO_FILES.map((d) => d.file) };
}
