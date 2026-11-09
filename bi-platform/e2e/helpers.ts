import type { Page, Request } from '@playwright/test';

/** Records every network request the page makes. */
export function trackRequests(page: Page) {
  const reqs: Request[] = [];
  page.on('request', (r) => reqs.push(r));
  return reqs;
}

export const isLocal = (url: string, origin: string) => url.startsWith(origin) || url.startsWith('blob:') || url.startsWith('data:');
