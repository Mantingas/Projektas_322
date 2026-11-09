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
