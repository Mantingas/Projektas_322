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
