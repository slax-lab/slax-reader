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
