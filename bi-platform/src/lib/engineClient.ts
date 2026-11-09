import { EngineSession } from './engineSession';

export class EngineError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
  }
}

type Methods = 'parse' | 'analyze' | 'preview' | 'commit' | 'discard' | 'build' | 'drill' | 'drillCsv' | 'buildPurchasing' | 'priceTrendFor' | 'buildInventory';
type Fn<K extends Methods> = EngineSession[K] extends (...a: infer A) => infer R ? { args: A; result: Awaited<R> } : never;

const TIMEOUT: Record<Methods, number> = { parse: 90_000, analyze: 60_000, preview: 60_000, commit: 120_000, discard: 5_000, build: 60_000, drill: 30_000, drillCsv: 60_000, buildPurchasing: 60_000, priceTrendFor: 30_000, buildInventory: 60_000 };

/**
 * Talks to the engine Web Worker. If a call takes longer than its budget the worker is terminated (a runaway parse or analysis
 * can never freeze the page) and a fresh one is started for the next call. Without Worker support the same engine runs on the main thread.
 */
export class EngineClient {
  private worker: Worker | null = null;
  private local: EngineSession | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  private start(): Worker | null {
    if (this.worker) return this.worker;
    if (typeof Worker === 'undefined') return null;
    try {
      const w = new Worker(new URL('../workers/engine.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; code?: string; message?: string }>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(e.data.id);
        if (e.data.ok) p.resolve(e.data.result);
        else p.reject(new EngineError(e.data.code ?? 'unknown', e.data.message));
      };
      w.onerror = () => this.reset(new EngineError('worker'));
      this.worker = w;
      return w;
    } catch {
      return null;
    }
  }

  private reset(reason: EngineError) {
    this.worker?.terminate();
    this.worker = null;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(reason);
    }
    this.pending.clear();
  }

  async call<K extends Methods>(method: K, args: Fn<K>['args'], transfer: Transferable[] = []): Promise<Fn<K>['result']> {
    const w = this.start();
    if (!w) {
      this.local ??= new EngineSession();
      try {
        return (await (this.local[method] as (...a: unknown[]) => unknown)(...(args as unknown[]))) as Fn<K>['result'];
      } catch (e) {
        throw e instanceof EngineError ? e : new EngineError((e as { code?: string }).code ?? 'unknown', (e as Error).message);
      }
    }
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.reset(new EngineError('timeout')), TIMEOUT[method]);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      w.postMessage({ id, method, args }, transfer);
    });
  }
}

let shared: EngineClient | null = null;
export const engine = () => (shared ??= new EngineClient());
