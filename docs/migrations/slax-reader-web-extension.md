# Slax Reader Web and Extension migration baseline

## Source snapshot

- Source repository: `https://github.com/unnoo/slax_reader_frontend.git`
- Local read-only checkout inspected: `/Users/yjc/Documents/Company/slax-reader`
- Source commit: `8a983148fdd1da2f145e7797be070d3fbe8f791a`
- Inspection date: `2026-09-21`
- Source status at inspection: clean working tree on `codex/fix-ci-typecheck-env-order`
- Migration mode: snapshot import; Git history is intentionally not required for the first pass

## Target mapping

| Source path | v2 path | Reason |
| --- | --- | --- |
| `apps/slax-reader-dweb` | `apps/web` | DWeb application |
| `apps/slax-reader-extensions` | `apps/extension` | Browser extension |
| `commons/types` | `packages/contracts` | API, domain, event, and route contracts used by Web and Extension and reserved for the future backend |
| `commons/types-pro` | `packages/contracts` and `packages/frontend-types` | Split by boundary: transport contracts stay shared with backend; browser-only/local-first types stay frontend-only |
| `commons/utils` | `packages/frontend-utils` | Renamed to make its frontend-only scope explicit |
| `commons/selection` | `packages/selection` | Used by Web and Extension |
| `docs/DEVELOPMENT-DOCUMENT-*` | `docs/apps` and `docs/architecture` | Long-form onboarding and architecture material |
| `docs/HOW-TO-CONTRIBUTION-*` | `docs/contributing` | Contributor onboarding |
| migration provenance | `docs/migrations` | Traceability and migration notes |

## Observed workspace facts

The source root currently uses pnpm workspace globs for `apps/*` and `commons/*`. Both application manifests depend on four source libraries. In v2, the source type surface is split into `contracts` and `frontend-types`, and `commons/utils` is exposed as `frontend-utils`; `selection` depends on `contracts` and `frontend-utils`. The source root also contains shared configuration under `configs/`, `scripts/`, and root TypeScript/environment files; these require an explicit app-by-app placement decision during implementation rather than blind copying to the v2 root.

## Review of later source changes

After the pinned snapshot, source `develop` merged PR #1601 (`50de9f64`), which adjusts the
legacy `push.yml` environment generation and adds deployment notes for Cloudflare-only Web
configuration. v2 currently has no equivalent legacy workflow or deployment document, so this
PR is recorded as a follow-up rather than copied into the migration. When v2 adds its own CI or
deployment pipeline, it should carry over the behavior: Web-only OAuth/Turnstile values may be
empty during checks, shared and Extension variables remain required, and the temporary `.env`
must exist before dependency installation. The source repository remains unchanged.

## Exclusions

Do not copy or commit `.git`, `node_modules`, `.pnpm-store`, `.env*`, `.dev.vars`, credentials, private keys, build outputs, caches, generated local state, or backend source. Do not modify the source checkout while performing the import.

## Backend boundary

The DWeb and Extension applications continue to use their existing backend integration during the first migration. The separate `slax_reader_backend` repository is out of scope and remains untouched. Local development documentation may describe required variable names and a backend checkout path, but must never include secret values.

## Phase 2: Web snapshot import

Work branch: `feat/import-slax-reader-web`, based on `feat/integrate-slax-reader-web-extension`.
Every stage branches from and merges into the integration branch. The final integration into
`dev` must use a pull request; there is no direct push to `dev`.

The source checkout subsequently advanced to `ddcf9bc68931791ebc0682d3ed5739c73fc872a7`.
This import deliberately uses the previously agreed immutable `8a983148` Git tree rather than
copying the changing working directory. No branch, file, or dependency installation in the
source checkout is touched.

### Inventory and placement

| Source content | Phase 2 disposition |
| --- | --- |
| DWeb: 596 tracked files | Import into `apps/web`, retaining Nuxt app/server/content/tests |
| Extension: 189 tracked files | Leave for the next stage; `apps/extension` stays a placeholder |
| types: 8; types-pro: 6; utils: 25; selection: 20 tracked files | Import into four v2 packages as Web prerequisites; split `types-pro` by shared-contract versus frontend-only responsibility and rename `utils` to `frontend-utils` |
| `configs/env.ts`, `configs/backend-path.ts` | `apps/web/config`, resolve environment files under `apps/web` |
| `env.schema.ts` | `apps/web/env.schema.ts`, schema definitions only |
| root UnoCSS and ESLint bases | `apps/web/config/uno.base.ts` and `eslint.base.ts` |
| root TypeScript base used by types-pro | absorbed into `packages/contracts` and `packages/frontend-types` as needed |
| root dependencies used implicitly by Web | Declare in the app/library that uses them; do not add app dependencies at v2 root |
| source pnpm lock | Merge locked entries with v2, adapt importer paths and pnpm 11 override specifiers |
| `scripts/start.script.ts`, `configs/cmd.ts` | Do not import interactive launcher; use small root delegating commands |
| source root `README*`, deployment and contribution guides | Do not overwrite v2; contribution consolidation remains the later onboarding stage |
| DWeb `open_docs`, `docs/en`, `docs/zh` | Keep inside app: Nuxt Content reads these as runtime content |
| source agent rules, hooks, CI, editor workspace, graph output, planning notes | Do not import; retain v2 governance and hooks |
| source LICENSE and trademark text | Preserve under `docs/migrations/source-license.txt` and `source-trademark.md` |

The original four source packages already have both app consumers in the pinned source. They are
migrated ahead of the Extension so Web can resolve its existing workspace dependencies;
this is not an extraction of new abstractions. The v2 workspace exposes four focused packages:
`@commons/contracts`, `@commons/frontend-types`, `@commons/frontend-utils`, and
`@slax-reader/selection`. API routes, domain payloads, events, and shared enums live in
`contracts`; browser-only and local-first implementation types live in `frontend-types`.
No API-contract conversion or OpenAPI generation is performed.

### Coupling that remains

- Web local dev calls `backendStateV3()` only for the `dev` command. It requires a separate
  backend checkout and its local Wrangler state. This is preserved, not replaced with mocks.
- SSR invokes the `BACKEND` service binding and reads the `OSS` R2 binding. Web's `server/`
  is part of its rendering application, not a migration of `slax_reader_backend`.
- Nuxt profiles and `/x/ext-bridge` extension IDs remain unchanged for the later extension import.
- selection publishes local generated `dist` entrypoints; it must build before Web consumes them.
- The source uses pnpm 9 whereas v2 pins pnpm 11.25.0; the migration preserves locked package
  versions and adapts workspace configuration and native build-script permissions.
- The source's Vue server-renderer override is declared in its root manifest/lock, but absent
  from its workspace YAML. v2's single override table includes it to retain the locked resolution.

### Attribution

Imported code carries the original Apache-2.0 license, including `Copyright [2025] [unnoo]`.
The source license and trademark notice are preserved beside this record. Adjustments in
this phase are limited to workspace plumbing, package manifests, configuration locations,
package-local development documentation, and required build compatibility fixes. Runtime
Vue and server implementation files remain the pinned snapshot. The Web-only declaration
`_cloudflare/env.d.ts` now describes its used backend RPC surface locally instead of importing
a sibling backend source checkout; RPC names and runtime calls are unchanged.

### Validation

- Nuxt prepare and Web vue-tsc application and server type checks: passed.
- Shared selection build (ESM and declarations) and type check: passed.
- Web Vitest: 164 files / 1754 tests passed; one file / test skipped, as in the source suite.
- OpenSpec strict validation: 3 items passed.
- Frozen dependency resolution/linking with scripts disabled: passed. This is not a
  successful full dependency installation: `better-sqlite3` compilation fails because the
  host has not accepted the Xcode license. Do not silently skip that script in CI.
- Web build: passed with local placeholder public configuration and the default development
  profile; generated client assets and the Cloudflare Pages Worker. This is not a production
  environment validation or deployment. ReSVG fell back to WASM because its native binding
  was unavailable.
- Real backend-connected smoke test: deferred by the user until all migration stages are
  complete (task 6.5). It remains required before merging the final pull request into `dev`,
  but does not gate each stage. No source environment files are read or copied and no
  backend is started here.

The Xcode message concerns macOS's C/C++ compiler and SDK, which native Node.js addons
also use. The recorded install ran `node-gyp rebuild` for the existing `better-sqlite3`
dependency and `make` exited with code 69 because the host had not accepted the Xcode
license. This does not add an iOS application or require contributors on other platforms
to use Xcode. Full installation remains unverified; passing tests and the Web build after
linking with scripts disabled do not resolve that separate installation issue.

### Deferred installation follow-up

At the user's request, revisit this issue after all migration stages (task 6.2), rather
than blocking Extension migration. Record the affected macOS/CPU/Node combination,
why a prebuilt `better-sqlite3` binary was not used, and whether Command Line Tools alone
suffice for local compilation. Then verify a clean install with dependency scripts enabled.
Do not accept Apple's license on the user's behalf or make full Xcode an onboarding
requirement for all contributors. Non-programmers using hosted previews, reporting issues,
or editing documentation online should not need a local native compilation toolchain.

Type-checking exposed the source lock's split Vue peer contexts (TypeScript 5 and 6).
pnpm recomputed peer connections without introducing any package version absent from the
source and v2 lockfiles. Source `hasBin` metadata was retained when pnpm's lock repair
removed it, so clean installations retain Nuxt, ESLint, Vitest, and OpenSpec commands.
The frontend-utils manifest now declares its existing Vue dependency; Web declares h3, vue-i18n,
and vue-eslint-parser instead of relying on source-root hoisting.

Source-fidelity check: all 655 tracked files across DWeb and the four source libraries are present;
the v2 package layout consolidates those source libraries into four focused packages.
645 are byte-identical to the source snapshot; 10 differ only in the documented config,
manifest, declaration, ignore, and README adaptations. Original trailing whitespace in
`useReadingPosition.ts`, `public/llms.txt`, and generated `worker-configuration.d.ts` was
retained, so `git diff --check` reports those inherited lines. No behavior code was reformatted.
The staged paths contain no environment files, dependency directories, build outputs, or keys.

The current source branch/HEAD remain `codex/fix-ci-env-before-install` / `ddcf9bc6`
and its worktree remains clean after this stage. Source paths in this document describe
provenance, not dependencies of the migrated application.


## Phase 3 — Extension import checkpoint

The Web stage merged into `feat/integrate-slax-reader-web-extension` at `f100570`.
The Extension stage uses `feat/import-slax-reader-extension`, created from that integration
commit. The final integration into `dev` still requires a pull request.

### Imported content and adaptations

- Imported 188 of the 189 tracked Extension files from the same pinned `8a983148` snapshot;
  excluded only `.vscode/settings.json` because v2 keeps editor settings local.
- 181 imported files are byte-identical. The seven adapted files are the README, manifest
  of package dependencies/scripts, environment type declaration, WXT/UnoCSS/ESLint config,
  and `tests/offscreen-fault-injection.mjs`. All files under `src/` are unchanged.
- Manifest public keys, extension IDs, icons, permissions, entrypoints, vendor shims and
  Web bridge protocol are retained. Environment loading now resolves below `apps/extension`.
- Environment schema/loader and UnoCSS/ESLint bases live under the Extension app. They do
  not import from the Web app or introduce root-level configuration. Configuration
  consolidation can be considered separately; this import keeps app setup independent.
- Replaced the stale `SlaxEnv` type import (which the source config does not export) with
  a type inferred from the local environment schema. Runtime configuration is unchanged.
- Declared previously root-provided tool/config dependencies in the Extension manifest.
  The lockfile adds 193 source-locked package records, preserves existing Web/library
  importer and package records, and retains CLI `hasBin` metadata.
- Added root `web` and `extension` dispatchers. They expose app scripts through commands such as
  `pnpm web -- build` and `pnpm extension -- zip`; app scripts remain authoritative and automatically
  prepare selection and WXT where needed; development also prepares vendor assets.
- Retained the source's explicit `@wxt-dev/analytics` postinstall opt-out under pnpm 11
  `allowBuilds`. No general disabling of install scripts is committed.
- Updated the offscreen test's Web source path to `apps/web`. In Chrome for Testing 151,
  a CDP-loaded unpacked extension was absent after browser restart; the test now also passes
  its unpacked path at browser startup. This changes the test harness, not extension behavior.
- App setup and architecture guidance are in `docs/apps/extension`; root, Web and shared
  package READMEs now link to the imported extension. Contributor-wide onboarding remains
  the next stage.

### Validation

- Frozen dependency resolution/linking with scripts disabled: passed. Full installation
  remains the separate deferred Xcode / `better-sqlite3` item in task 6.2.
- selection build, WXT prepare and Extension `vue-tsc`: passed.
- Extension Vitest: 4 files / 14 tests passed.
- Chrome MV3 build and zip with local placeholder public values and the default development
  profile: passed. This does not validate production configuration or publish an extension.
- Vendor prebuild: passed; both normal bundling and the existing vendor path were exercised.
- Chromium load smoke: passed using a temporary browser profile and local article page.
  Service worker listeners, injected modal/sidebar, and the content readiness reply worked
  without page errors. Development extension ID: `jgaccepfhchlnpggghoodnklcfcbhhlh`.
- Existing offscreen fault-injection suite: all 17 scenarios passed with an isolated local
  fixture, including concurrent calls, 20 worker stop/wake cycles, session switching,
  logout, 50 tabs, disconnection, extension reload, and browser restart. These fixtures
  do not replace the deferred real backend acceptance test.
- Strict OpenSpec validation and generated rulesync drift check: passed.
- Source checkout remained clean on `codex/fix-ci-env-before-install` / `ddcf9bc6`.

Generated `.wxt`, `.vendor`, `build`, browser profiles, dependency directories and environment
files are excluded from the stage commit. The native installation follow-up and real
backend testing remain open until final verification, as requested by the user.

The stage diff retains three source trailing-whitespace lines in
`apps/extension/src/components/Tips/SidebarTips.vue`; `git diff --check` reports only
these inherited lines. They were not reformatted during the snapshot import.
