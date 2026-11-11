# Validation

## Scope and approval

The user approved the native SQL proposal and requested implementation and a PR on 2026-11-11. The implementation changes only API share-setting persistence and its tests. It preserves ownership/moderation admission, visitor rights, existing share identity/code/time, response fields and vector-maintenance dispatch. No schema, dependency, shared contract or shipped client package changes were made.

Version decision: API-only implementation with unchanged client contracts; Web/API do not use package-version increments under `docs/release/VERSIONING.md`. CLI, Extension and Mobile artifacts are unaffected, so no application-version decision is required.

## Automated checks

- Red: the new service/repository regressions failed against the old implementation (8 failures, 4 passes). The stale-result service case hit the old duplicate-create path; repository cases required the new native save operation.
- Green: `pnpm --dir apps/api exec vitest run test/flow/bookmarkUid` passed 97 tests across 8 files.
- `pnpm api -- test`: 3850 passed, 118 skipped; 244 files passed and 15 skipped. An initial run identified the old write-method mock in `vectorMaintenancePublication.test.ts`; it was updated and its write-before-dispatch assertion retained before the passing full run.
- `pnpm api -- lint`: passed with 0 errors and 343 existing warnings.
- `pnpm api -- typecheck`: passed.
- `HYPERDRIVE_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/unused LOGS_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/unused SLAX_API_CONFIG=deploy/cloudflare/api.toml.example pnpm api -- gen:all`: passed. Generated artifacts have no tracked diff.
- `pnpm exec openspec validate --all --strict`: 124 items passed, 0 failed.
- `git diff --check`: passed.

The PostgreSQL-backed repository tests execute the production tagged SQL through a small PGlite adapter. They cover immediate off/on saves, retained identity/code/time, disabled-share reactivation, owner separation and parameter binding. PGlite serializes its single connection; real concurrent HTTP requests are covered below.

## Running environment

The `SHARE_SMOKE=1` mode of `pnpm api -- test:http` runs the actual Edge/Core handlers against a new disposable PostgreSQL 17 container and isolated local D1/R2/KV state. All repository PostgreSQL, logs and D1 migrations completed successfully. The local diagnostic wrapper delegates requests to the actual Core entrypoint. A temporary launcher adapted this host's OrbStack socket and cached pinned pnpm CLI to the harness's isolated environment; it did not use operator credentials or remote bindings.

The dedicated share smoke run passed:

- 24 sequential HTTP saves: three immediate off/on cycles for each of four fixtures (new share, article with a comment, existing legacy code, and existing disabled share). Every save returned HTTP/envelope 200 and the requested settings, with exactly one stored share row and all stored flags correct.
- 8 concurrent HTTP first saves for one new owner/bookmark pair: all returned success and exactly one share row remained.
- Existing ID, UUID, creation time and share code remained unchanged across updates; a legacy-ID initialization generated a nonempty code, which a subsequent UID update retained.
- The existing comment-statistics trigger cleared the count/first comment when hidden and restored both when reopened. The fixture assertion was corrected after inspecting the latest migration: hiding preserves the stats row with zero count rather than deleting it.

The smoke fixture also emits expected vector-dispatch errors because it does not bind the vector-maintenance Workflow. That external Workflow was not exercised by this run; the passing unit suite verifies dispatch after the successful share write.

## Review

An independent reviewer completed the Bugs, Security and Compliance passes against `origin/dev` and this change's artifacts. No Important findings remain. The reviewer verified the conflict index, database defaults, share-trigger compatibility, retained identity/code/time, parameterization and existing maintenance dispatch. The old mock and the single-connection concurrency limitation were addressed as described above.

## Human hands-on acceptance

Accepted by the requesting user on 2026-11-11 (Asia/Shanghai), before opening the PR. In the agent-prepared disposable Web/Edge/Core environment, the user disabled Show highlights and immediately enabled it again after the request completed. The user explicitly confirmed manual acceptance with no error toast. The article initially had no explicit share record; the final visible checkbox was checked. No adjustments were requested after acceptance.

The acceptance entry at `http://localhost:3012/` used only a synthetic fixture session and opened the actual reader on port 3011. The temporary environment is cleaned up after acceptance.

## Limits

- No cloud deployment or remote migration was performed. The original cloud Hyperdrive cache configuration and cloud cache-hit behavior remain unverified.
- Read-only share configuration/access queries still use the existing connections; this patch removes the existence-read dependency from saving, rather than changing cache policy.
- Frontend duplicate error toasts and visitor annotation permissions are unchanged.
- The full API suite's 118 existing skipped tests were not enabled by this change.
