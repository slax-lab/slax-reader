# Validation evidence

## Automated checks

- Focused account, promotion, onboarding, local-readiness, local-sync, bookmark-data, and bookmarks integration suites passed, including malformed KOC-query coverage.
- Full Web test suite passed: 216 files, 2,420 tests; 1 file and 3 tests were skipped. Vitest printed a happy-dom teardown `AbortError`, but exited successfully with no failed tests.
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

- Local Chrome smoke verification on 2026-10-22 used the development Web server with the supplied development session and intercepted API failures:
  - ordinary `/` with KOC/API failure rendered no identity error and no `.promotion-notice`;
  - explicit `/?activity_id=daguang&activity_type=blogger&claim=true` with API 503 rendered Retry and Later;
  - malformed `activity_type=blogger&activity_id=BAD!` rendered no promotion notice and did not remain on `/onboarding`.

### Human hands-on acceptance

- Tester: YJC (`Whyjsee`, the PR author).
- Date: 2026-10-22 (Asia/Shanghai), reported in the PR follow-up task conversation with `Screenshot 2026-10-22 at 14.30.13.png`.
- Accepted revision: `6052b43eada65fe835154517f4ffac6c50c4390b` on `fix/decouple-koc-onboarding-identity`; this follow-up changes evidence only, so the tested Web implementation is unchanged.
- Result: YJC confirmed that they had personally tested this PR in the running Web application and that the behavior fully matched expectations. This is hands-on acceptance of the implemented behavior, superseding the earlier approval of the repair direction and the pending-acceptance entry.
- Screenshot evidence: the onboarding page renders "Save any page with one click", "Maybe later", "Install Browser Extension", and the "Claim KOC reward" entry; no KOC identity-error notice is visible in the captured state. The screenshot is attached to PR #322 rather than committed to Git.
- Adjustments requested after testing: none; no implementation changes were needed for this acceptance.
- Evidence scope: the screenshot records this onboarding state, while the failure-injection scenarios above and edge-case coverage remain supported by the agent smoke runs and automated checks. The user did not provide a separate per-scenario or theme/viewport test matrix, so this record does not infer one from the screenshot.

## Review evidence

- Bugs pass: the malformed blogger-query regression found by automated review was fixed; account-switch, stale-response, pending-storage, explicit-failure, and onboarding-readiness paths are covered by tests.
- Security pass: no raw token, email, or secret is persisted or logged; cached aliases are used only for legacy storage compatibility and never authorize claims.
- Compliance pass: implementation matches OpenSpec change `decouple-koc-onboarding-identity`; no API contract or database migration changed.
- Human-acceptance review finding: resolved by the 2026-10-22 hands-on confirmation above, with the tester, date, accepted revision, observed state, and absence of requested adjustments recorded consistently in this file, task 6.4, and the PR Test plan.

## Acceptance-record follow-up checks (2026-10-22)

- This follow-up updates documentation and the PR evidence trail only; it does not change the tested implementation or application versions.
- `pnpm exec openspec validate --all --strict`: re-run successfully, 70 passed and 0 failed.
- `git diff --check`: re-run successfully.
- Web unit/integration suites, lint, typecheck, and browser smoke were not re-run for this documentation-only update; their implementation-checkpoint results and limitations remain recorded above.
- Local pre-push review followed the `REVIEW.md` Bugs, Security, and Compliance passes for `decouple-koc-onboarding-identity`. The evidence update introduces no runtime or security change, and the pending/complete human-acceptance contradiction is removed. Existing non-blocking review nits are outside this acceptance-record update.
