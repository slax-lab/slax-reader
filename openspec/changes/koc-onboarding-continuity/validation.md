# Validation and delivery

## Review outcome

Change: `koc-onboarding-continuity`. Branch: `fix/koc-onboarding-continuity`, in an isolated Codex worktree based on `origin/dev`. The original checkout and its unrelated work were preserved.

The plan review clarified verified identity, database ownership, storage-denied startup and the ordinary modal caller. The implementation review ran Bugs, Security and Compliance passes and found three Important issues: success disposal on navigation, an older check erasing a newer campaign, and collection readiness surviving an account switch. These were corrected and covered by regression tests. The reviewer reported no additional Security findings. The final author pass inspected the follow-up fixes and acceptance criteria.

## Automated evidence before PR integration

- Web full suite: 189 files passed, 1 skipped; 1,994 tests passed, 1 skipped. Includes real Vue Router / KeepAlive KOC-to-onboarding journeys, successful acknowledgement, navigation away after success, delayed A-to-B invitation replacement, submission attribution, URL-only deferral/resume, the ordinary caller, shared onboarding flags and authentication return preservation.
- Installed PowerSync Vue query API: exercised with a controlled database adapter. First synchronization pending, successful empty/nonempty results, query errors, offline-after-verification and ownership mismatch are covered without replacing the query composable itself.
- API full suite: 158 files passed, 9 skipped; 1,884 tests passed, 46 skipped. New promotion contract tests verify receipt precedence, Apple exclusion, trial/credit descriptions, legacy compatibility and unchanged grant inputs. The reward-writing transaction was not changed.
- Web, API and shared-contract typechecks passed with explicit non-secret fixture configuration.
- Touched Web production files pass ESLint with zero errors; four pre-existing warnings remain in existing code.
- Static Web generation succeeds. Strict OpenSpec validation passes all 35 items. `git diff --check` passes.
- Regression red/green evidence includes delayed readiness, unvalidated persistence, session/profile isolation, storage-denied startup, success route departure, competing invitations and URL-only resume. The original production incident was traced from source; it was not replayed against a real user's account.

## Controlled browser evidence

The built Web application was served on `127.0.0.1:3107` with mock API responses and a disposable fake account. PowerSync storage failure was injected at startup, exercising the real REST fallback. No production promotion, Stripe credit or Apple subscription was consumed.

Verified in the Codex in-app browser:

1. `/daguang-reader` reaches the root URL and displays the 60-day offer before onboarding.
2. Later enters onboarding; a full document reload restores the deferred KOC entry without reopening the offer.
3. Skipping onboarding returns to `/`; the KOC entry is still available and the cached page does not loop back.
4. Resuming and claiming shows success without a forced reload; Continue disposes the presentation.
5. A fresh eligible account remains on `/` during offer/success acknowledgement, then enters `/onboarding` after Continue.
6. The offer and resume controls remain usable at 375px and 860px widths.

## Limits and release checks

- The database-backed payment integration suite is opt-in and was skipped. Its hard-coded test database is truncated by setup; it was not enabled against an unverified existing database. Before release, run concurrent blogger claims and ordinary-before-KOC / KOC-before-ordinary cases in a dedicated isolated PostgreSQL test database and confirm one grant per blogger entitlement.
- Browser API responses were controlled fixtures. Google OAuth, production Turnstile, real extension installation, Stripe and Apple calls were not exercised. Existing auth middleware tests verify campaign-preserving redirects; full-document reload was exercised directly. Recheck external integrations in staging using dedicated test accounts.
- An already-verified session can use previously synced offline local data. A fresh offline document conservatively waits for identity verification; cached profile data alone never authorizes onboarding or binds a promotion.
- Chinese and English copy is included. The touched UI uses Web semantic tokens and respects reduced motion. Browser visual checks covered the light profile; dark/e-ink were inspected for semantic-token compatibility, not given a complete visual pass. This change does not claim to migrate the rest of the legacy subscription UI to new theme profiles.

## Rollout and recovery

Deploy the additive API status response before the Web change. Older clients still read the existing boolean; newer clients accept old boolean-only replies and keep unknown unavailability retryable. No database migration is needed.

If the Web release must be rolled back, retain all reward receipts, entitlement periods and subscription credits. The older client can ignore the versioned pending-invitation record. Do not clear unrelated browser state or onboarding completion markers.

Users whose invitation was already lost should revisit the original KOC URL. Eligibility is determined by the server; an ordinary platform trial does not remove an unused blogger entitlement. No bulk grants or invented attribution are part of recovery.

When publishing, target `dev` and include `OpenSpec: koc-onboarding-continuity` in the PR body. Archive the change only after merge. At this pre-publication checkpoint, no deployment, push, or merge had been performed; see the PR integration checkpoint below for subsequent publication.

## Follow-up fixes

The follow-up review corrected cross-tab invitation replacement during an explicit route check and ordinary promotion presentation surviving cached-page departure. Additional settlement tests found that returning before an abandoned request finished could leave eligibility/profile state stale. Disposal now triggers account-scoped reconciliation when the original request settles; older eligibility responses cannot overwrite newer results, and profile refreshes are serialized without losing a request at completion.

Regression coverage includes both invitation-check delays, bare-route storage recovery, all ordinary claim/departure/return orders, overlapping stale reads, account changes, owner disposal, lost responses, and a refresh queued in the previous refresh's completion microtask. No reward values, backend grant logic, visual styles, or layout were changed in this follow-up.

Final follow-up verification: Web full suite passes 2,008 tests across 189 files, with one existing test/file skipped. Web typecheck and touched production ESLint pass with no errors or lint warnings. Strict OpenSpec validation passes all 35 items; `git diff --check` passes. Independent Bugs, Security and Compliance review reports no remaining Important or Nit findings against `koc-onboarding-continuity`. The validation limits above still apply; backend grants and external integrations were not rerun in this follow-up. An initial full-suite run overlapped Nuxt type generation and failed to load its temporary tsconfig in one unrelated suite; running the suite separately passed in full.

### Files changed in the follow-up

All ten files below are modifications; this follow-up adds or deletes no tracked files.

| File | Purpose |
| --- | --- |
| `apps/web/app/components/Promotion/KocPromotionHost.vue` | Serialize storage reconciliation and require matching durable context before URL cleanup. |
| `apps/web/app/utils/promotionFlow.ts` | Preserve explicit invitation precedence while restoring persisted context. |
| `apps/web/app/pages/bookmarks/index.vue` | Reset cached ordinary presentation and reconcile activation, settlement, and queued refreshes safely. |
| `apps/web/app/components/GetSubscribeModal.vue` | Notify the original owner after a disposed request settles in the same session. |
| `apps/web/tests/unit/promotion/routing.spec.ts` | Cover invitation storage races and correct blogger attribution. |
| `apps/web/tests/integration/pages/bookmarks/index.spec.ts` | Cover cached-page lifecycle, settlement order, late responses, and refresh queues. |
| `apps/web/tests/unit/components/GetSubscribeModal.spec.ts` | Cover disposed success/failure settlement and session isolation. |
| `openspec/changes/koc-onboarding-continuity/design.md` | Record follow-up decisions. |
| `openspec/changes/koc-onboarding-continuity/tasks.md` | Track follow-up implementation and verification. |
| `openspec/changes/koc-onboarding-continuity/validation.md` | Record verification and changed-file inventories. |

### Historical branch inventory before dev integration

Compared with the branch base `b086da93`, the complete KOC/onboarding change touches 46 files: 18 added, 28 modified, none deleted. This includes the earlier implementation and both review-fix passes.

| Change | File |
| --- | --- |
| Modified | `apps/api/src/domain/subscriptionMain.ts` |
| Modified | `apps/api/src/handler/http/promotionController.ts` |
| Added | `apps/api/test/domain/promotionStatus.test.ts` |
| Modified | `apps/web/app/components/GetSubscribeModal.vue` |
| Added | `apps/web/app/components/Promotion/KocPromotionHost.vue` |
| Modified | `apps/web/app/composables/bookmark/useBookmarkData.ts` |
| Modified | `apps/web/app/composables/bookmark/useInboxOnboardingState.ts` |
| Modified | `apps/web/app/composables/bookmark/useLocalBookmarks.ts` |
| Modified | `apps/web/app/composables/bookmark/useLocalCollections.ts` |
| Modified | `apps/web/app/composables/bookmark/useOnboardingPending.ts` |
| Added | `apps/web/app/composables/promotion/useKocPromotionFlow.ts` |
| Modified | `apps/web/app/layouts/default.vue` |
| Modified | `apps/web/app/pages/[blogger]-reader/index.vue` |
| Modified | `apps/web/app/pages/bookmarks/index.vue` |
| Modified | `apps/web/app/pages/onboarding.vue` |
| Modified | `apps/web/app/plugins/pinia.ts` |
| Modified | `apps/web/app/plugins/powersync.client.ts` |
| Modified | `apps/web/app/stores/user.ts` |
| Modified | `apps/web/app/utils/channel.ts` |
| Added | `apps/web/app/utils/promotionFlow.ts` |
| Added | `apps/web/app/utils/userProfile.ts` |
| Modified | `apps/web/i18n/locales/en.json` |
| Modified | `apps/web/i18n/locales/zh.json` |
| Modified | `apps/web/tests/integration/pages/bookmarks/index.spec.ts` |
| Modified | `apps/web/tests/unit/components/GetSubscribeModal.spec.ts` |
| Modified | `apps/web/tests/unit/composables/bookmark/useBookmarkData.spec.ts` |
| Modified | `apps/web/tests/unit/composables/bookmark/useInboxOnboardingState.spec.ts` |
| Modified | `apps/web/tests/unit/composables/bookmark/useOnboardingPending.spec.ts` |
| Modified | `apps/web/tests/unit/local-first/powersync-bridge-session.spec.ts` |
| Modified | `apps/web/tests/unit/middleware/auth.global.spec.ts` |
| Modified | `apps/web/tests/unit/pages/onboarding.spec.ts` |
| Added | `apps/web/tests/unit/promotion/continuity.spec.ts` |
| Added | `apps/web/tests/unit/promotion/local-readiness.spec.ts` |
| Added | `apps/web/tests/unit/promotion/local-sync.spec.ts` |
| Added | `apps/web/tests/unit/promotion/profile-ordering.spec.ts` |
| Added | `apps/web/tests/unit/promotion/onboarding-readiness.spec.ts` |
| Added | `apps/web/tests/unit/promotion/routing.spec.ts` |
| Modified | `apps/web/tests/unit/stores/user.spec.ts` |
| Added | `openspec/changes/koc-onboarding-continuity/.openspec.yaml` |
| Added | `openspec/changes/koc-onboarding-continuity/design.md` |
| Added | `openspec/changes/koc-onboarding-continuity/proposal.md` |
| Added | `openspec/changes/koc-onboarding-continuity/specs/inbox-onboarding-readiness/spec.md` |
| Added | `openspec/changes/koc-onboarding-continuity/specs/koc-promotion-continuity/spec.md` |
| Added | `openspec/changes/koc-onboarding-continuity/tasks.md` |
| Added | `openspec/changes/koc-onboarding-continuity/validation.md` |
| Modified | `packages/contracts/src/interface.ts` |

## Final deep-review fixes

The five reproducible findings were confirmed and approved for repair. All five now have durable regression coverage:

1. First sync no longer authorizes onboarding from a throttled stale empty query. A direct SQLite read confirms the committed Inbox and active subscription state. Tests use the installed PowerSync query processor and actual SQLite expressions, covering downloaded bookmarks/subscriptions, cancelled/null subscriptions, archived/deleted data, offline reuse, errors and ownership changes.
2. Profile writes share request ordering across the page, KOC controller and offline fallback; newer accepted commits include locale synchronization. Older reads and cleared sessions cannot restore stale subscription or language state.
3. A disposed KOC request retains submission ownership until settlement. Returning does not remount a second claim form; settlement rechecks server authority and refreshes the profile without relying on focus.
4. Storage invalidations remain queued during submission/success and reconcile when allowed. Broadcasts cannot bypass an owned in-flight submission or be blocked by another account's old submission.
5. Ordinary success invalidates eligibility responses started before the grant, preventing a consumed CTA from reappearing.

Both profile refresh queues drain genuinely newer queued work after an earlier read fails, while retaining focus-based retry when no new request exists. This pass changes lifecycle and data decisions only; no styles, layout, entitlement values, or backend grant transaction changed.

The new real-store fixture initially depended on import order because partial Nuxt mocks evaluated a circular network/store dependency. After consulting the Nuxt testing and Vitest module-mocking documentation, the options considered were a complete network-module mock, hoisted module-cache reset, deferred store import, and a Nuxt runtime fixture. A complete network boundary mock was the narrowest deterministic fix; production store, controller, router, host and modal remain real.

### Files changed in this pass

This pass adds three files and modifies twelve existing files. Together with the preceding uncommitted follow-up, the worktree contains eighteen changed files; the cumulative branch inventory above also includes the earlier committed implementation.

| Change | File | Purpose |
| --- | --- | --- |
| Modified | `apps/web/app/components/Promotion/KocPromotionHost.vue` | Submission ownership, disposal reconciliation, queued storage events and profile refreshes. |
| Modified | `apps/web/app/composables/bookmark/useBookmarkData.ts` | Direct post-sync Inbox/subscription emptiness confirmation. |
| Modified | `apps/web/app/composables/bookmark/useInboxOnboardingState.ts` | Require scoped confirmation before setting pending. |
| Modified | `apps/web/app/composables/promotion/useKocPromotionFlow.ts` | Share ordered authoritative profile commits. |
| Modified | `apps/web/app/pages/bookmarks/index.vue` | Wire confirmation, invalidate old eligibility, drain queued refresh after failure. |
| Modified | `apps/web/app/plugins/pinia.ts` | Remove the separate offline-fallback writer. |
| Modified | `apps/web/app/stores/user.ts` | Include offline fallback inside the ordered profile transaction. |
| Added | `apps/web/app/utils/userProfile.ts` | Shared profile/locale commit ordering and invalidation. |
| Modified | `apps/web/tests/integration/pages/bookmarks/index.spec.ts` | Ordinary eligibility and refresh regressions. |
| Modified | `apps/web/tests/unit/promotion/routing.spec.ts` | KOC disposal, account, storage, broadcast and refresh races. |
| Added | `apps/web/tests/unit/promotion/local-sync.spec.ts` | Real query scheduler plus SQLite readiness coverage. |
| Added | `apps/web/tests/unit/promotion/profile-ordering.spec.ts` | Real store and KOC profile-ordering integration. |
| Modified | `openspec/changes/koc-onboarding-continuity/design.md` | Record asynchronous boundary decisions. |
| Modified | `openspec/changes/koc-onboarding-continuity/tasks.md` | Track approved fixes and validation. |
| Modified | `openspec/changes/koc-onboarding-continuity/validation.md` | Record evidence and updated file inventories. |

### Final verification

- Full Web suite: **2,031 passed, 1 skipped; 191 files passed, 1 skipped**. This adds 23 regression cases to the preceding 2,008-test baseline.
- Web typecheck: passed after the final production edits, run separately from Vitest to avoid concurrent `.nuxt` generation.
- Touched production ESLint: zero errors; four pre-existing warnings (one `any` and three unused bindings) remain.
- Independent Bugs/Security/Compliance re-review: no remaining Important findings. The review also caught and verified corrections to accepted-profile locale updates, foreign submission ownership, and refresh queues following rejection.
- `git diff --check`: passed. Strict OpenSpec validation passes all 35 items.

The successful Web run printed a happy-dom fetch abort during environment teardown, in addition to fixture Turnstile/SSR warnings; Vitest reported no failed tests or unhandled test errors. Earlier failing profile fixture runs are not counted as verification. The dedicated PostgreSQL concurrency check in task 4.5 and the external integration limitations above remain open. This pass did not change backend code or repeat payment operations. No push, deployment, or merge had been performed at that verification checkpoint.

## PR integration checkpoint

PR: https://github.com/slax-lab/slax-reader/pull/209 (target `dev`). The reviewed implementation and deep-review fixes were published at `43f3a27`. The target had advanced to `1912e3b`; its account-locale work overlapped the layout, store and Pinia fallback. The integration preserves those dev behaviors and reuses `UserLocaleTasks` for all profile commits. The earlier `userProfile.ts` helper is removed, and Pinia matches dev without a competing fallback implementation. KOC uses a server-only store action with a propagated 10-second deadline and one bounded same-session retry for a superseded identity read.

The post-PR Bugs, Security and Compliance review found no remaining Important findings or Nits in the resolved diff. Tests additionally cover a confirmed language save during a KOC read, a competing page read, the real Pinia offline fallback, and abort-signal propagation. Historical inventories above describe the earlier checkpoints rather than the final PR contents.

Integrated verification:

- Web full suite: **2,096 tests passed, 1 skipped; 195 files passed, 1 skipped**.
- Web typecheck and lint for integration-touched production code passed. The first typecheck exposed a missing workspace link introduced by dev's new frontend-utils dependency; `pnpm install --frozen-lockfile` restored the declared link without changing the lockfile, and typecheck then passed.
- Strict OpenSpec validation: **39 items passed**. `git diff --check` passed.
- The PostgreSQL concurrency release check in task 4.5 and the documented external integration limits remain unchanged. No deployment or PR merge is part of publication.

### CI runtime compatibility follow-up

Frontend CI run `38500840706` failed before collecting the 10 tests in `local-sync.spec.ts`: Vite rejected the static `node:sqlite` import. The remaining 2,086 Web tests and the API/CLI checks passed. The failure was reproduced locally with CI's Node 22.22.2; the previous integrated verification used Node 24.15.0.

Node 22 supports SQLite but omits prefix-only modules from `module.builtinModules`. Vitest uses that list to externalize built-ins, so the static import reached Vite's client bundler. Node added prefix-only entries in 23.5.0, explaining the different Node 24 result. The test now loads the same real SQLite module with `process.getBuiltinModule('node:sqlite')`, supported since Node 22.3.0. This keeps the happy-dom/Vue fixture, actual SQL execution, and all existing assertions intact.

The Node documentation confirms three available approaches: direct `getBuiltinModule` loading, a `createRequire` loader, or using a runtime with the expanded built-in module list. Direct loading is the smallest fix and preserves the repository's supported Node 22 CI runtime without additional loader setup or workflow changes.

- Before the fix: the targeted suite reproduced the CI bundling error and collected zero tests on Node 22.22.2.
- After the fix: all 10 targeted tests passed on Node 22.22.2.
- Full Web suite on Node 22.22.2: **2,096 tests passed, 1 skipped; 195 files passed, 1 skipped**. The existing happy-dom fetch abort during teardown remains non-failing.
- Node 24.15.0 compatibility: all 10 targeted tests passed. Strict OpenSpec validation passed all 39 items, and `git diff --check` passed.
- The follow-up changes only test loading and this validation record; production behavior, UI, dependencies, and CI configuration are unchanged. Incremental Bugs/Security/Compliance review found no Important findings or Nits, using `OpenSpec: koc-onboarding-continuity`.

References: [Node 22 process.getBuiltinModule](https://nodejs.org/download/release/v22.22.2/docs/api/process.html#processgetbuiltinmoduleid), [Node 22 module.createRequire](https://nodejs.org/download/release/v22.22.2/docs/api/module.html#modulecreaterequirefilename), and [Node 24 builtinModules history](https://nodejs.org/download/release/v24.15.0/docs/api/module.html#modulebuiltinmodules).

### Subsequent dev merge: Safari worker policy

Integrated dev `3f2ea18d` into PR #209 after the Safari/mobile PowerSync worker-policy fix and design-spec archives landed. The only textual conflict was the recovery import group in `powersync.client.ts`. The resolution retains the new `shouldUsePowerSyncSharedWorker()` policy alongside the KOC account-ownership guard, delayed plugin exposure, and storage-denied REST fallback.

The first combined regression run exposed seven fixture failures in the incoming worker-selection suite: its happy-dom plugin harness lacked the Nuxt `useState` boundary now needed for ownership tracking. A single fixture mock supplies that state; the real plugin, policy, and recovery path remain under test.

- Full Web suite on Node 22.22.2: **2,119 passed, 3 skipped; 197 files passed, 1 skipped**.
- Development-transform worker-selection run: **2 passed, 7 production-only cases skipped**.
- Web typecheck, lint for the merged plugin/test, and `git diff --check` passed. Strict OpenSpec validation passed all **38** current items after dev's archives.
- Independent incremental Bugs/Security/Compliance review: no Important findings or Nits. The selected change remains `koc-onboarding-continuity`, compatible with `powersync-safari-worker-policy`.

The diff against this dev revision contains 49 files; the additional file relative to the inventory below is the worker-selection fixture adaptation. Real-device Worker timing and the existing isolated PostgreSQL concurrent-grant release check remain outside these automated results.

### File inventory at the first PR integration checkpoint

The final diff against `1912e3b` contains 48 files: 17 added, 31 modified, 0 deleted. Changes already present in dev are excluded.

| Change | File |
| --- | --- |
| Modified | `apps/api/src/domain/subscriptionMain.ts` |
| Modified | `apps/api/src/handler/http/promotionController.ts` |
| Added | `apps/api/test/domain/promotionStatus.test.ts` |
| Modified | `apps/web/app/components/GetSubscribeModal.vue` |
| Added | `apps/web/app/components/Promotion/KocPromotionHost.vue` |
| Modified | `apps/web/app/composables/bookmark/useBookmarkData.ts` |
| Modified | `apps/web/app/composables/bookmark/useInboxOnboardingState.ts` |
| Modified | `apps/web/app/composables/bookmark/useLocalBookmarks.ts` |
| Modified | `apps/web/app/composables/bookmark/useLocalCollections.ts` |
| Modified | `apps/web/app/composables/bookmark/useOnboardingPending.ts` |
| Added | `apps/web/app/composables/promotion/useKocPromotionFlow.ts` |
| Modified | `apps/web/app/layouts/default.vue` |
| Modified | `apps/web/app/pages/[blogger]-reader/index.vue` |
| Modified | `apps/web/app/pages/bookmarks/index.vue` |
| Modified | `apps/web/app/pages/onboarding.vue` |
| Modified | `apps/web/app/plugins/powersync.client.ts` |
| Modified | `apps/web/app/stores/user.ts` |
| Modified | `apps/web/app/utils/accountLocaleRequest.ts` |
| Modified | `apps/web/app/utils/channel.ts` |
| Added | `apps/web/app/utils/promotionFlow.ts` |
| Modified | `apps/web/app/utils/userLocaleTasks.ts` |
| Modified | `apps/web/i18n/locales/en.json` |
| Modified | `apps/web/i18n/locales/zh.json` |
| Modified | `apps/web/tests/integration/pages/bookmarks/index.spec.ts` |
| Modified | `apps/web/tests/unit/components/GetSubscribeModal.spec.ts` |
| Modified | `apps/web/tests/unit/composables/bookmark/useBookmarkData.spec.ts` |
| Modified | `apps/web/tests/unit/composables/bookmark/useInboxOnboardingState.spec.ts` |
| Modified | `apps/web/tests/unit/composables/bookmark/useOnboardingPending.spec.ts` |
| Modified | `apps/web/tests/unit/local-first/powersync-bridge-session.spec.ts` |
| Modified | `apps/web/tests/unit/middleware/auth.global.spec.ts` |
| Modified | `apps/web/tests/unit/pages/onboarding.spec.ts` |
| Added | `apps/web/tests/unit/promotion/continuity.spec.ts` |
| Added | `apps/web/tests/unit/promotion/local-readiness.spec.ts` |
| Added | `apps/web/tests/unit/promotion/local-sync.spec.ts` |
| Added | `apps/web/tests/unit/promotion/onboarding-readiness.spec.ts` |
| Added | `apps/web/tests/unit/promotion/profile-ordering.spec.ts` |
| Added | `apps/web/tests/unit/promotion/routing.spec.ts` |
| Modified | `apps/web/tests/unit/stores/user.spec.ts` |
| Modified | `apps/web/tests/unit/utils/accountLocaleRequest.spec.ts` |
| Modified | `apps/web/tests/unit/utils/userLocaleTasks.spec.ts` |
| Added | `openspec/changes/koc-onboarding-continuity/.openspec.yaml` |
| Added | `openspec/changes/koc-onboarding-continuity/design.md` |
| Added | `openspec/changes/koc-onboarding-continuity/proposal.md` |
| Added | `openspec/changes/koc-onboarding-continuity/specs/inbox-onboarding-readiness/spec.md` |
| Added | `openspec/changes/koc-onboarding-continuity/specs/koc-promotion-continuity/spec.md` |
| Added | `openspec/changes/koc-onboarding-continuity/tasks.md` |
| Added | `openspec/changes/koc-onboarding-continuity/validation.md` |
| Modified | `packages/contracts/src/interface.ts` |
