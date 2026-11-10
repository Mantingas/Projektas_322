# Pilot readiness

## D. Readiness level (evidence-based)

| Level | Reached? | Evidence |
|---|---|---|
| Engineering prototype | **Yes** | Working application, Phases 1–7 |
| **Technically validated with synthetic data** | **Yes – current level** | 735 unit tests, 95 browser tests, hand-written ground truth, adversarial suite, measured large-file runs (`docs/PHASE7_VALIDATION.md`) |
| Real-export validated | **No** | No real, lawfully supplied ERP export has been tested. No ERP is claimed compatible. |
| Controlled pilot ready | **No** – preparation done, gate not passed | Requires at least one real anonymised export per use case to pass `docs/ERP_VALIDATION_PROTOCOL.md` |
| Commercially validated | **No** | No customer evidence of confirmed or recovered value |

## A. Minimum data requirements per use case
All files: CSV or XLSX, one header row, consistent identifiers across files. Amounts keep the export's own sign convention; tell us the currency and whether amounts include VAT.

### 1. Supplier credit-note analysis (unapplied credits)
* **Required:** supplier credit-note register *or* an AP invoice register with a document-type column (supplier id or name, credit-note number, date, amount, currency) **and** an AP open-item report dated after the credits (supplier, document number, outstanding amount – negative for credit balances).
* **Recommended:** the referenced invoice number on each credit note; AP invoice register covering the referenced invoices; payment register.
* **Assumptions supported:** a credit still shown as a negative open item in the newest open-item report is *verified* unapplied; a credit larger than the invoice it references leaves a *candidate* remainder.
* **Conclusions possible:** per-credit state (open in report / partly applied / applied / reversed / settled per report), exposure as "credit balance open in the report".
* **Withheld:** a credit without reference, report or equal-amount invoice; a credit whose invoice is not in the export (shown as *amount to investigate*, never "unused"); any invoice recorded with different amounts in register and report; credits recognised only by a negative sign (never verified).

### 2. Duplicate-payment investigation
* **Required:** supplier payment register (supplier, payment number, date, amount, currency, **invoice reference**) and an AP invoice register (invoice number, supplier, amount).
* **Recommended:** AP open-item report (turns an overpayment from candidate into verified); bank reference.
* **Supported:** repeated payment lines; payments exceeding an invoice after referenced credits and refunds; look-alike payments within 7 days without references; reversals / refunds are netted; instalments, split payments and monthly recurring charges are not duplicates.
* **Possible:** candidate / verified possible excess with the supporting records. **Withheld:** amounts without invoice amounts; unmatched money is "to investigate", never recoverable.

### 3. Sales profitability
* **Required:** sales lines (date, document number, customer id/name, product code, quantity, **net** amount, currency) with a stated VAT basis.
* **Optional:** cost per line or unit cost; salesperson; category.
* **Supported:** revenue changes, customer concentration, product trends, margin *proxy* where cost exists (documented, labelled gross-profit proxy – not accounting profit).
* **Withheld:** margin without cost data; any comparison between net and gross files; products identified by name only are candidates.

### 4. Inventory analysis
* **Required:** stock snapshot or valuation (date, product code, warehouse, quantity, unit) – history snapshots and movement files make demand-based findings possible.
* **Optional:** unit cost / value, minimum stock, movement types.
* **Supported:** stock value and concentration, non-moving and slow-moving items, excess and stock-out *estimates* with the threshold shown; cross-module stock cover when product links are confirmed and units agree.
* **Withheld:** demand-based findings without movements or enough history; anything with mixed or conflicting units; a snapshot too far from the sales period.

### 5. Overdue receivables / payables
* **Required:** open-item report with due dates (or an aging report) dated as of a known date.
* **Withheld:** overdue figures when fewer than 80 % of open lines have a due date; balance-only snapshots give no overdue figure.

## B. Pilot acceptance protocol
1. **Prepare.** Customer exports anonymised files per the protocol (identifiers consistent, amounts unscaled, dates and signs untouched). Record export tool, version, filters, encoding.
2. **Import and validate schema.** Run each file through the import trust card. Record every ambiguity (date order, VAT basis, sign, currency), every confirmation the user had to give, and every file refused.
3. **Interpretation check.** A customer accountant confirms for 10 random rows per file that the app's reading (document type, sign, date, amount, identifiers) matches the source system.
4. **Generate findings.** Produce settlement findings and cross-module findings; export the evidence CSV and the executive report.
5. **Reconcile independently.** For every *verified* and *candidate* finding (all if ≤ 50, otherwise a stratified sample of ≥ 30 including every status) the customer's accountant checks the cited records against the accounting system and bank statements and records a verdict (table below).
6. **Seek false negatives.** The accountant (or the customer's own process) lists known problems in the period (duplicates, unapplied credits, overpayments they already found). Record which the app found, missed, or withheld, and why.
7. **Value.** Record amounts the customer confirms as recoverable, and, later and separately, amounts actually recovered or saved.
8. **Capture gaps.** Unsupported export patterns, missing features, confusing wording.

### Evaluation template (one row per finding)
| Finding id | Rule | App status | Cited records correct? (Y/N) | Verdict (confirmed / false positive / inconclusive) | Exposure per app | Confirmed amount | Customer-confirmed recoverable | Actually recovered (independently reported) | Verification time (min) | Notes |
|---|---|---|---|---|---|---|---|---|---|---|

Known-problem list (false negatives): `| Known problem | Found by app? | Withheld? reason | Missed – why |`

## C. Commercial value evidence – definitions
* **Findings generated** – count by status.
* **Confirmed** – verdict "confirmed" after independent reconciliation. **False positive** – verdict "false positive". **Inconclusive** – excluded from rates, reported separately.
* **False negatives** – known problems not found (only where a reference list exists).
* **Financial exposure confirmed** – sum of exposure of *confirmed* findings (still not money recovered).
* **Recoverable amount confirmed by the customer** – customer's own statement per finding.
* **Actual recovered / saved** – independently reported, later, in the customer's books. Only this may be called realised value.
* **Analyst verification time** and **time saved** – measured against the customer's existing process for the same period.
* Identified exposure is **never** revenue, recovery or realised savings. Precision = confirmed ÷ (confirmed + false positive); recall = found ÷ known problems; report counts, not just percentages, and state the sample size.

## Smallest practical pilot
One company, one period (12 months), supplier side only: AP invoice register + credit-note register + payment register + AP open-item report as of the period end (4 files). Goal: of the findings, how many does the customer's accountant confirm, what amount is confirmed recoverable, and how long did verification take versus their usual month-end review.
