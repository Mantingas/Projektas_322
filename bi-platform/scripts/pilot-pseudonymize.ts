/**
 * Local-only pseudonymisation of confidential accounting exports for the pilot (no network access, no telemetry, nothing is uploaded).
 *
 *   PILOT_SECRET='<at least 16 random characters, kept by the data owner>' \
 *     npx tsx scripts/pilot-pseudonymize.ts ap_invoices.csv credit_notes.csv payments.csv open_items.xlsx [--keep-docs] [--write-key] [--out pilot-data/pseudonymised]
 *
 * Outputs (only inside the git-ignored `pilot-data/` directory):
 *   file-1.csv … file-N.csv     pseudonymised copies (neutral names: original file names can identify the company)
 *   control-totals.json         row counts and sums of the ORIGINAL amount columns, for checking the copies against the accounting system
 *   pseudonym-key.json          (only with --write-key) pseudonym → original; CONFIDENTIAL, stays with the data owner
 * The secret is read from the environment, never from the command line (shell history). Original values are never printed.
 * This is pseudonymisation, not anonymisation – see docs/PILOT_DATA_CHECKLIST.md for its limits.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { MIN_SECRET, pseudonymise } from '../src/engine/pilot/pseudonymize';

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const val = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const files = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out' && argv[i - 1] !== '--sheet');
const secret = process.env.PILOT_SECRET ?? '';
const out = path.resolve(val('out') ?? 'pilot-data/pseudonymised');
const safeRoot = path.resolve('pilot-data');
if (!files.length) { console.error('Give at least one export file.'); process.exit(2); }
if (secret.length < MIN_SECRET) { console.error(`Set PILOT_SECRET (at least ${MIN_SECRET} characters) in the environment.`); process.exit(2); }
if (out !== safeRoot && !out.startsWith(safeRoot + path.sep)) { console.error('Output must be inside pilot-data/ (git-ignored) so confidential data cannot be committed by accident.'); process.exit(2); }
fs.mkdirSync(out, { recursive: true });

const control: Record<string, unknown> = {};
const key: Record<string, string> = {};
let i = 0;
for (const f of files) {
  i++;
  const res = await pseudonymise(new Uint8Array(fs.readFileSync(f)), path.basename(f), { secret, hmac: (s, m) => createHmac('sha256', s).update(m).digest('hex'), keepDocumentNumbers: flag('keep-docs'), sheet: val('sheet') });
  if (res.warnings.includes('no_table')) { console.error(`file-${i}: no table with data was found – nothing written.`); continue; }
  fs.writeFileSync(path.join(out, `file-${i}.csv`), res.csv);
  control[`file-${i}`] = { ...res.control, pseudonymisedFields: res.pseudonymisedFields, keptFields: res.keptFields, blankedColumns: res.blankedColumns, warnings: res.warnings };
  Object.assign(key, res.reverse);
  console.log(`file-${i}.csv: ${res.rows} rows, ${res.pseudonymisedFields.length} identifying fields pseudonymised, ${res.blankedColumns} unrecognised columns blanked${res.warnings.length ? ', warnings: ' + res.warnings.join(',') : ''}`);
}
fs.writeFileSync(path.join(out, 'control-totals.json'), JSON.stringify(control, null, 1));
if (flag('write-key')) { fs.writeFileSync(path.join(out, 'pseudonym-key.json'), JSON.stringify(key, null, 1)); console.log('pseudonym-key.json written: CONFIDENTIAL, keep it with the data owner.'); }
console.log(`Done. Output: ${out}. Review the copies yourself before sharing them.`);
