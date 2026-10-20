# Tasks

## 1. Contracts, schema, and generated artifacts

- [x] Add Fork request/response types, `write_mode`, error codes, and REST path.
- [x] Add PostgreSQL lineage/publication fields and migration with expand-only compatibility.
- [x] Regenerate Prisma clients, router, DI, consumer/cron artifacts as required and inspect generated diffs.

## 2. Backend target identity and publication primitives

- [x] Make private content creation paths reject accidental `private_user = 0` for authenticated captures.
- [x] Add normalized same-user target lookup, stable user-bookmark UUID reuse, write-version/conditional publication, and safe failed-update behavior.
- [x] Update R2 copy helpers to stream bodies, preserve metadata, derive PDF sidecars from actual keys, and sweep unpublished objects.

## 3. Fork service and lineage

- [x] Implement source access validation through the service-level bookmark access API.
- [x] Implement article/text/PDF copy, current lineage replacement, source identity policy, and side effects without starting crawl.
- [x] Cover own-source, deleted/pending/failed, hidden identity, source revocation, overwrite, retry, and concurrency behavior with tests.

## 4. Direct capture integration

- [x] Route `/add`, `/add_url`, import, PowerSync, CLI, and Telegram writes through the same private target overwrite/version rules.
- [x] Ensure direct capture clears current Fork attribution and late crawl workflows cannot publish over newer versions.

## 5. Reader URL compatibility

- [x] Add strict canonical `/b/<uuid>` parser before normalization/short-link/policy/crawl.
- [x] Delegate supported URL-save entry points to Fork and define batch/import behavior.
- [x] Add controller and contract tests for valid, malformed, alternate-origin, query, and retry cases.

## 6. Content read, search, and cache alignment

- [x] Make Web/API content readers honor committed content keys and avoid stale fixed-key fallback after overwrite.
- [x] Refresh full-text/vector/search caches and PowerSync/change notifications after publication with retryable post-commit work.

## 7. Web UI

- [x] Add `can_fork`/`fork_info` metadata handling, REST client call, and responsive SnapshotTopBar action.
- [x] Implement login return, loading/error/retry, owner hiding, Source/Fork attribution, localization, accessibility, and theme/viewport checks.

## 8. Verification and review

- [x] Run focused API/Web tests, typecheck, lint, migration/schema checks, and `openspec validate --all --strict`.
- [x] Run the repository local pre-push review from `REVIEW.md`, resolve Important findings, and record remaining risks.

## 9. Follow-up correctness and database performance review

- [x] Preserve complete stored URL identity and restrict URL cleanup/short-link resolution to fetching.
- [x] Retire replaced revisions transactionally and reclaim all private revisions after bookmark/account deletion without affecting other users' Fork copies.
- [x] Bound stage cleanup/search repair work, preserve retries and settling windows, and prune completed cleanup tombstones.
- [x] Add query-driven indexes and verify migration compatibility, PostgreSQL query plans, publication, cleanup failures, and account deletion.
