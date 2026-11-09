// Regenerates docs/COMPATIBILITY.md from tests/compat. Runs locally; nothing is transmitted.
import fs from 'node:fs';
import path from 'node:path';
import { discoverFixtures, loadVendors, renderCompatibilityDoc, runFixture, vendorStatuses } from '../tests/compat/runner';

const results = [];
for (const f of discoverFixtures()) results.push(await runFixture(f));
const doc = renderCompatibilityDoc(vendorStatuses(loadVendors(), results), results);
fs.writeFileSync(path.join(process.cwd(), 'docs/COMPATIBILITY.md'), doc);
console.log('docs/COMPATIBILITY.md written');
