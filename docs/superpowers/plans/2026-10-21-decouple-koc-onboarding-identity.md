# Decouple KOC Promotion Failures from Onboarding Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ordinary KOC outages silent and non-blocking while allowing independently verified, previously synchronized local data to drive offline onboarding safely.

**Architecture:** Introduce an account context with separate local scope and server-verified identity. Move bookmark/onboarding readiness to that context plus PowerSync/REST readiness, then make KOC blocking and presentation depend on explicit promotion context. Keep explicit KOC journeys recoverable and preserve existing reward, route, and API behavior.

**Tech Stack:** Nuxt 3, Vue 3, Pinia, TypeScript, VueUse, PowerSync, Vitest, Nuxt test utilities, OpenSpec.

**Spec:** `openspec/changes/decouple-koc-onboarding-identity/` (proposal, design, capability specs, and tasks).

## Global Constraints

- Ordinary routes without a KOC query or pending invitation must not show KOC error UI or block onboarding.
- Ordinary routes must not remain behind the KOC API timeout after local account/pending restoration completes.
- A token-derived local account key scopes local state only; only a current `/v1/user/me` response supplies server identity.
- Previously synchronized, owner-matched local data may support offline onboarding; new, unowned, loading, failed, stale, or unsynchronized data may not.
- Explicit KOC URLs and restored pending invitations retain Retry/Later and claim-before-onboarding behavior.
- Do not change KOC reward economics, claim transaction, API contract, database schema, route compatibility, or Web/Extension visual theme.
- Do not read, print, commit, or modify secret files such as `.env*` or `.dev.vars`.

## Review Focus

- API unavailable on ordinary `/` or `/bookmarks`: no KOC warning and no onboarding block — test in Task 4 and Task 5.
- Pending-invitation restoration is still unresolved: onboarding waits until the bounded restore/check completes, so a restored KOC claim cannot be overtaken by onboarding — test in Tasks 2, 4, and 5.
- Previously synced empty local Inbox while REST is down: onboarding may proceed only after owner and sync checks — test in Task 3.
- New device or first sync incomplete: empty query remains unresolved and creates no marker — test in Task 3.
- Account switch or late response: old identity, marker, local owner, and promotion callback cannot affect the new account — test in Tasks 1–2 and Task 4.
- Same-token API outage after a verified session: old server ID is not reused for new claims, while local owner and local readiness remain usable — test in Tasks 1, 3, and 4.
- Same-token API outage after a verified session: old server ID is not reused for new claims, while local owner and local readiness remain usable — test in Tasks 1, 3, and 4.
- Explicit KOC timeout or malformed response: pending invitation remains retryable and onboarding waits until Later/terminal outcome — test in Task 4 and Task 5.

## File Map

- Create `apps/web/app/utils/accountContext.ts` for pure identity, generation, and trust-boundary helpers.
- Create `apps/web/app/composables/useAccountContext.ts` for shared reactive account state.
- Modify `apps/web/app/stores/user.ts` and `apps/web/app/plugins/pinia.ts` to publish ordered current-session server profile state.
- Modify `apps/web/app/composables/bookmark/useBookmarkData.ts` and `apps/web/app/composables/bookmark/useInboxOnboardingState.ts` to use independent readiness.
- Modify `apps/web/app/composables/bookmark/useOnboardingPending.ts` for stable account-key markers and legacy migration.
- Modify `apps/web/app/utils/promotionFlow.ts`, `apps/web/app/composables/promotion/useKocPromotionFlow.ts`, and `apps/web/app/components/Promotion/KocPromotionHost.vue` for context-aware failures and account-key pending-invitation storage.
- Modify `apps/web/app/pages/bookmarks/index.vue` and `apps/web/app/pages/onboarding.vue` to consume the split contexts and preserve root fallback navigation.
- Add/update tests under `apps/web/tests/unit/account/`, `apps/web/tests/unit/composables/bookmark/`, `apps/web/tests/unit/promotion/`, and `apps/web/tests/integration/pages/bookmarks/`.

## Implementation Tasks

### Task 1: Establish the account-context boundary

**Files:**
- Create: `apps/web/app/utils/accountContext.ts`
- Create: `apps/web/app/composables/useAccountContext.ts`
- Modify: `apps/web/app/stores/user.ts`
- Modify: `apps/web/app/plugins/pinia.ts`
- Test: `apps/web/tests/unit/account/accountContext.spec.ts`
- Test: `apps/web/tests/unit/stores/user.spec.ts`

**Interfaces:**
- Produces `AccountContext`, `deriveAccountKey(token)`, `isValidServerUserId(value)`, and current-session generation guards for bookmark, onboarding, and KOC consumers.
- `AccountContext.status` is one of `empty | local | ready | stale`; `source` is `local | server | null`. A same-token server refresh failure clears `serverUserId` for server-dependent work but leaves status `local` when local ownership is valid.

- [ ] **Step 1: Write failing tests** for missing/malformed tokens, valid local keys, positive server IDs, server/local mismatch, logout, account switch, and late profile responses.
- [ ] **Step 2: Run the focused account/store tests** and verify they fail because the context boundary does not exist.
- [ ] **Step 3: Implement the pure helpers and composable** with token-plus-generation guards; keep decoded token data local-only.
- [ ] **Step 4: Integrate ordered profile commits** through the existing user store/plugin path so KOC and bookmark consumers observe the same current profile.
- [ ] **Step 5: Persist and test the non-secret local-account-to-server-ID alias** used only for legacy marker migration during offline startup.
- [ ] **Step 6: Run focused tests** and verify stale responses cannot update the active account or authorize server work.

### Task 2: Make onboarding markers account-scoped and compatible

**Files:**
- Modify: `apps/web/app/composables/bookmark/useOnboardingPending.ts`
- Modify: `apps/web/app/pages/onboarding.vue`
- Test: `apps/web/tests/unit/composables/bookmark/useOnboardingPending.spec.ts`
- Test: `apps/web/tests/unit/pages/onboarding.spec.ts`

**Interfaces:**
- `useOnboardingPending(context)` reads stable account-key markers and accepts an optional verified `serverUserId` for legacy numeric-key compatibility.
- `isPending`, `isDismissed`, `setPending`, `clearPending`, and `setDismissed` remain the consumer-facing API.

- [ ] **Step 1: Add failing marker tests** for stable keys, legacy read/mirror, dismissed-over-pending, storage denial, and account isolation.
- [ ] **Step 2: Run the marker tests** and verify the current numeric-only implementation fails the new cases.
- [ ] **Step 3: Implement versioned account-key storage** without persisting JWTs and preserve same-document reactive state when storage throws.
- [ ] **Step 4: Wire onboarding completion and no-pending fallback** to the shared context while keeping root `/` return navigation.
- [ ] **Step 5: Run marker and onboarding page tests** and verify cached Inbox consumers observe completion before returning.

### Task 3: Remove KOC identity from bookmark and Inbox readiness

**Files:**
- Modify: `apps/web/app/composables/bookmark/useBookmarkData.ts`
- Modify: `apps/web/app/composables/bookmark/useInboxOnboardingState.ts`
- Modify: `apps/web/app/pages/bookmarks/index.vue`
- Test: `apps/web/tests/unit/promotion/local-readiness.spec.ts`
- Test: `apps/web/tests/unit/promotion/local-sync.spec.ts`
- Test: `apps/web/tests/unit/composables/bookmark/useBookmarkData.spec.ts`
- Test: `apps/web/tests/unit/composables/bookmark/useInboxOnboardingState.spec.ts`
- Test: `apps/web/tests/integration/pages/bookmarks/index.spec.ts`

**Interfaces:**
- `useBookmarkData()` exposes `onboardingReady` and `confirmOnboardingEmpty()` based on account context and data-source readiness, never on `koc-promotion` state.
- `confirmOnboardingEmpty()` returns true only for a current, owner-matched, fully synced local database whose committed Inbox/subscription query is empty.

- [ ] **Step 1: Add failing tests** for API-down with synced local empty data, first-sync incomplete, query failure, owner mismatch, stale confirmation, REST failure, and successful empty REST data.
- [ ] **Step 2: Run the readiness suites** and verify the current KOC-dependent implementation fails the API-down/local-context cases.
- [ ] **Step 3: Implement local readiness** using PowerSync owner, `hasSynced`, query state, current token, and direct committed emptiness confirmation.
- [ ] **Step 4: Implement REST readiness** using only current-session successful responses and verified server ID; keep failed responses unresolved.
- [ ] **Step 5: Keep the existing Inbox audience gate** and run local-readiness, local-sync, bookmark, Inbox-state, and page integration tests.

### Task 4: Make KOC failures context-sensitive

**Files:**
- Modify: `apps/web/app/utils/promotionFlow.ts`
- Modify: `apps/web/app/composables/promotion/useKocPromotionFlow.ts`
- Modify: `apps/web/app/components/Promotion/KocPromotionHost.vue`
- Test: `apps/web/tests/unit/promotion/silent-failure.spec.ts`
- Test: `apps/web/tests/unit/promotion/routing.spec.ts`
- Test: `apps/web/tests/unit/promotion/profile-ordering.spec.ts`

**Interfaces:**
- Add `hasPromotionContext(state, routeQuery): boolean`.
- Change `promotionBlocksOnboarding(state, hasContext, contextResolved): boolean`; preserve compatibility for all existing callers by updating them in the same task. `resolving` blocks only until `contextResolved` is true; ordinary post-resolution `error` is non-blocking.
- `useKocPromotionController.identify()` accepts the current context decision and leaves context-free failures inactive/silent.
- `promotionStorageKey(accountKey)` becomes the primary durable key; `promotionLegacyStorageKey(serverUserId)` is compatibility-only and never a claim authorization source.

- [ ] **Step 1: Add failing tests** for ordinary API failure, ordinary malformed response, explicit KOC timeout, pending retry, malformed status, account switch, and definitive invalid/already-received outcomes.
- [ ] **Step 2: Run promotion tests** and verify ordinary `error` currently blocks and renders user-facing KOC controls.
- [ ] **Step 3: Move pending storage to an account-key versioned key** with numeric-key compatibility fallback and verify same-token API-down restoration.
- [ ] **Step 4: Implement context-aware phase transitions and blocking** so initial restoration cannot be overtaken, ordinary post-resolution failures become inactive, and explicit/pending failures remain retryable.
- [ ] **Step 5: Update the KOC host** to render checking/error/Retry/Later only for explicit promotion context and to preserve claim-before-onboarding.
- [ ] **Step 6: Run the focused promotion suites** and verify no false eligibility, receipt, or server identity is produced.

### Task 5: Reconnect cached page navigation

**Files:**
- Modify: `apps/web/app/pages/bookmarks/index.vue`
- Modify: `apps/web/app/pages/onboarding.vue`
- Test: `apps/web/tests/integration/pages/bookmarks/index.spec.ts`
- Test: `apps/web/tests/unit/pages/onboarding.spec.ts`

**Interfaces:**
- Bookmarks uses account/data readiness for ordinary onboarding and promotion context for KOC blocking.
- Root `/` remains the preferred return target; exact legacy `/bookmarks` URLs remain supported.

- [ ] **Step 1: Add failing lifecycle tests** for cached activation, ordinary API-down, explicit KOC API-down, Later, success acknowledgement, root cleanup, and legacy `/bookmarks` compatibility.
- [ ] **Step 2: Update watchers and return targets** so inactive cached pages cannot redirect and no KOC failure can replace a pending invitation or ordinary flow.
- [ ] **Step 3: Run page integration tests** and verify route/query cleanup occurs only after recoverable KOC state is persisted.

### Task 6: Verify and review the complete change

**Files:**
- Modify only files already listed above; no API, database, or dependency changes.

- [ ] **Step 1: Run focused tests** for account, onboarding markers, local readiness, promotion, and page integration; verify all pass.
- [ ] **Step 2: Run `pnpm --filter @apps/slax-reader-dweb test`** and verify the full Web suite passes on the supported Node runtime.
- [ ] **Step 3: Run `pnpm --filter @apps/slax-reader-dweb typecheck` and `pnpm --filter @apps/slax-reader-dweb lint`** and verify no new errors.
- [ ] **Step 4: Run `pnpm exec openspec validate --all --strict` and `git diff --check`** and verify both pass.
- [ ] **Step 5: Perform the `REVIEW.md` Bugs, Security, and Compliance passes** with `OpenSpec: decouple-koc-onboarding-identity`; resolve every Important finding before creating a branch/PR.
- [ ] **Step 6: Manually verify four browser paths**: ordinary API-down has no KOC message, synced-local empty Inbox still reaches onboarding, explicit KOC API-down shows Retry/Later, and Retry succeeds after API recovery.
