# Validation

## Scope and approval

The requester asked in the on-call thread on 2026-11-26 to adopt this fix for the `[aigc.summary] failed to write error text` alert and open a PR. Production access during diagnosis was read-only; no production row, Worker, configuration or migration was changed. The change touches only `apps/api` runtime code and tests. No CLI, Extension, Mobile or Web code, shipped UI, shared package, contract, dependency or build configuration changes, so the package-version question does not apply.

## Production diagnosis (read-only)

- `slax-ops alert 'reader-ai|[aigc.summary] failed to write error text'`: 8 occurrences, first 2026-11-23T09:58:14Z, last 2026-11-26T05:59:58Z, deployed version `44fb0b8d-37f8-4ddb-a431-b9d4002bedb7`.
- `slax-ops logs --service reader-ai --minutes 1440 --level error`: request `02fbc7927a021ab32fc05f37b76b90bd` (`POST /v1/aigc/summaries`, 2026-11-26T05:59:58.595Z) emits four error-level events: `undefined`, the stack `at VertexAIClient.chatStream … at async AigcService.bookmarkSummary`, `[aigc.summary] failed to write error text`, and `[aigc.summary] failed to close stream`.
- The monitor also tracks `reader-ai|undefined` and `reader-ai|at VertexAIClient.chatStream (index.js:N:N)` as separate keys with the same first-seen timestamp, so the four events are one failure family from one request, not independent faults.
- Root cause in the code (`apps/api/src/domain/aigc.ts`, `bookmarkSummary` at `origin/dev`): the client stops reading the response, the response stream rejects the delta write, and the `catch` treats that as a generation failure. It then writes the failure text to the same rejected stream and closes it, so the rejection is logged two more times at error level. The write rejection carries no usable message (`boundedMessage` yields `undefined`), which is why the first log is unrecognisable.

## Running-environment evidence

- Real `AigcService` over real Web Streams, with only the provider and storage faked (`test/domain/aigcSummaryPersistence.test.ts`):
  - a cancelled response stream (`readable.cancel('client closed')` before generation) now produces one warning `[aigc.summary] client closed the stream` with the Ray ID, no error logs, and no stored summary;
  - a response stream whose `close()` throws after a full generation stores the summary and reports one warning `[aigc.summary] failed to close stream` without error logs;
  - a generation failure whose failure text cannot be written keeps exactly one error log (`summary generation failed`), reports the failed write as a warning, and does not attempt the close.
- `POST /v1/aigc/summaries` end to end in the same file ("POST /v1/aigc/summaries recovers after a failed generation") still streamed the failure text on a live-stream provider failure, stored nothing, and served the next successful generation from the cache.
- Negative control: with `apps/api/src/domain/aigc.ts` reverted to `origin/dev`, the three new tests fail (the cancelled stream and the failed close log at error level, and the failed failure-text write is logged at error level plus a close attempt); with this change they pass.

## Automated checks

- `pnpm api -- test test/domain/aigcSummaryPersistence.test.ts`: 23 passed (3 new).
- `pnpm api -- test` (with `SLAX_API_CONFIG`, `HYPERDRIVE_DATABASE_URL` and `LOGS_DATABASE_URL` unset): 289 files passed, 20 skipped; 4,586 tests passed, 169 skipped, 0 failed.
- `pnpm api -- test test/script/layerArchitecture.test.ts`: 45 passed; no baseline entry added.
- `pnpm api -- typecheck`: passed.
- `pnpm api -- lint`: 0 errors, 317 warnings (all pre-existing).
- API Prettier check of both changed source and test files: passed.
- `node_modules/.bin/openspec validate --all --strict`: 195 passed, 0 failed.
- `git diff --check`: passed.

## Gaps and boundaries

- No deployed Worker was exercised: this container has no Docker, no local PostgreSQL and no Worker runtime, and production access is read-only. The client-departure path is reproduced through real Web Streams against the real controller and service, and the deployed behaviour it replaces is recorded in the Worker logs above.
- No real Vertex AI call was made; the provider failure paths use the existing deterministic fakes.
- The log level is the observable change, so the monitor stops receiving this signature only after the fix reaches `reader-ai` through the normal release flow. Nothing was deployed from this branch.
- No UI presentation change, so no hands-on visual acceptance applies.

## Local review

Completed the three `REVIEW.md` passes on this branch on 2026-11-26. No Important findings.

- Bugs: the broken-stream flag is set only by a rejected write to this request's own writer, so a healthy stream keeps the existing error log, failure text and close; a broken stream skips exactly the two follow-ups that can only reject with the same cause, and `completed` stays false so nothing is stored; a complete generation whose close fails still stores and reports a warning. No other caller of `bookmarkSummary` exists, and the endpoint, frames and cache rule are unchanged.
- Security: no new dependency, secret, network destination, log field or data write. The new warning carries the same bounded diagnostic fields as the existing error log, and the catch-all object passed to the close warning is an error object, not user content.
- Compliance: the diff matches `openspec/changes/summary-stream-disconnect-errors`; the delta scenarios are covered by the new tests; the missing deployed-Worker exercise is declared above; the PR targets `dev` with `OpenSpec: summary-stream-disconnect-errors` and does not merge, deploy or apply anything.
