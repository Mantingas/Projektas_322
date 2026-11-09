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
# e2e (needs a built ./out and Chromium):
npm run build && PW_CHROMIUM_PATH=/path/to/chromium npm run test:e2e   # omit PW_CHROMIUM_PATH after `npx playwright install chromium`
```

## What works
- LT / PL / EN interface; `.xlsx`, `.csv`, `.tsv`; sheet selection; header row detection under report titles; totals rows skipped.
- UTF-8 / Windows-1257 / Windows-1250 CSV; `1 234,56`, `1.234,56`, `1,234.56`, `€`/`zł` suffixes; ISO, `dd.mm.yyyy`, `dd/mm/yyyy`, `yyyy.mm.dd`, Excel serial dates.
- Mapping with confidence scores, saved mappings, mandatory confirmation; VAT basis is never assumed (`net` / `gross` / `unknown`).
- 10 deterministic insight rules, ranking, topic de-duplication, "why not generated" list.
- Import history, file checksum + line-level duplicate prevention, backup/restore, delete-all, HTML/CSV report export.

## Known limitations
See the final report in the pull request / session summary. Notably: legacy `.xls` unsupported; templates are generic header signatures, not real ERP exports; tested only on synthetic files; ZIP-bomb protection is limited to file size; PDF = browser print.
