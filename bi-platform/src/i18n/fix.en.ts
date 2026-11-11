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
  'mp.sharedNumber': 'Documents sharing a number with another year', 'mp.sharedNumberNote': 'These document numbers are already stored for a different year (numbering often restarts every year). They are kept as separate documents and do not replace the older ones. If they are corrected versions of the same invoices, the dates in the file must be the original dates.',
  'pw.previous_unverified': 'Your data starts on {dataFrom}, but the previous period begins earlier. It is UNKNOWN whether the export covers it (the first transaction is not necessarily the start of the export), so changes are not shown. State the export period when importing, or choose a shorter period.',
  'pw.previous_declared_incomplete': 'You stated that the export starts on {declaredFrom}, after the start of the previous period: it is only partly covered, so changes are not shown.',
  'lim.previous_unknown': 'The previous comparison period starts on {from}, but your first transaction is on {dataFrom}. Whether the export covers the earlier part is UNKNOWN (there may simply have been no transactions). Changes and comparison-based findings are not shown. If the export really starts earlier, state its period when importing; otherwise choose a shorter period.',
  'lim.previous_incomplete': 'You stated that the export starts on {declaredFrom}, but the previous comparison period starts on {from}: it is only partly covered. Changes and comparison-based findings are not shown. Load an earlier export or choose a shorter period.',
  'import.cover.title': 'Export period (optional)', 'import.cover.from': 'From', 'import.cover.to': 'To',
  'import.cover.help': 'If you know which period the report covers, state it. Then a quiet start or end (no transactions) is told apart from missing data, and comparisons with the earlier period can be trusted. Leave empty if unknown: the first and last transaction are then all that is known.',
} as const;
export default fix;
