# Validation

## Repository checks

- `pnpm api -- gen:all` passed using the committed public API configuration template and unused local placeholder database URLs. Generation left no tracked changes outside the intended repository method. No local secret files or production services were used.
- `pnpm api -- test test/infra/bookmarkVectorShard.test.ts test/flow/bookmarkUid test/infra/bookmarkCommentSecurity.test.ts test/domain/bookmarkAccessSecurity.test.ts` passed: 11 files, 134 tests, including four new shard mapping regressions.
- `pnpm api -- typecheck` passed, including shared contracts.
- Prettier checks passed for the changed source and new test.
- ESLint passed for `dbBookmark.ts` with two existing `no-explicit-any` warnings at lines 392 and 393, outside the change.
- `pnpm exec openspec validate --all --strict` passed: 62 items, zero failures.
- `git diff --check` passed.

The first focused test attempt hit Vitest's default 10-second setup timeout while initializing PGlite. The setup hook now uses the existing repository convention of 30 seconds; all four tests passed in the combined run. PGlite exercises the production SQL and migration constraints but serializes submitted queries, so it is not the multi-session concurrency evidence below.

## Native PostgreSQL concurrency comparison

Used a disposable `postgres:17-alpine` container, the installed Prisma 7.2.0 client and PostgreSQL adapter, and the original migration's shard table and unique index. The container was reachable only through a randomly allocated localhost port and contained no application data.

For each implementation, twelve distinct PostgreSQL sessions attempted to allocate bookmark `276747` with competing bucket proposals. A separate session held a SHARE table lock until all twelve writers were waiting, then committed to release them together. The table was truncated between implementations.

- Original Prisma `upsert`: one success and eleven `P2002` uniqueness errors.
- Updated `BookmarkRepo.upsertVectorShard`, called through the actual Prisma client: twelve successes, exactly one persisted mapping, and identical returned row IDs and bucket values matching the stored mapping. Returned timestamps remained JavaScript `Date` values.

This verifies atomic mapping allocation, not serialization of subsequent vector index deletion and insertion.

## Local pre-push review

The behavior-changing diff maps unambiguously to `fix-vertor-shard`; the other active changes do not define bookmark vector shard allocation. Reviewed the proposal, design, tasks, and `bookmark-vector-indexing` delta against the final source and tests under all three `REVIEW.md` passes:

- **Bugs:** No Important findings. Conflict handling preserves the existing bucket and row identity, refreshes the timestamp, returns the stored mapping, and propagates unrelated failures. The native PostgreSQL comparison exercises the actual driver and concurrent sessions.
- **Security:** No Important findings. Values use Prisma's tagged query parameters; identifiers are static, and the patch adds no authentication, logging, credentials, or remote operations.
- **Compliance:** No Important findings. The change implements the declared atomic allocation and compatibility requirements. There are no schema, API contract, workflow retry, or vector mutation changes.

## Application version impact

Only backend mapping allocation and tests change. CLI, Extension, and Mobile shipped code, assets, dependencies, native integration, contracts, and package output are unaffected, so their version-decision requirement does not apply. No application manifests or lockfiles were changed.
