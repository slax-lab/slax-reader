# Tasks

A separate design document is intentionally omitted: the change marks a rejected response write and downgrades the follow-up logs, with no new architecture, dependency, retry or configuration.

## 1. Approval

- [x] 1.1 Record the requester's 2026-11-26 on-call instruction to adopt the fix for the `[aigc.summary] failed to write error text` alert and open a PR.

## 2. Implementation

- [x] 2.1 Raise a failed response write as `ResponseStreamClosedError`, and make `VertexAIClient.chatStream` pass that error through without its provider-failure log or `AIProviderError` wrapper.
- [x] 2.2 In `AigcService.bookmarkSummary`, mark the response stream broken when a delta write rejects, and on a broken stream stop generation, skip the failure-text write and the terminal close, and log the client departure once at warning level with the Ray ID.
- [x] 2.3 Keep the error-level `summary generation failed` log, the failure text and the close for a live stream, and report a failed failure-text write or terminal close at warning level.
- [x] 2.4 Cover the paths in `apps/api/test/domain/aigcSummaryPersistence.test.ts`: a cancelled stream logs one warning and no errors and stores nothing, the same holds through the real `VertexAIClient.chatStream` over a fake SDK stream, a failed close after a complete stream logs a warning and still stores, and a failure frame that cannot be written logs a warning and skips the close. Cover the provider pass-through in `apps/api/test/infra/vertexAIClient.test.ts`.

## 3. Verification and delivery

- [x] 3.1 Run the affected test file, the API layer-architecture test, API typecheck and lint, and `openspec validate --all --strict`; confirm the new assertions fail on `origin/dev`; record commands and results in `validation.md`.
- [x] 3.2 Record the running-environment evidence and gaps in `validation.md`, run the Bugs/Security/Compliance local review from `REVIEW.md`, resolve Important findings, and open a task PR from `fix/summary-stream-disconnect-errors` to `dev` with `OpenSpec: summary-stream-disconnect-errors`; do not merge or deploy.
