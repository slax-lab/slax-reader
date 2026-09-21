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
| `commons/types` | `packages/types` | Used by Web and Extension |
| `commons/types-pro` | `packages/types-pro` | Used by Web and Extension |
| `commons/utils` | `packages/utils` | Used by Web and Extension |
| `commons/selection` | `packages/selection` | Used by Web and Extension |
| `docs/DEVELOPMENT-DOCUMENT-*` | `docs/apps` and `docs/architecture` | Long-form onboarding and architecture material |
| `docs/HOW-TO-CONTRIBUTION-*` | `docs/contributing` | Contributor onboarding |
| migration provenance | `docs/migrations` | Traceability and migration notes |

## Observed workspace facts

The source root currently uses pnpm workspace globs for `apps/*` and `commons/*`. Both application manifests depend on all four shared packages. `commons/selection` additionally depends on `types` and `utils`. The source root also contains shared configuration under `configs/`, `scripts/`, and root TypeScript/environment files; these require an explicit app-by-app placement decision during implementation rather than blind copying to the v2 root.

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
| types: 8; types-pro: 6; utils: 25; selection: 20 tracked files | Import into corresponding `packages` as Web prerequisites; preserve package names and exports |
| `configs/env.ts`, `configs/backend-path.ts` | `apps/web/config`, resolve environment files under `apps/web` |
| `env.schema.ts` | `apps/web/env.schema.ts`, schema definitions only |
| root UnoCSS and ESLint bases | `apps/web/config/uno.base.ts` and `eslint.base.ts` |
| root TypeScript base used by types-pro | `packages/types-pro/tsconfig.base.json` |
| root dependencies used implicitly by Web | Declare in the app/library that uses them; do not add app dependencies at v2 root |
| source pnpm lock | Merge locked entries with v2, adapt importer paths and pnpm 11 override specifiers |
| `scripts/start.script.ts`, `configs/cmd.ts` | Do not import interactive launcher; use small root delegating commands |
| source root `README*`, deployment and contribution guides | Do not overwrite v2; contribution consolidation remains the later onboarding stage |
| DWeb `open_docs`, `docs/en`, `docs/zh` | Keep inside app: Nuxt Content reads these as runtime content |
| source agent rules, hooks, CI, editor workspace, graph output, planning notes | Do not import; retain v2 governance and hooks |
| source LICENSE and trademark text | Preserve under `docs/migrations/source-license.txt` and `source-trademark.md` |

The original four packages already have both app consumers in the pinned source. They are
migrated ahead of the Extension so Web can resolve its existing workspace dependencies;
this is not an extraction of new abstractions. Package names stay `@commons/*` and
`@slax-reader/selection` during this phase, including the broad but pre-existing utils package.
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
- Real backend-connected smoke test: pending developer-supplied configuration; no source
  environment files are read or copied and no backend is started here.

Type-checking exposed the source lock's split Vue peer contexts (TypeScript 5 and 6).
pnpm recomputed peer connections without introducing any package version absent from the
source and v2 lockfiles. Source `hasBin` metadata was retained when pnpm's lock repair
removed it, so clean installations retain Nuxt, ESLint, Vitest, and OpenSpec commands.
The utils manifest now declares its existing Vue dependency; Web declares h3, vue-i18n,
and vue-eslint-parser instead of relying on source-root hoisting.

Source-fidelity check: all 655 tracked files across DWeb and the four libraries are present.
645 are byte-identical to the source snapshot; 10 differ only in the documented config,
manifest, declaration, ignore, and README adaptations. Original trailing whitespace in
`useReadingPosition.ts`, `public/llms.txt`, and generated `worker-configuration.d.ts` was
retained, so `git diff --check` reports those inherited lines. No behavior code was reformatted.
The staged paths contain no environment files, dependency directories, build outputs, or keys.

The current source branch/HEAD remain `codex/fix-ci-env-before-install` / `ddcf9bc6`
and its worktree remains clean after this stage. Source paths in this document describe
provenance, not dependencies of the migrated application.
