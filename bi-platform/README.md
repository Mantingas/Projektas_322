# Excel Insights – local-first sales analytics (vertical slice)

Upload an Excel/CSV sales export → confirm the suggested column meanings → get explained, ranked sales insights.
**All parsing, calculation and storage happen in the browser** (Web Worker + IndexedDB). There is no server code.

Plan, risks and acceptance criteria: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Run

```bash
npm install
npm run dev            # http://localhost:3000
npm test               # unit/integration tests (vitest)
npm run typecheck
npm run build          # static export to ./out
npm run start          # serve ./out
npm run samples        # regenerate synthetic files in public/samples
npm run compat:report  # regenerate docs/COMPATIBILITY.md
npm run compat:new -- <export> --vendor rivile --id rivile-001   # anonymise a real export locally (see tests/compat/README.md)
# e2e (needs a built ./out and Chromium):
npm run build && PW_CHROMIUM_PATH=/path/to/chromium npm run test:e2e   # omit PW_CHROMIUM_PATH after `npx playwright install chromium`
```

## Phase 2 additions
- Sales dashboard with **Manager** and **Analyst** modes, KPI cards with previous-period comparison and calculation explanations, period comparison (DoD/WoW/MoM/YoY, rolling 7/30/90, custom) with partial-period warnings, 8 chart types chosen from the available data (each with a table alternative), sortable/searchable/paged tables with CSV export, drill-down to source rows, insight details, printable management summary.
- Corrected invoices are superseded (not lost), overlap risk without document numbers is disclosed, ZIP decompression limits.
- Shared engine: `src/engine/analytics` (see docs/ARCHITECTURE.md).

## Phase 2.1 additions
- Insights follow the selected period, filters, currency and VAT basis (rolling-window alerts are separate and labelled); year-to-date; period-status indicator.
- Safe import replacement: export-mode choice, import preview, explicit confirmation for replacements/removals, held lines + **Conflict review**, audit log, reversible imports.
- Hardened XLSX validation (measured decompression, DTD refusal, bounded dimensions) and the engine running in a Web Worker.
- Import diagnostics screen; real-export compatibility framework (`tests/compat`, `npm run compat:new`, `npm run compat:report`) – **no accounting program is verified yet**, see `docs/COMPATIBILITY.md`.

## Phase 3 additions
Purchasing and supplier intelligence: import purchase exports (supplier, SKU, unit, unit price, discount, credit notes), a purchasing dashboard with manager / analyst modes, supplier concentration, price changes by item and supplier, a price-volume-mix spend bridge, price variance across suppliers, explainable insights with *actual / potential / hypothetical* savings kept apart, drill-down to source lines and a local management summary. Strict unit policy by default; no silent currency or unit conversion. Samples: `public/samples/sample_lt_pirkimai.csv`, `sample_pl_zakupy.csv`, `sample_en_purchases.xlsx` (synthetic). Details: `docs/ARCHITECTURE.md` (Phase 3), screenshots in `docs/screenshots/phase-3/`.

## Phase 4 additions
Inventory intelligence: import stock balances, valuation reports, historical snapshots and movement reports (data type recognised and shown before import), a dashboard with manager / analyst modes (stock value and trend, warehouse comparison, top items, ABC / Pareto, turnover and days on hand, slow-moving / non-moving stock, stockout risk, movements, snapshot-vs-movement reconciliation), explainable insights, drill-down to source lines and a local management summary. Metrics that the data cannot support are withheld with the reason. Samples: `public/samples/sample_lt_likuciai.csv`, `sample_lt_judejimai.csv`, `sample_pl_wycena_zapasow.csv`, `sample_en_stock_movements.csv` (synthetic). Details: `docs/ARCHITECTURE.md` (Phase 4), screenshots in `docs/screenshots/phase-4/`.

## Phase 5 additions
Receivables, payables and cash intelligence (module "Receivables & payables"): import AR/AP open-item reports, aging reports, balance snapshots, invoice / payment / credit-note registers (dataset kind, grain and side are shown and confirmed before import). Dashboard with manager / analyst modes: outstanding, overdue amount / share / count, aging buckets, overdue trend, due-date timeline, counterparty ranking, payment behaviour, payment matching, credit-note review and duplicate-payment review, with source-document drill-down and local HTML/CSV reports. Insights are labelled **Fact**, **Possible match** or **Risk indicator**; a potential duplicate is never called a confirmed overpayment. Synthetic samples: `public/samples/sample_lt_gautinos_atviros.csv`, `sample_lt_mokejimai.csv`, `sample_lt_saskaitos.csv`, `sample_en_ap_open_items.csv`, `sample_pl_wiekowanie_zobowiazan.csv`. Screenshots: `docs/screenshots/phase-5/`.

## Phase 6 additions
- **Overview tab (executive dashboard):** 4–8 KPI cards (one per module metric, each in its own currency / VAT basis / period), up to 10 ranked findings with a class (fact · risk · potential opportunity · hypothetical scenario), key trends, largest changes, suggested actions, data coverage and quality flags, and the date of the last import. KPI cards open the source records; findings open their module. A local executive report (HTML, script-free, no external requests) and a findings CSV are generated in the browser. Figures of different modules, currencies, VAT bases and snapshots are never added.
- **Links between modules:** product and customer / supplier identity is shared across modules only through links you confirm. Equal codes are *proposed*; equal names alone are listed apart and never joined unless you knowingly confirm them (stored as "confirmed by you" and named in every finding that uses them). Decisions are local, audited, included in backups and can be undone. Confirmed links enable five cross-module findings (stock cover vs sales, stock above demand, purchase cost vs sales margin proxy, sales concentration vs overdue receivables, stock value vs purchasing); each discloses its sources, the links used, period, calculation, confidence and limitations.
- **Ranking:** materiality 35 % (relative to the module’s own base) · confidence 20 % · urgency 20 % · actionability 15 % · novelty 10 %; findings telling one story are folded into the strongest, and advice that contradicts another finding for a product you confirmed (buying more of something that is piling up) is withheld with a note.
- **Any table (universal analytics):** *Import → "Any other table"*. Column types (number, percentage, amount with currency, date / timestamp, category, identifier, yes/no, free text) are detected, and every ambiguous column must be confirmed before import. Analyses: descriptive statistics, trends, latest-period comparison, rankings, category distributions, outliers (Tukey fences), missing-data and duplicate diagnostics, correlations (≥ 30 rows, rank correlation ≥ 0.5, p < 0.01, outlier-sensitivity flagged). No business meaning is ever assumed. A chart recommender picks line, bar, Pareto, histogram, scatter or heat-map only where the data can answer the question, skips duplicates, and every chart shows its unit, scope and table alternative.
- **Test reliability:** the intermittent 120 000-line Playwright failure was traced (see `docs/ARCHITECTURE.md`) to Playwright’s in-memory file upload, not to the app; the test now uploads a file path with a tighter 600 ms limit, and regression tests guard it.
- Samples are generated by `scripts/make-samples.ts`; screenshots are in `docs/screenshots/phase-6/`.

## What works
- LT / PL / EN interface; `.xlsx`, `.csv`, `.tsv`; sheet selection; header row detection under report titles; totals rows skipped.
- UTF-8 / Windows-1257 / Windows-1250 CSV; `1 234,56`, `1.234,56`, `1,234.56`, `€`/`zł` suffixes; ISO, `dd.mm.yyyy`, `dd/mm/yyyy`, `yyyy.mm.dd`, Excel serial dates.
- Mapping with confidence scores, saved mappings, mandatory confirmation; VAT basis is never assumed (`net` / `gross` / `unknown`).
- 10 deterministic insight rules, ranking, topic de-duplication, "why not generated" list.
- Import history, file checksum + line-level duplicate prevention, backup/restore, delete-all, HTML/CSV report export.

## Known limitations
See the final report in the pull request / session summary. Notably: legacy `.xls` unsupported; templates are generic header signatures, not real ERP exports; tested only on synthetic files; ZIP limits trust sizes declared in the archive header; PDF = browser print.

### Phase 3 limitations
- No real ERP purchase export has been verified (only synthetic LT/PL/EN fixtures); see `docs/COMPATIBILITY.md`.
- Items identified by name only are compared but marked unverified; products without a unit column are assumed to have one unit per item.
- Potential savings assume the cheaper supplier can deliver the same quantity on the same terms; hypothetical scenarios are what-ifs.
- Payables / inventory / sales cross-module joins are not implemented (only the link contract).
- Mix effects are computed at item–supplier level; categories are not modelled.

### Phase 4 limitations
- No real ERP stock or movement export has been verified (only synthetic LT/PL/EN fixtures); see `docs/COMPATIBILITY.md`. Movement-type wording is a vocabulary, not a vendor guarantee.
- Demand comes only from movement files; sales exports are not joined (the link contract exists, no join). Seasonality and lead times are not modelled, so stockout risk is a warning, not a forecast.
- Balances are never reconstructed from movements; positions need snapshots. Turnover is per period (not annualised) and uses the average of the opening and closing snapshot only.
- Lot / batch / expiry, bin locations and multi-currency valuation are not modelled; each currency is its own series.
- Thresholds (180 / 90 / 14 days, 60-day minimum history) are fixed and shown, not yet configurable.

### Phase 5 limitations
- No real ERP receivable / payable export has been verified (only synthetic LT/PL/EN fixtures); see `docs/COMPATIBILITY.md`. No ERP compatibility is claimed.
- Outstanding balances come only from open-item / aging / balance snapshots; they are never derived from invoices minus payments. Snapshots are never summed.
- A payment is linked to an invoice only by an exact reference under the same counterparty. Payments without a usable reference stay unmatched; credit-note "possible matches" are suggestions and are never applied.
- Duplicate-payment findings are review indicators. Advance payments, split payments and unloaded credit notes can look like duplicates.
- DSO / DPO need a covering invoice register and enough invoices; they are withheld otherwise. Aging uses due dates as of the snapshot date; aging-only files give bucket totals without invoice evidence.
- Overdue KPIs are withheld when too many lines lack a due date (< 80 % known) and for plain balance snapshots.
- Multi-currency: each currency is its own series, no conversion. Thresholds (14 / 90 / 7 days, 5 matched payments) are fixed and shown.
- A supplier invoice register can be auto-detected as purchasing; select the finance module manually in that case.
- Cash forecasting, interest/penalties, and cross-module (sales/purchasing) joins are not implemented.

### Phase 6 limitations
- No real ERP export has been verified; no ERP compatibility is claimed. Cross-module findings need codes (product code, customer / supplier id) that are equal across the files; without codes you can only confirm links by hand.
- Cross-module quantities are assumed to be in the same unit in both files (you confirm the link; the files do not prove it). Stock cover ignores lead times, open orders and seasonality; the margin figure is a proxy (net price − net purchase cost), not the accounting margin.
- Cross-module findings are shown for the first currency that both modules share and only with net amounts (margin) or shares (customer exposure); other series are listed, never converted or added.
- The overview shows each module’s first currency / VAT-basis series and each module’s own latest 30 days; switch series inside the module views.
- Contradiction detection covers "buy more" versus "stock piling up" for products linked across purchasing, inventory and cross-module findings; sales-side evidence keys are not matched.
- Any table: files are limited to the same size and row limits as other imports; time-of-day of Excel timestamps is not available (Excel stores dates without a stored time in this parser); percent-like fractions (0–1) are converted ×100 only after you confirm "percentage"; the correlation test uses a large-sample approximation; no forecasting.
- The universal analysis does not detect formulas’ meaning and never evaluates formulas (cached values only).
