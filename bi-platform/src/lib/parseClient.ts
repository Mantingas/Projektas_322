import type { ParsedFile } from '@/engine/types';
import type { ParseErrorCode } from '@/engine/parsing/errors';

export class ClientParseError extends Error {
  constructor(public readonly code: ParseErrorCode | 'unknown') {
    super(code);
  }
}

let seq = 0;

/** Parses in a Web Worker so large files do not freeze the page. Falls back to the main thread if workers are unavailable. */
export async function parseInWorker(bytes: ArrayBuffer, fileName: string): Promise<ParsedFile> {
  if (typeof Worker === 'undefined') return parseOnMainThread(bytes, fileName);
  let worker: Worker;
  try {
    worker = new Worker(new URL('../workers/parse.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return parseOnMainThread(bytes, fileName);
  }
  const id = ++seq;
  return new Promise<ParsedFile>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; parsed?: ParsedFile; code?: ParseErrorCode | 'unknown' }>) => {
      if (e.data.id !== id) return;
      worker.terminate();
      if (e.data.ok && e.data.parsed) resolve(e.data.parsed);
      else reject(new ClientParseError(e.data.code ?? 'unknown'));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new ClientParseError('unknown'));
    };
    worker.postMessage({ id, bytes: bytes.slice(0), fileName });
  });
}

async function parseOnMainThread(bytes: ArrayBuffer, fileName: string): Promise<ParsedFile> {
  const { parseFile, ParseError } = await import('@/engine/parsing/parseFile');
  try {
    return await parseFile(new Uint8Array(bytes), fileName);
  } catch (e) {
    throw new ClientParseError(e instanceof ParseError ? e.code : 'unknown');
  }
}
