# Pilot data checklist (supplier side, ~12 months)

Tick each item with the data owner. Nothing here is filled in yet – no real data exists.

## 0. Authorisation
- [ ] Written permission from the data owner for this validation (scope, duration, who sees what)
- [ ] Data stays on the owner's / reviewer's machines; nothing is uploaded anywhere (the app makes no network requests)
- [ ] Decision made: import originals locally, or pseudonymise first (`scripts/pilot-pseudonymize.ts`)
- [ ] Pseudonym secret generated and kept by the owner (never emailed, never committed)

## 1. The four datasets (same period where possible)
| # | Dataset | Needed columns | Recommended | Done |
|---|---|---|---|---|
| 1 | AP invoice register | supplier id **and/or** name, invoice no, invoice date, due date, amount, currency | document type, VAT amount, posting date | [ ] |
| 2 | Supplier credit-note register | supplier id, credit-note no, date, amount, currency | **referenced invoice no**, reason | [ ] |
| 3 | Supplier payment register | payment no / bank reference, date, supplier id, amount, currency | **referenced invoice no**, bank account (will be blanked) | [ ] |
| 4 | AP open-item report | supplier id, document no, outstanding amount (credit balances negative), currency, **report date** | original amount, due date | [ ] |

For each file record (do not guess): exporter / report name · system and version · filters · date range · encoding · delimiter · decimal and date format · whether amounts include VAT · sign convention of credit notes, payments and credit balances · whether the export has title / footer rows.

## 2. Snapshot and coverage
- [ ] Open-item report snapshot date documented **with the report it came from** (enter in the Pilot tab; it must equal the date in the file)
- [ ] Invoice and payment registers cover about 12 months, ending at or after the snapshot date
- [ ] Credit-note register covers the same period
- [ ] Same company / legal entity in all four files; same currency basis (list every currency present)

## 3. Interpretation checks with the owner's accountant (≥ 10 random rows per file)
- [ ] Column meaning confirmed (amount, outstanding, due date, document type, references)
- [ ] Debit / credit and sign conventions confirmed (is a credit note negative? is a credit balance negative? is a refund a negative payment?)
- [ ] Document types and settlement references confirmed (how does the system link a payment or credit to an invoice? is it always populated?)
- [ ] Currency and VAT interpretation confirmed (net vs gross, VAT-exempt lines, foreign-currency documents)
- [ ] Cross-file reconciliation: counts and sums of each file equal the accounting system's own totals (`control-totals.json` or a manual report)
- [ ] Unsupported fields / record types listed (e.g. allocation lines, bank-statement rows, debit notes)

## 4. Reference outcomes (needed for any accuracy claim)
- [ ] Independent reviewer named; not the person who runs the app
- [ ] Reviewer lists problems known in the period *without* using the app's findings (the reference list); states whether the list is complete
- [ ] Baseline: minutes the customer's existing process needs for the same scope, and how it was measured
- [ ] Reviewer's reconciliation sources identified (ledger, bank statements, supplier statements)

## 5. Stop checks before starting the review
- [ ] Import trust card reviewed for every file; every unresolved warning has an owner
- [ ] No file contains personal data that is not needed (blank or remove it)
- [ ] The report name masking option is on when results are shared outside the owner's organisation
