# Validation

## Scope

The change removes the Stripe platform marker gate and the global Stripe mode environment switch. Callback ingestion, queue consumption, cancellation, and recovery support test and live modes without a global flag, matching the previous backend. Reward operation key namespaces derive from the configured Stripe key. Signature, connected-account, collection/owner, user/customer binding, invoice shape, and invoice grant deduplication remain enforced.

The operator separately received an untracked recovery SQL artifact for seven confirmed paid invoices across six users. Customer-specific invoice evidence is excluded from Git. The SQL restores purchased entitlement; it does not add a discretionary outage bonus.

## Recovery SQL running-environment evidence

On 2026-10-28, the repair was executed in an isolated in-memory PostgreSQL runtime (PGlite) using minimal production fixtures fetched over connections forced to `default_transaction_read_only=on`. No production compensation writes were performed.

- First execution created seven invoice grants and seven entitlement periods for six users, completed six stored invoice event jobs and the separately verified rejected invoice job, and recomputed cached expiry from the period ledger.
- A second execution inserted zero grants and periods and left subscription state unchanged.
- Deliberately changing a fixture's cached expiry caused the complete repair to abort before any grant was inserted.
- The SQL uses the application's invoice grant keys and per-user lock order, validates the evidence and historical subscription binding, rejects partial prior repairs and stale state, and commits all users in one transaction.
- The operator-supplied rejected live event is represented by normalized invoice evidence in the repair audit payload. No synthetic webhook inbox event is inserted.

## Automated checks

Follow-up checks after restoring test/live compatibility on 2026-10-28:

- `node node_modules/vitest/vitest.mjs run --config vitest.config.ts test/domain/stripePlatformCompatibility.test.ts test/domain/subscriptionTelemetry.test.ts test/domain/redeemSubscriptionFlow.test.ts test/infra/stripeClient.test.ts test/infra/paymentPostgres.test.ts` — 4 files passed, 55 tests passed; `paymentPostgres.test.ts` skipped all 19 integration tests because no local PostgreSQL database was provisioned. Coverage includes signed test/live callback intake, distinct mode-scoped grant keys, recovery of both modes, cancellation in both modes with customer binding, reward mode bookkeeping, and fake Stripe key prefix detection. Connected-account and invalid-signature rejections remain covered.
- The required public-example-config `pnpm api -- gen:all` command passed with unreachable placeholder database URLs. It left no unrelated generated-code diff.
- `pnpm --filter slax-reader-backend typecheck` passed.
- `pnpm --filter slax-reader-backend lint` initially found a Prettier formatting error in `apps/api/src/domain/subscriptionPayment.ts:159`; after the production edit was formatted, the final run passed with zero errors and 344 warnings.
- `node node_modules/vitest/vitest.mjs run --config vitest.config.ts test/domain/promotionStatus.test.ts` — passed: 1 file, 7 tests. Its `SubscriptionServiceMain` Stripe client mock supplies `liveMode: false` without constructing a network client.

Initial checks on 2026-10-28, before restoring test-mode compatibility:

- `pnpm --filter slax-reader-backend test -- test/domain/stripePlatformCompatibility.test.ts test/domain/subscriptionTelemetry.test.ts test/domain/redeemSubscriptionFlow.test.ts test/domain/promotionStatus.test.ts test/infra/paymentPostgres.test.ts` — passed: 193 test files, 2,521 tests; 14 files and 115 tests skipped. The package script forwarded the paths in a way that ran the full API Vitest suite. The PostgreSQL integration file was among the skipped files because no local database was provisioned.
- `SLAX_API_CONFIG=deploy/cloudflare/api.toml.example HYPERDRIVE_DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unused LOGS_DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unused WRANGLER_SEND_METRICS=false pnpm api -- gen:all` — passed. Prisma clients, Worker runtime types, and backend registrations generated successfully using the public example config and unreachable placeholder database URLs. No generated-code diff remained; `worker-configuration.d.ts` has only the intended removal of the obsolete mode binding.
- `pnpm --filter slax-reader-backend typecheck` — passed.
- `pnpm --filter slax-reader-backend lint` — passed with 344 warnings and zero errors.
- `node /Users/daguang/project/slax-reader/node_modules/@fission-ai/openspec/bin/openspec.js validate --all --strict` — passed: 79 items, zero failures.

## Running-environment gaps

The changed Worker HTTP callback and queue deployment have not been exercised in a deployed environment. An isolated Worker configuration with signing secrets and local backing services was not provisioned, and this task does not deploy Workers or issue live Stripe operations. Signed event fixtures and mocked external clients cover admission and payment dispatch in the focused regression suite. The operator must deploy the change through the normal release workflow; existing parked jobs are not automatically replayed.

The SQL fixture uses PGlite for real SQL execution. It does not simulate concurrent PostgreSQL sessions; production advisory locking was reviewed against `SubscriptionRepo.paymentTransaction`.

## Local review

- Bugs: traced callback admission, consumer dispatch, test/live operation recovery, reward keys, cancellation, and SQL ledger projection. Recovery keeps canonical invoice keys so subsequent event delivery cannot grant the same invoice again.
- Security: reviewed signature/account handling, retained collection/owner and user/customer checks, and acceptance of signed test/live events without a mode admission gate. Production credentials and customer-specific SQL are excluded from the patch.
- Compliance: matched the diff to `remove-stripe-reader-event-gate`, recorded the owner's explicit scope approval, kept generated runtime output owned by its generator and the environment binding declaration manually maintained as documented in that file, and declared the Worker runtime verification gap. The change affects API internals and its deployment documentation; no CLI, Extension, or Mobile version change is required.

No Important findings remain in the reviewed runtime diff. The post-merge archive task remains pending until the task pull request is merged.

## Previous backend comparison

Reviewed `/Users/daguang/project/slax_reader_backend/src/domain/subscription.ts` and its subscription orchestrator. The prior callback verifies the signature and records `eventRes.livemode`; it does not reject test-mode events. The prior consumer dispatches stored events without a deployment-mode check. The updated implementation preserves that behavior while retaining the current durable inbox and grant ledger.
