# Tasks

A separate design document is intentionally omitted: this is a bounded extension of the existing optional-image filter, with no new architecture, dependencies, schema, or migration. Use one shared raw-image limit and the existing skip accounting; do not add provider-error swallowing or retry machinery.

## 1. Image filtering

- [x] 1.1 Add `VECTOR_IMAGE_MAX_BYTES = 5 * 1024 * 1024` beside the existing embedding budgets and skip oversized candidates in `VectorSourceRepo.articleInputs` at metadata and retrieved-byte checks with `image_too_large`; verify focused source-selection tests pass and no stored-source mutation or remote refetch is added.
- [x] 1.2 Extend existing `apps/api/test/utils/vectorSources.test.ts` cases for limit-plus-one rejection, exact-limit acceptance, retrieved-body rejection, preserved text, later valid-image slots, and explicit no-content outcome; preserve coverage of the independent JSON-request budget and verify the test file passes.

## 2. Verification and delivery

- [x] 2.1 Run the required API generator, API tests, lint, and worker dry-run builds using the documented safe local configuration; review generated changes and record exact commands and results in `validation.md`, without deploying.
- [x] 2.2 Replay both previously failing test articles through the changed input builder using read-only test DB/R2 sources and real Jina calls, without remote index writes; verify each known oversized image is skipped, retained inputs succeed, and record only redacted evidence in `validation.md`.
- [x] 2.3 Run `openspec validate --all --strict` and the Bugs/Security/Compliance local review from `REVIEW.md`, resolve Important findings, and create a task PR from `fix/skip-oversized-vector-images` to `dev` with `OpenSpec: skip-oversized-vector-images` and verification evidence; do not merge or deploy. Delivered as PR #574.
