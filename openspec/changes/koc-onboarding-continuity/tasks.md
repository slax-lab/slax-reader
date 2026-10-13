# Tasks

Plan review and implementation were authorized on 2026-10-13. Checkboxes record verified implementation only. Follow design.md for decisions and both delta specs for acceptance criteria.

## 1. Regression coverage and compatibility baseline

- [x] 1.1 Add a combined KOC-to-onboarding regression fixture using a previously registered account with no blogger receipt and an already-consumed platform trial; record the traced legacy loss of blogger context and verify invitation recovery after document reconstruction.
- [x] 1.2 Add a delayed nonempty first-bookmark response test and a failed collection-query test; verify automatic onboarding never treats those unresolved results as empty.
- [x] 1.3 Add actual cached-component lifecycle coverage for explicit KOC re-entry and onboarding skip/complete, rather than only mocking navigateTo; verify the tests exercise activation and shared-state visibility.

## 2. Additive authoritative eligibility contract

- [x] 2.1 Add shared promotion status/reward types and a detailed status read path in SubscriptionServiceMain and PromotionController while retaining the legacy boolean; verify controller/domain tests cover eligible, already received, active Apple, and unsupported-input compatibility.
- [x] 2.2 Reuse the existing reward values for trial/credit descriptions without changing the grant transaction; verify 60/30 days and USD 11.98/5.99 inputs, and inspect that ordinary-before-KOC stacking and KOC-before-ordinary consumption remain unchanged; database-backed validation is tracked in 4.5.
- [x] 2.3 Cover old and new status payloads on the Web side, including malformed data and conflicting optional fields; verify no error or unknown status becomes a claim entitlement or permanent receipt.

## 3. Durable invitation and shared state

- [x] 3.1 Implement a versioned account-scoped pending-invitation utility with validation and defensive persistence; verify serialization, invalid JSON, write denial, restored deferred state, and definitive invalid-blogger handling.
- [x] 3.2 Integrate capture before URL cleanup and preserve the existing OAuth return route; verify initial logged-in entry and logged-out returning-account entry both bind the validated blogger only after account identity resolves. Make cleanup path-preserving, retain unrelated query/hash state, and coordinate existing search consumption.
- [x] 3.3 Implement current-route and KeepAlive reconciliation with request generations and fresh-explicit-invite precedence on both / and the exact legacy /bookmarks list route; verify duplicate reconciliation does not double-open and late responses cannot replace newer/account-switched state.
- [x] 3.4 Implement denied-storage URL preservation through onboarding and root return navigation, including deferral; verify document reconstruction from either URL restores the invitation without using another account's in-memory state or rearming a deferred claim.
- [x] 3.5 Stop consuming legacy activity_claimed_* flags and remove only known obsolete keys; verify a prior account's cache cannot suppress eligibility and unrelated storage remains intact.
- [x] 3.6 Change authenticated blogger destinations to the same-origin root path with campaign query and replace semantics; verify logged-in entry, blogger OAuth return, direct logged-out root campaign entry, root cleanup, and legacy /bookmarks compatibility using real routing/KeepAlive coverage.

## 4. Claim-before-onboarding orchestration

- [x] 4.1 Add one client flow host/coordinator in the default layout with an initially unresolved gate; verify eligibility/offer/submission/success acknowledgement block automatic onboarding and Later/unavailability release it.
- [x] 4.2 Make GetSubscribeModal emit typed outcomes and remove forced reloads; adapt the ordinary campaign caller to refresh profile/status, dispose its modal, and converge across tabs; verify successful claim, already-received response, failed attempt, lost response, and profile-refresh failure keep the correct success/retry state.
- [x] 4.3 Disable close/backdrop/Escape during submission, clean up scroll locks/timers on disposal, and reset failed Turnstile attempts appropriately; verify component tests and keyboard focus/return behavior.
- [x] 4.4 Add visible resumable KOC entries to bookmarks and onboarding, localized reward-aware copy, and suppression of competing ordinary offers while KOC remains pending; inspect Chinese/English copy and verify desktop, 769-920px, and narrow layouts.
- [ ] 4.5 Refresh subscription/eligibility state across tabs through a targeted existing-channel signal, preserving backend idempotency; verify concurrent test-account claims produce one grant and no forced document reload.

## 5. Authoritative onboarding readiness

- [x] 5.1 Add current-query successful-resolution state to useBookmarkData, separate from request start and visual loading; verify delayed success, empty success, rejection, malformed response, and superseded request behavior.
- [x] 5.2 Propagate installed PowerSync query error/loading state and account first-sync readiness into onboarding decisions; verify the actual query API with first-sync-pending, resolved-empty, resolved-nonempty, and previously-synced offline cases.
- [x] 5.3 Distinguish successful collection-subscription resolution from finally-cleared loading in local and REST paths; verify failures never establish zero subscriptions for automatic onboarding.
- [x] 5.4 Update useInboxOnboardingState and the page redirect to require verified account/readiness, active Inbox route, and the promotion gate; verify archived-only audience compatibility and that cached pages, RSS, search, or source-filter transitions cannot cause stale redirects.
- [x] 5.5 Share existing per-account onboarding flags reactively and publish completion atomically before returning to /; make the no-pending fallback use / as well. Verify skip/complete on cached bookmarks, all three root return paths, stale pending plus dismissed, storage events, and account switching.
- [x] 5.6 Keep extension-install refresh compatible with deferred and non-deferred invitations; verify the full-document reload used by store return, manual reload, and direct onboarding resume do not erase or repeatedly prompt deferred KOC.

- [x] 5.7 Guard server identity/profile commits against session changes and require matching PowerSync ownership for local readiness; verify stale persisted profiles, local UUID fallback, late identity responses, and failed account cleanup.
- [x] 5.8 Make storage-denied PowerSync startup fall back safely to REST without exposing unowned local data; verify fresh startup and URL-based onboarding return recovery.

## 6. Integrated validation and delivery

- [x] 6.1 Run the affected Web unit/component/page suites and API status/grant regression suites plus relevant typechecks through repository commands; verify the final change passes without broad unrelated test churn.
- [x] 6.2 Execute the design acceptance matrix in a controlled browser/test-account environment, specifically cached routing and full-document reload paths; record results and any genuine infrastructure limitation without consuming production rewards.
- [x] 6.3 Verify touched UI against DESIGN.md for responsive visibility, keyboard interaction, localization, reduced motion, and supported theme profiles; record actual coverage without claiming a full legacy modal theme migration.
- [x] 6.4 Run openspec validate --all --strict and the local pre-push review required by REVIEW.md before any behavior-changing push; resolve Important findings and verify the eventual PR body names OpenSpec: koc-onboarding-continuity and targets dev.
- [x] 6.5 Document API-first rollout, legacy-response fallback, safe Web rollback, and the affected-user recovery step of revisiting the KOC link; verify rollback preserves grant records and avoids clearing unrelated browser state.

## Validation scope

Local implementation and non-production browser verification are complete; see validation.md. Task 4.5 is partially complete: targeted cross-tab convergence is implemented, but real concurrent grant verification requires the opt-in isolated PostgreSQL payment suite and a dedicated test account. No existing database was truncated to run that suite. Preserve this release check rather than marking it tested.

Task 6.4 covers completed local review and strict validation. No push or PR was performed in this session; the documented PR target and OpenSpec body requirement apply when publishing the branch.
