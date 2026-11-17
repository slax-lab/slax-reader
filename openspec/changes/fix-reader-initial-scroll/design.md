# Design: Reader Startup Position and Subscription Decisions

## Context

See [proposal.md](proposal.md) for the observed two-jump trace. The first stack was Vue Router's `finalizeNavigation -> handleScroll -> scrollToPosition`; the second was the application's `restore -> jump` in `useReadingPosition`. The trace establishes these two causes, not a defect in annotation painting.

- Nuxt 4.5.2 performs an initial forced `router.replace` during `app:created`. Its default scroll policy handles initial navigation and otherwise preserves page lifecycle timing, history destinations, and hashes. The repository has no custom `app/router.options.ts`.
- `/b/[id].vue` has route-key metadata and enables local HTML progress restoration only for a local-first bookmark. It waits for `localReady`, and currently skips progress restoration only while `route.query.highlight` is present.
- `useReadingPosition` starts readiness waiting and position capture on mount. It installs cancellation listeners only after `await options.load()`, so pre-mount interaction and interaction during the lookup are missed. It corrects the restored position immediately, in the next frame, and after 250/700/1500ms.
- `useArticleSelection` locates highlights after marks are drawn and then consumes the query. Comment cards and Outline anchors have their own explicit navigation. Those paths must remain functional.
- Existing Vitest tests have composable/component patterns, but there is no focused reading-position or router-scroll regression suite. `apps/web/tests/fixtures/article-loading/` provides browser harness precedents. A static HTML fixture alone cannot validate Nuxt's actual initial navigation.
- Subscription investigation used the latest published branch, not only the older local checkout: `useUserSubscribe` initializes a local `ref(true)`, and `useBookmark` updates it only after the extra `getUserInfo({ refresh: true })` resolves. The release-source experiment reproduced both protected guards rejecting an already-active cached profile while that refresh was pending, then allowing the identical returned profile. `Promise.allSettled` does not repair the local flag after a failed task.
- The `/b` panel watcher always guards Chat; it guards Analysis only when there is no already-available Outline and no known owner/Pro exemption. `useBookmark` also serves the shared snapshot reader. Existing user-store/account-context checks and the API's subscription denial remain authoritative boundaries.
- Both the subscription default and local-position restoration predate the LCP changes. Earlier rendering and optional-panel loading can change the interaction window; no controlled before/after reproduction-rate comparison establishes that LCP caused these defects. This change preserves the existing performance work rather than rolling it back.

## Goals / Non-Goals

**Goals:** Give each navigation one understandable scroll decision: honor its explicit/history destination, otherwise retain already-established reading, otherwise allow eligible saved progress. Cancel stale automatic work when the reader takes control. Give subscription-gated actions an explicit readiness/result decision so delayed or failed checks cannot impersonate expiry.

**Non-Goals:** Replace Nuxt's complete scroll algorithm; change routing or database startup; modify stored anchors, annotation rendering, article markup, PDF scrolling, layout, or other applications. Authentication, account ownership, paid eligibility, API enforcement, pricing, and purchasing rules are unchanged. No arbitrary startup delay, automatic retry layer, shared cross-application framework, dependency patch, or dependency addition.

## Decisions

### 1. Restrict the initial-navigation exception to the HTML reader

Use the article page's existing `definePageMeta` and Nuxt's functional `scrollToTop` metadata to distinguish initial document entry from a real client-side page change. Suppress only the initial plain-article default-top action; retain Nuxt's normal policy for other pages, ordinary navigation, explicit hashes, and history behavior. Do not set an unconditional global or page-wide `scrollToTop: false`.

Keep the initial/document history distinction available to the progress-restoration decision. For initial reload/history entry, the browser-established viewport must not be replaced by local progress. For in-document Back/Forward, retain the router's history position and skip local progress for that navigation. Explicit highlight intent remains reserved for the annotation locator even when marks are delayed. Where intent is consumed from the URL, retain a navigation-scoped boolean until that navigation ends.

Exercise this predicate against the pinned Nuxt initialization wrapper and a running app; testing only the predicate would not establish that Nuxt still preserves saved positions and hash timing. Any implementation detail needed to convey history intent must remain a small route-lifecycle adapter, not a copied default router implementation.

### 2. Capture early interaction before the main application starts

Add a small, synchronous first-party bootstrap to the existing head-script configuration in `apps/web/nuxt.config.ts`, with its source owned by a focused Web utility. The bootstrap activates only on a `/b` article document. It records scroll-related input and whether a nonzero viewport has already been established; it never scrolls, fetches, reads account data, or writes storage. Scroll keys must exclude editable controls; mouse movement and ordinary typing are not reading interaction.

This closes the measured interval between readable SSR content and application initialization. Moving listeners merely from `onMounted` to composable setup would still miss that interval. A framework plugin loaded with the delayed application bundle has the same limitation. The bootstrap must execute before that bundle, and browser verification must establish actual execution order with the site's deployed script processing.

Use a narrowly scoped, in-memory document marker. The initial article consumes it; subsequent client-side article entries create fresh navigation state. Hand off or remove bootstrap listeners once the application owns the decision. BFCache restoration retains its existing document viewport rather than replaying initialization. Do not persist interaction flags across documents, articles, or accounts.

### 3. Make cancellation cover the entire local restoration lifetime

In `useReadingPosition`, establish cancellation before readiness waiting or saved-position loading. Initialize it from early document interaction and the navigation's history/explicit-target intent. Recheck cancellation, route lifetime, eligibility, and skip conditions after the awaited lookup and before every correction. Preserve the existing correction schedule while it is eligible.

Cancellation immediately ends restore mode so subsequent progress capture is not suppressed for the rest of the correction window. Dispose of readiness timeouts, animation frames, correction timers, and interaction listeners on completion, cancellation, or unmount; a late lookup result must not act after disposal. Keep the existing anchor calculations, 240px dead zone, capture throttling, persistence methods, and local-first eligibility.

Explicit comment/Outline navigation during the correction interval takes ownership, cancelling automatic corrections through the same small navigation/interaction boundary. A valid initial highlight remains handled by the existing annotation locator; this change does not rewrite matching or its query cleanup.

### 4. Keep the two scrolling fixes together

Fixing only local restoration still leaves the captured default-top call. Suppressing only initial top positioning still lets old progress replace newly chosen reading. Both fixes share the same navigation intent and are verified together.

**Alternatives considered:** Globally disabling scroll restoration breaks page changes and history. Delaying rendering until all initialization completes prevents reading and expands the task into startup performance. Saving the current pixel offset and replaying it after every update introduces competing jumps and mixes layout shifts with navigation. The proposed narrow initial exception plus cancellable progress restoration addresses the observed calls without those costs.

### 5. Represent subscription readiness at the existing gate

Extend `useUserSubscribe` and its `useBookmark` caller with explicit pending/active/inactive/error outcomes. Reuse the existing user profile and `checkUserSubscribedIsExpired` expiry/type calculation; do not keep a second independent expiry snapshot that remains true until a particular task calls a setter. Readiness/error state describes the existing profile request, not another request or a new entitlement store. Reuse the existing profile request when a click needs its pending result; repeated clicks do not create parallel profile refreshes.

A result can seed the gate only when the existing account context associates it with the current session/account. A persisted profile alone is not a new authorization source. Keep an already-confirmed current-account result during an ordinary background refresh, re-evaluating its expiry as the existing gate does; a confirmed newer inactive result replaces it. Failed refreshes without a usable confirmed result enter error, not inactive. Existing identity invalidation still removes the result when the session/account changes.

The user-visible decisions are:

| Existing action eligibility | Result |
| --- | --- |
| Login is required but absent | Existing login flow |
| Existing public/read-only Outline exemption applies | Open it under the current rules |
| Subscription check has no result yet | Local, accessible checking status; no upgrade prompt or protected request |
| Current-account subscription is confirmed active | Continue the selected eligible action |
| Current-account subscription is confirmed inactive | Existing upgrade prompt; no protected action |
| Check failed without a usable confirmed result | Local error and explicit Retry; no expiry inference |

Update the reader panel and selection-quote callers to consume this decision without treating pending as allowed or as denied. A panel clicked during pending displays checking feedback and continues once active only if the same account, route, and panel selection still own that intent. Closing or switching the panel, leaving the route, logging out, or changing accounts discards that intent. Reuse the existing account generation and component lifetime; do not introduce a general action queue. Selection-quote delivery must keep its existing scope checks and must never send a chat message automatically.

Provide normal localized checking/error/retry copy for the existing panel area, with an accessible status/alert and reachable retry control. Reuse current loading and error presentation patterns, tokens, and identity/request handling. Do not hold the article, scrolling, or public Outline behind subscription readiness.

The shared `useBookmark` boundary means `/s` and PDF detail consumers require regression checks, while their ownership rules, public exceptions, and PDF scroll/rendering remain unchanged. No server endpoint or subscription error mapping is changed. Client presentation never substitutes for the API's authorization.

**Alternatives considered:** Defaulting expiry to false would temporarily grant protected UI on unknown data. Defaulting to true reproduces the false upgrade prompt. Removing the subscription guard or trusting a persisted paid profile alone weakens existing decisions. The chosen explicit state at the current boundary avoids these outcomes without adding a second permission system.

## Risks / Trade-offs

- [Nuxt metadata and history timing] -> Keep Nuxt's existing algorithm, test the pinned version, and verify cold entry plus real Back/Forward; do not infer success from mocked router calls.
- [Bootstrap arrives after deferred scripts] -> Verify response script order and execution before the reader can scroll. Include a delayed-main-bundle browser case. Do not change Cloudflare configuration as part of this proposal.
- [Programmatic layout changes mistaken for reading input] -> Separate scroll-related input from an already-established nonzero viewport; avoid treating every DOM mutation or mouse event as user takeover. Test image loading with and without user interaction.
- [Highlight query disappears before local readiness] -> Preserve its intent per navigation, and test with both delayed marks and delayed local readiness.
- [Pending corrections or flags survive navigation] -> Dispose pending work and test leaving during lookup/correction, navigating between articles, same-page query cleanup, and BFCache.
- [Broader application effects] -> Changes stay Web-owned; verify PDF and non-reader navigation smoke paths without changing their implementations.
- [Cached or late profile belongs to another account] -> Reuse existing identity verification and account generation, discard stale responses/intent, and test logout and account switching while a check is pending.
- [Pending accidentally treated as active, or inactive accidentally treated as a network error] -> Test each gate outcome separately, preserve current login/upgrade decisions, and verify server authentication/ownership/subscription denials remain effective.
- [Shared guard alters free Outline or PDF/shared-reader access] -> Exercise the existing public/read-only exemption before the paid gate and regression-test all Web reader consumers without altering eligibility rules.

## Verification and Delivery

Create failing regressions before product edits: early interaction, readiness/lookup interruption, correction cancellation with resumed saving, disposal, and navigation-destination priority. Test restoration without interaction as a positive control. Add subscription regressions with the real gate connected to a deferred profile response, rather than mocking the gate as already active: active current-account data, unknown status, confirmation of inactive status, failure/retry, account changes, and abandoned panel/quote intents.

Run a real Nuxt HTML-reader matrix using a long development article with and without annotations, with startup delayed independently of local readiness/marks. Cover fresh entry, reload, existing/missing local progress, local-first and REST paths, ordinary client navigation, Back/Forward with a history position deliberately different from local progress, BFCache, highlight/reply targets, hash links, query-only updates, comment cards, and Outline anchors. Observe the relevant paragraph as well as scroll calls so normal image anchoring is not confused with a reset. Include a post-startup observation window beyond the final 1500ms correction.

Independently delay and fail the current-account profile refresh in the running app. Verify paid Chat and protected Analysis show checking then open, confirmed inactive users still see upgrade, logged-out users still see login, public Outline remains available, and retry recovers an unknown failed result. Change panels/accounts and leave the page before resolving a delayed response. Use permitted development accounts or fixtures for inactive cases; do not modify the real user's subscription. Exercise existing server-side denials and record the preserved response/error behavior.

This restores existing interaction intent rather than redesigning a material UX flow; no discovery demo is needed for the proposal. Before opening a task PR, obtain and record human hands-on acceptance under `DESIGN.md` section 10.2, including who, date, exercised cases, and adjustments. Record automated commands, runtime evidence, theme/viewport coverage appropriate to this behavior-only change, and any agent-executable gaps in `validation.md`; never mark a gap as human acceptance.

Implementation uses a dedicated `fix/fix-reader-initial-scroll` branch from current `origin/dev`, targeted at `dev`. Retain the current change identifier for the user-requested combined startup correction. Deliver code and evidence in that task PR; archive only after its merge via the repository's human-reviewed docs PR process. Rollback reverts the Web bootstrap, initial-entry predicate, restoration updates, and subscription-gate/caller changes coherently; no stored data migration is needed.
