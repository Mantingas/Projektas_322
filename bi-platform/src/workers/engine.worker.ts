/// <reference lib="webworker" />
import { EngineSession } from '@/lib/engineSession';
import { AppDB } from '@/db/db';
import { ParseError } from '@/engine/parsing/parseFile';

// Everything heavy runs here, off the UI thread. Business data never leaves the browser: the only I/O is IndexedDB and postMessage to the page.
// The page names the database on EVERY call (demo data lives in a separate database). The session is rebuilt if the name ever changes.
let session: EngineSession | null = null;
let sessionDb = '';
const sessionFor = (db: string) => {
  if (!session || sessionDb !== db) { session = new EngineSession(new AppDB(db)); sessionDb = db; }
  return session;
};
const METHODS = new Set(['parse', 'analyze', 'preview', 'commit', 'discard', 'build', 'drill', 'drillCsv', 'buildPurchasing', 'priceTrendFor', 'buildInventory', 'buildFinance', 'universalProfile', 'universalCommit', 'universalList', 'universalBuild', 'linkWorkflow', 'buildExecutive']);
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (e: MessageEvent<{ id: number; method: string; args: unknown[]; db: string }>) => {
  const { id, method, args, db } = e.data;
  if (!METHODS.has(method)) {
    scope.postMessage({ id, ok: false, code: 'unknown_method' });
    return;
  }
  try {
    const result = await (sessionFor(db) as unknown as Record<string, (...a: unknown[]) => unknown>)[method]!(...args);
    scope.postMessage({ id, ok: true, result });
  } catch (err) {
    scope.postMessage({ id, ok: false, code: err instanceof ParseError ? err.code : 'unknown', message: err instanceof Error ? err.message : String(err) });
  }
};
