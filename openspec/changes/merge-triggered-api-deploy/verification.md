# Implementation verification

Change: `merge-triggered-api-deploy`.

## Offline checks

- `node --test tooling/api-release.test.mjs`: 13 tests passed, covering eligibility, private fetch/schema, currency, command sequencing, credential scope, timeout/cancellation, owned access cleanup, temporary storage, encoded/private sentinel exclusion and YAML contracts. Default-branch resolution tests reject malformed branch/revision metadata, verify one fixed SHA despite branch movement between file requests, and verify a retry resolves the newer tip. The three-environment layout test verifies only `api/releases.json` and the selected `api/<environment>.toml` are fetched at the resolved revision.
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

The operator has selected the private configuration repository and explicitly requested migration of the three legacy native TOML files. The operator supplied a separate local HTTPS checkout, which was empty with an unborn default branch. Its local instructions and existing contents were checked before preparing a task branch. GitHub metadata remains unavailable through the CLI/network and returns 404 through the current connector, so authenticated remote visibility and publication remain unverified.

At the operator's request, the three legacy native TOML files and deployment override data were processed locally into an independent protected staging directory outside the public monorepo. The conversion removes local environment sections, supplies explicit Edge identities and existing Edge routes, and preserves original resource bindings and base compatibility settings. All three converted files pass native `readConfig`/`checkRemote` validation. No credential files or live services were accessed; no configuration contents were displayed. A comparison of 39 real installation identifiers against the added public diff found zero matches.

The converted files are now installed in the independent local checkout under the conventional `api/` layout, together with an English operator README and credential-file ignore rules. All three actual-checkout configurations passed native validation, release-mode/Worker identity checks, required resource-binding checks, and comparisons preserving original database/storage bindings, Durable Object migrations and base compatibility settings. The copied bytes matched the separately prepared migration. These private migration checks emitted only structural results; no configuration values were displayed or copied into public source.

The manifest intentionally blocks all deployment environments until production account IDs, both firewall zone IDs and a valid test Tunnel hostname are supplied privately; that rejection was verified. The legacy production Edge/Browser compatibility overrides also differ from the shared native base and require review before the first release. The operator must complete and review this local configuration, verify the remote repository is private, push its reviewed commit and merge the complete reviewed configuration into its default branch for automatic revision resolution. The local migration is not a deployable placeholder configuration. Keep the repository selector in Actions Secrets rather than public source.

The implementation acceptance tests use synthetic configuration. The separately authorized local legacy-file migration did not access cloud credentials, databases, migrations or Worker publication. Operator-managed private manifest/Secrets and GitHub Environment branch policies must be ready before the implementation PR merges. Cloud permissions, Access routing and GitHub runner behavior require the first authorized merged release; offline tests do not claim that live acceptance occurred.

## Configuration resolution and contribution-policy follow-up

At the operator's explicit request, the manually maintained configuration-ref Secret has been removed from workflows, selector validation and operator instructions. Each release now verifies the private repository, resolves its default branch once and uses that SHA for both file requests. Branch/revision values are masked internally and remain absent from public diagnostics. A current-run retry can pick up a newer reviewed configuration tip without changing an Actions Secret.

The independent configuration checkout now carries canonical agent instructions and the requested additional entry file, plus a `Secret scan` PR workflow. The workflow pins checkout/Python actions and Gitleaks v8.30.1, verifies the official Linux archive SHA-256, uses read-only permissions and no deployment Secrets, checks every introduced commit, overrides repository ignore configuration and inline allow comments, captures raw diagnostics and removes temporary files without reports/artifacts. Its additional Python guard rejects credential file paths before reading blobs and rejects credential-bearing TOML/JSON while accepting ordinary infrastructure metadata. The operator must require `Secret scan` through branch protection and review policy changes; the workflow does not create that protection.

Seven synthetic Python tests passed, including an added-then-removed credential, forbidden staged files, embedded credential fields/keys/URLs, valid metadata, invalid configuration, and generic-output behavior for scanner success/findings/errors. The staged credential guard passed. Bash syntax and YAML contracts for PR-only triggering, full history, read-only permissions, no Secrets/artifacts, tool pinning and cleanup passed. Local Python 3.12 was used because the default Python is 3.9; CI explicitly installs Python 3.12.

The real Gitleaks CLI download was attempted over HTTPS but failed GitHub DNS resolution. Its version and archive checksum were verified through the official release metadata; local tests exercise the wrapper with a synthetic scanner. Do not treat these results as a completed real Gitleaks scan or a live GitHub check.

The follow-up Bugs/Security/Compliance review checked snapshot consistency/retry semantics, removal of the old selector throughout workflows/docs, scanner commit-range coverage (including merge diffs), staged blob inspection, path/argument validation, credential-file rejection before content access, generated fixtures, failure/cancellation cleanup and diagnostic suppression. No Important implementation findings remain; runtime scanner execution, repository branch protection and publication remain external prerequisites.
