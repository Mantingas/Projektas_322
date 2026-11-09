/// <reference lib="webworker" />
import { EngineSession } from '@/lib/engineSession';
import { ParseError } from '@/engine/parsing/parseFile';

// Everything heavy runs here, off the UI thread. Business data never leaves the browser: the only I/O is IndexedDB and postMessage to the page.
const session = new EngineSession();
const METHODS = new Set(['parse', 'analyze', 'preview', 'commit', 'discard', 'build', 'drill', 'drillCsv']);
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (e: MessageEvent<{ id: number; method: string; args: unknown[] }>) => {
  const { id, method, args } = e.data;
  if (!METHODS.has(method)) {
    scope.postMessage({ id, ok: false, code: 'unknown_method' });
    return;
  }
  try {
    const result = await (session as unknown as Record<string, (...a: unknown[]) => unknown>)[method]!(...args);
    scope.postMessage({ id, ok: true, result });
  } catch (err) {
    scope.postMessage({ id, ok: false, code: err instanceof ParseError ? err.code : 'unknown', message: err instanceof Error ? err.message : String(err) });
  }
};
