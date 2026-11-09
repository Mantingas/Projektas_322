# Real-export compatibility framework

**Goal:** know, with evidence, which accounting programs' exports the importer handles – and say so only when it is true.
Targets: Rivilė, Finvalda, Microsoft Dynamics NAV / Business Central, Comarch ERP Optima, InsERT Subiekt, Symfonia.

> **No vendor is verified yet.** The repository contains no real export. The importer understands generic LT / PL / EN header
> vocabulary; that is *not* a claim of support for any program. Current status: [`docs/COMPATIBILITY.md`](../../docs/COMPATIBILITY.md).

## What counts as "verified"
A program is verified only if **at least one fixture** satisfies all of:
1. `provenance: "real-anonymized"` (a real export, anonymised) and `status: "ready"`;
2. it passes every check in `runner.ts`: header row found; **the proposed mapping equals `expect.fields` without manual correction**;
   amount basis (net / gross / unknown) and currency; imported row count; **sales totals equal the accounting program's own report**;
3. its manifest is valid (anonymisation recorded; `controlTotals.source` names the ERP report the totals came from).

Synthetic fixtures (e.g. `fixtures/_example`) exercise the framework and never count.

## Procedure for adding a real export (everything stays on your computer)
1. **Export** the sales lines (invoice lines with date, document number, customer, product, quantity, amounts) for a period from the
   accounting program. Export a second file for another period or a different report layout if you can – more variety is better.
2. **Take the control totals from the program itself**: run its own sales summary report for the *same period and filters* and write down
   the net (or gross) sales total, the number of lines and, if available, the number of documents. Do not take them from this tool.
3. **Anonymise locally:**
   ```bash
   npx tsx scripts/compat-new.ts /path/to/export.csv --vendor rivile --id rivile-sales-001 --scale 0.37 --shift-days 41
   ```
   The script keeps the header row and all format conventions (encoding, delimiter, number/date formats, title and totals rows),
   replaces customers / salespeople / products / document numbers by pseudonyms, blanks columns it does not recognise, and
   (optionally) scales amounts and shifts dates. It writes `tests/compat/fixtures/<vendor>/<id>/` with a **draft** manifest.
4. **Read the anonymised file yourself.** The script is a helper, not a guarantee. Remove anything that could identify a person or company.
5. **Complete `manifest.json`:** program name and version, `anonymization.reviewedBy`, `expect.basis` / `currency`, and the control totals from step 2
   (**multiplied by the same `--scale`**), then set `"status": "ready"`.
6. **Run** `npm test -- compat` and `npm run compat:report`. If the mapping does not match, that is a finding: improve the dictionary / mapper
   (never edit `expect` to hide a mismatch), then re-run. Commit the fixture folder and the regenerated `docs/COMPATIBILITY.md`.

## Safeguards
* `privacy.ts` scans every fixture for e-mail addresses, URLs, IBANs, phone numbers, tax / company ids and long digit runs; a hit fails the test.
  It catches obvious leaks only – it cannot prove anonymisation.
* A `real-anonymized` manifest without anonymisation details or without the ERP report source is rejected.
* `docs/COMPATIBILITY.md` is generated; a test fails if it is stale.
* Nothing in this framework opens a network connection.

## Manifest
See `schema.ts` (`CompatManifest`). Folder layout: `fixtures/<vendor-id>/<case>/{manifest.json, export.csv|export.xlsx}`.
