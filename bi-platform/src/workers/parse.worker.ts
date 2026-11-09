/// <reference lib="webworker" />
import { parseFile, ParseError } from '@/engine/parsing/parseFile';

// Runs entirely inside the browser: file bytes arrive from the page and parsed sheets go back to the page.
self.onmessage = async (e: MessageEvent<{ id: number; bytes: ArrayBuffer; fileName: string }>) => {
  const { id, bytes, fileName } = e.data;
  try {
    const parsed = await parseFile(new Uint8Array(bytes), fileName);
    (self as DedicatedWorkerGlobalScope).postMessage({ id, ok: true, parsed });
  } catch (err) {
    (self as DedicatedWorkerGlobalScope).postMessage({ id, ok: false, code: err instanceof ParseError ? err.code : 'unknown' });
  }
};
