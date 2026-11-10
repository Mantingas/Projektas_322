# Commercial value audit

> **What this is.** An *expert potential assessment* of the findings the code really produces today. It is **not** proof of customer savings: no real company data has been analysed (see `COMMERCIAL_VALIDATION.md`, verdict: NO-GO for a paying customer, GO for a free controlled pilot). Scores are the author's judgement, 1 = very low, 10 = very high, and exist to decide what the first page should emphasise and what a pilot should test first.
>
> **Scope.** Only rules that exist in `src/engine` and run in the app. Nothing planned is listed as working. Code references name the file; every rule is found by its id (`grep "id: '<rule>'"`) – line numbers are deliberately not used because they drift. Test references are test files that mention the rule id (or whose assertions exercise it); where a rule is only exercised through a shared test, that is stated.

## 1. Modules at a glance

| Module | Required input | Findings | Has money amount? | What the amount means |
|---|---|---|---|---|
| **Sales** (`engine/insights/rules.ts`, `engine/sales`) | date + amount (a customer / product / salesperson / cost column unlocks more) | 11 | Yes, on every rule | Revenue change, revenue at risk, revenue in low-margin products – **exposure**, not savings |
| **Purchasing & suppliers** (`engine/purchasing`) | date + amount + product + quantity (+ supplier, unit) | 10 | Yes | Extra cost vs previous price (`actual`), spread between suppliers (`potential`), historical scenario (`hypothetical`, kept separate) |
| **Inventory** (`engine/inventory`) | product + quantity + snapshot date or movements (+ unit cost for value) | 10 | Yes when cost exists, otherwise a count | Stock value tied up, value of slow/dead stock |
| **Debts & cash** (`engine/finance`, `engine/trust`) | counterparty + amount + date (+ due date for ageing, payment register for payment findings) | 10 + 3 settlement rules | Yes | Overdue balance, credit still open, possible excess payment – each with an evidence status |
| **Universal analyser** (`engine/universal`) | any single table | 6 | No (counts/shares) | Data-quality and statistical signals, no money claim |
| **Cross-module** (`engine/executive/cross.ts`) | two modules + user-confirmed product / counterparty links | 5 | Yes where both sides share a currency | Only joined through **confirmed** links |

Every finding carries `reliability` (high / medium / low) and a reason key; finance settlement findings additionally carry an **evidence status** (`verified from data` / `high-confidence candidate` / `estimate` / `withheld`) decided by the kind of evidence, never by the amount (`engine/trust/evidence.ts`).

## 2. Every implemented finding

Columns: **Impact** = potential financial benefit to the client · **Freq** = how often the situation occurs in a typical SME · **Verify** = how objectively the result can be checked against source records · **Data** = how likely the required export is available · **MRR** = suitability for a monthly subscription. *Kind*: `$` = has an affected amount; `risk` = anomaly/risk only; `trend` = descriptive.

### 2.1 Purchasing & suppliers

| Finding | Kind | Impact | Freq | Verify | Data | MRR | Evidence shown | Code | Tests |
|---|---|---|---|---|---|---|---|---|---|
| `purchasing.price_increase` – purchase price rose vs previous period | $ (actual extra cost) | 8 | 9 | 8 | 7 | 8 | per-product previous/current price, quantity, lines | `purchasing/insights.ts` | `purchasing-insights`, `purchasing-analytics`, `executive-dashboard` |
| `purchasing.price_decrease` | $ (actual saving) | 4 | 7 | 8 | 7 | 4 | same | `purchasing/insights.ts` | `purchasing-insights` |
| `purchasing.supplier_price_gap` – same item cheaper at another supplier | $ (potential, tagged) | 9 | 6 | 7 | 6 | 8 | price per supplier, volume | `purchasing/insights.ts` | `purchasing-insights`, `executive-dashboard` |
| `purchasing.supplier_cost_increase` | $ | 7 | 7 | 8 | 7 | 6 | supplier spend bridge | `purchasing/insights.ts` | `purchasing-insights`, `executive-dashboard` |
| `purchasing.spend_change` | $ | 5 | 9 | 9 | 8 | 5 | period totals | `purchasing/insights.ts` | `purchasing-insights`, `executive-dashboard` |
| `purchasing.supplier_concentration` | risk | 5 | 6 | 9 | 7 | 4 | top-N shares | `purchasing/insights.ts` | `purchasing-insights` |
| `purchasing.unusual_quantity` – ≥ 3× median order | risk | 6 | 5 | 8 | 7 | 6 | the lines, median | `purchasing/insights.ts` | `purchasing-insights` |
| `purchasing.spend_anomaly` – week far above history | risk | 5 | 5 | 8 | 7 | 5 | the weeks | `purchasing/insights.ts` | `purchasing-insights`, `executive-dashboard` |
| `purchasing.credit_notes_reduced` – fewer supplier credits than before | risk | 6 | 4 | 6 | 6 | 5 | credit share previous/current | `purchasing/insights.ts` | `purchasing-insights` |
| `purchasing.historical_price_scenario` | $ (**hypothetical**, never summed with actual) | 3 | 6 | 3 | 6 | 2 | scenario assumptions | `purchasing/insights.ts` | `purchasing-insights`, `executive-dashboard` |

### 2.2 Debts & cash (reports + payment registers)

| Finding | Kind | Impact | Freq | Verify | Data | MRR | Evidence shown | Code | Tests |
|---|---|---|---|---|---|---|---|---|---|
| `finance.unmatched_credits` / settlement `unapplied_credit` – credit note with no matching use | $ (open credit balance) | 8 | 7 | 8 | 7 | 8 | credit, invoices and payments considered, state (`open_in_report`, `partially_applied`…) | `finance/insights.ts`, `trust/settlement.ts` | `finance-insights`, `trust-settlement`, `trust-adversarial`, `trust-evidence` |
| `finance.duplicate_payments` / settlement `duplicate_payment` – same invoice paid twice | $ (candidate or verified excess) | 8 | 5 | 8 | 6 | 8 | both payments, invoice, dates | `finance/insights.ts`, `trust/settlement.ts` | `finance-insights`, `trust-settlement`, `trust-adversarial` |
| settlement `overpayment` – paid more than invoiced | $ | 7 | 5 | 8 | 6 | 7 | invoice, payments | `trust/settlement.ts` | `trust-settlement`, `trust-adversarial` |
| settlement `unmatched_payment`, `counterparty_conflict`, `unclear_settlement` | $ (**investigate** – never counted as recoverable) | 4 | 6 | 5 | 5 | 4 | the payment/invoices | `trust/settlement.ts` | `trust-settlement`, `trust-recall` |
| `finance.largest_overdue` | $ | 7 | 9 | 9 | 7 | 7 | ranked counterparties | `finance/insights.ts` | `finance-insights`, `executive-dashboard` |
| `finance.long_overdue` – older than 90 days | $ | 7 | 8 | 9 | 7 | 7 | buckets | `finance/insights.ts` | `finance-insights`, `executive-dashboard` |
| `finance.overdue_growth` – vs previous snapshot | $ | 6 | 6 | 9 | 5 | 6 | two snapshots | `finance/insights.ts` | `finance-insights` |
| `finance.due_soon` | $ | 5 | 8 | 9 | 7 | 5 | open items due ≤ N days | `finance/insights.ts` | `finance-insights` |
| `finance.working_capital` (receivables) | $ (**possible**) | 6 | 7 | 6 | 7 | 5 | late share | `finance/insights.ts` | `finance-insights` |
| `finance.concentration` | risk | 5 | 7 | 9 | 7 | 4 | top shares | `finance/insights.ts` | `finance-insights` |
| `finance.payment_delay` / `finance.behaviour_change` | risk (indicator) | 5 | 6 | 6 | 4 | 5 | matched payments per counterparty | `finance/insights.ts` | `finance-insights` |

### 2.3 Sales

| Finding | Kind | Impact | Freq | Verify | Data | MRR | Evidence shown | Code | Tests |
|---|---|---|---|---|---|---|---|---|---|
| `sales.low_margin_products` (only if cost on ≥ 80 % of lines and net basis) | $ (revenue at low margin) | 8 | 7 | 8 | 5 | 8 | product, revenue, margin | `insights/rules.ts` | `insights`, `trust-evidence`, `phase7-i18n` |
| `sales.customers_declined` | $ (revenue lost vs previous period) | 7 | 8 | 8 | 9 | 7 | customer table, previous/current | `insights/rules.ts` | `period-insights`, `insights`, e2e |
| `sales.revenue_change` | $ | 5 | 10 | 9 | 10 | 5 | period totals, bridge | `insights/rules.ts` | `period-insights`, `executive-dashboard` |
| `sales.product_decline` / `sales.product_growth` | $ | 5 | 9 | 8 | 9 | 5 | product waterfall | `insights/rules.ts` | `period-insights` |
| `sales.salesperson_decline` | $ | 5 | 6 | 8 | 6 | 5 | salesperson table | `insights/rules.ts` | `insights` |
| `sales.customer_concentration` | risk | 5 | 7 | 9 | 9 | 4 | pareto | `insights/rules.ts` | via `analytics` (pareto) – rule id not asserted directly |
| `sales.product_pareto` | trend | 3 | 7 | 9 | 9 | 3 | pareto | `insights/rules.ts` | via `analytics` (pareto) |
| `sales.new_customers` | trend | 3 | 7 | 8 | 9 | 3 | list | `insights/rules.ts` | not asserted by id |
| `sales.margin_overview` | trend | 4 | 6 | 8 | 5 | 3 | margin | `insights/rules.ts` | covered by "no cost → no margin claims" tests |
| `sales.credit_notes` – credit notes ≥ 2 % of sales | risk | 5 | 5 | 8 | 8 | 4 | the notes | `insights/rules.ts` | `period-insights` |

### 2.4 Inventory

| Finding | Kind | Impact | Freq | Verify | Data | MRR | Evidence shown | Code | Tests |
|---|---|---|---|---|---|---|---|---|---|
| `inventory.excess_stock` – cover above threshold | $ (value tied up) | 7 | 8 | 7 | 6 | 7 | items, cover, value | `inventory/insights.ts` | `inventory-insights`, `executive-dashboard` |
| `inventory.non_moving` / `inventory.slow_moving` | $ | 7 | 9 | 8 | 6 | 7 | last-movement date, value | `inventory/insights.ts` | `inventory-insights` |
| `inventory.stockout_risk` | risk (count) | 7 | 7 | 7 | 5 | 7 | min/cover per item | `inventory/insights.ts` | `inventory-insights`, `executive-dashboard` |
| `inventory.negative_stock` | risk | 4 | 6 | 10 | 8 | 5 | item list (stored values) | `inventory/insights.ts` | `inventory-insights` |
| `inventory.stock_inconsistent` – snapshots don't reconcile with movements | risk | 5 | 5 | 8 | 4 | 5 | opening + movements vs closing | `inventory/insights.ts` | `inventory-insights` |
| `inventory.valuation_anomaly` – conflicting values, cost outliers | risk | 5 | 5 | 8 | 6 | 5 | rows | `inventory/insights.ts` | `inventory-insights` |
| `inventory.unusual_movements` | risk | 5 | 5 | 8 | 5 | 5 | movements | `inventory/insights.ts` | `inventory-insights` |
| `inventory.value_concentration` / `inventory.value_increase` | trend | 3–4 | 7 | 9 | 6 | 3 | shares / delta | `inventory/insights.ts`, `inventory/insights.ts` | `inventory-insights` |

### 2.5 Cross-module (only through confirmed links)

| Finding | Kind | Impact | Freq | Verify | Data | MRR | Code | Tests |
|---|---|---|---|---|---|---|---|---|
| `cross.margin_squeeze` – purchase price up while selling price flat | $ | 8 | 5 | 7 | 4 | 8 | `executive/cross.ts` | `executive-cross` |
| `cross.stock_cover_low` – demand outpaces stock | risk | 7 | 5 | 7 | 4 | 7 | `executive/cross.ts` | `executive-cross`, `trust-adversarial` |
| `cross.stock_excess_vs_demand` | $ | 6 | 5 | 7 | 4 | 6 | `executive/cross.ts` | `executive-cross`, `trust-adversarial` |
| `cross.customer_exposure` – overdue balance of a major customer | $ | 7 | 4 | 7 | 4 | 6 | `executive/cross.ts` | `executive-cross` |
| `cross.stock_vs_purchasing` | risk | 5 | 4 | 6 | 4 | 5 | `executive/cross.ts` | `executive-cross` |

### 2.6 Universal analyser

| Finding | Kind | Impact | Freq | Verify | Data | MRR | Code | Tests |
|---|---|---|---|---|---|---|---|---|
| `universal.duplicates`, `universal.missing`, `universal.outliers` | risk (data quality) | 3 | 10 | 9 | 10 | 3 | `universal/insights.ts` | `universal-analytics`, `universal-recognition` |
| `universal.trend_change`, `universal.concentration`, `universal.correlation` | trend | 3 | 8 | 7 | 10 | 3 | same | `universal-analytics` (correlation = Spearman ≥ 0.5, p < 0.01, n ≥ 30, outlier-sensitivity flag) |

The universal analyser never states a monetary effect. Its value is breadth (any table, immediate result), not savings.

## 3. Ten most commercially promising working features

Ranking rule: mean of **Impact, Verify and MRR** (section 2 scores); ties are broken by **Data** availability. Scores are the author's judgement (1–10). "Technically proven" below means: implemented, covered by automated tests and shown in the demo on **synthetic** data. **None of these has been validated on real company data**, so none is commercially proven.

| # | Feature | Impact | Freq | Verify | Data | MRR | Mean (I,V,M) | Input needed | Biggest limitation | Technically proven (synthetic) | Commercially proven |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Credit note that may be unapplied (`unapplied_credit`, `finance.unmatched_credits`) | 8 | 7 | 8 | 7 | 8 | 8.0 | Receivables/payables report with credit-note rows (and ideally invoice + payment registers with document references) | Without a payment register it can only say the report still shows the credit open; real ERP exports may not link credit notes to the invoices they offset | Yes – `trust-settlement`, `trust-adversarial`, `finance-insights` | No |
| 2 | Purchase price increases (`purchasing.price_increase`) | 8 | 9 | 8 | 7 | 8 | 8.0 | Purchase lines: date, supplier/product, quantity, amount (unit helps) | Needs the same item identified consistently (SKU) and comparable units; name-only matching lowers reliability to *low* | Yes – `purchasing-insights`, `purchasing-analytics` | No |
| 3 | Same item cheaper at another supplier (`purchasing.supplier_price_gap`) | 9 | 6 | 7 | 6 | 8 | 8.0 | Purchase lines with supplier and product on at least two suppliers | The amount is a *potential* saving: availability, minimum quantities, quality and delivery terms are not in the data | Yes – `purchasing-insights` | No |
| 4 | Possible duplicate payments / overpayments (`duplicate_payment`, `overpayment`) | 8 | 5 | 8 | 6 | 8 | 8.0 | Payment register with invoice references plus invoices | Repeat payments are often legitimate (instalments, recurring bills); candidates stay *candidates* until a person confirms | Yes – `trust-settlement`, `trust-adversarial` | No |
| 5 | Low-margin products (`sales.low_margin_products`) | 8 | 7 | 8 | 5 | 8 | 8.0 | Sales lines with a cost column on ≥ 80 % of lines, net amounts | Silent by design when cost or VAT basis is missing – many sales exports do not contain cost | Yes – `insights`, `trust-evidence` | No |
| 6 | Overdue and long-overdue receivables (`finance.largest_overdue`, `finance.long_overdue`) | 7 | 9 | 9 | 7 | 7 | 7.7 | Open-item report with due dates (or ageing buckets) | Already visible in most ERP reports, so the app adds ranking and evidence rather than new information | Yes – `finance-insights`, `finance-analytics` | No |
| 7 | Margin squeeze (`cross.margin_squeeze`) | 8 | 5 | 7 | 4 | 8 | 7.7 | Purchases and sales **plus user-confirmed product links** | Depends on the user confirming links between two files; without them it is withheld | Yes – `executive-cross` | No |
| 8 | Declining customers (`sales.customers_declined`) | 7 | 8 | 8 | 9 | 7 | 7.3 | Sales lines with customer and two comparable periods | Decline can be seasonal or a one-off order; the app cannot tell why | Yes – `period-insights`, `insights`, e2e | No |
| 9 | Excess, slow and non-moving stock (`inventory.excess_stock`, `slow_moving`, `non_moving`) | 7 | 8 | 7 | 6 | 7 | 7.0 | Stock snapshot with cost plus movements (history) | Cover and thresholds are generic (e.g. 180 days); seasonal or project stock can be flagged wrongly | Yes – `inventory-insights` | No |
| 10 | Stock-out risk (`inventory.stockout_risk`, `cross.stock_cover_low`) | 7 | 7 | 7 | 5 | 7 | 7.0 | Movements history or minimum stock levels; cross rule also needs demand and confirmed links | Reports a count, not money; lead times and open purchase orders are not known | Yes – `inventory-insights`, `executive-cross` | No |

**Reading the table.** Commercial *potential* is the Impact / MRR columns (judgement). Technical *proof* is the second-to-last column (tests on synthetic data). The gap between them is exactly what the free pilot must close: precision (how many findings a reviewer confirms) and recall (what real problems the app missed). Until then every claim on the website must stay at "possible" / "worth checking".

## 4. Conclusions that drive the first page

1. **No single module dominates.** Purchasing price findings, settlement findings (credits, duplicates) and margin findings score within one point of each other on benefit and verifiability. Sales trend findings are the most available but least monetisable; the universal analyser is the broadest but has no monetary claim.
2. **Therefore the first page leads with the business question** (*what is worth checking in your numbers*) across purchasing, sales and margins, receivables/payables, and stock – not with one module.
3. **Order of modules on the page** follows the audit: Purchasing prices → Debts, credits and payments → Sales and margins → Stock → Universal analysis.
4. **What can be shown honestly as a hero finding:** an *unapplied credit note* from the synthetic receivables set, produced by the real engine and classified *verified from data*, with its records. It is shown with the label "synthetic data".
5. **What must not be claimed:** realised savings, ROI, ERP compatibility, or that any pilot has happened. `potential` and `hypothetical` amounts are never presented as savings.

## 5. Limits of this audit

* Scores are judgement, not measurement. Precision and recall on real data are the pilot's job (`PHASE8_PILOT_EXECUTION.md`).
* "Data availability" assumes the client can export the listed columns; this was not checked against any real ERP.
* Frequencies are the author's estimate for small and mid-sized trading businesses, not market statistics.
