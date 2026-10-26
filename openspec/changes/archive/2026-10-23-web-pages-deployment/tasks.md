# Tasks

## 1. Release input and publication helper

- [x] 1.1 Add `tooling/web-pages-deploy.mjs` with fixed branch/profile mapping and strict `WEB_BUILD_CONFIG` validation using the existing Web schema; verify fixture tests reject missing/unknown/malformed inputs and prevent credential or process-setting injection.
- [x] 1.2 Add read-only Pages project inspection with bounded requests and safe diagnostics; verify mocked responses cover account/project errors, required bindings, and repository `main` targeting a remote `master` production branch without changing project settings.
- [x] 1.3 Add isolated staging of the Nuxt Pages output and explicit invocation of the pinned Wrangler from outside repository config discovery; verify a fixture with conflicting tracked/generated/redirected configs excludes them from deployment while preserving `_worker.js`, chunks, WASM, routing, headers, and redirects.
- [x] 1.4 Handle child exit status, final deployment failure, interruption, and temporary-file cleanup without leaking credentials; verify subprocess fixtures exercise successful publication, rejected uploads, final-status failure, and cleanup.

## 2. GitHub Actions integration

- [x] 2.1 Add `.github/workflows/web-deploy.yml` with merged-PR guards, immutable source checkout, Environment selection, explicit Variables/Secret references, pinned workspace installation, and the existing `pnpm web -- build` path; verify all three mappings and absence of release tokens during installation/build through workflow contract tests.
- [x] 2.2 Add environment-scoped non-cancelling concurrency and a scoped freshness check before upload; verify tests cover superseded Web changes, unrelated branch updates, reruns, and agreement between trigger and freshness path scopes.
- [x] 2.3 Register `tooling/web-pages-deploy.test.mjs` in existing root test commands and frontend CI path/check coverage; verify `pnpm test:preflight` and the focused release regressions run without cloud credentials.

## 3. Operator documentation and verification

- [x] 3.1 Add `docs/web/deployment.md` and link it from `docs/web/development.md`, documenting `dev`/`beta`/`prod`, three Variables and one Secret, placeholder JSON, Pages token permissions, preserved runtime bindings, automatic production-branch lookup, duplicate-build prevention, and rollback; verify no live IDs, project names, or credentials appear in tracked examples.
- [x] 3.2 Run `pnpm install --frozen-lockfile`, `pnpm test:preflight`, `pnpm --filter @slax-reader/contracts typecheck`, `pnpm --filter @slax-reader/selection typecheck`, `pnpm web -- typecheck`, `pnpm web -- test`, and `pnpm web -- build` using synthetic public configuration; verify the actual sanitized build with the release helper's offline publication fixture and report any unverified live behavior separately.
- [x] 3.3 Run `openspec validate --all --strict`, workflow syntax checks available in the repository/toolchain, and `git diff --check`; perform the Bugs, Security, and Compliance review from `REVIEW.md`, resolve Important findings, then commit/push `ci/web-pages-deployment` and open a PR targeting `dev` with `OpenSpec: web-pages-deployment` and an explicit first-live-deployment limitation.

## 4. Remove the compatibility preflight gate

- [x] 4.1 Remove only the helper's compatibility-date/flag rejection and update the operator guide; verify regression cases accept absent, old, and explicitly different settings without mutation while retaining binding checks.
- [x] 4.2 Exercise the offline publication subprocess with those compatibility settings and confirm upload/final-status failures still propagate; run root tooling tests, Web build and actual-output smoke tests, strict OpenSpec validation, and the local three-pass review before pushing the isolated repair branch.
