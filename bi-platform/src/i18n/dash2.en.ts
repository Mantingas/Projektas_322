const d = {
  'diag.title': 'Import diagnostics', 'diag.structure': 'Detected file structure', 'diag.kind': 'File type', 'diag.encoding': 'Encoding', 'diag.delimiter': 'Delimiter', 'diag.sheet': 'Sheet',
  'diag.size': '{rows} rows × {cols} columns', 'diag.headerRow': 'Header in row {row} (confidence {pct})', 'diag.truncated': 'Truncated: the sheet is larger than the supported size',
  'diag.columns': 'Columns and proposed meanings', 'diag.unrecognized': 'Unrecognised columns (ignored unless you assign them)', 'diag.noneUnrecognized': 'Every column with data has a meaning.',
  'diag.validation': 'Validation issues', 'diag.noIssues': 'No problems found.', 'diag.examples': 'e.g. rows {rows}', 'diag.rows': 'Rows: read {read}, imported {imported}, skipped {skipped}',
  'diag.metrics': 'What can be calculated from this file', 'diag.available': 'available', 'diag.unavailable': 'not available',
  'diag.aspNote': 'Average selling price is shown when exactly one product is selected in the dashboard.',
  'diag.download': 'Download diagnostics (no cell values)', 'diag.privacy': 'The diagnostics file contains structure and counts only – no cell values, customers or products. Header names are included.',
  'diag.source.saved': 'saved mapping', 'diag.source.template': 'known layout', 'diag.source.heuristic': 'suggested', 'diag.source.user': 'your choice',
  'diag.confidence': 'confidence', 'diag.working': 'Analysing…',

  'mode.partial': 'Partial documents (some lines only)',
  'mode.help.full': 'Every document of the period is in the file with all its lines. Only this mode can replace stored lines – and only after you confirm.',
  'mode.help.incremental': 'Only transactions that are new or changed since the last export. Stored lines are never replaced.',
  'mode.help.partial': 'Documents may contain only some of their lines. Lines can be added to stored documents; stored lines are never removed.',
  'mode.help.unknown': 'You are not sure. Anything that could change stored data is held for your review.',

  'mp.newDocs': 'New documents', 'mp.additions': 'Stored documents that gain lines', 'mp.held': 'Lines held for review', 'mp.heldDocs': 'Documents held for review',
  'mp.removed': 'Documents that would lose lines', 'mp.omitted': 'Documents with stored lines missing from the file (kept)', 'mp.absent': 'Stored documents in this period that are not in the file (kept)',
  'mp.skipped': 'Lines skipped (only new dates)', 'mp.safe': 'Nothing in this import replaces or removes stored data.',
  'mp.heldNote': 'Held lines are stored but not included in any figure until you resolve them in History → Conflict review.',

  'pol.conflicts': 'If a stored document differs from the file', 'pol.hold': 'Hold the new lines for review (recommended)', 'pol.replace': 'Replace the stored lines with this file’s version',
  'pol.add_alongside': 'Keep both versions (may double count)', 'pol.content': 'Lines without a document number that overlap stored dates', 'pol.hold_overlap': 'Hold overlapping lines for review (recommended)',
  'pol.only_new_dates': 'Import only lines dated after the latest stored date', 'pol.dedupe_exact': 'Skip exact duplicates and add the rest (a corrected line may be counted twice)', 'pol.proposed': 'proposed',
  'cf.title': 'Please confirm before importing', 'cf.replacements': 'Stored lines of {n} documents will be replaced. They are kept for audit and come back if you delete this import.',
  'cf.removals': '{n} documents will lose lines that are missing from this file. They are kept for audit and come back if you delete this import.',
  'cf.add_alongside': 'Lines will be added next to stored ones and may be counted twice.',
  'cf.content_overlap': 'Lines overlapping stored dates are added, but without document numbers a corrected line cannot be recognised: totals may be counted twice.',
  'cf.checkbox': 'I understand and confirm', 'cf.needed': 'Confirmation required',

  'import.result.held': 'Lines held for review', 'import.result.reviewNow': 'Review conflicts', 'import.result.removed': 'Documents with removed lines',
  'lim.held_pending': '{lines} imported lines are held for your review and are NOT included in any figure. Resolve them in History → Conflict review.',

  'cr.title': 'Import conflict review', 'cr.empty': 'Nothing is waiting for your decision.',
  'cr.intro': 'These lines came from an import but were not added to your figures, because the file could change data you already have. Decide for each document. Nothing is deleted: replaced and discarded lines stay in the audit trail, and deleting the import undoes it.',
  'cr.stored': 'Stored lines', 'cr.held': 'Lines from {file}', 'cr.useNew': 'Use the new version', 'cr.keepStored': 'Keep what is stored', 'cr.keepBoth': 'Keep both', 'cr.add': 'Add these lines', 'cr.discard': 'Discard these lines',
  'cr.noDoc': 'Lines without a document number', 'cr.bulk': 'Apply to every conflict', 'cr.doc': 'Document', 'cr.amount': 'Amount', 'cr.product': 'Product', 'cr.date': 'Date', 'cr.sum': 'Total',
  'cr.pending': 'waiting: {n}', 'cr.hintUseNew': 'Use the new version: the stored lines it replaces are kept for audit.', 'cr.hintKeepBoth': 'Keep both: both versions count, so totals may be double.',

  'au.title': 'Audit log', 'au.time': 'When', 'au.action': 'Action', 'au.detail': 'Details', 'au.import': 'Import', 'au.delete_import': 'Import deleted', 'au.resolve_conflict': 'Conflict resolved', 'au.empty': 'No events yet.',
  'hist.held': 'Held',

  'rolling.title': 'Rolling 30-day alerts', 'rolling.toggle': 'Show rolling-window alerts', 'rolling.badge': 'Rolling 30 days',
  'rolling.note': 'These alerts always compare the last 30 days with the 30 days before them, whatever period you selected above. Figures here may differ from the selected period on purpose.',
  'dash.computing': 'Calculating…', 'err.worker': 'The background worker stopped unexpectedly. Please try again.', 'err.workerTimeout': 'The background worker did not answer in time and was stopped.',
} as const;
export default d;
