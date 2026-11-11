# Validation

## Scope and approval

On 2026-11-06 the human confirmed the minimal empty-image fix and requested immediate PR delivery. During implementation they additionally requested correction of the failing `hybridSearch.runtime.test.ts` disconnect test. That follow-up changes only the test harness and its observation of existing cancellation behavior; no production search or authentication code changes.

## Empty-image implementation

The existing image-selection path now skips zero-size storage metadata before downloading, and skips a zero-byte retrieved body before base64 encoding. Both paths record `empty`; neither consumes a valid-image slot. Existing source ownership, MIME, size, candidate-count and missing-content checks remain intact. No image is refetched or repaired and genuine provider failures still propagate.

Nine new parameterized/regression cases cover both empty detection points, preservation of four later valid images and text, image-only failure, maintenance/provider input boundaries, and unchanged genuine provider HTTP 400 failure. Focused source/maintenance/embedding suite: 135 passed.

## Read-only actual-content replay

The actual fixed `VectorSourceRepo.articleInputs` ran locally against the four human-authorized saved article bodies and their existing image proxy responses. Earlier direct R2 reads had confirmed the zero-byte objects. Temporary diagnostic copies were removed; there were no database or R2 writes.

- The two Microsoft documentation captures omit the empty image and select four later/other valid images, emitting zero empty image inputs.
- The first FreeOK capture skips its four empty image occurrences and reports `missing_source_content` when the text branch is deliberately excluded. The maintenance regression separately proves that valid stored text still produces a successful text representation.
- The second FreeOK capture skips two empty occurrences, deduplicates its valid image and emits one nonempty image input.

This verifies preprocessing against actual stored content, not a direct Jina success response. No local Jina credential was available; no claim is made that this fix resolves every provider 400 or 422. No production deployment, data repair or refresh rerun was performed.

## Disconnect regression diagnosis and correction

The original socket test passed three local baseline repetitions, so the reported original CI symptom was not reproduced unchanged. An intermediate synchronized socket-reset run then reproduced a decisive observation: `embeddingAborts=1`, `cleanupCount=1`, `vectorArticleCalls=0`, but `requestAborts=0`. The existing Controller cancels work through either Request abort or response-stream cancellation; the original assertion incorrectly required the intermediate Request event even when actual work was canceled and cleaned up.

The test now waits for a complete early partial and an in-flight embedding, uses a dedicated connection, explicitly resets its TCP socket and waits for close. It asserts actual embedding cancellation exactly once, zero vector retrieval, exactly one cleanup, and no complete event before disconnect. A finally block releases the fixture gate and destroys the request. The existing 2-second audit timeout and 120-second test deadline are unchanged; the test is not skipped or retried by Vitest. Production cancellation logic is unchanged.

The complete three-test real Workerd suite passed eight consecutive independent runs (24 assertions-at-test level). The final whole API run also passed with this test correction. This is local evidence; remote CI must still validate its runner environment.

## Commands and results

- `pnpm api -- gen:all` with the public template: passed; no generated tracked diff.
- `pnpm api -- test test/utils/vectorSources.test.ts test/domain/vectorMaintenance.test.ts test/utils/vectorEmbedding.test.ts --silent --reporter=dot`: 135 passed.
- Final `pnpm api -- test --silent --reporter=dot`: 3,828 passed, 117 existing environment-gated skips, zero failures; 241 files passed, 15 skipped.
- `pnpm api -- typecheck`: passed on the final tree.
- `pnpm api -- lint`: zero errors, 344 warnings.
- `pnpm exec openspec validate --all --strict`: 114 passed, zero failed before this evidence-only addition; the commit hook validates the delivered artifacts again.
- `pnpm agent:check`: passed.
- Standard public-template `pnpm api -- build`: Core, Edge, AI and Browser bundles passed; temporary output was removed.
- `git diff --check`: passed.

## Pre-push review

Bugs: both empty-input paths are covered, valid content remains, and no-content/provider failures remain observable. Security: source-only review finds no access-boundary change, new network destination, secret value, dependency, or content mutation; this is a narrow review, not a comprehensive security audit. Compliance: behavior matches the confirmed empty-image contract; the added disconnect correction is explicitly user-requested and test-only. No new Important finding was identified in this scoped diff.

CLI, Extension and Mobile files, dependencies, contracts and package output are unchanged, so no application version increment is required. Existing untracked security-skill files and `skills-lock.json` are unrelated and excluded from this PR.
