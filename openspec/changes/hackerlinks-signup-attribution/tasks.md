# Tasks

## 1. Approval and shared contract

- [x] 1.1 Obtain human review and approval of this proposal, both-provider coverage, the Q6 analytics definitions, and the authorized real-account acceptance approach; record the approval and any scope changes in the planning artifacts before implementation.
- [x] 1.2 Add the closed acquisition type, composed Web attribution type, and type guards in `packages/contracts`; verify type tests or focused package checks accept the two supported shapes and reject partial/unsupported values without changing existing collection callers.

## 2. Server registration attribution

- [x] 2.1 Extend optional `auth_attribution` validation at the existing login boundary so Google accepts collection or acquisition and Apple accepts acquisition only; add API tests for valid, absent, partial, malformed, unsupported-provider, duplicate/ambiguous, and unknown-key inputs while confirming authentication outcomes remain unchanged.
- [x] 2.2 Attach validated acquisition only to server `user_created`, preserving the actual provider method and authenticated user ID; test new Google and Apple accounts, returning accounts with acquisition-free `user_logged_in`, no success event on authentication failure, and no client-controlled identity/method override.
- [x] 2.3 Re-run collection attribution and device-alias suites; verify existing Google collection events, Apple collection exclusion, signup/login alias sources, event device identity, and analytics-stream failure isolation remain unchanged without database or generated-schema edits.

## 3. Web entry and OAuth continuity

- [x] 3.1 Add the closed UTM extraction helper and preserve a valid triplet through the unauthenticated `/` → `/login` redirect; unit-test header, resource-detail, direct-login, missing, partial, unsupported, array-valued, unrelated, and repeated-attempt inputs, including unchanged return/affiliate targets and no `utm_content` capture.
- [x] 3.2 Thread optional acquisition through the login page/view and Google/Apple controls; verify collection-only UI observations do not fire for acquisition, ordinary login has no stale source, provider availability and visible presentation remain unchanged, and no storage-based last-source state is introduced.
- [x] 3.3 Carry per-attempt acquisition through both OAuth state builders, callback union parsing/recovery, and the existing login request; extend `useAuth`, callback, and auth-recovery tests for both providers, independent attempts, cancellation/failure, unchanged credentials/redirects, Google collection compatibility, and Apple collection exclusion.

## 4. Analytics contract and query

- [x] 4.1 In the companion `slax-reader-event-tracking` change, register Q6 and the three optional `user_created` properties in `handbook/03-事件词典.md`, narrow the current Q1 non-goal, add `handbook/plans/Q6-HackerLinks注册归因.md` and `decisions/Q6-HackerLinks注册归因.md`, and update README navigation; verify the frozen v1 snapshot is unchanged, current definitions have one authoritative home, local links resolve, and `git diff --check` passes.
- [x] 4.2 Make the Q6 plan's query fully deterministic with fixed snapshot, UTC and partition windows, the normative 300-second `effective_at` rule, complete `source=hackerlinks` / `campaign=mvp` / supported-`medium` filtering, natural-key deduplication, positive distinct-user counting, raw/duplicate/data-quality counts, and reconciled medium/campaign/method breakdowns; exercise the formula with an application-side synthetic fixture covering redelivery, returning logins, ordinary/source-only/invalid attribution, both sides of the 300-second threshold and UTC boundary, and reproducibility, keeping scripts and query-result exports out of the analytics repository.

## 5. Running-environment and warehouse acceptance

- [x] 5.1 Run focused Web/API/shared-contract tests, existing collection/auth-recovery regressions, and affected applications' required typecheck/lint checks; record exact commands and results in `openspec/changes/hackerlinks-signup-attribution/validation.md` and verify no UI-visible change requires a design acceptance path.
- [ ] 5.2 In an authorized non-production deployment, use real never-registered OAuth test accounts to exercise Google/header and Apple/resource-detail through actual Web, provider, callback, API, account creation, and event ingestion; also exercise returning, ordinary/invalid, and cancelled flows, inspect exact request/event fields and signup alias continuity, and record any provider or environment gap rather than substituting fixtures.
- [ ] 5.3 After authorized deployment, start from the actual public HackerLinks header and resource-detail links for production C5 acceptance, query `logs.events` at a fixed snapshot, reconcile each test account to one deduplicated `user_created`, verify returning/cancelled attempts add none, assert all forbidden fields are absent, and record snapshot/UTC window/raw duplicates/deduplicated counts in sanitized application evidence.
- [ ] 5.4 Re-run the Q6 report against the exercised cohort and verify medium/campaign/method breakdowns reconcile and duplicate replay leaves the distinct-user count unchanged; obtain Alex's analytics C5 acceptance, link the evidence from the companion decision/plan, and do not mark affected definitions `live` without actual warehouse evidence and acceptance.

## 6. Delivery and lifecycle

- [x] 6.1 Assess release impact before handoff: `docs/release/VERSIONING.md` states that Web/API do not use package-version increments; verify no CLI, Extension, or Mobile manifest, dependency, database schema, or HackerLinks change is present, so no version decision is required.
- [x] 6.2 Run `pnpm exec openspec validate --all --strict` and the REVIEW.md Bugs, Security, and Compliance passes, plus both repositories' delivery checks; resolve Important findings and verify the diff contains only task-owned changes and no raw events, account identifiers, credentials, or query exports.
- [ ] 6.3 After proposal approval and implementation verification, prepare the application PR targeting `dev` with `OpenSpec: hackerlinks-signup-attribution` and a linked companion analytics PR targeting its default branch; verify current dictionary/plan definitions travel with implementation and lifecycle statuses reflect evidence, while keeping proposal review out of the PR.
- [ ] 6.4 After the task PRs merge, classify every remaining unchecked item, synchronize the accepted capability, archive this OpenSpec change through a separate docs PR, and archive the analytics Q6 plan only when its own all-live/no-pending-work lifecycle condition is satisfied.
