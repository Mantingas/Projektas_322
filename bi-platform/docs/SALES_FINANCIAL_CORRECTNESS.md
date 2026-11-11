# Sales module – financial correctness remediation (Phase 10B)

> Phase 10C refined S2 (an unknown export start is now *unknown*, not "proven incomplete", and can be declared at import), extended D1 to purchasing, finance and inventory and added visibility for ignored costs, excluded credit rows and old imports – see `CROSS_MODULE_CORRECTNESS_GATE.md`.

Result of the Phase 10 audit (every finding was reproduced with a synthetic scenario before it was fixed). Principle: **bad, partial or ambiguous data must not produce a figure that looks reliable – a withheld figure is better than a wrong one.**

| ID | Was | Now | Where | Regression tests |
|---|---|---|---|---|
| S1 | Credit notes written as positive numbers (typed in a "Document type" column) counted as sales: 2 invoices + 2 credit notes of 100 → sales 400 | `document_type` is a sales field; typed credit rows are made negative; already-negative rows are never flipped; a file mixing both conventions imports the positive credit rows **not at all** and says how many (import notice + trust item) | `validation/normalize.ts`, `types.ts`, `mapping/dictionary.ts`, `trust/importTrust.ts` | `sales-import-correctness` |
| S2 | 40 days of flat sales, last 30 vs previous 30 → "+200 %", growth findings with high reliability | If the previous window is not covered by the data (more than max(3 days, 10 % of the window) before the first date) changes, the waterfall and every comparison-based finding are withheld, with a limitation text. Completeness is judged from the data's range, **not** from the number of days with transactions | `analytics/periods.ts: previousIncomplete`, `compare.ts`, `dashboard.ts`, `insights/engine.ts` | `sales-periods-merge-correctness` |
| M1 | Margin shown when 80 % of **lines** had a cost (90 % of lines = 30 % of the money → 40 % instead of ~15 %) | Cost must cover ≥ 80 % of positive lines **and** ≥ 80 % of positive revenue. With < 100 % revenue coverage the KPI explanation and a limitation say it is the margin of the costed sales only | `analytics/metrics.ts: evaluateMargin` | `sales-kpi-correctness` |
| M2 | "Gross profit" ignored returns (profit 200 on net sales 200) | Margin and profit are net of returns whose cost has the sign of the amount. Returns with a missing or wrong-sign cost are not trusted: above 2 % of sales they withhold the margin | `analytics/aggregate.ts`, `metrics.ts` | `sales-kpi-correctness` |
| Z1 | A column of 0 → margin 100 %; one absurd cost → −128 509 % | Zero cost is real unless it is the column's placeholder (≥ half of the cost lines); negative and > 5× price costs are ignored (and reduce coverage); import warnings count them | `aggregate.ts`, `metrics.ts`, `normalize.ts` | `sales-kpi-correctness`, `sales-import-correctness` |
| M3 | Low-margin finding for a product with a cost on 15 % of its lines; amount = only the costed lines | Judged with the same rule as the table (own line and revenue coverage); amount = the product's whole positive revenue | `insights/rules.ts: lowMargin` | `sales-kpi-correctness` |
| U1 | No unit field: kg + pcs + l summed (5 280); price of kg+g mixed (0.041 instead of 2 €/kg) | `unit` is a sales field. Quantity and average price use one unit: exact metric conversions only (g→kg, ml→l …); kg+pcs, boxes+pcs, or some lines without a unit while others have one → withheld with a reason. A file with no unit column keeps the quantity and shows a "units not stated" limitation | `metrics.ts: quantityInOneUnit`, `normalize.ts` | `sales-kpi-correctness`, `sales-import-correctness` |
| Q1 | Returns with a positive quantity increased the quantity (60 instead of 20) | A consistent "returns carry positive quantities" convention is normalised (notice); contradictory quantities are ignored (notice) | `normalize.ts` | `sales-import-correctness` |
| D1 | Next year's file with restarted numbering, "full" mode → proposes to REPLACE last year's documents (500 instead of 700) | Sales documents are identified by number **and year**: they are added as separate documents (a note shows how many share a number with another year); corrections inside one year still need the usual confirmation | `import/merge.ts` (`yearScoped`), `db/store.ts`, `ImportFlow.tsx` | `sales-periods-merge-correctness` |
| O1 | "Orders" = distinct document numbers; merged across years/customers | Counted by number + year + customer; renamed **Sales documents / Pardavimo dokumentai / Dokumenty sprzedaży**; the explanation says it is not a count of customer orders | `aggregate.ts`, i18n | `sales-kpi-correctness`, `sales-wording` |
| I1 | Customers / products keyed by name: two customers with one name merged, one customer with two spellings split | Stable code first (`id:<code>`), else normalised name (`name:<name>`); clashing labels get the code appended | `analytics/filters.ts`, `sales/kpi.ts` | `sales-identity` |
| T1 | "prarado / lost / straciły … pardavimų", "prarastos rinkos dalies ženklas" | "pardavimai sumažėjo / fell / spadła"; decline findings mention timing, seasonality, one-off orders | i18n | `sales-wording` |
| T2 | "Poveikis / Impact" next to a revenue amount | "Susijusi suma / Amount involved / Kwota, której dotyczy" | i18n | `sales-wording` |

## Existing test changed, and why
`tests/analytics.test.ts` – the independent margin reference summed only positive lines (the audited defect). It now nets returns whose cost carries the sign of the amount; the engine matches it to 1e-6. Filter keys in `analytics.test.ts` / `period-insights.test.ts` are now taken from the engine (`id:` / `name:` keys) instead of hard-coded lower-cased names. No assertion was loosened.

## Data and migrations
* **No IndexedDB schema change** (still v8). Stored sales lines gain an optional `unit`; old lines simply have none.
* Protections that work at read time (S2, M1, M2, Z1, M3, U1 conversion, O1, I1, T1, T2) apply to **already stored data immediately**.
* Protections that need the original file (S1 credit type, Q1 quantity sign, `unit`) apply to files imported **after** this change. Sales imported earlier from files with a document-type column or a unit column should be **re-imported** (delete the old import first, or import the corrected file as a new full snapshot).
* Import behaviour changes: two new fields can be mapped in sales (`document_type`, `unit`); credit-typed rows are normalised; ambiguous credit rows are not imported; the merge no longer treats same-numbered documents of different years as the same document.

## Same defects in the other modules (recorded, not fixed)
| Shared code | Finding | Evidence |
|---|---|---|
| `analytics/periods.ts` (`resolvePeriods`, `isComparisonBlocked`) | **Purchasing:** 40 days of flat spend → spend +200 % and a `spend_change` finding (reproduced). Inventory and finance use the same gate (read from code, not reproduced by a test) | temporary test, deleted |
| `import/merge.ts` (`planMerge`) | **Purchasing:** the same supplier invoice number next year in a "full" file proposes a replacement of last year's document (reproduced). Finance and inventory use the same merge | temporary test, deleted |
| Identity by name | Purchasing already prefers SKU / supplier code (not affected) | `purchasing/entities.ts` |
| Units | Purchasing has `qtyByUnit` (not affected) | `purchasing/aggregate.ts` |

`planMerge({ yearScoped })` and `previousIncomplete()` are written so that other modules can adopt them with one line each after a decision.

## Residual risks that need real ERP exports
* Whether real exports write credit notes with a type column, negative amounts, or both (S1 depends on it).
* Which units real sales files carry and how often unit cells are blank for services (U1 withholds the whole quantity when some quantity lines lack a unit).
* Customer codes present on some rows and absent on others still split one customer into a coded and a name-only entity (I1).
* The 80 % / 2 % / 5× / 3-day thresholds are reasoned defaults, not calibrated on real data.
* "Customers who bought less" can still flag customers who order every N days (timing false positive); the wording now says so, the rule is unchanged.
