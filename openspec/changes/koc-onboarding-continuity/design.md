# Design

## Context

See [proposal.md](proposal.md) for the motivation and scope. The user selected **claim before onboarding** and requested **root-path KOC destinations** on 2026-10-13. The user authorized implementation after plan review on 2026-10-13; implementation progress is tracked in tasks.md.

### Verified failure chain

The inspected flow is unchanged between the analysis checkout and origin/dev at worktree creation:

1. The blogger route resolves a configured blogger, preserves that route through OAuth, and sends an authenticated visitor to bookmarks with activity_id, activity_type=blogger, and claim=true.
2. Bookmarks captures the activity in setup-local constants and immediately removes it from the URL. It only exposes a sidebar claim entry; claim=true no longer triggers a dialog.
3. The Inbox state watcher independently redirects to bare /onboarding.
4. Both onboarding exits target bare /bookmarks. The tutorial can also reload /onboarding after returning from the extension store.
5. A retained bookmarks instance can preserve the constants. A document reload destroys that instance; a fresh bookmarks setup defaults to platform_0527. This produces a 30-day offer, or no offer if the platform campaign was already received.

The backend still permits a returning user who has never received a blogger reward. The failure is loss of the active campaign and competing navigation, not a new-user restriction.

The bookmarks page already declares `definePageMeta({ alias: ['/'], key: 'bookmarks' })`. Root / and /bookmarks render the same page; the blogger entry still explicitly targets /bookmarks. The root alias accepts the same campaign query, so the requested cleaner destination requires no new page or intermediate redirect. Changing this destination alone does not fix campaign loss or onboarding races.

### Adjacent defects within this flow

| Observation | Consequence |
| --- | --- |
| Bookmarks is cached with a fixed key; its activation hook consumes search only | A KOC navigation that reuses the instance can retain an earlier platform or blogger context |
| The claim modal forces reload after success and on an already-received error | Navigation and recovery cannot be coordinated reliably |
| Claim flags use activity type alone and never expire | Another account, or a formerly active Apple subscriber, can have its entry incorrectly hidden |
| Status true means either a prior reward or a currently active Apple subscription | The client cannot safely distinguish permanent completion from temporary exclusion |
| onLoadMore clears isFirstLoad before awaiting the first response | A slow, ultimately nonempty response can be preceded by an onboarding redirect |
| The onboarding gate does not use bookmark loading/error or first-sync status | Loading and failed queries can look like an empty library |
| useOnboardingPending creates independent refs around localStorage | Completion in onboarding does not update the cached bookmarks instance in the same document |
| Automatic redirect watches are not restricted to the active bookmarks route | Cached pages can react while the user is elsewhere |
| The sidebar is hidden at widths 769-920px | A sidebar-only recovery entry is insufficient |

An isolated execution of original source initializers confirmed eight checks during analysis, including KOC loss after fresh setup, the install-return reload, and the premature empty-state window. This was not a production-account or real-router reproduction. Existing tests mock navigation and do not cover the combined campaign/onboarding/reload journey.

### Implementation evidence map

- [Blogger entry](../../../apps/web/app/pages/[blogger]-reader/index.vue): authenticated campaign parameters and OAuth return route.
- [Bookmarks page](../../../apps/web/app/pages/bookmarks/index.vue): activity capture/cleanup, onboarding watcher, activation hook, status cache, and claim entry.
- [Onboarding page](../../../apps/web/app/pages/onboarding.vue) and [tutorial](../../../apps/web/app/components/BookmarkList/BookmarksOnboardingHero.vue): bare return route and installation-triggered reload.
- [Bookmark data](../../../apps/web/app/composables/bookmark/useBookmarkData.ts), [Inbox state](../../../apps/web/app/composables/bookmark/useInboxOnboardingState.ts), and [pending flags](../../../apps/web/app/composables/bookmark/useOnboardingPending.ts): readiness and cached-consumer state.
- [Default layout](../../../apps/web/app/layouts/default.vue) and [claim modal](../../../apps/web/app/components/GetSubscribeModal.vue): page caching and forced reload.
- [Promotion controller](../../../apps/api/src/handler/http/promotionController.ts), [subscription service](../../../apps/api/src/domain/subscriptionMain.ts), and [grant repository](../../../apps/api/src/infra/repository/dbSubscription.ts): allowlist, eligibility, values, and account-level deduplication.

## Goals / Non-Goals

**Goals**

- Make invitation persistence, presentation, and onboarding ordering independent of component lifetime.
- Treat the server as the authority for eligibility and grant completion.
- Preserve retryability without repeated unsolicited dialogs or blocking the product indefinitely.
- Make delayed, failed, or stale data incapable of triggering automatic onboarding.
- Keep KOC arrival and onboarding return navigation on the root Inbox URL while supporting existing /bookmarks links.

**Non-Goals**

- No server-side pending-invitation table, cross-device invitation recovery, reward backfill, or new global application workflow framework.
- No change to the existing Inbox-based onboarding audience. Inbox emptiness is not an account-wide history check; archived-only accounts can still qualify after data resolves.
- No refactor of authentication, payment settlement, analytics infrastructure, or general request handling.

## Decisions

### 1. Account-scoped invitation plus one flow coordinator

Use a small client-side promotion store/composable and a single flow host mounted once in the existing default layout. The host runs only on active bookmarks/onboarding surfaces and owns one modal instance. Bookmarks supplies onboarding readiness; onboarding consumes the same state and continuation.

Suggested boundaries:

- app/composables/promotion/useKocPromotionFlow.ts: shared reactive invitation, eligibility, request generation, and presentation state.
- app/utils/promotionFlow.ts: parsing, versioned storage, and URL fallback without UI dependencies.
- app/components/Promotion/KocPromotionHost.vue: one declaratively mounted claim dialog, pending/error entry, and continuation callbacks.
- Existing pages: capture/reconcile input and request navigation through the coordinator.

Use existing Nuxt/Vue facilities; do not add a state-machine dependency. No server-scoped mutable singleton may retain user data during SSR.

Alternatives considered:

| Approach | Benefit | Why it is not selected |
| --- | --- | --- |
| Propagate query parameters only | Small initial patch | Every navigation and refresh needs discipline; cached instances still need reconciliation |
| Skip onboarding whenever a KOC parameter exists | Avoids the first redirect | Does not fix stale cached context, deferred claims, reloads, or premature emptiness |
| Store unclaimed invitations on the server | Cross-device recovery | Requires a new lifecycle and API/database model for a problem currently bounded to one browser |

Durable account-scoped state plus coordinated presentation covers the observed failure modes with no new grant mechanism.

### 2. Capture and preserve intent before consuming the URL

Persist under slax_koc_pending_v1_<userId>. Store only version, canonical blogger/activity ID, capturedAt, and deferred. Store no token, email, or copied user profile.

Rules:

1. Validate the blogger using the existing blogger-info allowlist. Wait for the authenticated account identity before binding and persisting the invitation. Before login, keep using the explicit OAuth return route; do not create a browser-global anonymous invitation.
2. Save successfully before removing activity query parameters. A fresh explicit KOC entry wins over an older unclaimed invitation and resets deferred=false. Do not switch the submitted activity while its request is in flight.
3. Reconcile explicit route input on initial entry, active-route changes, and KeepAlive reactivation. Repeated reconciliation of the same navigation must not reopen the dialog.
4. With no explicit invitation, restore the current account's stored invitation. Never replace it with platform_0527 because a URL lacks query parameters.
5. Choosing Later persists deferred=true. The invitation remains available without auto-opening on subsequent ordinary visits. Revisiting a KOC URL explicitly re-arms the prompt.
6. Remove the invitation after confirmed success or a definitive already_received response. Keep it deferred for active_apple_subscription or legacy status=true with unknown reason; later visits recheck rather than caching a permanent denial.
7. Do not introduce a new eligibility expiry. A stored invitation remains unclaimed until resolved; validate its canonical blogger again before presenting it after a new document load. An explicitly invalid/removed blogger is discarded with an explanation. Transport failures remain retryable.
8. On account change/logout, close the current presentation and invalidate its requests. Preserve only account-keyed durable records; never restore account A's record for B. Handle storage events by refreshing the active account's server status, not by assuming another tab granted entitlement.

Storage denial/corruption is an explicit degraded mode. Ignore malformed data without crashing. If durable storage is unavailable, preserve the validated activity in the current URL and propagate it through onboarding and its return URL, including a deferred marker. Do not strip the only recoverable context. This fallback survives reload of that URL but cannot promise recovery from a later bare URL after closing the tab. After auth changes, discard the old in-memory owner and revalidate any explicit public invite for the new account; old responses cannot bind it.

#### Root-path destinations and legacy compatibility

- After blogger validation and authentication, navigate with `path: '/'`, the campaign query, and `replace: true`. For daguang the production destination is `https://r.slax.com/?activity_id=daguang&activity_type=blogger&claim=true`. Use same-origin router navigation rather than hardcoding the production host so development and preview environments remain usable.
- Keep the existing blogger-route OAuth continuation. After sign-in it resolves the blogger and reaches the same root destination. A direct logged-out visit to the root campaign URL must also preserve its full query through the existing authentication return flow.
- Treat / and the exact legacy /bookmarks list route as the same supported Inbox surface for invitation reconciliation and active-page guards. Do not include article-detail routes or bypass the plain-Inbox exclusions. Preserve the existing page identity and KeepAlive behavior; do not rely on a remount to consume a fresh invitation.
- Clean campaign parameters only after successful account-scoped persistence. Use an explicit path-preserving replace so root / does not become /bookmarks through named-route resolution. Retain unrelated query/hash state; coordinate the existing search-parameter consumption with invitation cleanup to avoid competing replaces. With no unrelated URL state, successful cleanup leaves bare /.
- Onboarding skip, completion, and the no-pending fallback all return to /. In storage-degraded mode, carry the validated campaign and deferred marker through /onboarding and back to the root URL. Deferral must remain effective after reload even if the original claim flag was true.
- Keep existing /bookmarks entry links accepted, with the same eligibility, persistence, and ordering guarantees. This change does not remove that route or globally rewrite article links, filters, PWA start URLs, or unrelated authentication defaults.

The root-path change is part of this journey's navigation contract. It complements durable invitation handling and claim-before-onboarding coordination rather than replacing either.

### 3. Preserve the status API and describe its decision

Extend POST /v1/promotion/check_receive additively. Keep status=false for eligible and status=true for unavailable, exactly as existing clients consume it. For valid activities, add reason and, when eligible, a reward description:

| Result | status | reason | reward |
| --- | --- | --- | --- |
| Eligible ordinary/system/expired subscription | false | eligible | kind=trial, days=60 for blogger or 30 for platform |
| Eligible active Stripe subscription with a customer binding | false | eligible | kind=credit, amount=1198 or 599, currency=usd |
| Activity already received | true | already_received | omitted |
| Active Apple subscription, no activity record | true | active_apple_subscription | omitted |

Read the activity record before choosing the exclusion reason so actual completion wins over temporary Apple status. Keep unsupported-input handling compatible; it must never become an invitation or permit a grant. Check status boolean shape and optional fields defensively in the client.

Add shared response types in packages/contracts and a detailed read method in SubscriptionServiceMain. Existing boolean callers can delegate to the detailed result for supported activities. Derive reward descriptions from the same values used by receiveSubscription so copy cannot drift from 60 days/$11.98. The claim transaction remains authoritative and unchanged.

Old API fallback:

- status=false without new fields still permits an explicit claim. Use neutral reward wording that mentions the existing paid-subscriber treatment instead of promising a trial to every account.
- status=true without a reason means unavailable/unknown, not definitely already claimed. Keep the invitation deferred and explain that it is unavailable now.
- Missing/malformed status or an HTTP error is not eligible, received, or empty data; show Retry/Later.

This read-only extension is justified by an existing ambiguity that otherwise recreates the permanent Apple-denial bug.

### 4. Claim takes precedence over automatic onboarding

The coordinator exposes whether automatic onboarding can proceed. It begins unresolved while account identity and invitation capture are being established; it must not default to allowed and race a later pending-invitation read.

| State | User-visible behavior | Automatic onboarding |
| --- | --- | --- |
| Resolving/checking an explicit or non-deferred invitation | Bounded loading state, then Retry/Later on failure | Wait |
| Eligible | One reward dialog with Claim and Later | Wait |
| Submitting | Claim controls and dismissal disabled | Wait |
| Success | Server-confirmed result and Continue action | Wait until acknowledgement |
| Deferred | Compact KOC entry on bookmarks/onboarding | Allowed when data is ready |
| Already received | No duplicate claim; concise explanation for an explicit KOC visit | Allowed |
| Active Apple subscription | Explain temporary unavailability, retain deferred invitation | Allowed |
| No pending invitation | Existing non-KOC experience | Allowed |

Do not block indefinitely on a silent network request: give the check a bounded timeout (initial proposal: 10 seconds), ignore late results using a request generation, and provide Retry/Later. Later never submits a claim or writes a backend receive record.

While a validated KOC invitation remains pending, suppress the ordinary platform claim entry. Otherwise a user who deferred KOC can accidentally receive the wrong campaign. Show a textual resume entry in content visible at desktop, 769-920px, and narrow widths; onboarding also has this nonmodal entry.

Automatic onboarding navigation requires the active bookmarks route, authoritative ready data, and an allowed promotion state. A cached/deactivated page must not navigate. Re-evaluate after success acknowledgement or deferral; do not reuse an earlier empty snapshot if current data has changed.

Only the plain personal Inbox is an automatic-entry surface. Search, a source filter, a selected collection feed, and RSS must not turn a filtered empty result into an empty-Inbox conclusion.

### 5. Make the modal report outcomes without navigating

Adapt GetSubscribeModal to expose typed success, deferred, and unavailable outcomes to its owner. Remove its unconditional page reload and duplicate navigation responsibilities. Use the declarative host so modal lifetime, scroll lock, focus restoration, and timers end together.

- Keep the production Turnstile requirement. Reset/recreate its token after a failed attempt when needed.
- Close, backdrop, Escape, and Later share the same deferral behavior when idle. Prevent all of them during submission.
- After success, clear the matching pending invitation, show the server result, refresh the user/subscription store, and continue only after acknowledgement. A refresh failure after confirmed grant must not change success into a failed grant or resubmit it.
- For an already-received error, recheck the authoritative status and settle the state without reloading.
- For an uncertain network outcome, preserve intent and retry safely. Existing server reward keys and transaction locking prevent duplicate grants. Do not clear a pending invitation merely because a request was sent.
- Capture account/activity/request generation. Late callbacks cannot refresh another account, clear a newer invitation, reopen a disposed dialog, or navigate after logout.
- Notify other open tabs through the existing channel with a targeted subscription-state refresh signal, rather than forcing a page refresh. Consumers refresh eligibility/subscription state; this is not a new durable entitlement cache.

No change to reward economics: ordinary trial then KOC remains eligible for an additional 60 days; KOC then ordinary remains consumed by the existing transaction. Prior KOC receipt across any blogger still prevents a second grant.

### 6. Use successful data readiness, not "loading started"

Expose an explicit readiness result from useBookmarkData for the current account, tab, source filter, and query generation. Keep visual first-load indicators distinct where existing UI needs them.

- REST: readiness becomes true only after the current query succeeds and its result is applied. Rejection, undefined/malformed results, cancellation, or superseded responses do not prove emptiness. A valid empty array does.
- Local data: wait for the current query result without an error/loading/settling state AND completion of the account's first PowerSync sync. A previously synced offline account can use its resolved local data after its identity has been verified in the current document; first-ever offline sync cannot prove emptiness. A fresh offline document cannot verify identity from cached Pinia or a local UUID profile, so it conservatively waits for reconnection before automatic onboarding.
- Collection subscriptions: require successful data resolution too. A finally block that only clears loading is insufficient after a failed request.
- Extension detection: preserve the existing detection mechanism; wait for its completed result for new automatic decisions.
- Require verified user identity. Recompute against current data after any query/account change.

Pass these facts into useInboxOnboardingState rather than assuming !isFirstLoad means success. Do not merely move isFirstLoad=false into finally; failures would still become empty.

Maintain the existing audience rule: current Inbox empty, zero noncancelled collection subscriptions, no detected extension, and not dismissed. Do not switch this fix to a new account-wide bookmark count or add a count endpoint.

### 7. Share onboarding state across cached pages

Keep the existing per-user localStorage keys for backward compatibility, but expose one shared reactive state per account. Persist reads/writes defensively and synchronize storage events.

Completion is one atomic transition: dismissed=true and pending=false in shared state before any navigation decision can re-run. Both skip and complete use it. A valid dismissed marker takes precedence over a stale pending marker and repairs that combination.

A restored pending flag alone does not bypass readiness for a new automatic redirect. Resolve current data before redirecting again; clear obsolete pending state when data is nonempty or extension installation is detected. A direct /onboarding resume can show the existing tutorial after the promotion gate resolves, without creating a new empty-library conclusion.

Keep the extension-install reload where needed for injection. The flow must survive that reload rather than depending on its removal.

### Review resolutions before implementation

- Bind invitations to a positive account ID from a session-bound server identity read. Persisted Pinia profiles and the local offline profile (which can have userId=0) are not verified identity. Reject late identity/profile results before committing them when the session changes. Keep promotion ownership separate from the local-profile fallback.
- Establish PowerSync database ownership for the same account in addition to hasSynced and successful query results. Failed ownership/version checks must not expose local results as ready. When storage access fails at startup, disable local data and use the existing REST path so URL-based invitation recovery can run. This is a narrow startup/readiness boundary, not an authentication redesign.
- Retain the shared subscription modal and explicitly adapt the ordinary campaign caller to its typed outcomes, profile refresh, status recheck, and targeted cross-tab signal. KOC remains the single automatic offer; ordinary claims stay manually initiated.
- Distinguish the blogger-info endpoint's definitive ERROR_PARAM from transport errors. Only definitive invalidity discards context.

### 8. Acceptance and verification matrix

| Case | Expected result |
| --- | --- |
| Authenticated blogger entry or blogger OAuth return | Arrive at / with the validated campaign query; cleanup remains on / |
| Direct root campaign URL before login | Authentication preserves invitation parameters and returns to the root Inbox |
| Root alias or legacy /bookmarks with an already cached page | Same invitation reconciliation and one prompt; no forced remount or automatic path rewrite |
| Onboarding skip, completion, or no-pending fallback | Return to /; retain campaign/deferred query when storage is unavailable |
| New account, valid KOC, empty Inbox | KOC dialog first; confirmed 60-day reward; then onboarding if still applicable |
| Previously registered on another device, never received KOC | Same eligibility and presentation as a new account |
| Ordinary trial already received, no KOC history | KOC remains available; ordinary status cannot hide it |
| Any prior blogger reward, same/different blogger URL | No second grant; no repeat prompt on ordinary navigation |
| Active Stripe subscriber | Credit wording and existing $11.98 credit, no promised 60-day extension |
| Active Apple subscriber, then later expired | Temporary exclusion followed by fresh eligibility check; no permanent denial cache |
| Later, extension-store return reload, finish/skip | Same pending KOC remains resumable, no auto-prompt loop or platform fallback |
| Refresh during unresolved/eligible/submitting flow | Rehydrate, check server status, never blindly auto-submit |
| Cached bookmarks initially held platform context | Explicit KOC entry updates context without remount dependence |
| Account A claimed, then account B signs in | B uses its own server eligibility and invitation |
| Old account/request responds after a newer invitation | No stale state write, grant-context replacement, or navigation |
| Two tabs submit concurrently | One backend reward; both converge through refresh/status |
| Denied storage or corrupt JSON | No crash; URL fallback retained; eligibility still server-authoritative |
| Invalid/removed blogger versus transport failure | Discard only definitive invalidity; allow retry for transport failure |
| Slow REST response eventually contains bookmarks | No premature onboarding |
| REST/local/collection query failure | Error/retry state, no empty conclusion |
| First PowerSync sync pending; existing offline synced data | Wait in the first case; use resolved current local data in the second |
| Skip/complete while bookmarks remains cached | No stale pending redirect loop |
| 769-920px and narrow screens | Reward prompt/resume entry remains visible and operable |
| Keyboard, Chinese/English, reduced motion | Focus trap/return, clear copy, and appropriate animation behavior |

Use existing Vitest unit/page suites for pure state, API and component contracts. Add an integration test with real Vue routing/KeepAlive semantics rather than only asserting mocked navigateTo calls. Verify full reload and extension-store focus-return in a controlled browser environment with test responses/accounts; never consume a real user's production reward as a test.

The shared tests/e2e directory currently has no established runnable Web journey suite. Add browser coverage in the existing Web test tooling or a focused harness; do not turn this fix into a repository-wide E2E platform project. The installed PowerSync version's error/readiness behavior must be exercised with its actual query API during implementation, not inferred from the current comment.

## Risks / Trade-offs

- [Persistence outlives a session] → Keep only non-sensitive campaign metadata under account-specific keys, revalidate on document entry, and check server eligibility before presentation/submission.
- [Backend and frontend deploy separately] → Ship additive status fields first; implement explicit fallback for old responses. No migration is required.
- [A request may succeed while its response is lost] → Preserve the pending invitation and rely on the existing idempotent grant path; distinguish server confirmation from client transport success.
- [Multiple route watchers can compete] → One flow host owns promotion presentation and continuation; active-route guards protect cached pages.
- [Network/storage limitations] → Retry/Later and URL preservation avoid destructive fallback; cross-device and bare-URL recovery without storage are outside scope.
- [Legacy modal theming/accessibility debt] → Reuse Web semantic tokens and fix touched interactions under DESIGN.md; verify current supported profiles without claiming a full subscription-theme rewrite.
- [Previously lost invitations cannot be inferred] → Ask affected users to revisit the original KOC link; do not invent attribution or mass-grant rewards.

## Migration Plan

1. Implement and validate additive API status fields and unchanged reward decisions.
2. Implement client persistence/coordinator, then modal and page integration, then readiness/shared onboarding state as one coherent change.
3. Ignore legacy activity_claimed_* flags from the first updated client load. Remove only these obsolete known keys; do not clear unrelated browser storage or existing onboarding completion history.
4. Run targeted tests, strict OpenSpec validation, and the repository's local pre-push review. The eventual PR targets dev and names OpenSpec: koc-onboarding-continuity.
5. Verify on a controlled deployed test environment, including actual cached route return and installation-triggered reload. Promote through the repository's human-managed environment flow.
6. Rollback the Web flow if needed while leaving additive API fields harmless. Do not remove awarded entitlements or roll back claim records. Stored versioned invitations remain non-authoritative and can be safely ignored by the old client.


## Implementation review resolutions

The independent Bugs, Security and Compliance review identified three Important findings. All three were fixed with regression coverage:

1. Leaving a successful offer before pressing Continue disposed the only acknowledgement control. Explicit navigation away from the supported flow surfaces now releases the successful presentation; returning evaluates onboarding without requesting another grant. Staying on the flow surface still requires Continue or dismissal.
2. An older eligibility response could clean a newer campaign URL. The host now captures and verifies the route before presenting or cleaning, invalidates obsolete checks, and preserves a new invitation while a previous grant is submitting.
3. REST collection readiness could survive an account change. Collection and bookmark readiness now belong to the current session/account, reset before new queries, and reject late responses.

Additional integration checks cover synchronously gating a cached Inbox on a fresh campaign query, rearming a deferred URL when storage is denied, and refreshing the ordinary modal caller after removing forced reload. Storage events reread only the current account's pending record, and confirmed success removes only the matching invitation. Profile refresh failures retry on focus independently of the confirmed grant.

See [validation.md](validation.md) for execution evidence, rollout and remaining deployment checks.


### Follow-up review: storage events and cached ordinary offers

The follow-up review found two additional lifecycle defects:

- A storage-event restore could replace a still-resolving explicit invitation, after which the original route cleanup consumed the wrong invitation. Storage events now queue through the host reconciliation loop. Explicit route context wins over persisted context, and cleanup requires the matching blogger to be durable. Reasserting that invitation preserves its capture time; a bare-route storage event invalidates older validation before restoring the new record.
- Ordinary promotion success or submission could leave its page-owned open/phase flags alive after the modal was disposed. Leaving the Inbox or deactivating the cached page now resets presentation. Returning rechecks eligibility, and an abandoned submission schedules a profile refresh, without requiring a window-focus event or reopening the modal automatically. A session-bound disposal callback also reconciles when the request settles after the user has already returned. It checks the owning page and account before refreshing or notifying other tabs, and never restores presentation. Eligibility generations reject older replies; profile refreshes drain queued requests serially, including requests arriving as the previous refresh finishes.

Regression tests exercise both validation and eligibility delays, stored-to-stored replacement, normal cross-tab recovery, real cached-page/modal departure and return in each settlement order, delayed profile/status replies, queued refreshes, and account/page disposal. These fixes retain the existing UI styles and reward policy.

### Final deep-review: asynchronous settlement boundaries

First-sync completion can precede PowerSync's throttled live-query refresh. Automatic onboarding therefore confirms both Inbox emptiness and the absence of active collection subscriptions with a fresh database read after readiness, scoped to the current account/session. Failed or superseded confirmation cannot set pending. This adds no fixed delay and retains previously synced offline support.

All profile writers share request ordering, including the offline fallback. An older response cannot overwrite a newer committed profile or locale. Accepted commits apply server language consistently regardless of which caller requested the profile. Refresh queues attempt genuinely newer queued work even when the preceding read fails, and otherwise retain focus-based retry. KOC identity still requires a successful authenticated server read. Disposed KOC submissions reconcile eligibility and profile when they settle, without reviving the disposed modal. Storage changes received during submission stay queued until reconciliation is allowed. Ordinary grant success invalidates any eligibility reads started before that success. Regression coverage includes real query scheduling and Router/KeepAlive lifetimes. No styles, layout, or reward policy change in this pass.

### Integration with account locale synchronization

PR integration reuses the latest dev branch's `UserLocaleTasks` as the sole profile and locale writer, replacing the earlier standalone profile-ordering helper. A server-only store action shares its ordering with ordinary reads and the Pinia offline fallback. The KOC controller bypasses that fallback, uses a 10-second abort signal, checks numeric verified identity after the read, and retries a superseded same-session identity read once within the same deadline. Confirmed language changes during a promotion read remain authoritative; ordinary offline recovery retains the existing language and account safeguards.
