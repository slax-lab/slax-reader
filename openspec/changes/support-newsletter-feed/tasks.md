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

## Archive after merge

- [ ] 6e. Generate the clean initial schema, document every field and verify serialized address reservation without added unique address index/CHECK constraints.
- [ ] 6f. Implement Newsletter-only first-configuration validation, flat modules and HtmlBuilder mail extraction; restore generic sync repository and ordinary search helpers.
- [ ] 6g. Complete fresh runtime/regression/review evidence and start local API/Web for renewed hands-on acceptance before PR handoff.
- [ ] 7. After the task PR merges, classify unchecked tasks and archive this change through a separate documentation PR.
