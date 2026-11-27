## Automated checks

Run from `apps/api` on 2026-11-27.

- `pnpm run typecheck`: passed.
- `pnpm run lint`: 0 errors. The 317 warnings are the same count as on `origin/dev` before this change.
- `vitest run test/script/layerArchitecture.test.ts`: 45 passed.
- `pnpm run test`: 290 files and 4,622 tests passed, 169 skipped. The baseline before this change was 289 files and 4,586 tests. The 36 new tests are listed below.
- `openspec validate publisher-published-time --strict`: valid.

New tests:

- `test/utils/publishedTime.test.ts`: zoned values are accepted. Unzoned, unparseable, non-string and future values are rejected. `article:published_time` is read only from the document head. The publisher allowlist matches exact IDs.
- `test/domain/privateBookmarkSave.test.ts`: a cached `add_url` or `add` re-save by a publisher writes the supplied time to its own bookmark. A non-publisher, an unzoned time, a future time and another owner's bookmark write nothing. Fresh captures carry the time in the workflow message only for a publisher.
- `test/domain/pdfBookmarks.test.ts`: a new upload passes the time to the extraction workflow only for a publisher. An already-saved upload applies it immediately.
- `test/flow/addUrl/10-crawlWorkflowRun.test.ts`: on a YouTube capture, the time is applied after publication and before moderation. It is skipped for an ordinary user, a missing time and an unzoned time. A failed time step does not stop moderation or post-processing.
- `test/infra/publisherPublishedAt.integration.test.ts` (`FORK_TEST_DATABASE_URL`, UTC process): against PostgreSQL 17 with all repository migrations applied, the owner's bookmark is updated and the `trigger_bookmark_update` mirror in `sr_user_bookmark.metadata` carries the same instant. Another owner's, a shared (`private_user = 0`) and an unfinished bookmark are unchanged. Repeating the write changes nothing.
- `test/script/backfillPublisherPublishedAt.test.ts`: input validation and outcome classification. Against PostgreSQL, rows were seeded for a match, an already-correct row, a row changed since the audit, another owner's row, a shared bookmark and a missing UUID. The dry run wrote nothing. `--apply` updated only the matching row, and a second `--apply` updated none. It passed with the Node process in UTC and in Asia/Shanghai. A database session in Asia/Shanghai also wrote the correct UTC instant.

The PostgreSQL tests ran against a disposable `postgres:17-alpine` container with `prisma migrate deploy`, never against the shared development database.

## Running-environment exercise

`pnpm api -- test:http` ran on this branch's baseline and passed. It covers the existing local Edge, Core, AI and Objects smoke flows, including bookmark add, list and delete.

Not exercised: an end-to-end `add_url`, `add` and `upload_pdf` with `published_at` through the local HTTP stack and the real crawl workflow. The workflow fetches external pages and providers that the isolated stack does not serve. The PDF path requires the Labs flag and a PDF fixture through the HTTP upload. This was left out to avoid extending the smoke harness for one field. The workflow step, both cached branches and both PDF completions are covered by the tests above, and the repository write is exercised against PostgreSQL. The first beta save with `published_at` is the remaining runtime check.

## Production backfill

Not run. The script needs the production connection, and its dry run and `--apply` are the operator steps in tasks 4.3 and 4.4. The audit list of 302 bookmarks is kept outside the repository on the collector host, at `~/slax-collector/backups/reader-wrong-published-at-20261127.json`.
