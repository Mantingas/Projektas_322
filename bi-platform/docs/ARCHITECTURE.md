# Architektūra, rizikos, planas ir priėmimo kriterijai

> Repozitorijoje iki šiol buvo tik nesusiję statiniai HTML failai ir `embassy-monitor/`.
> Nauja programa gyvena atskirame kataloge `bi-platform/` ir nieko iš esamo turinio nekeičia.

## 1. Architektūra

```
src/engine/            ← grynas TypeScript, be DOM/React (galima naudoti Worker'yje, testuose, vėliau darbalaukio programoje)
  parsing/             failo baitai → neapdorotos lentelės (CSV / XLSX), koduotės, saugumo ribos
  schema/              antraštės eilutės radimas, stulpelių profiliai, skaičių/datų/valiutų skaitymas
  mapping/             LT/PL/EN žodynas, žinomi šablonai, semantinis susiejimas + patikimumas
  validation/          eilučių validacija ir normalizavimas → kanoninės `SalesRecord`
  import/              kontrolinė suma, eilučių raktai, persidengiančių importų sujungimas
  sales/               KPI skaičiavimai (be UI, be formatavimo)
  insights/            įžvalgų taisyklės, reitingavimas, dubliavimosi šalinimas
  report/              lokali HTML/CSV ataskaita (HTML escape + formulių injekcijos apsauga)
src/db/                Dexie (IndexedDB): importai, operacijos, išsaugoti susiejimai, nustatymai
src/workers/           Web Worker: failo skaitymas ir antraštės radimas ne UI gijoje
src/i18n/              LT / PL / EN žodynai (įžvalgos grąžinamos kaip raktas + parametrai, ne kaip tekstas)
src/app, src/components UI (Next.js App Router, statinis eksportas, Tailwind, shadcn stiliaus komponentai)
```

Duomenų srautas:

```
File ─▶ Worker: parseFile ─▶ RawSheet[] ─▶ detectHeader ─▶ profileColumns
      ─▶ matchTemplate / saved mapping / suggestMapping (+confidence)
      ─▶ [VARTOTOJAS PATVIRTINA] ─▶ validate+normalize ─▶ SalesRecord[] + ImportStats
      ─▶ mergeIntoStore (dedupe pagal raktą) ─▶ IndexedDB
      ─▶ computeSalesKpis ─▶ rules ─▶ rank/dedupe ─▶ Insight[] ─▶ UI / HTML+CSV ataskaita
```

Pagrindiniai sprendimai:

| Tema | Sprendimas | Kodėl |
|---|---|---|
| Hostingas | `next build` su `output: 'export'` – grynai statiniai failai, **jokio serverio kodo** | Nėra vietos, kur duomenys galėtų patekti į serverį; CSP `connect-src 'self'` |
| Excel | **ExcelJS** (MIT) tik `.xlsx`; formulių rezultatai skaitomi iš talpyklos, formulės niekada nevykdomos | `xlsx` (SheetJS) npm paketas užfiksuotas ties 0.18.5 su žinomomis pažeidžiamumo (prototype pollution, ReDoS) pastabomis; naujesnės versijos platinamos ne per npm |
| CSV | Papa Parse (MIT) + savos koduotės (UTF-8 / Windows-1257 / 1250) ir skyriklio atpažinimas | Brandi, greita, naršyklėje ir Node |
| Senas `.xls` | Nepalaikomas MVP – aiški žinutė „išsaugokite kaip .xlsx“ | Binarinis formatas = didesnis atakos paviršius |
| Skaičiai | Stulpelio lygio skaičių formato išvedimas (`1 234,56` / `1.234,56` / `1,234.56`) | Pavienės reikšmės `1.234` yra dviprasmiškos |
| Sumų bazė | Atskiri kanoniniai laukai `net_amount`, `gross_amount`, `amount_unknown_basis` | Niekada nepriimame, kad suma be PVM, jei susiejimas to nenustato |
| Dublikatai | Eilutės raktas = 106 bitų maiša iš kanoninių laukų + pasikartojimo numeris faile | Tas pats laikotarpis du kartus / persidengiantys eksportai neskaičiuojami dukart |
| Įžvalgos | Deterministinės taisyklės; grąžina struktūrą (raktas+parametrai+įrodymai), ne tekstą | Verčiama į LT/PL/EN, tikrinama testais |

## 2. Techninės rizikos ir kompromisai

1. **Neteisinga finansinių duomenų interpretacija** (didžiausia rizika). Sumažinimas: privalomas patvirtinimas; sumos bazė (neto/bruto/nežinoma) rodoma kiekviename rezultate; trūkstami laukai → įžvalga negeneruojama; savikaina/marža tik kai padengta ≥ 80 % eilučių.
2. **Dviprasmiški skaičių/datų formatai** (`1.234`, `03/04/2024`). Sumažinimas: stulpelio lygio išvedimas, nenusprendžiamų atvejų skaičius rodomas kaip perspėjimas.
3. **Dvigubas skaičiavimas**: raktas gali nesutapti, jei eksporte pataisyta suma. Sumažinimas: dokumentai su tuo pačiu numeriu, bet kitu turiniu laikomi „konfliktais“ ir **nepridedami**, o importo suvestinėje rodomi. Likusi rizika: jei failuose nėra dokumento numerio, pataisyta eilutė bus atskira operacija.
4. **Nepatikimas įvestis**: formulės nevykdomos, VBA ignoruojama, ribos failo dydžiui / eilučių / stulpelių skaičiui, visi tekstai atvaizduojami per React (be `dangerouslySetInnerHTML`), eksportuojamos HTML reikšmės escape'inamos, CSV – su formulių prefiksu. **Likusi rizika:** ExcelJS neriboja išskleistos ZIP apimties (zip bomb); ribojame tik failo dydį.
5. **Našumas** didelėms lentelėms: skaitymas Worker'yje, vienas praėjimas per eilutes. IndexedDB įrašai – masiniai `bulkPut`. DuckDB-Wasm atidedamas.
6. **Privatumo garantija** priklauso nuo disciplinos: testas tikrina, kad `src/` nenaudoja tinklo API / analitikos paketų, o Playwright testas stebi visas užklausas įkėlimo metu.
7. **Naršyklės saugykla** gali būti išvalyta – nustatymuose yra atsarginė kopija (JSON) ir paprašoma „persistent storage“.

## 3. Etapai

| Etapas | Turinys | Būsena |
|---|---|---|
| 0 | Planas, rizikos, kriterijai (šis dokumentas) | ✅ |
| 1 | Pagrindas: Next.js, i18n, IndexedDB, CSP | ✅ |
| 2 | Importas: parseris, antraštės radimas, profiliavimas, susiejimas, patvirtinimas | ✅ |
| 3 | Pardavimų KPI ir 9 įžvalgų taisyklės, reitingavimas | ✅ |
| 4 | Istorija, dublikatai, ataskaitos eksportas (HTML/CSV) | ✅ (PDF – per naršyklės „Spausdinti“) |
| 5 | Testai: vienetiniai, 10 formatų, privatumas, e2e | ✅ pirmas lygis; realūs failai dar netikrinti |
| 6+ | Pirkimai, atsargos, skolos, universalus analizatorius; paskyros ir mokėjimai | ❌ sąmoningai nepradėta |

## 4. Priėmimo kriterijai (matuojami)

| # | Kriterijus | Kaip tikrinama |
|---|---|---|
| A1 | ≥ 10 skirtingų LT/PL CSV/XLSX formatų įkeliami ir pasiūlomas teisingas susiejimas be rankinių pataisų | `tests/formats.test.ts` |
| A2 | Pardavimų suma, eilučių skaičius, TOP klientas, TOP prekė kiekvienam formatui sutampa su nepriklausomu skaičiavimu iš „tiesos“ duomenų | `tests/formats.test.ts` |
| A3 | Pakartotinis to paties failo / persidengiančio eksporto importas nekeičia sumų | `tests/import-store.test.ts` |
| A4 | Jokios įžvalgos be reikiamų laukų (nėra savikainos → nėra maržos įžvalgos) | `tests/insights.test.ts` |
| A5 | Kiekviena įžvalga turi: poveikį, patikimumą, veiksmą, įrodymus; nėra beveik vienodų dublikatų | `tests/insights.test.ts` |
| A6 | `src/` neturi `fetch`/`XMLHttpRequest`/`sendBeacon`/`WebSocket`/analitikos paketų | `tests/privacy.test.ts` |
| A7 | Įkėlimo metu naršyklė neišsiunčia jokių užklausų ne į savo kilmę ir jokių POST | `e2e/privacy.spec.ts` |
| A8 | Duomenys išlieka perkrovus puslapį; „Ištrinti viską“ išvalo visas lenteles | `e2e/flow.spec.ts` |
| A9 | `tsc --noEmit`, `vitest run`, `next build` be klaidų | CI komandos |

---

# Phase 2 – analytics, comparisons, visualisations

## Audit findings (fixed before any new feature; each has a regression test in `tests/audit-fixes.test.ts`)

| # | Finding | Evidence | Fix |
|---|---|---|---|
| 1 | Corrected invoice lost: the new line was parked as a "conflict" and never stored | stored 150 € instead of 170 € | Document-level merge: replaced lines are **kept** (`supersededBy`) but leave analytics; deleting the correcting import restores them; older versions arriving later are ignored (`stale`) |
| 2 | No document number → corrected line double-counted | 220 € instead of 120 € | Identity reliability (`document` / `mixed` / `content`) stored per import; dry-run preview warns about overlap risk; dashboard shows a data limitation. Not "fixed" – it cannot be fixed without identifiers; it is disclosed |
| 3 | No ZIP decompression limits | 150 KB file inflated to 150 MB (+371 MB RAM) | Central directory inspected before inflating: entry count, per-entry/total size, compression ratio, ZIP64 rejected |
| 4 | Average order value included credit-note documents | 33.3 instead of 100 | Orders = documents with a positive total |
| 5 | Records lost provenance (`importId`) | – | Kept in loaded records, used by drill-down |
| 6 | Conflict lookup loaded the whole sales table | – | Indexed `docKey` (Dexie schema v2 with migration) |
| 7 | Table names sorted by code point (Š, Ž, Ł misplaced) | found by an e2e test | `Intl.Collator` per UI language |
| 8 | Mobile analyst view overflowed by 457 px | found by an e2e test | `min-w-0` on cards / single-column grids |

## Shared analytics layer (`src/engine/analytics`, no React)

```
filters.ts      one filter implementation (entity keys, text) – used by KPIs, charts, tables, drill-down, reports
periods.ts      day/week/month/year-over-year, rolling 7/30/90, custom; like-for-like by default; partial-period & data-gap warnings
aggregate.ts    ONE pass → Aggregate; per-entity aggregates with an "unassigned" bucket so totals always reconcile
metrics.ts      metric registry: pure functions of an Aggregate + availability rules (new modules register here)
compare.ts      metric comparison (abs, %, direction, zero-base), trend, aligned series, entity tables, rankings, Pareto, waterfall, composition
charts.ts       chart configuration: which charts make sense for the data, and why a chart is hidden
provenance.ts   drill-down on the same filter engine; source summary; metric input explanations
dashboard.ts    buildDashboard(): the single model consumed by UI, drill-down and the management summary
insights/explain.ts   normalised insight explanation (what / how much / contributors / why / action / sufficiency)
report/summary.ts, report/svg.ts   printable management summary with dependency-free SVG charts
```

Consistency guarantee (tested): Σ entity rows + unassigned = KPI sales; trend total, aligned series, Pareto total and composition agree with the KPI; waterfall start + Σ steps = end; drill-down total = KPI value.

## Phase 2 acceptance results
See the final report; numbers are produced by `npm test` and `npm run test:e2e`.

---

# Phase 2.1 – reliability and real-world readiness

## Import replacement policy (what can change stored data, and who decides)

Nothing is ever deleted. "Replaced" lines get `supersededBy`, "held" lines get `heldBy`, discarded lines get `discarded`; every action is written to an audit log and
deleting an import undoes everything that import did. The user declares what the file contains (`full` / `incremental` / `partial` / `unknown`, default `unknown`).

| Situation (document numbers present) | full | incremental | partial | unknown |
|---|---|---|---|---|
| New document | add | add | add | add |
| Identical lines | skip (duplicate) | skip | skip | skip |
| File only ADDS lines to a stored document | add | **hold** | add | **hold** |
| Stored document differs (corrected) | **replace – needs explicit confirmation** (or hold / keep both) | hold | hold | hold |
| Stored lines missing from the file | **remove – needs explicit confirmation** (or hold) | kept | kept | kept |
| Stored documents absent from the file | reported only, never touched | – | – | – |
| Older version of an already-corrected line | ignored (`stale`) | ignored | ignored | ignored |

Without document numbers (identity = content only) nothing can be matched reliably, so the import preview says so and offers three choices:
*hold overlapping lines* (default when dates overlap), *import only lines after the latest stored date*, or *skip exact duplicates and add the rest* (a corrected line may be
counted twice → explicit confirmation). Held lines are excluded from every figure; the dashboard states how many are waiting. **History → Conflict review** resolves
them per document: use the new version / keep what is stored / keep both.

## Engine in a Web Worker

`EngineSession` (`src/lib/engineSession.ts`) holds parse → profile → normalise → merge-plan → commit → dashboard → drill-down. `src/workers/engine.worker.ts` hosts it; the page talks to it
through `EngineClient` (typed RPC, per-call time budget, the worker is terminated and recreated on timeout). The record list never crosses to the UI thread: only aggregated
models and the visible drill-down page do. The same class runs in the tests and as a main-thread fallback when `Worker` is unavailable.

## Archive validation (XLSX)

`inspectZip` reads the central directory, then **inflates every entry in 4 KB steps and counts the real output** (declared sizes are not trusted): per-entry and total caps, ratio cap,
time budget, encrypted / unsupported-method / path-traversal / duplicate-name entries refused, entity declarations (`<!DOCTYPE`, `<!ENTITY`) in XML parts refused (billion-laughs, XXE),
required workbook parts checked. Sheets are read row-by-row from existing rows only (a sheet that declares row 1 000 000 costs nothing), with row, column, cell and gap limits.
Residual risk: ExcelJS inflates the archive again, so memory for a legitimate, very large workbook is bounded only by these caps.

## Analytics consistency additions
Period-aware insights (`analyzeSalesPeriod`), year-to-date (offered only when data reaches back to 1 January; equal elapsed days), explicit period-status chip
(complete / incomplete n of m / year to date), rolling-window alerts as a separate, labelled section, held-lines limitation.

## Compatibility framework
`tests/compat` + `scripts/compat-new.ts` + `docs/COMPATIBILITY.md` (generated). **No vendor is verified**: there is no real export in the repository.

## Phase 3 – Purchasing and supplier intelligence

**Module split.** Sales and purchasing share the import-safety store (`src/db/store.ts`, module-parametrised: `imports`, `sales`, `purchases` tables, schema v4), the merge planner, the period engine, `compareWith`, entity tables, Pareto / waterfall helpers, diagnostics and the report builders. Purchasing-specific code lives in `src/engine/purchasing/*` and `src/engine/validation/normalizePurchases.ts`; the UI in `src/components/purchasing/*`. The page still receives only aggregated models from the worker (`buildPurchasing`, `priceTrendFor`); the record list never crosses the worker boundary except for one drill-down page.

**Recognition.** `PURCHASE_FIELDS` (supplier name/id, product name/SKU, unit, unit price, discount, warehouse, document type …) with LT/PL/EN synonyms. The module is *proposed* from the headers (`detectModule`; ambiguous words such as "kontrahent" count for neither) and always confirmable; mappings are saved per module (`purchasing:` signature prefix).

**Identity and units (no silent conversion).**
- Supplier = code if present, otherwise name. Supplier document numbers are unique only per supplier, so purchase `docKey` is `currency|supplier|document`.
- Product = `sku:<code>` (verified) or `name:<name>` (unverified, reliability capped at *low*). One code with several names is *ambiguous* and excluded from price comparison.
- Prices are compared only for the same product, same unit, same currency and VAT basis. `UnitPolicy` `strict` (default) compares identical units; `metric` (opt-in, announced in the limitations) applies exact SI factors only (g/t→kg, ml→l, cm/mm→m). pcs / box / pack / pallet are never converted. Quantity totals are shown only when all lines share one unit.
- Credit-type column + positive amount ⇒ sign flipped and counted (`credit_sign_normalised`). Discount arithmetic is checked (`none | included | deducted | unverified`) and the result is shown at import.

**Spend bridge.** Δspend = price (same item, same supplier) + supplier mix + volume + new items + discontinued items + credit notes + not comparable; the last bucket is the remainder, so the steps add up exactly. Tests verify this identity.

**Savings classification.** *Actual* (a lower price was paid than the previous period's price from the same supplier), *potential* (cross-supplier gap in the same period; assumes the cheaper supplier can supply the quantity on the same terms) and *hypothetical* (earlier lower monthly price; no evidence it is available today). The three are displayed and exported side by side and are never summed. "Fewer credit notes" is raised only with ≥3 prior credit documents, ≥2 % of purchases and a fall of both amount and share by half, and says it does not prove missing credits.

**Cross-module preparation.** `src/engine/entities/links.ts` is a design contract, not a join: links are proposed only from equal verified codes (never names), start as `proposed`, need a user decision, and ambiguous codes are never proposed. No analytics use links yet.

**Reports.** `buildPurchasingSummaryDoc` reuses `renderManagementSummary` (self-contained HTML, no scripts) and the CSV builder (formula-injection safe). The savings kind is part of the impact cell.

**Robustness.** `translate()` falls back to English / the key instead of throwing; `tests/purchasing-i18n.test.ts` lists every dynamically built key (a missing `punavail.*` key crashed the page during Phase 3 e2e).

## Phase 4 – Inventory intelligence

**Module split.** Inventory is a third module on the shared machinery: the generic import-safety store (new `inventory` table, schema v5), the merge planner, period engine, `compareWith`, entity tables, Pareto / waterfall helpers, diagnostics and report builders. Inventory code lives in `src/engine/inventory/*` and `src/engine/validation/normalizeInventory.ts`; UI in `src/components/inventory/*`. The page receives only aggregated models from the worker (`buildInventory`); positions, movement lines and item lists never cross the worker boundary except one drill-down page.

**Dataset types.** Detected from the confirmed mapping and shown before import: *stock balance* (quantities only), *valuation report* (cost / value), *historical snapshots* (several dates), *movements* (a movement type or movement date is mapped). A balance without a date column needs the as-of date the user types. One record type (`InventoryRecord`) holds both kinds; `kind: 'snapshot' | 'movement'`.

**Snapshots are documents.** A snapshot line gets the synthetic document id `snap <date> <warehouse>`, so the existing merge rules apply unchanged: an identical re-export adds nothing, a *conflicting* snapshot of the same date and warehouse is held for review (or replaced after an explicit confirmation), and every decision is audited and reversible. Two sources of one snapshot kept side by side are flagged (`i_multi_source`).

**Position, not sums over time.** Stock value / quantity at a date D is the *latest snapshot of each warehouse on or before D* (`SnapIndex`, `positionAt`). The previous period uses ITS OWN snapshot; if it would be the same snapshot, the change is withheld. A value is the stated value, else quantity × unit cost, else unknown – never estimated; value KPIs need ≥ 80 % valued lines.

**Withheld, not guessed.** Turnover and days on hand need two valued snapshots (opening and closing) and movements that cover the window with enough issue values. Slow-moving, non-moving and excess stock need ≥ 60 days of movement history ending near the closing date (lookback ≤ 180 days). Cover-based stockout risk needs the same history; below-minimum risk needs only the snapshot with a minimum-stock column. No snapshot alone ever produces turnover, "non-moving" or a demand-based stockout. Items that never appear in the movement file are reported as *not classified*, never as non-moving. Rules and thresholds (slow > 180 d cover, excess above 90 d demand, stockout < 14 d cover) are shown to the user.

**Movements.** Types are read from the type column (LT / PL / EN wording; unknown stays unknown and, above 20 %, switches demand metrics off). Sign convention is decided per file (issues printed positive or negative) and reported. **Transfers, adjustments and opening balances are never receipts or issues**; a transfer moves stock between warehouses only (two legs or one line with a destination) and unbalanced transfer documents are reported. Customer returns reduce issues, supplier returns reduce receipts, write-offs always reduce stock.

**Consistency checks.** Negative stock lines, stated value ≠ quantity × cost, unit costs differing ≥ 3-fold between lines, and *snapshot A + movements = snapshot B* (only where the movement file covers the interval, only for items in both snapshots) – differences are findings to check, not proof of loss.

**Units and identity** follow the purchasing rules: strict unit policy by default, exact metric conversion opt-in, pieces / boxes / packs never converted; product = code (verified) or name (unverified, low reliability); one code with several names is excluded from movement-based conclusions. Matching snapshot to movement lines uses product + unit when both files carry units, otherwise product only (with a limitation).

**Insights** (`analyzeInventoryPeriod`): value concentration, value increase, excess stock, slow-moving, non-moving, stockout risk, negative stock, snapshots vs movements, unusual movements, valuation anomalies. Each has evidence, reliability with a stated reason, an action and a "why". Amounts for slow / non-moving / excess stock are *capital tied up, not losses*; no inventory text promises savings (tested).

**Cross-module foundation.** `proposeLinks` / `proposeInventoryLinks` / `confirmedCounterpart` (`src/engine/entities/links.ts`): links are proposed only from equal verified product codes, stay `proposed` until the user decides, name-only matches are unverified candidates, ambiguous codes are never proposed, and another module can reach an item only through a link the user confirmed. Nothing joins data yet.

## Phase 5 – Receivables, payables and cash intelligence
Code: `src/engine/finance/*` (keys, kind, ledger, metrics, dashboard, insights, drill), `src/engine/validation/normalizeFinance.ts`, `src/components/finance/*`, `src/lib/financeSummary.ts`, texts in `src/i18n/fin.{en,lt,pl}.ts`. Module id `finance` (Dexie table `finance`, schema v6); everything else (worker, store, merge planner, chart architecture, drill-down, reports) is reused.

**Dataset kind and grain** come only from the confirmed mapping: aging buckets → aging; payment date / payment reference → payments; credit reference → credit notes; outstanding + document id → open items; outstanding without document → balance; otherwise invoices. Credit rows inside an invoice register (document-type or negative amount) are split off. The side (receivable / payable) is suggested from headers and confirmed by the user.

**Snapshots vs flows.** Open-item, aging and balance reports are *positions*: each gets a synthetic document id (`<kind> <side> <date>`), so a conflicting re-export of the same date is held for review, never merged or summed. Position choice = newest snapshot ≤ the as-of date (open item > aging > balance on ties). Invoice, payment and credit registers are *flows*, merged by real document numbers (scoped by counterparty where numbers are not globally unique). Flows are shown only if the register covers the window, and are never turned into balances.

**Aging** is computed from due dates at the snapshot date (due on the as-of date = not overdue; buckets 1–30 / 31–60 / 61–90 / >90; no due date → separate bucket; negative lines → credits).

**Matching.** A payment links to an invoice only by exact reference under the same counterparty (status matched / unreferenced / not_found / counterparty_conflict). Credit notes: matched / reference_not_found / no_reference; same-counterparty-same-amount candidates are displayed as possible matches only. Duplicate tiers: exact_repeat, same_invoice, overpaid, lookalike (≤ 7 days) – all "possible".

**Certainty classes** on every insight: `fact` (read directly from data), `possible` (needs checking), `indicator` (pattern-based risk). DSO/DPO = outstanding / invoiced × days, requires ≥ 10 invoices and a covering register; payment delay requires ≥ 5 matched payments. Link contract: counterparty and document keys are stable for future joins with sales/purchasing; no join is implemented.

