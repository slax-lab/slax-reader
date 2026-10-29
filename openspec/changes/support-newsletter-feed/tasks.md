# Tasks

Earlier implementation/acceptance history is preserved in validation.md and superseded by the user-approved independent-storage plan on 2026-10-28. Prior finished work is not proof of the new revision.

## Independent Newsletter revision

- [x] 1. Rewrite the initial independent mail schema and restore all Newsletter-induced RSS model/backend/local-first/PowerSync changes; prove schema/data invariance and generation parity.
- [x] 2. Implement one-row synchronous receive, no-lease dedupe/cancellation, independent body storage and owner deletion; verify limits, failures, parallel delivery and zero RSS writes. The user later deferred background body collection.
- [x] 3. Implement mixed read projections, typed numeric cursor/order, discriminated source contracts and public RSS history delegation with expanded-window rereads.
- [x] 4. Implement independent Inbox snapshot copies, ordinary default sharing (revised by the user during acceptance), idempotent restore/reconcile, safe indexing and acquisition guards with concurrency/security tests.
- [x] 5. Implement Feed-owned Web actions while delegating unchanged RSS-only UI; verify themes/responsive behavior and obtain renewed human hands-on acceptance.
- [x] 6. Complete generation/full checks/actual Worker and database verification, zero-RSS-diff audit, fresh three-pass review, operator documentation and original PR updates without deployment.
- [x] 6a. Simplify account revocation to existing sr_user.deleted_at; remove binding retirement columns/triggers directly from the initial migration, verify deletion/publication fences and retained address reservations, and update the original PR.
- [x] 6b. Defer Newsletter-specific scheduled tasks: remove the body collector and its dedicated scan/query/index/cursor, regenerate registration, preserve immediate cleanup and existing shared jobs, verify and update the original PR.

- [x] 6c. Implement the user-approved collapsible address card and explicit confirmed creation, regenerate/check API wiring, verify themes/identity/errors and local runtime, complete fresh review, and prepare API/Web for renewed human acceptance before PR handoff.

- [x] 6d. Record renewed human hands-on acceptance and complete reviewed verification/screenshot preparation for committing and updating the original PR. Demo approval alone is not product acceptance.

## Team-feedback revision

- [x] 6e. Generate the clean initial schema, document every field and verify serialized address reservation without added unique address index/CHECK constraints.
- [x] 6f. Implement Newsletter-only first-configuration validation, flat modules and HtmlBuilder mail extraction; restore generic sync repository and ordinary search helpers.
- [x] 6g. Complete fresh runtime/regression/review evidence and start local API/Web for renewed hands-on acceptance before PR handoff.
- [x] 6h. Record renewed requesting-user acceptance (2026-10-29) of the first-configuration rule and reviewed account-casing, reader-scroll and shared body-typography corrections, and update original PR #349.

- [x] 6i. Audit the complete PR scope, remove iteration-only noise, restore ordinary Reader account policy and original RSS hints, reconcile dev-only rollout guidance, verify and update the original PR.

## Approved local-first/CID/timing revision (2026-10-29)

- [x] 6j. Remove Readability, preserve full sanitized mail and tracking filtering, resolve CID raster images into embedded data URLs through receiving, preview and independent Inbox copying; prove regressions.
- [x] 6k. Add privacy-safe complete-handler and phase timing summaries for every outcome, with a five-second observation flag and tests.
- [x] 6l. Add a separate Newsletter metadata stream/local table and combine owned local RSS/Newsletter lists, source selection, pagination, saved overlays and enablement/session fences; preserve RSS persistence/stream.
- [x] 6m. Fix existing Mobile saved-mail source and original-link affordances only, validate and record the Mobile version decision.
- [x] 6n. Complete actual local runtime verification, regression checks and independent Bugs/Security/Compliance review; document operator publication/console steps and start API/Web for renewed human acceptance.

- [x] 6o. Obtain renewed requesting-user hands-on acceptance of this revision before committing/updating the original PR; record any Mobile device acceptance limits explicitly.

## Approved four-comment follow-up (2026-10-29)

- [x] 6p. Record approved plan, reconcile the current requirements and verify the existing worktree baseline.
- [x] 6q. Preserve successful receive and original failures through cleanup; add actual-handler regressions and quiet cleanup diagnostics.
- [x] 6r. Unify Web original-navigation policy with Mobile, keeping internal Reader navigation and all source labels; prove affected controls.
- [x] 6s. Move the mixed comparator to Feed and share literal local/server order/keyset fixtures without RSS or local-first changes.
- [x] 6t. Prove splitter compatibility in workerd, implement bounded streamed MIME with ordinary attachment discard and full-input identity, and exercise large/CID/failed inputs.
- [x] 6u. Complete full checks, actual runtime and independent review, update pilot guidance, and start local API/Web for renewed human acceptance.
- [ ] 6v. Record renewed human acceptance and update original PR with verified commits and CI; do not deploy.

## Archive after merge

- [ ] 7. After the task PR merges, classify unchecked tasks and archive this change through a separate documentation PR.
