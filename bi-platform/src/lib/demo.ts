import { engine } from './engineClient';
import type { FinanceSide, ModuleId } from '@/engine/types';

/**
 * The public demo: the SYNTHETIC sample files shipped with the site, imported through the normal engine (parse → analyse → commit) into the
 * separate demo database. Nothing is fabricated – every figure comes from the real analysis of these files.
 * (The files use Lithuanian headers and company names whatever the interface language is; they are not real companies or ERP exports.)
 */
export interface DemoFile { file: string; module: ModuleId; side?: FinanceSide; asOf?: string }
export const DEMO_FILES: DemoFile[] = [
  { file: 'sample_lt_pardavimai.csv', module: 'sales' },
  { file: 'sample_lt_pirkimai.csv', module: 'purchasing' },
  { file: 'sample_lt_likuciai.csv', module: 'inventory', asOf: '2025-09-30' },
  { file: 'sample_lt_judejimai.csv', module: 'inventory' },
  { file: 'sample_lt_gautinos_atviros.csv', module: 'finance', side: 'receivable' },
  { file: 'sample_lt_saskaitos.csv', module: 'finance', side: 'receivable' },
  { file: 'sample_lt_mokejimai.csv', module: 'finance', side: 'receivable' },
];

/** Imports one demo file; returns false (and leaves everything else untouched) if anything about it fails. */
export async function importDemoFile(d: DemoFile, load: (name: string) => Promise<ArrayBuffer>): Promise<boolean> {
  const e = engine();
  const bytes = await load(d.file);
  await e.call('parse', [bytes, d.file], [bytes]);
  const a = await e.call('analyze', [0, ',', d.module]);
  if (!a) return false;
  const r = await e.call('commit', [{
    sheetIdx: 0, module: d.module, side: d.side, entries: a.proposal.entries, currency: a.proposal.detectedCurrency ?? 'EUR', asOfDate: d.asOf,
    mode: 'full', confirmed: true, allowSameChecksum: false, remember: false,
  }]);
  // 'duplicate_file' = this exact file is already in the demo database (e.g. another tab got there first): nothing is added twice
  return r.status === 'ok' || r.status === 'duplicate_file';
}

export async function loadDemoData(onStep?: (done: number, total: number) => void): Promise<boolean> {
  // the synthetic files are bundled into a chunk that is only loaded for the demo (the app itself never makes network requests of its own)
  const { DEMO_TEXT } = await import('@/generated/demoSamples');
  const fetchBytes = async (name: string) => {
    const t = DEMO_TEXT[name];
    if (t === undefined) throw new Error('demo_file_missing');
    const u = new TextEncoder().encode(t);
    return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
  };
  let ok = true;
  for (let i = 0; i < DEMO_FILES.length; i++) {
    ok = (await importDemoFile(DEMO_FILES[i]!, fetchBytes)) && ok;
    onStep?.(i + 1, DEMO_FILES.length);
  }
  return ok;
}
