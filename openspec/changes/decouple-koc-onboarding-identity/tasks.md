# Tasks

## 1. Establish the account-context boundary

- [x] 1.1 Add `apps/web/app/utils/accountContext.ts` with pure helpers that derive an opaque stable `accountKey` without persisting raw JWT/email data, validate a positive server user ID, and compare token/generation snapshots; verify with focused unit tests for missing, malformed, changed, and mismatched sessions.
- [x] 1.2 Add `apps/web/app/composables/useAccountContext.ts` and integrate it with `apps/web/app/stores/user.ts` and `apps/web/app/plugins/pinia.ts`; verify that server profile commits are current-session-only and that a failed `/v1/user/me` leaves a local-only context rather than an error identity.
- [x] 1.3 Persist a non-secret local-account-to-server-ID alias only after a verified profile response, and verify offline marker compatibility can read the alias without making the account server-ready or promotion-eligible.
- [x] 1.4 Replace KOC state identity reads in `apps/web/app/composables/bookmark/useBookmarkData.ts`, `apps/web/app/pages/bookmarks/index.vue`, and `apps/web/app/pages/onboarding.vue` with the account context; verify that account A responses cannot update account B readiness or navigation.

## 2. Make onboarding markers account-scoped and compatible

- [x] 2.1 Refactor `apps/web/app/composables/bookmark/useOnboardingPending.ts` to use the stable account key, preserve current in-memory behavior when storage is denied, and read/mirror legacy numeric markers only when a verified server ID exists; verify pending, dismissed, migration, storage-denied, and account-switch cases in `apps/web/tests/unit/composables/bookmark/useOnboardingPending.spec.ts`.
- [x] 2.2 Update onboarding consumers and page tests so dismissed state wins over stale pending state and completion is reactive across cached Inbox/onboarding instances; verify `apps/web/tests/unit/pages/onboarding.spec.ts` and the relevant bookmarks integration cases.

## 3. Remove KOC identity from local and REST readiness

- [x] 3.1 Define a readiness result in `apps/web/app/composables/bookmark/useBookmarkData.ts` that requires current owner equality, completed first sync, successful live queries, and direct committed Inbox/subscription confirmation for local tabs, while requiring current-token REST success for REST tabs; verify API failure is unresolved rather than empty.
- [x] 3.2 Preserve the existing Inbox audience in `apps/web/app/composables/bookmark/useInboxOnboardingState.ts` and wire it to the independent readiness result; verify `apps/web/tests/unit/promotion/local-readiness.spec.ts`, `apps/web/tests/unit/promotion/local-sync.spec.ts`, and `apps/web/tests/unit/composables/bookmark/useInboxOnboardingState.spec.ts` cover new-device, offline-synced, query-error, stale-response, owner-change, archived-only, and active-subscription cases.
- [x] 3.3 Add or update `apps/web/tests/unit/composables/bookmark/useBookmarkData.spec.ts` and `apps/web/tests/integration/pages/bookmarks/index.spec.ts` to prove that ordinary onboarding still works when KOC identity is unavailable and does not start on failed or stale REST data.

## 4. Make KOC failures context-sensitive

- [x] 4.1 Add `hasPromotionContext(state: PromotionState, routeQuery: Record<string, unknown>): boolean` and change `promotionBlocksOnboarding(state, hasContext, contextResolved): boolean` in `apps/web/app/utils/promotionFlow.ts`; verify initial restoration blocks, ordinary post-resolution errors are non-blocking, and explicit/pending states remain blocking.
- [x] 4.2 Move durable pending KOC storage to a local-account-key versioned key, read the existing numeric key only as a verified-ID compatibility fallback, and verify pending restoration works during a same-token API outage.
- [x] 4.3 Update `apps/web/app/composables/promotion/useKocPromotionFlow.ts` so initial account/pending restoration remains a bounded `resolving` gate, ordinary background identity failures then become inactive/silent, explicit KOC failures remain retryable, and no failure can produce a false server identity or eligibility result; verify malformed, timeout, unauthorized, pending, and account-switch cases in `apps/web/tests/unit/promotion/silent-failure.spec.ts` and existing routing/profile-ordering suites.
- [x] 4.4 Update `apps/web/app/components/Promotion/KocPromotionHost.vue` to render checking/error/retry controls only for active KOC context and to preserve the existing claim-before-onboarding modal lifecycle; verify no KOC notice appears on ordinary `/` or `/bookmarks` API failure while explicit URLs still expose Retry/Later.

## 5. Reconnect page navigation and cached lifecycle

- [x] 5.1 Update `apps/web/app/pages/bookmarks/index.vue` and `apps/web/app/pages/onboarding.vue` so ordinary onboarding gates use account/data readiness, explicit KOC gates use promotion context, and root return targets preserve validated fallback query state; verify cached-page activation, root alias, legacy `/bookmarks`, deferred KOC, and success acknowledgement scenarios.
- [x] 5.2 Keep the ordinary campaign/modal path independent from KOC failures and verify that an API outage does not replace a pending KOC invitation or show an unrelated error in `apps/web/tests/integration/pages/bookmarks/index.spec.ts`.

## 6. Complete verification and review

- [x] 6.1 Run the focused Web tests for account, onboarding, local readiness, promotion, and bookmarks integration; verify all targeted suites pass on the repository-supported Node runtime.
- [ ] 6.2 Run `pnpm --filter @apps/slax-reader-dweb test`, `pnpm --filter @apps/slax-reader-dweb typecheck`, and `pnpm --filter @apps/slax-reader-dweb lint`; full tests pass, while typecheck and repository-wide lint remain blocked by pre-existing `parse5` type resolution and import-sort errors documented in `validation.md`.
- [x] 6.3 Run `pnpm exec openspec validate --all --strict` and `git diff --check`; verify the new change validates and the working tree has no whitespace errors.
- [x] 6.4 Perform the `REVIEW.md` Bugs, Security, and Compliance passes using `OpenSpec: decouple-koc-onboarding-identity`; the malformed-query Important finding is fixed. YJC (`Whyjsee`) completed hands-on testing of the running Web implementation and confirmed that it fully matched expectations on 2026-10-22 (Asia/Shanghai), supplying an onboarding screenshot and requesting no further adjustments; see `validation.md` for the accepted revision and evidence scope.
