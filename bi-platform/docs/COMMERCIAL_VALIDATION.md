# Commercial validation

## Status: **NOT STARTED**
No real company data has been tested. Every statement below about accuracy, value or time saved is therefore **unsupported** and not made.

## Criteria (all required before any claim of commercial validation)
| # | Criterion | Evidence required | Status |
|---|---|---|---|
| 1 | At least one real dataset independently reconciled before claiming real-export validation | Completed results template; control totals match the accounting system; interpretation check passed | **Not met** – no real dataset |
| 2 | Findings and known misses evaluated against documented reference outcomes | Reviewer decisions per finding; attested-complete reference list with denominators | **Not met** |
| 3 | Any measured business value independently substantiated | Recovered / prevented amounts with independent evidence references (tiers kept apart) | **Not met** – no value measured |
| 4 | Verification time and manual-comparison baseline recorded | Baseline minutes + method; preparation and verification minutes | **Not met** |
| 5 | Limitations and required manual steps disclosed | `docs/PHASE7_VALIDATION.md` §11, this document, the pilot report | **Met** (as disclosure; says nothing about performance) |
| 6 | No unsupported financial conclusion marked verified | Soundness invariants + reviewer rejection of a verified finding treated as a defect | **Met on synthetic data only**; unmeasured on real data |

## Engineering acceptance (this phase)
Existing tests and build green (see the delivery report for counts); no confidential data in committed artefacts (git-ignore + test + review of the fixtures, which are synthetic); backup, deletion and privacy guarantees extended to the new review tables (tested); the 600 ms main-thread limit untouched (performance spec re-run); no silent currency / VAT / unit mixing (unchanged and still tested).

## Value language (strict)
Potential exposure ≠ confirmed accounting discrepancy ≠ confirmed recoverable ≠ actually recovered ≠ prevented loss ≠ verified analyst time saved. They are shown separately, never added, never across currencies or sides. Only "actually recovered" and "prevented loss" with independent evidence may be called realised value.

## Go / no-go for a first **paying** customer
**NO-GO.**
Supporting evidence:
1. No real export has been run through the product; correctness on real exports is unknown (largest risk).
2. No independently reconciled finding exists; there is no false-positive or false-negative evidence at all, and the 100 % recall / precision on the synthetic fixture is not evidence about real data.
3. No measured value and no measured time saving.
4. Matching depends on references and consistent counterparty ids that real systems may not provide; the fraction of findings that would be candidates or withheld on real data is unknown.
5. Pseudonymisation, review and reporting tooling now exists, so the gap is data, not engineering.

**GO for a free, controlled, supplier-side pilot** under these conditions: written data authorisation; four files per the checklist; named independent reviewer; baseline recorded; results reported as counts unless ≥ 30 decisions; outcome to be judged against the criteria above. 

**Revisit the paying-customer decision** only after: (a) at least one real export family reconciled with matching control totals and a passed interpretation check, (b) ≥ 30 independently decided findings or an explicit decision that the findings volume is too small to matter, (c) at least one independently evidenced recovered or prevented amount or an honest zero, (d) no verified finding rejected, (e) recorded time comparison. A single company result supports a decision to continue, not a general claim.

## Remaining blockers
1. Real data (authorised, four files) – external.
2. Reviewer capacity and baseline measurement – customer-side.
3. Possible importer adaptation for the real exporter's patterns – only after observing them; never a workaround for one sample.
4. Calibration of thresholds (look-alike window, recurrence gap) on real data.
5. Worker memory on the customer's largest real file (unmeasured).
