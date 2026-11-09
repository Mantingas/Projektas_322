import type { Reliability } from '../types';

export function reliabilityFor(lines: number, periodDays?: number): { level: Reliability; reasonKey: string } {
  if (periodDays !== undefined && periodDays < 21) return { level: 'low', reasonKey: 'rel.shortPeriod' };
  if (lines >= 30) return { level: 'high', reasonKey: 'rel.enoughLines' };
  if (lines >= 10) return { level: 'medium', reasonKey: 'rel.someLines' };
  return { level: 'low', reasonKey: 'rel.fewLines' };
}

export const pctChange = (cur: number, prev: number) => (prev === 0 ? 0 : (cur - prev) / Math.abs(prev));
