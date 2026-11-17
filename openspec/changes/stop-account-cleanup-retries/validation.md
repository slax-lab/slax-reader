# Validation

Date: 2026-11-16. Branch: `feat/fix-error-cronjob`, based on `origin/dev` at `155f91352233987170899353f4c7ea8565b1e5e4`. This is an API behavior change with no visible UI, schema, dependency, configuration, or client-contract changes. Web and API do not use package-version increments under `docs/release/VERSIONING.md`.

## Running-environment exercise

Ran the actual Workerd runtime through Miniflare in `apps/api/test/utils/accountCleanup.runtime.test.ts`. The Worker bundles the real `UserDeletionConsumer`, generated queue dispatcher, and generated cron dispatcher. Domain cleanup and unrelated jobs use isolated synthetic fixtures; no database, provider, production account, or real Workflow creation is involved.

- An HTTP-driven fixture invokes the beta queue handler with two deliveries. Cleanup for user 1 records one simulated vector admission and throws; cleanup for user 2 succeeds. Observed cleanup attempts `[1, 2]`, acknowledgements `[1, 2]`, no retry calls, and one simulated admission. The real consumer records the failure and continues through the generated dispatcher.
- Three subsequent HTTP-driven schedule invocations use the former five-minute schedule and scheduled times 0, 300000, and 600000. Attempts and simulated admissions remain unchanged. `recoverDeletedUsers` never runs; import progress, payment recovery, RSS refresh, podcast sweep, and YouTube sweep still run.
- The removed recovery job has no registration or runtime source. Old account state and expired completion-marker state therefore have no scheduled reader capable of admitting cleanup.

This exercises JavaScript handlers in Workerd, not Cloudflare's live Queue acknowledgement transport or its hosted scheduler. It does not claim an exactly-once transport guarantee. Unit regression exercises both production and beta queue names. The account-revocation suite covers active-account checks, transactional tombstones/key revocation, and credential rejection; the revocation implementation is unchanged.

## Automated checks

Commands run from the repository root with `SLAX_API_SKIP_DOTENV=1`, metrics disabled, and automatic dotenv loading disabled where applicable. Prisma generation used dummy localhost generation-only URLs, not a production connection.

- `pnpm api -- test test/domain/userDeletionRecovery.test.ts test/utils/accountRevocation.test.ts test/di/cronjob.test.ts test/script/cronDispatch.test.ts test/script/layerArchitecture.test.ts test/utils/accountCleanup.runtime.test.ts`: **61 tests passed across 6 files**, including the running Workerd exercise and all 35 architecture checks.
- `pnpm api -- typecheck`: **passed**, including contracts typecheck.
- `pnpm api -- lint`: **passed**, zero errors; 346 existing warnings across the API.
- API Prettier check on the changed consumer and new/updated cleanup tests: **passed**.
- `openspec validate --all --strict`: **137 items passed**, zero failures.
- `git diff --check` for the task paths: **passed**.
- `pnpm api -- gen:all`: Prisma clients and Worker runtime types generated, then the generator failed while removing its temporary directory with `EPERM: operation not permitted, rmdir`. A separate create/remove probe reproduced the directory-removal restriction. No generator was patched and no generated registration was hand edited.
- Ran the remaining official generators separately: `pnpm api -- gen:cron`, `gen:consumer`, `gen:router`, `gen:di`, followed by API Prettier. All **passed**. Repeated these commands and compared SHA-256 hashes of every generated registration file: **identical**. The final generated diff removes only `UserDeletionJob` and reorders its retained service import; consumer, router, and formatted Worker types match the base.
- `pnpm api -- build`: all four Workers reached Wrangler `--dry-run: exiting now`, with bundles produced. The wrapper then failed removing its temporary build directory with the same `EPERM`; this is **not a passing end-to-end build command**. No deployment occurred.
- `pnpm api -- test --maxWorkers=2`: **4142 passed, 87 failed, 161 skipped** across 290 files (263 passed, 7 failed, 20 skipped), plus one Vitest worker RPC timeout. Failures are in the untouched deployment/setup/environment-file/Worker-type tooling suites: `rootDeployment`, `setupBackend`, `rootCommands`, `setupApi`, `devLocal`, `workerTypesSecurity`, and `envFiles`. Their fixtures hit the filesystem restrictions on directory removal and protected environment-file paths. The complete suite is **not green locally**. The earlier stale contracts workspace link was corrected before this final run; Newsletter tests and all task-focused tests passed. No secret-file restriction was bypassed.
- The full run also passed all **3 WebSocket revocation tests**, including explicit revocation of web and extension sockets and fail-closed behavior when active-account checks fail.

## Verification boundaries

- The complete generation/build commands require an unrestricted filesystem runner to verify successful cleanup and exit. They are not claimed as passing locally. CI runs these exact commands on Linux.
- No live deployment, mutation of existing Cloudflare Workflows, cancellation, queue replay, database cleanup, or production-data test was performed. Production cost reduction cannot be measured before the change reaches both beta and production through the normal human-controlled release process.
- Provider-side vector deletion and the actual failing database operation were not replayed. Failure injection isolates the acknowledgement/replay policy; the original database failure remains deliberately unfixed under the approved terminal-failure policy.
- Account data can remain after a failed attempt. Existing account revocation remains mandatory, while full physical erasure is not guaranteed. Already-created Workflows can finish their finite work and retained state can continue storage billing.

## Local pre-push review

Reviewed the final task diff using all three passes in `REVIEW.md`, matched to `OpenSpec: stop-account-cleanup-retries`.

- **Bugs:** No Important findings. The consumer resolves after a handled cleanup error, so the existing per-message dispatcher acknowledges it and continues. Both queue aliases remain registered. Only the deleted-account recovery job is removed; unrelated five-minute jobs remain. The service still propagates failures to its direct callers. Transport-level redelivery and incomplete cleanup are explicit limits, not an exactly-once promise.
- **Security:** No Important findings. Tombstones, API-key revocation, session revocation, active-account guards, and diagnostic download checks are untouched. No new network or persistence path, secrets, dependency, migration, or authorization bypass is introduced. Residual-data retention is the requester's explicit trade-off and is documented.
- **Compliance:** No Important findings. Proposal approval and explicit branch choice are recorded in `proposal.md`; implementation matches the terminal-failure delta. Naming, placement, DI conventions, and handler-to-domain call chains remain intact. No new production mechanism or abstraction was added. The architecture baseline only removes three obsolete entries for the deleted file; no suppression is added. Generated files come from generators. Runtime evidence and incomplete local commands are explicitly distinguished above. No UI acceptance applies.

The PR targets `dev`, follows the repository template, and carries the OpenSpec ID and this evidence trail. Merge, deployment, and post-merge OpenSpec archival remain human-controlled.
