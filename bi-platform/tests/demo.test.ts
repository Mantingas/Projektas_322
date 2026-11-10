import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { AppDB } from '@/db/db';
import { EngineSession } from '@/lib/engineSession';
import { activeDbName, DEMO_DB, isDemoMode, REAL_DB } from '@/db/dbName';
import { DEMO_FILES } from '@/lib/demo';
import { buildDemoFinding } from '../scripts/demoFindingBuild';
import committed from '@/generated/demoFinding.json';
import { DEMO_TEXT } from '@/generated/demoSamples';

describe('the landing-page example finding is produced by the real engine', () => {
  it('the committed file equals a fresh run over the synthetic sample files (run `npm run demo:finding` if this fails)', async () => {
    const fresh = await buildDemoFinding();
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(committed);
  }, 60_000);

  it('is a verified unapplied credit note with its records, an amount and a stated basis', () => {
    const f = committed.finding;
    expect(f.rule).toBe('unapplied_credit');
    expect(f.status).toBe('verified');
    expect(f.exposure).toMatchObject({ kind: 'open_credit_balance' });
    expect(f.exposure!.amount).toBeGreaterThan(0);
    expect(f.records.length).toBeGreaterThanOrEqual(2);
    expect(f.records.every((r) => r.sourceRow > 0 && r.importId)).toBe(true);
    expect(f.limitations.length).toBeGreaterThan(0);
    expect(f.amountBasis).toBe('as_stated');
  });

  it('every evidence record points at the real row of the real source file (document id and amount match the CSV)', () => {
    for (const r of committed.finding.records) {
      const lines = fs.readFileSync(`public/samples/${r.importId}`, 'utf8').split(/\r?\n/);
      const row = lines[r.sourceRow - 1]!; // sourceRow is the 1-based line of the file, header on line 1
      expect(row, `${r.importId}:${r.sourceRow}`).toContain(r.documentId!);
      expect(row).toContain(String(Math.abs(r.amount)).replace('.', ','));
    }
  });

  it('only uses the shipped synthetic samples (no real data can end up on the landing page)', () => {
    for (const n of committed.sampleFiles) expect(fs.existsSync(`public/samples/${n}`)).toBe(true);
    expect(JSON.stringify(committed)).not.toMatch(/@|https?:\/\//);
  });
});

describe('the bundled demo samples', () => {
  it('equal the files in public/samples byte for byte (run `npm run demo:finding` if this fails)', () => {
    expect(Object.keys(DEMO_TEXT).sort()).toEqual(DEMO_FILES.map((d) => d.file).sort());
    for (const d of DEMO_FILES) expect(DEMO_TEXT[d.file], d.file).toBe(fs.readFileSync(`public/samples/${d.file}`, 'utf8'));
  });
  it('import through the bundled text exactly as through the files', async () => {
    const { setEngineForTests } = await import('@/lib/engineClient');
    const { importDemoFile } = await import('@/lib/demo');
    const db = new AppDB('demo-bundled-' + Math.random());
    setEngineForTests(new EngineSession(db));
    const load = async (n: string) => { const u = new TextEncoder().encode(DEMO_TEXT[n]!); return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer; };
    for (const d of DEMO_FILES) expect(await importDemoFile(d, load), d.file).toBe(true);
    expect(await db.imports.count()).toBe(DEMO_FILES.length);
  }, 60_000);
});

describe('demo files import completely through the normal engine', () => {
  it('every demo file is listed, exists and the demo set covers all four data modules', () => {
    for (const d of DEMO_FILES) expect(fs.existsSync(`public/samples/${d.file}`), d.file).toBe(true);
    expect(new Set(DEMO_FILES.map((d) => d.module))).toEqual(new Set(['sales', 'purchasing', 'inventory', 'finance']));
  });

  it('commits rows for each module into the (separate) database', async () => {
    const { setEngineForTests } = await import('@/lib/engineClient');
    const { importDemoFile } = await import('@/lib/demo');
    const db = new AppDB('demo-test-' + Math.random());
    setEngineForTests(new EngineSession(db));
    const load = async (n: string) => { const b = fs.readFileSync(`public/samples/${n}`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
    for (const d of DEMO_FILES) expect(await importDemoFile(d, load), d.file).toBe(true);
    const imports = await db.imports.toArray();
    expect(imports).toHaveLength(DEMO_FILES.length);
    expect(await db.sales.count()).toBeGreaterThan(0);
    expect(await db.purchases.count()).toBeGreaterThan(0);
    expect(await db.inventory.count()).toBeGreaterThan(0);
    expect(await db.finance.count()).toBeGreaterThan(0);
    // importing the whole set a second time (a second tab, a refresh mid-way) adds nothing
    const before = { imports: await db.imports.count(), sales: await db.sales.count(), purchases: await db.purchases.count(), inventory: await db.inventory.count(), finance: await db.finance.count() };
    for (const d of DEMO_FILES) expect(await importDemoFile(d, load), d.file).toBe(true);
    expect({ imports: await db.imports.count(), sales: await db.sales.count(), purchases: await db.purchases.count(), inventory: await db.inventory.count(), finance: await db.finance.count() }).toEqual(before);
  }, 60_000);
});

describe('demo mode never shares a database with the visitor’s own data', () => {
  const g = globalThis as unknown as { window?: unknown };
  afterEach(() => { delete g.window; });
  const fakeWindow = (search: string, stored: Record<string, string> = {}) => {
    g.window = { location: { search }, sessionStorage: { getItem: (k: string) => stored[k] ?? null, setItem: (k: string, v: string) => { stored[k] = v; }, removeItem: (k: string) => { delete stored[k]; } } };
    return stored;
  };

  it('uses the real database by default', () => {
    fakeWindow('');
    expect(isDemoMode()).toBe(false);
    expect(activeDbName()).toBe(REAL_DB);
  });
  it('?demo=1 switches to the demo database and remembers it for the tab', () => {
    const store = fakeWindow('?demo=1');
    expect(activeDbName()).toBe(DEMO_DB);
    expect(store['bi-demo']).toBe('1');
    (g.window as { location: { search: string } }).location.search = '';
    expect(activeDbName()).toBe(DEMO_DB);
  });
  it('the two database names differ', () => {
    expect(DEMO_DB).not.toBe(REAL_DB);
  });
  it('the engine worker opens the database the page names on each call, never a default', () => {
    const w = fs.readFileSync('src/workers/engine.worker.ts', 'utf8');
    const c = fs.readFileSync('src/lib/engineClient.ts', 'utf8');
    expect(c).toMatch(/postMessage\(\{ id, method, args, db: activeDbName\(\) \}/);
    expect(w).toMatch(/new AppDB\(db\)/);
    expect(w).not.toMatch(/new EngineSession\(\)/);
  });
  it('getDb switches databases when the mode changes instead of reusing the old one', async () => {
    const { getDb } = await import('@/db/db');
    fakeWindow('');
    const a = getDb();
    expect(a.name).toBe(REAL_DB);
    fakeWindow('?demo=1');
    expect(getDb().name).toBe(DEMO_DB);
    fakeWindow('');
    expect(getDb().name).toBe(REAL_DB);
  });
});
