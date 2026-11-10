# Real-export validation protocol

**Status of every ERP: unverified.** No real export has been tested. Do not describe the product as compatible with any system until a row below is filled with a passing run on real, lawfully supplied, anonymised data.

| System | Exporter / report used | Version | Families tested | Date | Result | Verified by |
|---|---|---|---|---|---|---|
| Rivile | – | – | none | – | **unverified** | – |
| B1.lt | – | – | none | – | **unverified** | – |
| Finvalda | – | – | none | – | **unverified** | – |
| SAP | – | – | none | – | **unverified** | – |
| Microsoft Dynamics | – | – | none | – | **unverified** | – |
| Odoo | – | – | none | – | **unverified** | – |
| Other | – | – | none | – | **unverified** | – |

## Rules
* Never download or invent data. Only files the data owner supplies, with permission, are used, and only offline.
* Anonymise before sharing: replace names with stable pseudonyms (one pseudonym per entity, across all files), replace identifiers with stable pseudonyms **preserving equality across files** (the same supplier id must stay the same everywhere), keep dates, signs, units and amounts untouched (or scale *all* amounts by one factor and say so – then compare ratios, not absolutes). Remove addresses, bank accounts, free-text descriptions with personal data.
* Keep the original structure: header text, column order, title and footer rows, encoding, delimiter, decimal and date format.

## Minimal anonymised datasets per family
| Family | Minimum content | Rows |
|---|---|---|
| Accounts payable open items | supplier id + name, document no, document date, due date, original and outstanding amount, currency, report date, **including 3+ credit balances (negative)** | 100–500 |
| Accounts payable invoice register | supplier id, invoice no, date, due date, amount, currency, document type, **3+ credit notes with and without references, 1 reversed** | 100–500 |
| Payment register (supplier / customer) | payment no, date, supplier id, amount, currency, invoice reference, **2+ split payments, 1 payment covering 2 invoices, 1 refund / reversal, 1 known duplicate** | 100–500 |
| Accounts receivable open items / aging | as AP, customers | 100–500 |
| Credit-note register | number, date, counterparty id, amount, referenced invoice, currency | 20–200 |
| Sales transactions | date, document no, customer id, product code, quantity, net amount, VAT amount, currency | 500–5 000 |
| Purchase transactions | date, document no, supplier id, product code, quantity, unit, net amount | 500–5 000 |
| Inventory snapshots / movements | date, product code, warehouse, quantity, unit, value; movement type | 200–2 000 |
| Bank / payment records | date, amount, counterparty, reference | 100–500 |
| General ledger | account, debit, credit, date, document no (currently **unsupported**: expected result is a clear refusal, not a misread) | 100–500 |

## Procedure per file
1. Record exporter, report name, version, filters, encoding.
2. Import; copy the import trust card (screenshot or text) and every confirmation the user had to give.
3. Compare totals with the source system's own totals (rows, sum of amounts, sum of outstanding) – independent of the app.
4. Check 20 random rows end to end (document type, sign, date, amount, identifiers).
5. Run settlement findings; reconcile per `docs/PILOT_READINESS.md` section B.
6. Record unsupported patterns precisely (which column, which value, what happened).
7. Fill the table above only if steps 3–5 pass for that family; state exactly which families and scenarios passed.
