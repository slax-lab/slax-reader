# Verification

Verified on November 6, 2026.

## Live incident replay

Ran the changed runYoutubeArticle from an empty filesystem object store against Gemini 3 Flash preview with the complete 1,687-cue input for fsTtKywmWlU. Used the configured model, schemas, temperature, thinking level and request budgets.

The runner reached ready with eight chunks, 129 paragraphs and 34 chapter headings. It made ten successful model calls, including one localized repair, in 28.4 seconds. Estimated model spend was USD 0.06707. An independent read of the generated JSON confirmed that all 1,687 cue IDs occur exactly once in source order and that all 34 chapter seek times match their first cue. Read the opening and interview passages in the generated Chinese text.

The article passed structural and source-aware passage checks. Diagnostic aggregate metrics were a 0.395 text-length ratio, 0.947 numeric coverage before per-passage unit equivalence, and a 1.0 language ratio.

An earlier live run exposed false rejections of correctly translated "70 grand", "15 mil ARR", a shared currency magnitude and a percentage range. Added numeric normalization and regression cases. After that correction, resumed its existing store with a new run identity and retained lifetime spend. It reused accepted bodies, requested one outstanding passage and the introduction, and reached ready in 3.7 seconds with two calls. This was recovery after a validator correction. Provider outage recovery was injected separately below.

## Runtime fault replay

Executed the actual runner in a separate Node process with filesystem storage, an in-memory repository and model replies reconstructed from a live Gemini article. This allowed reproducible failures without claiming a real provider outage. The harness asserted that recovered requests exclude already accepted source passages. Every ready result had all 1,687 references in order.

| Injected condition | Observed outcome |
| --- | --- |
| Missing passage | One targeted repair, then ready |
| Wrong output language | One targeted repair, then ready |
| Changed year | One targeted repair, then ready |
| Malformed batch JSON | Bounded repair, then ready |
| Provider errors after partial success | Retry with saved progress, then ready after recovery |
| Batch truncation | Smaller requests; complete ordered output |
| Introduction timeout | Extractive introduction, then ready |
| Malformed introduction | Extractive introduction, then ready |
| Process interruption after body generation | Resume with one introduction call, no body requests |
| Model budget exhausted after accepted body | No introduction model call, extractive introduction and ready |
| Storage errors writing introduction | No premature publication, retained body, then ready after storage recovery |
| Lease loss | Gone, zero publication calls |
| Localized corruption before assembly | Repair the affected passage, reassemble and publish |
| Structural reference corruption | Failed, retained progress, zero publication calls |
| Persistently omitted content | Bounded repair exhaustion, retained accepted work, zero publication calls |

The replay report is local at /tmp/slax-cue-2f114e/faults-9B7mIb/results.json. The committed runner and utility tests cover the same failure classes and additionally cover persisted sentence-split children, interrupted final repair, exhausted budget with unfinished translation, optional same-language editor failure, accounting failures and named speaker continuation across chunks.

## Automated checks

- API Vitest suite passed 2,883 tests, with 116 environment-dependent or explicitly skipped tests. The focused runner and passage suites passed 93 tests.
- API/contracts typechecks and changed-source ESLint passed. API gen:all produced no tracked drift. Strict repository-wide OpenSpec validation passed all 108 items. Diff whitespace checks passed.
- Checked digits, signs, magnitude units, decimal/grouping conventions, Chinese number spellings, short names and acknowledgements.
- Verified request bounds, counter persistence, missing-only retries, source-wording fallback and stored child reuse. A subsequent run retains accepted output while resetting the bounded content-repair allowance for unresolved work.
- Existing workflow tests cover claim, lease loss, request cancellation, concurrent cost reservations, truncation, durable-step replay, publication and takedown cleanup.

## Boundaries and local review

Live model execution and rendered JSON/HTML/text were exercised locally. Database writes and publication callbacks were simulated. The durable Cloudflare Workflows engine, production scheduling, production deployment and a production retry were not exercised. Source-aware heuristic checks detect observable errors. They do not prove semantic translation fidelity. Optional heading and introduction fallbacks are extracts and may be less polished.

Bugs review checked partial persistence, repair invalidation across step retries, child reconstruction, numeric false positives, remaining-work estimation and optional-model error boundaries. Security review checked the unchanged model/storage destinations, untrusted prompt inputs, escaping and count-only logs. Compliance review checked the user-approved direct-generation design, absence of new compatibility selectors and the evidence above.
