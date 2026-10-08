# Implementation verification

Change: `merge-triggered-api-deploy`.

## Offline checks

- `node --test tooling/api-release.test.mjs`: 12 tests passed, covering eligibility, private fetch/schema, currency, command sequencing, credential scope, timeout/cancellation, owned access cleanup, temporary storage, encoded/private sentinel exclusion and YAML contracts. The added three-environment layout test verifies only `api/releases.json` and the selected `api/<environment>.toml` are fetched at the pinned revision.
- API Vitest `test/script/deployPaths.test.ts` and `test/script/releaseCheck.test.ts`: 13 tests passed. The new preflight test exercises account/Worker mismatch, absent Edge/database bindings and explicit named-environment selection against synthetic TOML.
- API `tsc --project tsconfig.json --noEmit`: passed.
- API ESLint over `src`, `script`, and Prisma configuration files: passed with 0 errors and 336 existing warnings; the changed deployment scripts have no lint findings.
- `node --test tooling/pnpm-command.test.mjs`: 2 tests passed.
- `openspec validate --all --strict`: 18 items passed, 0 failures.
- Whitespace checks over the task's tracked diff: passed.

The installed pnpm is 11.2.2 rather than the project's 11.25.0. Automatic download failed because network/DNS access is unavailable. API validation therefore used the already installed local ESLint, TypeScript and Vitest binaries. OpenSpec also passed through `pnpm --pm-on-fail=ignore exec openspec validate --all --strict`. No dependency versions or lockfiles were changed.

A broader existing `tooling/app-command.test.mjs` run had three dispatcher cases fail or time out while resolving the pinned pnpm version. The isolated pnpm invocation tests passed. This is an unresolved local prerequisite for that broader suite, rather than evidence that a complete workspace check passed.

## Local review

The review follows `REVIEW.md`, with the change-id selected by matching the deployment diff to this active proposal and spec.

- **Bugs:** checked branch/environment derivation, merged checkout, reusable-event isolation, stale retries, shared beta/prod locking, validation-before-mutation, all migration stop paths, incomplete setup, bounded readiness and cleanup ownership. Fixed superseded-return cleanup failure handling, successful-on-timeout child exits and firewall cleanup's known-ID lookup. No Important findings remain.
- **Security:** checked private repository/immutable revision proof, contained declarative files, credential/key/hook rejection, account and identity consistency, stage-only public output, encoded/workflow-command injection tests, child environment allowlisting and temporary-file cleanup. Narrowed each Prisma migration to its own database Secret and isolated Wrangler logs/caches/generated files. No Important findings remain.
- **Compliance:** checked the implementation against proposal/design and every delta requirement. Private fetch uses authenticated Contents API data files instead of a clone/helper; the design records this implementation choice. Existing Worker/runtime behavior, SQL history and schemas are unchanged. The prepared PR description targets `dev` and links this change. No Important implementation findings remain.

## Remaining external verification

Local GitHub CLI network checks remain unavailable: Git push fails DNS resolution, and a connectivity check using a current GitHub DNS result also cannot connect. The GitHub connector can read the public source repository, but creating the reviewed tree returns `403 Resource not accessible by integration`. The branch/PR has not been published. The prepared PR description targets `dev` and includes `OpenSpec: merge-triggered-api-deploy`.

The operator has selected the private configuration repository and explicitly requested migration of the three legacy native TOML files. Repository access returns 404 through the current connector; an SSH clone to the requested local location also fails DNS resolution. The private repository's visibility, existing contents and history remain unverified, and it has not been cloned or updated.

At the operator's request, the three legacy native TOML files and deployment override data were processed locally into an independent protected staging directory outside the public monorepo. The conversion removes local environment sections, supplies explicit Edge identities and existing Edge routes, and preserves original resource bindings and base compatibility settings. All three converted files pass native `readConfig`/`checkRemote` validation. No credential files or live services were accessed; no configuration contents were displayed. A comparison of 39 real installation identifiers against the added public diff found zero matches.

The staged manifest intentionally blocks deployment until production account IDs, both firewall zone IDs and a valid test Tunnel hostname are supplied privately. The legacy production Edge/Browser compatibility overrides also differ from the shared native base and require review before the first release. Staging is not a fabricated repository checkout or a deployable placeholder configuration. Merge it into the verified private checkout only after reviewing that repository's instructions/current files, completing the metadata and pinning a reviewed private commit. Keep the repository selector in Actions Secrets rather than public source.

The implementation acceptance tests use synthetic configuration. The separately authorized local legacy-file migration did not access cloud credentials, databases, migrations or Worker publication. Operator-managed private manifest/Secrets and GitHub Environment branch policies must be ready before the implementation PR merges. Cloud permissions, Access routing and GitHub runner behavior require the first authorized merged release; offline tests do not claim that live acceptance occurred.
