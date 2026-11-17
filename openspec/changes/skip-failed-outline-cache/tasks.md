# Tasks

A separate design document is intentionally omitted: the change narrows when existing code saves and reads cached rows, with no new architecture, dependency, schema, retry or cache mechanism.

## 1. Persistence

- [x] 1.1 In `AigcService.bookmarkSummary`, accumulate streamed text locally, await the terminal error write and close, and call the save callback only after the provider stream completes with non-empty text; remove the unused chunk recorder and its `TransformStream` hook in `AigcController.handleSummariesRequest`. Verify with failure-before-output, failure-after-partial, empty-response, cancellation and success tests.
- [x] 1.2 Make `generateOutline` return `completed` and save in the outline stream only when generation completed with non-empty text, keeping the streamed frames unchanged. Verify with failed and completed outline-stream tests.

## 2. Reads

- [x] 2.1 Treat an empty or whitespace-only stored row as absent in the `POST /v1/aigc/summaries` cache check, the owner cache check of the outline stream, `getBookmarkSummaries`, and `getBookmarkOutline`. Verify that a stored empty row is regenerated and replaced, and that empty rows are not listed.

## 3. Verification and delivery

- [x] 3.1 Run the API generator, full API tests, typecheck, lint and the layer architecture test; confirm the new tests fail on the previous code; record results in `validation.md`.
- [x] 3.2 Exercise the real controller and service over real Web Streams with a failing first generation followed by a successful one, and record the running-environment evidence and gaps in `validation.md`.
- [x] 3.3 Run `openspec validate --all --strict` and the Bugs/Security/Compliance local review from `REVIEW.md`, resolve Important findings, and open a task PR from `fix/skip-failed-outline-cache` to `dev` with `OpenSpec: skip-failed-outline-cache`; do not merge or deploy.
