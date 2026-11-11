/** Phase 10B – sales financial correctness: import notices, KPI limitations, wording. */
const fix = {
  'issue.credit_sign_ambiguous': 'Credit-note row with a positive amount NOT imported (other credit rows are negative)',
  'issue.quantity_sign_normalised': 'Quantity of a negative-amount line made negative (returns reduce the quantity)',
  'issue.quantity_sign_ambiguous': 'Quantity ignored: its sign disagrees with the amount',
  'issue.cost_suspect': 'Cost not used: negative, far above the price, or of unknown sign on a return',
  'issue.cost_zero': 'Zero cost on a sale (kept; if it means “unknown” the margin will be too high)',
  'itrust.credit_ambiguous': '{n} row(s) are typed as credit notes but have a POSITIVE amount, while other credit rows are negative. The file mixes two sign conventions, so these rows were not imported (they would otherwise be counted as sales). Correct the signs in the file and import again.',
} as const;
export default fix;
