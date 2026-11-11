/** Phase 10B – sales financial correctness: import notices, KPI limitations, wording. */
const fix = {
  'issue.credit_sign_ambiguous': 'Credit-note row with a positive amount NOT imported (other credit rows are negative)',
  'issue.quantity_sign_normalised': 'Quantity of a negative-amount line made negative (returns reduce the quantity)',
  'issue.quantity_sign_ambiguous': 'Quantity ignored: its sign disagrees with the amount',
  'issue.cost_suspect': 'Cost not used: negative, far above the price, or of unknown sign on a return',
  'issue.cost_zero': 'Zero cost on a sale (kept; if it means “unknown” the margin will be too high)',
  'itrust.credit_ambiguous': '{n} row(s) are typed as credit notes but have a POSITIVE amount, while other credit rows are negative. The file mixes two sign conventions, so these rows were not imported (they would otherwise be counted as sales). Correct the signs in the file and import again.',
  'sales.margin_overview.body_partial': 'Gross profit is {profit} on the sales that have a cost, net of returns with a known cost. These sales are only {coverage} of all sales revenue, so this is not the margin of the whole turnover.',
  'mu.cost_revenue_coverage': 'Cost is known for under 80% of sales REVENUE (even if it is present on many lines)', 'mu.returns_cost_unknown': 'Returns / credit notes are material and their cost is missing or of unknown sign', 'mu.mixed_units': 'Quantities are in different units that cannot be added (e.g. kg and pcs)', 'mu.units_missing': 'Some quantities have no unit while others do',
  'lim.units_unstated': 'The file does not state units of measure, so quantities are added as they are and assumed to be in the same unit.',
  'lim.margin_partial': 'The margin covers only {pct} of sales revenue (the lines with a usable cost). It is not the margin of the whole turnover.',
  'lim.previous_incomplete': 'The previous comparison period starts on {from}, but your data starts on {dataFrom}: {missing} days of it are not in the file. Changes and comparison-based findings are not shown, because they would compare a full period with a partial one. Load an earlier export or choose a shorter period.',
  'mp.sharedNumber': 'Documents sharing a number with another year', 'mp.sharedNumberNote': 'These document numbers are already stored for a different year (numbering often restarts every year). They are kept as separate documents and do not replace the older ones. If they are corrected versions of the same invoices, the dates in the file must be the original dates.',
} as const;
export default fix;
