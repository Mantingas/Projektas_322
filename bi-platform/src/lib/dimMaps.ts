import type { Dimension, FilterSpec } from '@/engine/analytics/filters';
import type { MessageKey } from '@/i18n';

/** Which FilterSpec field and which label belong to each drillable dimension (both modules). */
export const FILTER_FIELD: Record<Dimension, keyof FilterSpec> = {
  customer: 'customers', product: 'products', salesperson: 'salespeople', category: 'categories', supplier: 'suppliers', warehouse: 'warehouses',
};
export const FILTER_LABEL: Record<Dimension, MessageKey> = {
  customer: 'flt.customers', product: 'flt.products', salesperson: 'flt.salespeople', category: 'flt.categories', supplier: 'flt.suppliers', warehouse: 'flt.warehouses',
};
