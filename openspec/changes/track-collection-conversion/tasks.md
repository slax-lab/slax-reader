# Tasks

Implementation was approved by the requesting human on 2026-11-02 with 48-hour subscription conversion and 30-minute login diagnostics. Tasks below track implementation and delivery evidence.

## 1. Review and contract baseline

- [x] 1.1 Obtain and record human approval of this proposal, the companion main dictionary definitions, public-page eligibility, and the proposed 30-minute/2-day (48-hour) reporting windows; verify the approved record distinguishes B selection and the requested 1–2-day range from detailed design approval.
- [x] 1.2 Reconcile the active `login-modal-benefits` source changes without creating a second delta for `web-login-modal`; verify the implementation diff preserves its presentation and the sole new capability remains `collection-conversion-analytics`.
- [x] 1.3 Add the minimal shared attribution/event-property types and optional login-request contract; verify existing callers without metadata still typecheck and the contract contains no client-controlled identity or credential fields.

## 2. Server authentication attribution

- [x] 2.1 Validate optional `auth_attribution` once at the existing login-input boundary, strip unknown keys, omit invalid metadata, and propagate the validated result internally; verify tests for absent, valid, wrong-type, invalid-code, oversized-code, unknown-key, and unsupported-provider metadata without changing authentication results.
- [x] 2.2 Enrich existing Google `user_created` or `user_logged_in` after successful authentication; verify new-account and returning-account tests produce the correct single event and failed authentication produces neither success fact.
- [x] 2.3 Verify existing device headers/alias behavior and success-event identity authority remain intact; test that metadata cannot override authenticated `user_id`, device identity, method, redirects, or permissions, and analytics delivery failure does not fail login.

## 3. Web observation and OAuth propagation

- [x] 3.1 Add `surface` at public and Inbox `collection_opened` call sites and gate public reporting on usable content; verify SSR hydration, SPA entry, late data readiness, unavailable states, pagination, collection changes, reload, and leave/re-entry counts.
- [x] 3.2 Thread optional collection context through the subscription control, modal factory, modal, and Google control; verify modal exposure occurs once per visible opening, not on an attempted mount, rerender, or authenticated direct-subscribe path.
- [x] 3.3 Emit one contextual Google `element_clicked` before navigation without awaiting delivery; verify no duplicate with the global listener, normal-login tracking remains unchanged, and cancellation retains only intent observations.
- [x] 3.4 Carry attribution in the existing Google OAuth state through `/auth` into the login request; extend `useAuth.spec.ts` and callback coverage for absent metadata, distinct collection redirects, unchanged target/affiliate/provider data, and no stale attribution on an unrelated login.
- [x] 3.5 Emit `collection_subscribe_button` intent in the genuine activation path; extend `SubscribeCollectionButton.spec.ts` for anonymous and authenticated clicks, busy/unavailable behavior, cancellation, and no second click during automatic post-login subscription.
- [x] 3.6 Verify the existing server `collection_subscribed` remains the only subscription-success writer; exercise successful writes, already-active rejection, closed collection, and request/database failure using the collection suites, with no synthetic client success event.

## 4. Running-environment and warehouse acceptance

- [x] 4.1 Run focused Web/API regression tests plus the affected applications' required typecheck/lint checks; record exact commands and results in `validation.md`, including standalone Google login, Apple availability, modal dismissal, and redirect preservation.
- [x] 4.2 In an authorized running environment, exercise anonymous new-user and returning-user Google flows, cancellation/failure, authenticated subscription, and automatic post-login subscription; record observed event sequences and the actual configured-origin device continuity, or name unavailable checks as gaps.
- [ ] 4.3 Query `logs.events` for the exercised flows and verify field completeness, correct writer ownership, success conditions, natural-key deduplication, public/Inbox separation, and nonempty consistent device identity; record snapshot IDs and sanitized evidence outside the analytics repository. Apply the plan's field-validity, device-continuity, duplicate-rate/invariance, and business-outcome reconciliation checks. Do not mark affected dictionary entries live without this evidence.
- [ ] 4.4 Validate a Q2 report against the reviewed definitions: raw counts versus browser UV, anonymous versus all-public cohorts, both Google success event names, direct logged-in subscriptions, 30-minute and 2-day (48-hour) windows, immature cohorts, bots, legacy records, and unmatched attribution; verify fixtures for repeated delivery/reloads, first-click versus last-click, click-time identity, matching device/collection, inclusive 48-hour cutoffs, public-open eligibility, maturity, and zero denominators.
- [ ] 4.5 Obtain the analytics acceptance required by handbook C5 and link the evidence from the companion documentation update; if implementation changes visible or accessibility-affecting behavior, also complete `DESIGN.md` hands-on acceptance before a PR, with no declared-gap substitute.

## 5. Delivery and lifecycle



- [x] 5.1 Reassess shipped effects on CLI, Extension, and Mobile before committing, pushing, or handing off implementation; ask the human about version increments for each affected application if applicable, and record an evidence-based exemption otherwise.
- [x] 5.2 Run `pnpm exec openspec validate --all --strict` and the REVIEW.md Bugs, Security, and Compliance passes; resolve Important findings and verify only task-owned changes remain in both repositories.
- [x] 5.3 After proposal approval and implementation verification, prepare the application PR targeting `dev` with `OpenSpec: track-collection-conversion` and a linked companion analytics PR targeting its default branch; verify the main dictionary entries and Q2 plan travel with the implementation and lifecycle statuses reflect evidence. Do not publish the proposal itself for review in a PR.
- [x] 5.4 Address event-tracking PR #1 review: integrate canonical tables, remove parallel increment lifecycle, move history into decisions, complete first-click conversion and C5 acceptance contracts, verify the query fixture, update both PRs, and reply to the reviewer. The requesting human approved this follow-up on 2026-11-03.
- [ ] 5.5 After the task PR merges, classify every remaining unchecked item, synchronize the accepted capability, and archive this OpenSpec change through a separate docs PR; archive the analytics Q2 plan only when its own all-live/no-pending-work lifecycle condition is satisfied.
