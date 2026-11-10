# Phase 7 – Financial trust, ERP-format validation and pilot readiness

This document says what Phase 7 built, how it was tested, what was measured, and – first of all – what has **not** been verified.
It does not hide limitations in an appendix. Read section 1 before anything else.

## 1. What is and is not verified

| Claim | Status |
|---|---|
| Calculations match hand-written ground truth on synthetic fixtures | **Verified** (sections 4, 6) |
| The engine refuses or qualifies the adversarial cases listed in section 5 | **Verified on synthetic fixtures** |
| Files shaped like business exports (encodings, separators, titles, footers, column order…) import with correct totals | **Verified on synthetic variants** (section 7) |
| The product reads **any real ERP's** export correctly | **NOT verified.** No real, lawfully supplied export exists in the repository or was made available. No ERP is claimed compatible (section 8). |
| False-positive / false-negative rate on real company data | **NOT measured.** The recall / precision figures in section 6 describe one synthetic fixture only. |
| Findings recover or save money | **NOT shown.** The product reports *exposure to verify*, never recovered or saved money. |
| Product is commercially validated | **No.** No customer evidence exists. |

**Readiness level reached: "Technically validated with synthetic data".** Not reached: "Real-export validated", "Controlled pilot ready", "Commercially validated" (see `docs/PILOT_READINESS.md`).

## 2. Baseline and gap assessment (code-level, before Phase 7)

The Phase 6 results were re-run independently first: `tsc` clean, 609 Vitest tests passing (42 files). Playwright was re-run at the end of this phase (section 9). Defects and risks found in the code, in priority order:

1. **Reversals and refunds were invisible to duplicate detection.** `duplicatePayments` discarded negative payments (`amount > 0` filter), so a payment, its reversal and a re-payment could be reported as a duplicate. *Fixed:* reversals / refunds are netted before anything is classed as a duplicate or excess (`trust/settlement.ts`).
2. **Negative amounts in invoice registers silently became credit notes.** The normaliser assumed "negative ⇒ credit note" without telling anyone. *Fixed:* the assumption is recorded (`creditEvidence: 'sign'`), warned at import (`negative_assumed_credit`), and any finding built on it can never be "verified".
3. **Register and open-item report could disagree about one invoice** and the open-item value was silently ignored. *Fixed:* the invoice becomes `conflicting`; matching and credit conclusions built on it are **withheld** with a reason.
4. **Unreferenced payments produced one finding per payment**, flooding the list and overlapping other findings. *Fixed:* one aggregated "no invoice reference" line per counterparty; payments already named in a duplicate/excess finding are never repeated; the same repeated payment line is reported once (the overpayment finding carries the "may be an export repeat" assumption).
5. **Cross-module quantities ignored units.** A product bought in boxes and counted in pieces would have produced stock-cover and margin figures. *Fixed:* units must be identical (or unstated, which stays a disclosed assumption); a conflict withholds the finding (`unit_mismatch`). Packaging units are never converted into pieces.
6. **Finance reports state no VAT basis** yet are stored with a constant `basis: 'net'` label for the series machinery. *Mitigated, not removed:* every finance finding carries the limitation "reports do not state whether amounts include VAT; used as stated" and the amount basis `as_stated`. Cross-module use only compares shares (customer exposure) or quantities.
7. **Date order of ambiguous dates (01/02/2025) was a silent guess.** *Fixed:* such a column is flagged at import and the user chooses; the choice is applied to parsing.
8. **No VAT consistency check.** *Added:* net + VAT must equal gross (±0.02); implied VAT rates are listed only from lines that state a VAT amount.
9. **Settlement analysis was quadratic** (10.5 s on 90 000 records). *Fixed:* indexed lookups; 372 ms for the same data.
10. **Evidence status did not exist.** Every insight is now classified (section 3), and a finding's status can never be raised by its amount (tested).

Not changed (no demonstrated defect): import pipeline, merge planner, worker architecture, IndexedDB schema (still v7 – evidence is derived from stored records, nothing new is persisted, so deletion, backup and restore cover it automatically), existing module insight rules.

## 3. What was built

* **Evidence classification** (`src/engine/trust/`): `verified` (supported by consistent records in the imported data – *not* an audit), `high-confidence candidate`, `estimate / scenario`, `withheld`. Status is decided by the *kind* of evidence (rule family) and its *quality* (reliability, VAT basis known, identity by code vs name, link basis, snapshot lag). The amount is never read. Weak evidence can only lower a status.
* **Settlement findings** (`trust/settlement.ts`): unapplied credit notes (open in report / partly applied / unmatched / applied / reversed / insufficient), possible duplicate payments (repeat, look-alike), overpayments, unmatched payments and receipts, counterparty conflicts, invoices with unclear settlement. Each has records, calculation, assumptions, limitations, missing evidence, rationale, and – when withheld – the reason. Exposure kinds: *credit balance open in the report*, *possible excess*, *amount to investigate* (never a claim).
* **Exposure to verify** (`potentialValue`): the only money total in the product. Per side and currency, never across currencies; only verified open credit balances and candidate possible-excess amounts; findings that share a record count once at their largest exposure; investigate-only, estimate and withheld items are excluded and counted. It is labelled *exposure to verify – not recovered, saved or confirmed-recoverable money*.
* **Import trust card**: currency (column or user's choice), VAT basis, implied VAT rates and net+VAT≠gross contradictions, date interpretation (with a choice when it is a guess), missing identifiers, duplicates, sign assumptions, coverage, and clashes with data already stored in other modules (currency / basis). An unambiguous file shows an all-clear.
* **Evidence panel** on every finding (module dashboards, overview, settlement findings): status, why, calculation, currency and basis, period, **date dimension used**, assumptions, limitations, missing evidence, source files and records, CSV export (formula-safe).
* **Withheld conclusions**: module rules that could not run, cross-module rules that were withheld (currency, basis, units, stale snapshot, short history, no links), and withheld settlement findings – each with its reason.
* **Executive report**: findings carry their evidence status; separate sections for verified calculations, potential opportunities, business risks, hypothetical scenarios, items to verify, exposure to verify (with composition), withheld conclusions and the verification action. HTML stays script-free and request-free; CSV stays formula-safe.
* **Performance**: indexed settlement analysis, display of the 40 largest findings with "show all", measurements in section 9.
* LT / PL / EN texts for all of it (≈ 200 new keys; completeness, placeholder and wording tests).

### Document semantics that are and are not recognised
Recognised from evidence: sales / purchase invoice registers, credit-note registers (register, document-type column, or – qualified – negative sign), customer / supplier payments, refunds and reversals (negative payments, credit and reversed credit), open-item and aging reports, balance snapshots, inventory balances / valuation / movements. **Not recognised:** general-ledger exports (blocked in every module rather than guessed; the universal table analysis can read them without meaning), debit notes, purchase orders, sales orders, bank statements as such. Unsupported families are listed, not faked.

## 4. Ground-truth design

* Fixtures are hand-built (`tests/fixtures/trust.ts`, `tests/fixtures/executive.ts`, `tests/fixtures/erpVariants.ts`) from plain rows; **no expectation is produced by running the analysis it checks**. Where a fixture has a simulated ledger (`tests/fixtures/finance.ts`), the expected values come from the simulation's truth rows.
* `tests/fixtures/soundness.ts` states invariants every classification must satisfy: *verified ⇒ the report itself shows the open balance and the document was not recognised by sign alone; withheld ⇒ a reason and no amount; every finding has records and limitations; no ineligible part in the exposure total; total = sum of parts.* They run over every adversarial scenario.

## 5. Adversarial scenarios covered (`tests/trust-settlement`, `trust-adversarial`, `executive-cross`, `erp-variants`)

Duplicate invoice with one payment · one invoice with three partial payments · one payment document allocated to several invoices · one payment line naming several invoices · multiple payments covering one invoice · credit applied / partly applied / without settlement data / reversed · credit open in the report · credit referencing a missing invoice (never called unused) · refund booked separately · payment and its reversal followed by re-payment · two different invoices with equal amounts · invoice number reused by different suppliers · same supplier under two identifiers (not merged) · same name for unrelated suppliers (not merged) · contradictory register vs report · negative-value invoices · zero-value documents · rounding differences · very large values (identical classification at 10⁹ scale) · fiscal-year boundary · monthly recurring payment · repeated payment line · invoices with unclear settlement · different currencies (separate results) · net vs gross sales (separate series, margin withheld) · different units and pack sizes (withheld) · stock snapshot older than sales / sales history too short (withheld) · general ledger export (blocked) · malformed and missing values · repeated import (no doubled exposure) · deleted source records (findings disappear) · backup / restore (same findings) · mixed-language headings · name-only joins (never).

Acceptance criteria, as measured: all explicit scenarios produce the expected classification and amounts; no VERIFIED finding exists without the report-line evidence (checked by invariant on 25 scenarios); every withheld item has a reason; the status is identical when amounts are scaled by 10⁻⁶…10¹² (property test); no cross-module join is made from names alone; re-import does not double exposure.

## 6. Measured recall / precision (synthetic only)
On the planted finance fixture (`tests/trust-recall.test.ts`): all planted cases are found with the amounts of the ledger simulation (receivables: double payment, 110 % payment, repeated register line, look-alike pair, two credits still open in the report, matched credit reconciled; payables: repeated line, look-alike pair, credit on a fully paid invoice) → recall 100 %; counterparties without a planted problem produce no finding → precision 100 %. **These numbers describe one synthetic fixture built by the same team as the rules. They are not a real-world rate and must not be quoted as one.** Conservative design consequence (expected, unmeasured on real data): where a real export lacks references or open-item reports, more items will be candidates or withheld.

## 7. Tested import variants (`tests/erp-variants.test.ts`, all synthetic)
UTF-8 with / without BOM · Windows-1257 · Windows-1250 · `;` `,` and tab delimiters · decimal comma / dot · thousands separators (space, comma, dot) · ISO, `dd.mm.yyyy`, `dd/mm/yyyy` and `m/d/yyyy` dates · export title lines and a totals footer · empty extra column and blank rows · reversed column order · mixed LT / EN / PL headings · multiline and quoted descriptions · duplicate column headings · missing invoice numbers · `n/a` amounts · impossible dates · negative amounts in parentheses · 60 000-line file. Each variant is checked against the same truth rows (invoice numbers, amounts, due dates, as-of date, currency, total).

## 8. Real ERP validation status
**No ERP is verified.** The repository contains only synthetic samples. Rivile, B1.lt, Finvalda, SAP, Microsoft Dynamics, Odoo and every other system are **unverified**. Synthetic variants show that file *shapes* commonly produced by systems are handled; they do not show that any system's actual export is. The protocol and minimal anonymised datasets needed are in `docs/ERP_VALIDATION_PROTOCOL.md`.

## 9. Measured results

**Unit / integration (Vitest):** 735 tests in 52 files, all passing (Phase 6 baseline: 609 in 42). **End-to-end (Playwright):** 95 tests, all passing (Phase 6: 85). `tsc --noEmit` clean, `next build` successful.

**Large-file performance** (`e2e/performance.spec.ts`; deterministic skewed data; files uploaded **as file paths**, never as in-memory buffers; headless Chromium 4 CPUs, 16 GB RAM, single worker, one run each, static build served locally; milliseconds):

| rows | file MB | parse + map | preview | import commit | sales dashboard | analyst view | overview | HTML report | longest app main-thread task | worst timer delay | JS heap (page) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 10 000 | 0.51 | 289 | 342 | 1 315 | 796 | 189 | 130 | 38 | 146 | 127 | 32.7 MB |
| 50 000 | 2.6 | 795 | 882 | 5 317 | 1 297 | 268 | 333 | 40 | 231 | 215 | 34.1 MB |
| 120 000 | 6.29 | 790 | 2 398 | 13 917 | 2 813 | 209 | 844 | 44 | 170 | 153 | 35.2 MB |

The 600 ms limit on application-attributable main-thread tasks was kept (not raised). Heavy work runs in the worker; worker memory is not measurable from the page and is **not** reported. Single runs on one machine – not a benchmark. Settlement analysis alone: 372 ms for 89 885 finance records (Vitest, same machine).

## 10. Privacy and integrity evidence
* No network request is made by any new code: Playwright specs for import trust, overview, evidence export and universal analysis record every request and assert all are local; the existing privacy tests still pass.
* Evidence is **derived** from stored records at build time and not persisted: deleting an import removes the findings (tested through the session), backup / restore reproduces identical findings (tested), "delete everything" needs no new step. Link decisions remain audited (`link_decision`).
* Evidence CSV and report CSV neutralise spreadsheet formulas (hostile names tested); HTML reports escape all source strings, stay script-free and contain no URLs (tested).
* Only the few supporting records of each finding (document number, date, amount, counterparty label, file, row) cross the worker boundary; no other record fields do (tested).

## 11. Remaining financial risks (ranked) and unsupported scenarios
1. Real exports may mean something the synthetic variants do not (column semantics, sign conventions, allocation exports, encodings). Largest risk; unmeasured.
2. Exact-reference matching: many real systems allocate payments without references or in lump sums; expect many *unmatched / withheld* items and unknown false negatives.
3. Finance reports state no VAT basis; downstream comparisons rest on the user's confirmation.
4. Sales files carry no unit; cross-module quantity findings rest on the confirmed link and are marked "units assumed" unless stock and purchasing units agree.
5. Evidence status is rule-based, not calibrated against outcomes; "exposure to verify" can be misread as value despite its labelling.

Unsupported: general ledger, bank statements, debit notes, purchase / sales orders, multi-currency conversion (never combined), VAT-rate-level reporting, partial-period fiscal reporting, unit-of-measure conversion between packaging units, ERP-specific exports of any kind.

## 12. Required before the first paying customer
1. Validate at least one real, lawfully supplied anonymised export per family (protocol).
2. Run the pilot acceptance protocol (`docs/PILOT_READINESS.md`) with independent reconciliation; record false positives and negatives.
3. Review default thresholds (cover days, recurring-payment gaps, look-alike window) with the pilot's finance lead.
4. Measure worker memory on the customer's largest real file.
5. Agree the wording of "exposure to verify" with the customer so it is never reported as recovered or saved.
