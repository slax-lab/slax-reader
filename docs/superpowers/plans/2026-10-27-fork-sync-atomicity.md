# Atomic Reader admission in PowerSync batches

The owner approved this correction on 2026-10-27. It supersedes the segmented-transaction portion of the earlier PowerSync plan.

## Goal and constraints

Keep ordinary bookmark mutations and Fork database admission in one existing ordered transaction. Start Workflows only after that transaction commits. Preserve ordinary-only behavior, existing bounded retries/locks/source checks, HTTP admission, and the prior local-first UI. No schema, bucket, R2, alias, cleanup or new rescue mechanism.

## Implementation

1. Reproduce mixed-batch failures with real PostgreSQL: ordinary create/refresh, Fork create/refresh, then a failing later mutation. Assert no persisted changes or workflow dispatch; replay the same request after the failure is removed and verify one successful admission. Check later personal edits are committed before dispatch, not only before the HTTP response.
2. Separate existing Fork database reservation from post-commit dispatch. Allow the repository's existing admission and own-source restore logic to use a caller transaction; retain their original standalone transaction wrappers for HTTP.
3. Extend the existing ordered batch executor with a narrow Reader handler that runs inside its transaction and returns a deferred post-commit effect. Reset deferred effects on each attempt. Use existing Serializable Fork isolation and bounded conflict retries for Reader-containing batches; ordinary-only transactions retain their current settings and retry count. Keep permanent source failures in the same transaction and leave infrastructure errors fatal to that batch.
4. Restore sync orchestration to one batch call, followed by ordinary Workflow dispatch. Reader callbacks dispatch only after commit and contain dispatch errors like ordinary post-commit scheduling, without releasing uncertain writer claims.
5. Run focused and full API tests, PostgreSQL/HTTP runtime tests, generation, typecheck, lint, build and OpenSpec validation. Review the whole PR and update Draft #399, the English implementation/evidence and Chinese report.

## Review focus

No independent writes or side effects during the outer transaction; business rejections must not leave partial Reader writes. Source and Labs permission checks must observe the same transaction, including with the runtime one-connection pool. Rolled-back/conflicting attempts must not retain dispatch callbacks. HTTP admission and own-source restoration must retain behavior. Failure after database commit remains distinct from a database rollback and does not gain exactly-once dispatch/recovery guarantees.

## Tasks

- [x] A1 RED/GREEN mixed-batch rollback/retry and dispatch-order regressions.
- [x] A2 Extract shared Fork database/dispatch boundaries and integrate one ordered transaction.
- [x] A3 Full verification, independent Bugs/Security/Compliance review, and report/PR update.
- [ ] After merge, archive together with `add-bookmark-fork` through the required documentation PR.
