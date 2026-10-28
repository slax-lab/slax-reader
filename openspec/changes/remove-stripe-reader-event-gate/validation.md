# Validation

## Scope

The change removes the Stripe platform marker gate and the global Stripe mode environment switch. Deployed callback ingestion, queue consumption, cancellation, and reward credits use live mode. Signature, connected-account, collection/owner, user/customer binding, invoice shape, and invoice grant deduplication remain enforced.

The operator separately received an untracked recovery SQL artifact for seven confirmed paid invoices across six users. Customer-specific invoice evidence is excluded from Git. The SQL restores purchased entitlement; it does not add a discretionary outage bonus.

## Recovery SQL running-environment evidence

On 2026-10-28, the repair was executed in an isolated in-memory PostgreSQL runtime (PGlite) using minimal production fixtures fetched over connections forced to `default_transaction_read_only=on`. No production compensation writes were performed.

- First execution created seven invoice grants and seven entitlement periods for six users, completed six stored invoice event jobs and the separately verified rejected invoice job, and recomputed cached expiry from the period ledger.
- A second execution inserted zero grants and periods and left subscription state unchanged.
- Deliberately changing a fixture's cached expiry caused the complete repair to abort before any grant was inserted.
- The SQL uses the application's invoice grant keys and per-user lock order, validates the evidence and historical subscription binding, rejects partial prior repairs and stale state, and commits all users in one transaction.
- The operator-supplied rejected live event is represented by normalized invoice evidence in the repair audit payload. No synthetic webhook inbox event is inserted.

## Automated checks

Final local checks on 2026-10-28:

- `pnpm --filter slax-reader-backend test -- test/domain/stripePlatformCompatibility.test.ts test/domain/subscriptionTelemetry.test.ts test/domain/redeemSubscriptionFlow.test.ts test/domain/promotionStatus.test.ts test/infra/paymentPostgres.test.ts` — passed: 193 test files, 2,521 tests; 14 files and 115 tests skipped. The package script forwarded the paths in a way that ran the full API Vitest suite. The PostgreSQL integration file was among the skipped files because no local database was provisioned.
- `SLAX_API_CONFIG=deploy/cloudflare/api.toml.example HYPERDRIVE_DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unused LOGS_DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unused WRANGLER_SEND_METRICS=false pnpm api -- gen:all` — passed. Prisma clients, Worker runtime types, and backend registrations generated successfully using the public example config and unreachable placeholder database URLs. No generated-code diff remained; `worker-configuration.d.ts` has only the intended removal of the obsolete mode binding.
- `pnpm --filter slax-reader-backend typecheck` — passed.
- `pnpm --filter slax-reader-backend lint` — passed with 344 warnings and zero errors.
- `node /Users/daguang/project/slax-reader/node_modules/@fission-ai/openspec/bin/openspec.js validate --all --strict` — passed: 79 items, zero failures.

## Running-environment gaps

The changed Worker HTTP callback and live queue deployment have not been exercised in a deployed environment. An isolated Worker configuration with signing secrets and local backing services was not provisioned, and this task does not deploy Workers or issue live Stripe operations. Signed event fixtures and mocked external clients cover admission and payment dispatch in the focused regression suite. The operator must deploy the change through the normal release workflow; existing parked jobs are not automatically replayed.

The SQL fixture uses PGlite for real SQL execution. It does not simulate concurrent PostgreSQL sessions; production advisory locking was reviewed against `SubscriptionRepo.paymentTransaction`.

## Local review

- Bugs: traced callback admission, consumer dispatch, live operation recovery, reward keys, cancellation, and SQL ledger projection. Recovery keeps canonical invoice keys so subsequent event delivery cannot grant the same invoice again.
- Security: reviewed signature/account handling, retained collection/owner and user/customer checks, and rejection of test-mode events and persisted test-mode operations. Production credentials and customer-specific SQL are excluded from the patch.
- Compliance: matched the diff to `remove-stripe-reader-event-gate`, recorded the owner's explicit scope approval, kept generated runtime output owned by its generator and the environment binding declaration manually maintained as documented in that file, and declared the Worker runtime verification gap. The change affects API internals and its deployment documentation; no CLI, Extension, or Mobile version change is required.

No Important findings remain in the reviewed runtime diff. The post-merge archive task remains pending until the task pull request is merged.
