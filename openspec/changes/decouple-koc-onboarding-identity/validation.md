# Validation evidence

## Automated checks

- Focused account, promotion, onboarding, local-readiness, local-sync, bookmark-data, and bookmarks integration suites passed: 11 files and 145 tests.
- Full Web test suite passed: 216 files, 2,418 tests; 1 file and 3 tests were skipped. Vitest printed a happy-dom teardown `AbortError`, but exited successfully with no failed tests.
- Promotion regression suite passed: 4 files and 44 tests.
- Changed-file ESLint passed with 0 errors after import sorting; existing fixture/type-quality warnings remain.
- `pnpm exec openspec validate --all --strict`: 70 passed, 0 failed.
- `git diff --check`: passed.

## Known baseline limitations

- `pnpm --filter @apps/slax-reader-dweb typecheck` still fails in the pre-existing `app/utils/articleImageLoading.ts` path because `parse5` cannot be resolved; the remaining implicit-type errors are downstream of that missing module.
- Repository-wide `pnpm --filter @apps/slax-reader-dweb lint` still reports 99 existing import-sort errors plus warnings across unrelated files. The changed-file lint run is clean of errors.
- The first focused routing run caught and fixed a remount regression: a new KOC host did not initialize its controller session from the current token, so a verified account context could not reopen an explicit offer. Focused and full suites pass afterward.
- A final concurrency review also fixed stale `/me` cleanup: an older same-session read that is superseded by a newer read no longer clears the newer server identity. Store, fallback, and profile-ordering regression suites pass after this fix.
- Explicit KOC capture now runs before ordinary pending restoration, so a slow legacy invitation cannot delay a newer URL invitation. Routing, continuity, and profile-ordering suites pass after this ordering fix.

## Manual verification

No new browser hands-on acceptance has been performed on this branch. Before push/PR, manually verify ordinary `/` and `/bookmarks` with KOC API failure, previously synced empty local data during API outage, explicit KOC URL Retry/Later, and claim-before-onboarding ordering.

## Review evidence

- Bugs pass: no Important finding remains after the remount/session fix; account-switch, stale-response, pending-storage, explicit-failure, and onboarding-readiness paths are covered by tests.
- Security pass: no raw token, email, or secret is persisted or logged; cached aliases are used only for legacy storage compatibility and never authorize claims.
- Compliance pass: implementation matches OpenSpec change `decouple-koc-onboarding-identity`; no API contract or database migration changed.
