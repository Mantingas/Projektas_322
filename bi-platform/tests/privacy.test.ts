import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk('src').filter((f) => /\.(ts|tsx)$/.test(f));
const read = (f: string) => readFileSync(f, 'utf8');

describe('privacy: business data has no path out of the browser', () => {
  const network = [/\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /\bWebSocket\b/, /\bEventSource\b/, /\bnavigator\.connection\b/, /\bimportScripts\s*\(/];
  it.each(network.map((r) => [String(r), r] as const))('src/ never uses %s', (_n, re) => {
    const offenders = files.filter((f) => re.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('src/ has no unsafe HTML / code execution sinks', () => {
    const bad = [/dangerouslySetInnerHTML/, /\.innerHTML\s*=/, /\beval\s*\(/, /new Function\s*\(/, /document\.write\s*\(/];
    for (const re of bad) expect(files.filter((f) => re.test(read(f))), String(re)).toEqual([]);
  });

  it('src/ imports no analytics / error-reporting / AI SDKs', () => {
    const banned = /(sentry|posthog|mixpanel|segment|amplitude|gtag|google-analytics|@vercel\/analytics|datadog|logrocket|hotjar|fullstory|clarity|openai|@anthropic-ai|bugsnag|rollbar|newrelic)/i;
    const offenders = files.filter((f) => /^\s*(import|export)\b.*from\s+['"]/m.test(read(f)) && read(f).split('\n').some((l) => /from\s+['"]/.test(l) && banned.test(l)));
    expect(offenders).toEqual([]);
  });

  it('package.json depends on no analytics / error-reporting / AI packages', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const all = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(all.filter((n) => /(sentry|posthog|mixpanel|segment|amplitude|analytics|datadog|logrocket|hotjar|fullstory|openai|anthropic|bugsnag|rollbar|newrelic)/i.test(n))).toEqual([]);
  });

  it('layout ships a CSP that forbids connections to other origins', () => {
    const layout = read('src/app/layout.tsx');
    expect(layout).toContain("connect-src 'self'");
    expect(layout).toContain("object-src 'none'");
    expect(layout).not.toMatch(/https?:\/\/(?!www\.w3\.org)/); // no external URLs in the shell
  });

  it('no external hosts are referenced by source files', () => {
    const offenders = files.filter((f) => /['"`]https?:\/\/(?!localhost)/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('persistence is IndexedDB only (no cookies, no server storage)', () => {
    expect(files.filter((f) => /document\.cookie/.test(read(f)))).toEqual([]);
  });

  it('only the UI language is kept in localStorage – never data', () => {
    const uses = files.filter((f) => /localStorage/.test(read(f)));
    expect(uses.map((f) => f.replace(/\\/g, '/'))).toEqual(['src/components/LangProvider.tsx']);
  });

  it('helper scripts and the compatibility framework open no network connections', () => {
    const extra = [...walk('scripts'), ...walk('tests/compat')].filter((f) => /\.(ts|mjs|js)$/.test(f));
    const net = [/\bfetch\s*\(/, /XMLHttpRequest/, /require\(['"](https?|net|tls|dgram)['"]\)/, /from ['"](node:)?(https?|net|tls|dgram)['"]/, /\baxios\b|\bgot\b\(|node-fetch/];
    for (const re of net) expect(extra.filter((f) => re.test(read(f))), String(re)).toEqual([]);
  });

  it('the engine worker has no I/O other than IndexedDB and messages to the page', () => {
    const w = read('src/workers/engine.worker.ts') + read('src/lib/engineClient.ts') + read('src/lib/engineSession.ts');
    expect(w).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|importScripts/);
  });
});

