# Tasks

## 1. Contract and validation

- [x] 1.1 Add optional `published_at?: string` to `AddUrlBookmarkRequest` in `packages/contracts`, and verify the contracts package and API typecheck.
- [x] 1.2 Parse `published_at` once at the add-URL and upload-PDF handlers, and `article:published_time` from the supplied HTML for content saves, into a `Date` only for an allowlisted publisher, dropping unparseable and future values. Verify with unit tests for a publisher, a non-publisher, an invalid value and a future value.

## 2. Owner-scoped override

- [x] 2.1 Add a repository method that sets `published_at` only where the bookmark id, `private_user` and `status = 'success'` match. Verify with a repository test covering the owner, another owner, a shared bookmark and a non-success status.
- [x] 2.2 Carry the validated time in the crawl workflow payload from add-URL and content-save admission, and apply it in one workflow step after the capture is published and before moderation. Verify with workflow tests on a YouTube capture: the step runs after publication and before moderation, is skipped for an ordinary user, a missing time and an unzoned time, and its failure does not stop moderation. Every capture route reaches the same step after publication.
- [x] 2.3 Apply the time in the cached content-save and add-URL branches and in both upload-PDF completions (new and cached). Verify with tests: a re-saved publisher article, a re-saved publisher URL and an uploaded PDF keep the supplied time, while an ordinary user's save and upload keep the current behavior.

## 3. Backfill

- [x] 3.1 Add `apps/api/script/backfill-publisher-published-at.ts`: dry run by default, `--apply` to write, conditional on owner relation, publisher list and the audited wrong value. Verify on a local database seeded with matching, already-correct, changed-since-audit, foreign-owner and missing rows, and check the reported counts and the unchanged rows.

## 4. Verification

- [x] 4.1 Run the API test suite, typecheck, lint and `pnpm api -- test test/script/layerArchitecture.test.ts`, and record results in `validation.md`.
- [x] 4.2 Record the running-environment evidence and the declared gap in `validation.md`: the existing local HTTP smoke passed, and an end-to-end save with `published_at` through the real workflow is left to the first beta save.

Post-merge operator rollout:

- [ ] 4.3 After the normal beta deployment, run the backfill dry run against production with the audit list, review the counts, then run it with `--apply`.
- [ ] 4.4 Re-run the publication-time audit and confirm zero mismatches for the listed bookmarks.
