# Phase 10C – cross-module financial correctness gate

Scope: remove the confirmed shared-code defects found after Phase 10B and check that the 10B fixes create no new data-integrity risk. Every item below was reproduced with a synthetic scenario before it was fixed. No real customer data was used.

## 1. Coverage of the previous comparison period (S2)
**Defect (purchasing, reproduced):** 40 days of flat purchases → spend +200 % and a `spend_change` finding; the executive overview showed the same +200 % KPI.

**Model.** The previous window is classified from the *evidence of coverage*, not from the number of days with transactions (`analytics/periods.ts: previousCoverage`):

| State | Meaning | Result |
|---|---|---|
| covered | a transaction – or the export period the user declared – exists at/before the window's start | comparison allowed |
| tolerated | the first evidence is ≤ max(3 days, 10 % of the window) late (quiet beginning) | comparison allowed |
| **unknown** | the first transaction is later and the export period was **not** declared: the export may start there *or* the business may simply have had no earlier transactions | change withheld, labelled **UNKNOWN** (never "proven incomplete") |
| declared_incomplete | the user stated an export start after the window's start | change withheld, labelled as declared |
| none | no previous data | existing `no_previous_data` |

A quiet period inside fully covered windows (sparse sales, every 5th day) is a normal comparison. A declared start *later* than the first transaction contradicts the file and is ignored. A declared **end** later than the last transaction moves the current window to the declared end (a quiet end, not missing data).

* New optional input at import (sales and purchasing): **Export period – from / to** (stored on the import row, no schema change).
* `resolvePeriods({ checkCoverage: true, declaredFrom, declaredTo })` adds the warnings `previous_unverified` / `previous_declared_incomplete`; `isComparisonBlocked` treats them as blocking, so KPI changes, comparison charts, findings **and the executive summary** follow automatically. Modules opt in; finance and inventory do not (below).

## 2. Document identity when numbering restarts (D1)
**Defect (reproduced for purchasing, finance and inventory):** the same document number in the next year, "full" file → "replacement" of last year's document (spend 500 instead of 700).

**Fix.** `planMerge({ yearScoped: true })` is now used for every module: a document is identified by its scope key (supplier / counterparty / kind, unchanged) **+ number + year of its lines**. A same-numbered document of another year is added as a separate document and the preview says how many ("share a number with another year"). A corrected document in the **same** year still goes through the usual confirmation; other years are never touched. Snapshot records (open items, balances, stock snapshots) carry their as-of date in the document id and are unaffected (tests).

Module semantics checked: purchasing – supplier scope kept, same number at two suppliers = two documents; finance – flows (invoices, credit notes, payments) are dated documents, snapshots unaffected; inventory – movement documents are dated, snapshots unaffected.

## 3. Other modules (S2 / D1 analogues)
| Module | S2 | D1 |
|---|---|---|
| Purchasing | reproduced → fixed (above) | reproduced → fixed |
| Finance | **not reproduced**: flow KPIs already use the register-coverage rule `finance/ledger.ts: covers()` (`register_gap`); position changes compare snapshots, not windows | reproduced → fixed |
| Inventory | **not reproduced**: KPIs compare stock snapshots; movement-only data has no comparisons | reproduced → fixed |
| Executive overview | follows the module builds → fixed by 1 (test) | – |

Not changed: finance `covers()` also uses the first transaction date as evidence and does not read the declared export period. It withholds (so it errs on the safe side) but cannot be corrected by declaring the period. Recorded as a residual risk.

## 4. Safety review of Phase 10B
| | Risk | Result |
|---|---|---|
| A | Old imports give wrong results | Every new import row carries `rules: 2`. A sales import without it raises the limitation *"N sales import(s) were made before the current import rules … re-import them: delete the old import in History, then import the file again. Nothing is changed or deleted automatically."* and a "re-import recommended" mark in History. Read-time protections (S2, margin, cost sanity, units conversion, identity, wording) already apply to old data |
| B | Cost thresholds lose or hide data | Stored cost values are never discarded (tests keep 900000 and −40). Ignored costs are counted on the dashboard (*"N sales lines have a cost that was ignored as unreliable …"*) and in the import notice. A legitimate zero cost stays in the margin and is not reported. When ignoring leaves too little cost, the margin is withheld with the specific reason "unreliable cost" |
| C | Ambiguous credit notes silently skipped | Import preview: count **and amount** (trust item + notice). Stored on the import (`ambiguousCreditAmount`). Dashboard limitation: *"N credit-note rows worth X were NOT imported … sales are overstated by up to this amount"*. History marks the import |
| D | First transaction mistaken for the export start | Replaced by the four-state model; unknown is reported as unknown |

## 5. Impact on data already imported
* **No schema migration** (IndexedDB v8). New optional fields on import rows: `coverage`, `rules`.
* **No automatic re-import or deletion.** Sales imports made before 10B show a warning; whether to re-import depends on whether their files had a document-type, unit or return-quantity column (the app cannot know: original files are not stored).
* Imports in the other modules are unaffected by import-time changes; their merge behaviour changed only for future imports (year scope).

## 6. Residual risks that need real ERP exports
* How real exports mark credit notes (type column / sign / both) and which units they carry.
* A document whose date is corrected across a year boundary is now a separate document (the preview says so, but it does not block): it could be counted twice until the user notices.
* The declared export period is user input; a wrong declaration makes a comparison trusted that should not be.
* Thresholds (80 % coverage, 2 % returns, 5× cost, 3 days / 10 % tolerance) are reasoned defaults, not calibrated.
* Finance `covers()` does not use the declared period (conservative).
* "Customers who bought less" can still flag customers that order every N days.

## 7. Final pre-deployment safety gate
Three targeted checks; each confirmed gap was fixed and has a regression test (`tests/predeploy-gate.test.ts`, `e2e/safety-gate.spec.ts`).

1. **Withheld credit notes.** Gap: the executive overview and the findings CSV did not mention them, and findings stayed "high" reliability. Now: findings are capped at "medium" (*some credit-note rows were not imported, so sales may be overstated*), the findings CSV prints the data limitations **before** the figures, and the executive overview/report carry the flag *INCOMPLETE: credit-note rows were not imported …* (also as a line of the executive summary, before any conclusion).
2. **"Tolerated" coverage.** Gap: it looked like verified coverage. Now it is an explicit **assumption**: period warning + limitation ("shown on the ASSUMPTION that those days had no transactions – not verified"), comparison-based findings capped at "medium", and an executive flag. Boundary tests: first sale 0 / 1 / 2 / 3 days after the start of the previous window (covered / tolerated ×3), 4 days (unknown, withheld), 90-day window 9 vs 10 days, declared export start (verified, no assumption), purchasing.
3. **Old-import instruction.** Gap: "delete the old import, then import again" could destroy the only copy. Now: the notice says the numbers have *not* changed, that deletion cannot be undone, that the app does not keep files, to re-import **only** with the original file or a backup, and otherwise to keep the old import. Every delete confirmation (one import, all data) warns the same way and points to Settings → Download backup; an old-rules import gets the stronger question ("the only stored copy"). Cancelling deletes nothing (e2e).

Demo and isolation: the demo data carries none of the completeness caveats (test); a deletion made in demo mode touches only the demo database and the visitor's own database stays byte-for-byte identical (e2e).
