# Tasks

## 1. Establish the reviewed regression baseline

- [x] 1.1 After human proposal approval, prepare `fix/fix-reader-initial-scroll` from current `origin/dev` without carrying unrelated changes; verify the branch base and record approval plus the baseline reproduction in `validation.md`.
- [x] 1.2 Add failing tests under `apps/web/tests/unit/` for pre-initialization interaction handoff, readiness/lookup cancellation, correction cancellation with resumed saving, navigation disposal, and uninterrupted saved-progress restoration; run the focused Vitest tests and confirm the relevant cases fail against the old behavior.
- [x] 1.3 Add navigation-policy cases for initial entry versus client navigation, history versus conflicting local progress, hash/highlight intent including query consumption, and fresh state on a later navigation; verify assertions cover destinations rather than source-text patterns.
- [x] 1.4 Add failing tests connecting the real subscription gate and bookmark caller to deferred profile responses: known active current-account data, unknown status, inactive confirmation, request failure/retry, and stale account results. Verify the current release behavior reproduces the false upgrade prompt and retain negative login/upgrade cases.

## 2. Preserve reading through initialization

- [x] 2.1 Add the minimal article-document bootstrap through the existing Web head-script configuration and a focused Web-owned utility; verify it runs before the delayed main bundle, records relevant reading input/nonzero established position, ignores ordinary typing, and performs no scrolling or persistence.
- [x] 2.2 Update `/b/[id].vue` scroll metadata and the small navigation-intent handoff to prevent only the initial plain HTML article reset while preserving normal Nuxt routing; verify initial-entry tests pass and normal page change, history, hash, and non-reader cases retain their destinations.
- [x] 2.3 Update `useReadingPosition` to cancel from before readiness waiting through asynchronous lookup and correction completion, recheck eligibility after awaits, resume capture on cancellation, and dispose pending work; verify focused composable tests pass without changing anchor calculation or persistence format.
- [x] 2.4 Preserve history and explicit passage intent for each navigation, including after highlight query cleanup, and cancel stale corrections when a comment/Outline target is chosen; verify delayed-mark, query-only, Back/Forward, and leave-during-restore tests pass.

## 3. Correct subscription decisions without changing eligibility

- [x] 3.1 Update `useUserSubscribe`/`useBookmark` to distinguish pending, active, inactive, and error using the existing current-account profile, request lifecycle, and expiry/type calculation; verify delayed and failed refreshes cannot independently produce upgrade prompts or paid access, while confirmed inactive users retain the upgrade flow.
- [x] 3.2 Update reader panel and selection-quote callers for pending/error outcomes with localized accessible checking feedback and explicit retry; verify a pending selection continues only while its account/route/panel intent still applies, repeated clicks reuse the pending profile request, and no quote is automatically sent as a message.
- [x] 3.3 Preserve account invalidation, newer inactive results, login checks, ownership, public/read-only Outline exemptions, and API denials; verify focused tests cover logout/account switch during checking, a confirmed expiry replacing older active data, shared reader/PDF consumers, and unchanged server error handling.

## 4. Verify the combined behavior in a running application

- [x] 4.1 Run focused tests, `pnpm web -- typecheck`, `pnpm web -- lint`, `pnpm web -- test`, and `pnpm exec openspec validate --all --strict`; record results and separate any pre-existing failures in `validation.md`.
- [x] 4.2 Exercise a real Nuxt long-article fixture under independently delayed main-client startup and local/mark readiness, with and without annotations and saved progress, on local-first and REST paths; record the visible reading paragraph and prove no delayed default-top or old-progress jump occurs after the final correction window. Include no-interaction positive controls and image-load observations.
- [ ] 4.3 Exercise ordinary navigation, reload/native restoration, Back and Forward with history/local positions deliberately different, BFCache, valid highlight and reply targets, valid hash links, query-only cleanup, comment-card navigation, and Outline anchors; record each destination and subsequent stability in `validation.md`.
- [x] 4.4 Independently delay/fail profile refresh in the running app and exercise paid Chat/protected Analysis, confirmed inactive upgrade, unauthenticated login, public Outline access, retry, and abandonment/account changes; verify no unknown/failed state grants paid access and existing server denials still work. Use development accounts/fixtures without changing the real user's subscription, and record evidence in `validation.md`.
- [ ] 4.5 Perform the documented Web smoke flow for login, library, article, highlights, comments, and extension bridge; include shared/PDF reader authorization and non-reader/PDF navigation smoke checks plus relevant desktop/mobile-width and light/dark/e-ink checking/error/retry states. Record any agent-executable gap explicitly without claiming coverage.

## 5. Prepare task delivery

- [x] 5.1 Obtain human hands-on acceptance of the weak-network reading, navigation, and subscription-gate behavior before opening a PR; record who, date, cases exercised, and adjustments in `validation.md` as required by `DESIGN.md` section 10.2.
- [x] 5.2 Run the Bugs, Security, and Compliance local pre-push review in `REVIEW.md`, resolve Important findings, and verify the final scope remains Web-only; if the implementation expands to an application subject to the versioning rule, obtain its version decision before commit, push, or handoff.
- [ ] 5.3 Prepare the single task PR targeting `dev` with `OpenSpec: fix-reader-initial-scroll`, a concrete Test plan/evidence link, and the required scroll-behavior recording; verify no archive is performed before the task PR merges.
