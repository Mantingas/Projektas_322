import type { SalesField } from '../types';
import { normalizeHeader } from './normalize';

/**
 * Built-in header-signature templates.
 * These describe *generic* layouts (LT / PL / EN invoice-line exports) – they are NOT claims about
 * the exact export of any named accounting product. Real vendor templates must only be added
 * after real export files have been inspected.
 */
export interface SalesTemplate {
  id: string;
  name: string;
  /** field → normalised header */
  headers: Partial<Record<SalesField, string>>;
  required: SalesField[];
}

const t = (id: string, name: string, headers: Partial<Record<SalesField, string>>): SalesTemplate => ({
  id,
  name,
  headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, normalizeHeader(v!)])),
  required: ['document_date'],
});

export const SALES_TEMPLATES: SalesTemplate[] = [
  t('lt-invoice-lines', 'LT sales invoice lines', {
    document_date: 'Data', document_id: 'Dokumento Nr.', customer_name: 'Klientas', product_name: 'Prekė', product_id: 'Prekės kodas',
    quantity: 'Kiekis', net_amount: 'Suma be PVM', salesperson: 'Pardavėjas',
  }),
  t('pl-invoice-lines', 'PL sales invoice lines', {
    document_date: 'Data sprzedaży', document_id: 'Numer dokumentu', customer_name: 'Kontrahent', product_name: 'Towar', product_id: 'Kod towaru',
    quantity: 'Ilość', net_amount: 'Wartość netto', salesperson: 'Handlowiec',
  }),
  t('en-invoice-lines', 'EN sales invoice lines', {
    document_date: 'Invoice Date', document_id: 'Invoice No', customer_name: 'Customer', product_name: 'Product', product_id: 'SKU',
    quantity: 'Quantity', net_amount: 'Net Amount', salesperson: 'Sales Rep',
  }),
];

export function matchTemplate(normalizedHeaders: string[]): { template: SalesTemplate; ratio: number } | null {
  const set = new Set(normalizedHeaders);
  let best: { template: SalesTemplate; ratio: number } | null = null;
  for (const template of SALES_TEMPLATES) {
    const wanted = Object.values(template.headers);
    const found = wanted.filter((h) => set.has(h!)).length;
    const ratio = found / wanted.length;
    const reqOk = template.required.every((f) => set.has(template.headers[f] ?? '\u0000'));
    if (reqOk && ratio >= 0.75 && (!best || ratio > best.ratio)) best = { template, ratio };
  }
  return best;
}
