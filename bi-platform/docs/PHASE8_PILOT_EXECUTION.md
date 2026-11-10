# Phase 8 – Pilot execution

**Data-dependent gate: NOT PASSED.** No real, lawfully supplied accounting export was available in the repository or on the machine this phase ran on (searched; only synthetic samples and one synthetic compatibility example exist). Nothing in this phase is a real-world result. Commercial validation is **NOT STARTED**. This document describes the tooling that was built and the exact procedure to run the pilot once data exists.

## 1. What this phase delivered
| Piece | Where | Purpose |
|---|---|---|
| Local pseudonymiser | `scripts/pilot-pseudonymize.ts`, `src/engine/pilot/pseudonymize.ts` | Prepare confidential exports locally: keyed (HMAC-SHA-256) deterministic pseudonyms for counterparty ids / names and document references, consistent across files; amounts, dates, currencies, types untouched; unrecognised columns blanked; titles and footers dropped; control totals of the original written alongside. No network, no telemetry, output only inside git-ignored `pilot-data/`. |
| Review store (IndexedDB v8) | `src/engine/pilot/types.ts`, `src/db/*` | Reviewer decisions per finding (confirmed / false positive / inconclusive / not reviewed), reconciliation text, reasons, amounts, evidence, minutes; known-missed list; pilot facts. Audited, in backup/restore, removed by "delete everything"; migration from v7 tested. |
| Pilot metrics | `src/engine/pilot/metrics.ts` | Counts, precision-as-counts, recall only with an attested complete reference list, five value tiers kept apart, time saved, completeness checklist, commercial status. |
| Pilot tab | `src/components/pilot/PilotView.tsx` | Datasets and coverage, warnings, facts, findings awaiting verification with evidence panel and review form, known misses, withheld conclusions, qualified results, completeness, reports. LT / PL / EN. |
| Pilot report | `src/lib/pilotReport.ts` | CFO report answering seven questions; HTML script-free, names masked by default; review ledger CSV (formula-safe). |
| Documents | this folder | Checklist, results template, commercial-validation criteria with go / no-go. |

Also fixed this phase: a Phase 7 slip (hand-editing the generated `docs/COMPATIBILITY.md` made its freshness test fail; restored).

## 2. Procedure once real data is available
1. **Authorisation.** The data owner confirms in writing that the exports may be used for this validation. Record who, when, scope (no personal data beyond what the files contain).
2. **Export** the four supplier-side files for the same ~12 months (see `docs/PILOT_DATA_CHECKLIST.md`) and note exporter, report name, version, filters, encoding. Note the accounting system's own totals (row counts, sums) – independently of this app.
3. **Pseudonymise locally** (data owner's machine, offline):
   ```bash
   PILOT_SECRET='<16+ random characters, kept by the owner>' \
     npx tsx scripts/pilot-pseudonymize.ts ap_invoices.csv credit_notes.csv payments.csv open_items.csv --write-key
   ```
   Check `pilot-data/pseudonymised/control-totals.json` against the system's own totals. **Read the output files.** Keep `pseudonym-key.json` with the owner: it is how the reviewer maps a finding back to a real document. (If the owner prefers, they can import the *original* files directly into the app – everything is local – and skip this step; the pseudonymised copies are for sharing outside the owner's control.)
4. **Import** each file (Import tab). Confirm side = payables, currency, as-of date for the open-item report. Copy the import trust card and every confirmation into the results template. Unsupported or refused files are findings.
5. **Validate column meaning and sign conventions** with the owner's accountant on ≥ 10 random rows per file (checklist section 3). Do **not** hardcode a workaround to make one sample pass: if the mapper is wrong, record the pattern; build a narrowly scoped adapter only for a pattern that is documented, general for that exporter, and tested with a synthetic fixture of the same shape.
6. **Pilot tab → Pilot facts:** organisation label, period, documented snapshot date and its source report, the baseline minutes of the customer's existing process for the same scope, preparation minutes, reviewer, and – only if true – the real-data attestation.
7. **Independent reviewer reconciles** every reviewable finding (or a stratified sample of ≥ 30 including all statuses): opens the evidence, checks the cited records against the accounting system and bank statements, records decision, reconciliation explanation, reason if rejected, confirmed discrepancy, the customer's recoverable statement and minutes spent.
8. **Reference list.** Independently of the app, the reviewer lists problems they know exist in the period (found by their normal process or by a full manual review). Enter each as a known problem; link the finding if the app found it, else give the reason it was missed. Tick "list is complete" **only** if it truly is – otherwise recall stays unavailable.
9. **Value** is recorded in tiers and **never summed**: potential exposure (the app), confirmed accounting discrepancy, customer-stated recoverable, actually recovered (with where it was independently reported), prevented loss (with evidence).
10. **Report.** Export the pilot report and review ledger (names masked by default). Fill `docs/PILOT_RESULTS_TEMPLATE.md`. Update `docs/COMMERCIAL_VALIDATION.md`.
11. **Stop conditions.** A *verified* finding rejected by the reviewer is a product defect: stop and investigate before any claim. Fewer than 30 decisions: report counts, not rates. A complete checklist is still a single-company result.

## 3. What was tested (synthetic only)
Pseudonymiser: determinism, cross-file consistency, no original value in outputs or CLI logs, relationship preservation (the pseudonymised copy imports with the same totals, due dates and distinct counterparties), refusal of short secrets and of output outside `pilot-data/`, git-ignore guarantees. Review store and metrics: tier separation, recovered-without-evidence exclusion, recall denominator rule, time-saved rule, completeness, status rules, v7→v8 migration, backup/restore, wipe. Report: seven answers, provenance banner, masking, formula safety, LT/PL/EN completeness, no "validated" wording. Browser: complete review workflow, status transitions, exports, PL/LT, mobile.

## 4. Limits of pseudonymisation (explicit)
This is **pseudonymisation, not anonymisation**. Amounts, dates and document patterns are deliberately preserved (reconciliation needs them) and can identify a supplier to someone who knows the business; one-off amounts, small suppliers and unusual dates are the weak points; document numbers can be kept (`--keep-docs`) only if the owner accepts that. Unrecognised columns are blanked, but a column the tool *does* recognise could still contain something identifying. The secret must never leave the owner; anyone holding secret + original data can regenerate the mapping. The files remain confidential business data. Real files must never be committed (`pilot-data/` is git-ignored; tests guard it).
