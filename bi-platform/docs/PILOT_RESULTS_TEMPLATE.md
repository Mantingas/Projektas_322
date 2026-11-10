# Pilot results (template – copy per pilot; do not fill with synthetic numbers)

**Provenance:** ☐ real data, authorised (attested in the app) ☐ synthetic / test data → if synthetic, write "NOT REAL-WORLD VALIDATION" at the top and stop here.

Organisation (label only): ______ · Period: ______ → ______ · Snapshot date and source report: ______ · Reviewer: ______ · Date: ______

## 1. Data and import
| File | Exporter / report / version | Rows | Period | Control total in system | Control total in app | Import warnings (codes, counts) | Refused / unsupported rows |
|---|---|---|---|---|---|---|---|
| AP invoice register | | | | | | | |
| Supplier credit-note register | | | | | | | |
| Supplier payment register | | | | | | | |
| AP open-item report | | | | | | | |

Import confirmations the user had to give (date order, VAT basis, sign, currency): ______
Interpretation check (10 rows per file): ☐ passed ☐ failed – details: ______
Sign conventions found: credit notes ______ · credit balances ______ · refunds / reversals ______
Unsupported patterns found (column, value, behaviour): ______

## 2. Findings (one row per finding; the app's ledger CSV has these columns)
| Finding id | Category | App status | Calculated amount | Currency | Source records correct? | Decision (confirmed / false positive / inconclusive) | Reconciliation explanation | Reason if rejected / uncertain | Confirmed discrepancy | Customer-stated recoverable | Actually recovered | Where independently reported | Prevented loss + evidence | Minutes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

## 3. Known problems the app did not report (reference list)
Is the list complete for the scope? ☐ yes (attested) ☐ no / unknown
| Description | Category | Amount | Source refs | Found by app? (finding id) | If missed: why |
|---|---|---|---|---|---|

## 4. Counts (copy from the Pilot tab; add the denominators)
Findings: ___ (reviewable ___, withheld ___) · confirmed ___ · false positive ___ · inconclusive ___ · not reviewed ___
Confirmed ÷ decided: ___ of ___ (**counts only if fewer than 30 decisions**)
Known problems found by the app: ___ of ___ (**only if the list is attested complete**)
A *verified* finding rejected by the reviewer? ☐ no ☐ yes → product defect, describe: ______

## 5. Value (tiers are NOT added together; per currency and side)
| Currency | Potential exposure (app) | Confirmed accounting discrepancy | Customer-stated recoverable | Actually recovered (evidence) | Prevented loss (evidence) |
|---|---|---|---|---|---|

## 6. Time
Customer's existing process: ___ min (how measured: ______) · Preparation / import: ___ min · Verification: ___ min over ___ findings · Time saved (baseline − preparation − verification): ___ min

## 7. Limitations that apply (tick)
☐ not attested real ☐ fewer than 30 decisions ☐ one company / one period ☐ reference list incomplete or absent ☐ no open-item report for some credits ☐ payments without references ☐ VAT basis not stated ☐ other: ______

## 8. Conclusion (no extrapolation)
What is confirmed: ______ · What is not: ______ · Evidence still needed: ______ · Recommendation for this customer: ______
