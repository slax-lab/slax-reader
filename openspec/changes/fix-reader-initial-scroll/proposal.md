# Proposal: Preserve Reader Position and Subscription Access During Startup

## Why

On 2026-11-17, browser tracing on the reported long article reproduced an initial-navigation `scrollTo({ left: 0, top: 0 })` after the reader had reached approximately 9,572px, followed about 190ms later by `useReadingPosition` restoring an older position near 4,163px. Slow startup lets readers interact with the server-rendered article before these automatic scroll decisions run; both decisions must respect that interaction.

The same startup interval exposes a subscription defect: the detail-page gate defaults to expired until a profile refresh finishes, even with an active subscriber profile already available. A controlled experiment using the current release branch's actual functions reproduced upgrade prompts before the refresh and normal access after the identical profile returned. Loading and request failure must not be treated as a confirmed subscription denial.

## What Changes

- Prevent a plain initial Web HTML article navigation from resetting a position the reader or browser has already established while client startup was pending.
- Observe reading interaction before the main client application initializes, and carry that fact into local reading-position restoration. Cancel pending restoration when the reader takes control, including during the asynchronous position lookup and subsequent correction timers.
- Give browser history restoration and explicit highlight/hash navigation their existing destinations without a competing local progress restore. Keep explicit-navigation intent for the navigation even after the highlight query is consumed.
- Preserve ordinary client-side page-change scrolling, same-page query behavior, Back/Forward restoration, BFCache restoration, and highlight/comment/outline navigation.
- Distinguish pending, active, inactive, and failed subscription checks at the existing Web reader gate. Pending checks show local loading feedback; failures show a recoverable error. Only a confirmed inactive result opens the existing upgrade prompt.
- Keep the existing login, current-account identity, subscription expiry/type, article ownership, and server-side authorization checks. Existing public/read-only Outline access remains available under its current rules.
- Add focused automated regressions and exercise navigation plus subscription decisions in a running Nuxt application under delayed startup, profile responses, and local readiness.

## Capabilities

### New Capabilities

- `web-reader-scroll-restoration`: Reader startup interaction correctness: initial HTML-reader scroll ownership, cancellation of stale progress restoration, compatibility with existing navigation destinations, and subscription-gated panel decisions during startup. The existing in-flight capability identifier is retained; its purpose and acceptance scenarios are extended together.

### Modified Capabilities

None. Existing `outline-anchor-navigation`, local database startup/recovery, public-page startup, article delivery, and API subscription-error contracts remain unchanged. No other active change currently carries a delta for `web-reader-scroll-restoration`.

## Impact

- Web only: the `/b/[id]` HTML reader, its page-level scroll policy, an early document interaction marker, `useReadingPosition`, and focused tests. The proposed early marker has two real consumers: initial article scroll handling and local position restoration.
- Subscription correction stays in the existing `useUserSubscribe`/`useBookmark` and reader panel callers, reusing the user store and account context. Shared snapshot and PDF detail consumers of that Web gate require regression coverage; their existing authorization boundaries and PDF scrolling stay unchanged.
- Reuse Nuxt's page scroll metadata and existing navigation lifecycle; do not patch dependencies, replace the global router scroll algorithm, or intercept `window.scrollTo` in shipped code.
- Retain the existing local reading-state schema, paragraph anchor calculation, top dead zone, saving cadence, and bounded layout-correction schedule unless cancellation ends it early.
- No API, database schema, public contract, dependency, theme, pricing, purchase, or layout changes. Extension, Mobile, CLI, and PDF rendering/scroll behavior are outside implementation scope.
- This package is for human review. Product implementation, deployment, and a task pull request are not authorized by completion of the proposal. Before implementation delivery, use `fix/fix-reader-initial-scroll` from current `origin/dev`; keep the existing dirty workspace and unrelated changes intact.

## Planning Validation

This revision contains planning documentation only and is exempt from product runtime verification under `docs/DEFINITION-OF-DONE.md`. On 2026-11-17, `pnpm exec openspec validate fix-reader-initial-scroll --strict` passed, and `pnpm exec openspec validate --all --strict` passed all 108 items with zero failures. These checks validate the proposal package, not an implemented fix; implementation and acceptance tasks were unchecked at that planning checkpoint. The owner subsequently approved implementation and hands-on acceptance; current results and remaining verification gaps are recorded in `validation.md`.
