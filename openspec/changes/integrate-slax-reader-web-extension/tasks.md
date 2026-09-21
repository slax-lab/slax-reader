## 1. Migration baseline

- [x] 1.1 Record the source repository URL, source commit, inspection date, and read-only rule in `docs/migrations/slax-reader-web-extension.md`.
- [x] 1.2 Inventory the Web app, Extension app, shared packages, configs, scripts, docs, generated files, local-only files, and backend integration points.
- [x] 1.3 Define the target mapping and explicitly exclude backend code, secrets, dependency directories, build outputs, caches, and local state.

## 2. Web application import

- [x] 2.1 Copy the tracked DWeb application into `apps/web` without copying Git metadata or local-only files.
- [x] 2.2 Move or adapt Web-specific configuration and documentation so it stays below `apps/web` or `docs/apps/web`.
- [x] 2.3 Make the Web package resolve the new workspace package locations without changing product behavior.
- [x] 2.4 Run Web prepare, type-check, tests, and build. Backend-connected smoke testing is tracked separately in final verification task 6.5.

## 3. Extension application import

- [x] 3.1 Copy the tracked browser extension into `apps/extension` without copying Git metadata or local-only files.
- [x] 3.2 Keep manifest, entrypoints, assets, vendor shims, and Extension-specific build configuration below `apps/extension`.
- [x] 3.3 Make the Extension package resolve the new workspace package locations without changing product behavior.
- [x] 3.4 Run Extension prepare, compile, tests, build, zip, and a Chromium load smoke test.

## 4. Shared package import

- [x] 4.1 Copy `commons/types` to `packages/types` and preserve its public exports.
- [x] 4.2 Copy `commons/types-pro` to `packages/types-pro` and preserve its augmentation behavior.
- [x] 4.3 Copy `commons/utils` to `packages/utils` and preserve its subpath exports.
- [x] 4.4 Copy `commons/selection` to `packages/selection` and preserve its adapter and build boundaries.
- [x] 4.5 Update workspace globs, package names, and imports only as needed for the new locations; do not create a catch-all package.

## 5. Onboarding and root hygiene

- [x] 5.1 Add focused READMEs for `apps/web`, `apps/extension`, and each migrated shared package.
- [ ] 5.2 Move long-form development, contribution, architecture, and migration guidance into `docs/` subdirectories.
- [x] 5.3 Add minimal root commands for Web and Extension development, testing, and builds while keeping app scripts authoritative.
- [ ] 5.4 Confirm the root contains no copied application source, app-specific long-form docs, secrets, generated local state, or dependency directories.

## 6. Final verification

- [ ] 6.1 Confirm the source `slax_reader` repository remains clean and unchanged.
- [ ] 6.2 Run workspace install and all applicable checks from the v2 worktree. Revisit the macOS Xcode license / `better-sqlite3` native installation issue after all migration stages, as requested by the user; do not count installation with scripts disabled as a full-install pass.
- [ ] 6.3 Run `openspec validate --all --strict`.
- [ ] 6.4 Summarize known limitations, especially the external backend requirement, for reviewers and new contributors.
- [ ] 6.5 After all migration stages are complete, run Web and Extension against the existing development backend and verify login, bookmarks, article reading, highlights/comments, and the extension bridge. Record results before the final pull request is merged into `dev`.

## Phase 2 checkpoint

Web and its four pre-existing shared dependencies have been imported on
`feat/import-slax-reader-web`. Web prepare/typecheck, selection build/typecheck,
1754 Web tests and the Nuxt build pass. Task 2.4 is complete for these checks.
At the user's request, backend-connected smoke testing moves to task 6.5 after all
migration stages; it is not an individual stage acceptance gate. It remains required
before final integration into `dev` through a pull request.
Full installation is still blocked by the host Xcode license when `better-sqlite3`
runs its native compilation. The user deferred this separate task 6.2 issue to final
verification; it is unresolved but no longer blocks progression to the Extension stage.
The Web stage was merged into the integration branch at `f100570`; Extension migration
continues in `feat/import-slax-reader-extension`, created from that commit. See the migration record for evidence.


## Phase 3 checkpoint

Extension import tasks 3.1–3.4, workspace linking task 4.5, app/package README task 5.1,
and root command task 5.3 are complete on `feat/import-slax-reader-extension`.
WXT prepare, vue-tsc, 14 unit tests, Chrome build/zip, vendor prebuild and Chromium loading
pass. The 17-scenario offscreen suite also passes using local fixtures. Runtime Extension
source remains the pinned snapshot. Remaining work is contributor-wide onboarding and
final verification, including the explicitly deferred native install issue and real backend
integration. See the migration record for validation scope and source-fidelity evidence.
