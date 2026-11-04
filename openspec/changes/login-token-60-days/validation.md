# Validation

Date: 2026-11-04. Branch: `fix/login-token-60-days`, created from `origin/dev` in a new managed worktree. The original checkout and its unrelated mobile changes were not modified.

## Automated checks

- `pnpm install --frozen-lockfile --ignore-scripts`: passed without dependency or lockfile changes.
- `HYPERDRIVE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:1/generation_only LOGS_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:1/logs_generation_only pnpm api -- gen:model`: passed using generation-only loopback placeholders, without a database connection or migration.
- `pnpm api -- test test/script/deployPaths.test.ts test/utils/loginSecurity.test.ts test/utils/auth.test.ts`: 33 tests passed, covering configuration projection and existing identity/audience/signature checks.
- `pnpm api -- test`: 200 files passed and 14 skipped; 2,829 tests passed and 113 skipped. Optional integration suites retain their existing skips.
- `pnpm api -- lint`: zero errors; 344 existing warnings in unchanged source.
- `pnpm api -- typecheck`: passed, including shared contracts.
- `pnpm exec openspec validate --all --strict`: 100 items passed, zero failures. Existing informational messages concern unrelated requirements.
- `git diff --check`: passed.

## Running-environment exercise

Ran `pnpm --filter slax-reader-backend exec tsx /tmp/slax-login-token-smoke.mts`, an ephemeral loopback HTTP harness using the actual `Auth.sign` and `Auth.verify` implementation, the checked-in public template, and a synthetic local signing secret. No real account, provider credential, private configuration, or raw JWT was printed or accessed.

The harness confirmed that all four Worker configuration projections carry `JWT_EXPIRES = "5184000"`. Both login-style and renewal-style calls to the shared production signer yielded `exp - iat = 5184000` with the existing Reader audience and identity. Seven sequential HTTP requests exercised the production verifier with an isolated simulated Date:

| Token / verification time | HTTP result |
| --- | --- |
| New token, 30 days after issuance | 200 |
| New token, one second before its 60-day expiration | 200 |
| New token, exactly at its 60-day expiration | 401 |
| New token, one second after its 60-day expiration | 401 |
| Previously issued 30-day token, one second before its original expiration | 200 |
| Previously issued 30-day token, exactly at its original expiration | 401 |
| Previously issued 30-day token, one second after its original expiration | 401 |

The harness closed its owned server after the exercise. No permanent test was added for this two-line configuration edit; existing tests and the scoped runtime exercise cover the affected behavior.

## Scope and verification limits

- The real OAuth login and database-backed renewal HTTP endpoints were not exercised; the harness exercised their shared production signer and verifier, not a deployed Worker router or live account.
- No private configuration was read or changed, and no remote deployment occurred. The intended environment's private `[vars].JWT_EXPIRES` must be updated to `"5184000"` before deployment; this public-template PR alone cannot change live issuance.
- Previously signed JWTs keep their original expiration. Client refresh schedules, Web cookie persistence and PowerSync credentials have no source changes.
- No visible UI surface or client package output changes. Human visual acceptance and CLI/Extension/Mobile version increments are not applicable; this is an API configuration change under `docs/release/VERSIONING.md`.

## Local pre-push review

An independent read-only reviewer completed the Bugs, Security and Compliance passes against `REVIEW.md`, the implementation diff and all change artifacts. Result: no Important findings and no Nits. The reviewer confirmed the 60-day arithmetic, unchanged signed-expiry enforcement, the explicit private-configuration rollout prerequisite, and the absence of client package/version or UI acceptance obligations.
