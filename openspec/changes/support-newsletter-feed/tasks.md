# Tasks

Earlier implementation/acceptance history is preserved in validation.md and superseded by the user-approved independent-storage plan on 2026-10-28. Prior finished work is not proof of the new revision.

## Independent Newsletter revision

- [x] 1. Rewrite the initial independent mail schema and restore all Newsletter-induced RSS model/backend/local-first/PowerSync changes; prove schema/data invariance and generation parity.
- [x] 2. Implement one-row synchronous receive, no-lease dedupe/cancellation, independent body storage/GC and owner deletion; verify limits, failures, parallel delivery and zero RSS writes.
- [x] 3. Implement mixed read projections, typed numeric cursor/order, discriminated source contracts and public RSS history delegation with expanded-window rereads.
- [x] 4. Implement independent Inbox snapshot copies, ordinary default sharing (revised by the user during acceptance), idempotent restore/reconcile, safe indexing and acquisition guards with concurrency/security tests.
- [ ] 5. Implement Feed-owned Web actions while delegating unchanged RSS-only UI; verify themes/responsive behavior and obtain renewed human hands-on acceptance.
- [ ] 6. Complete generation/full checks/actual Worker and database verification, zero-RSS-diff audit, fresh three-pass review, operator documentation and original PR updates without deployment.

## Archive after merge

- [ ] 7. After the task PR merges, classify unchecked tasks and archive this change through a separate documentation PR.
