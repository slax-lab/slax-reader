## 1. Migration baseline

- [x] 1.1 Record the source repository URL, source commit, inspection date, and read-only rule in `openspec/changes/integrate-slax-reader-web-extension/design.md`.
- [x] 1.2 Inventory the Web app, Extension app, shared packages, configs, scripts, docs, generated files, local-only files, and backend integration points.
- [x] 1.3 Define the target mapping and explicitly exclude backend code, secrets, dependency directories, build outputs, caches, and local state.

## 2. Web application import

- [x] 2.1 Copy the tracked DWeb application into `apps/web` without copying Git metadata or local-only files.
- [x] 2.2 Move or adapt Web-specific configuration and documentation so it stays below `apps/web` or `docs/web`.
- [x] 2.3 Make the Web package resolve the new workspace package locations without changing product behavior.
- [x] 2.4 Run Web prepare, type-check, tests, and build. Backend-connected smoke testing is tracked separately in final verification task 6.5.

## 3. Extension application import

- [x] 3.1 Copy the tracked browser extension into `apps/extension` without copying Git metadata or local-only files.
- [x] 3.2 Keep manifest, entrypoints, assets, vendor shims, and Extension-specific build configuration below `apps/extension`.
- [x] 3.3 Make the Extension package resolve the new workspace package locations without changing product behavior.
- [x] 3.4 Run Extension prepare, compile, tests, build, zip, and a Chromium load smoke test.

## 4. Shared package import

- [x] 4.1 Split the source type surface into `packages/contracts` for API/domain/event/route contracts and `packages/frontend-types` for browser-only/local-first implementation types.
- [x] 4.2 Merge the source `commons/types-pro` exports and augmentations into the package matching each type's boundary; remove the overlapping `packages/types` package.
- [x] 4.3 Rename the source `commons/utils` package to `packages/frontend-utils` and preserve its subpath exports.
- [x] 4.4 Copy `commons/selection` to `packages/selection` and preserve its adapter and build boundaries.
- [x] 4.5 Update workspace globs, package names, and imports only as needed for the new locations; do not create a catch-all package.

## 5. Onboarding and root hygiene

- [x] 5.1 Add focused READMEs for `apps/web`, `apps/extension`, and each migrated shared package.
- [x] 5.2 Keep Web and Extension development and contribution guidance under `docs/web` and `docs/extension`.
- [x] 5.3 Add minimal root commands for Web and Extension development, testing, and builds while keeping app scripts authoritative.
- [x] 5.4 Confirm the root contains no copied application source, app-specific long-form docs, secrets, generated local state, or dependency directories.

## 6. Final verification

- [x] 6.1 Confirm the source `slax_reader` repository remains clean and unchanged.
- [x] 6.2 Run workspace install and all applicable checks from the v2 worktree. Full CI installation and frontend/API checks pass; the host-specific macOS Xcode license / `better-sqlite3` follow-up remains documented separately and is not treated as a CI failure.
- [x] 6.3 Run `openspec validate --all --strict`.
- [x] 6.4 Summarize known limitations, especially the configured-backend environment requirement, for reviewers and new contributors.
- [x] 6.5 Define the post-merge backend acceptance checklist for Web and Extension (login, bookmarks, article reading, highlights/comments, and the extension bridge) and record that real development-backend execution is a follow-up once the backend environment and credentials are available. This migration PR does not claim those runtime results.

## Phase 2 checkpoint

Web and its four focused shared dependencies have been imported on
`feat/import-slax-reader-web`. Web prepare/typecheck, selection build/typecheck,
1754 Web tests and the Nuxt build pass. Task 2.4 is complete for these checks.
At the user's request, backend-connected smoke testing is documented as a post-merge
follow-up in task 6.5 because this migration does not have a configured development
backend environment or credentials. The checklist remains required for runtime acceptance
but is not claimed as completed by this repository-integration PR.
The full workspace install and CI checks pass on the hosted Linux runner. The host-specific
macOS Xcode license / `better-sqlite3` native installation issue remains a separate follow-up
and does not invalidate the hosted CI result.
The Web stage was merged into the integration branch at `f100570`; Extension migration
continues in `feat/import-slax-reader-extension`, created from that commit. See the application guides for the documented evidence.


## Phase 3 checkpoint

Extension import tasks 3.1–3.4, workspace linking task 4.5, app/package README task 5.1,
and root command task 5.3 are complete on `feat/import-slax-reader-extension`.
WXT prepare, vue-tsc, 14 unit tests, Chrome build/zip, vendor prebuild and Chromium loading
pass. The 17-scenario offscreen suite also passes using local fixtures. Runtime Extension
source remains the pinned snapshot. Remaining work is contributor-wide onboarding and
final verification, including the explicitly deferred native install issue and real backend
integration. See the application guides for validation scope and source-fidelity evidence.


## Phase 4 checkpoint

Contributor-facing onboarding is now under `docs/web` and `docs/extension`. It separates no-install participation from local Web and
Extension development, documents GitHub web editing and issue feedback, links the translation
files, and records the external backend, absent PR preview/demo, and deferred native install
limitations. Root navigation points to these entries while application source remains below
`apps/` and shared libraries remain below `packages/`.

## Final verification checkpoint

OpenSpec and rulesync checks pass. In the final worktree, Web prepare/type-check, Web server
type-check, 164 Web test files / 1754 tests, the Web development-profile build, Extension WXT
prepare/type-check, 4 Extension test files / 14 tests, and the Chrome MV3 build pass. The
Phase 3 Chromium load and offscreen suites remain the recorded Extension browser evidence.
A manual zip of the final MV3 directory was structurally verified because the sandbox could
not rewrite the generated WXT directory during the final rerun. `apps/web` now builds
selection before `typecheck`, so that command works from a fresh linked workspace.

The hosted CI full-install and frontend/API checks pass. The earlier macOS native
`better-sqlite3` installation issue remains a host-specific follow-up. Real development
backend acceptance is documented as the post-merge follow-up from task 6.5 and is not
represented as a completed runtime smoke test here.
