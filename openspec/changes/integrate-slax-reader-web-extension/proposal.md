# Integrate the Slax Reader web and extension applications

## Why

The v2 repository is the stable monorepo skeleton intended to make Slax Reader easier for non-programmers and third-party developers to understand and contribute to. The existing `slax_reader` repository already contains the DWeb application, the browser extension, and shared workspace libraries used by both applications, but those projects are not yet present in v2.

This change establishes the migration boundary and moves those frontend projects into v2 without changing the source repository. The migration is a one-way snapshot import: preserving Git history is optional and is deliberately out of scope for the first pass.

## What Changes

- Add the DWeb application under `apps/web`.
- Add the browser extension under `apps/extension`.
- Add the shared libraries under `packages/contracts`, `packages/frontend-types`, `packages/frontend-utils`, and `packages/selection`. API, domain, event, and route types used across the frontend/backend boundary live in `@commons/contracts`; browser-only and local-first implementation types live in `@commons/frontend-types`. The source's broad `utils` package is renamed to `frontend-utils` to reserve clearer naming for future Backend and CLI packages.
- Move relevant development and contribution documentation into `docs/web` and `docs/extension` without adding application implementation files to the v2 root.
- Add only the minimum workspace scripts and configuration needed to install, develop, build, type-check, and test the two migrated applications.
- Keep the existing backend outside this change; the migrated frontend applications continue to use their existing backend integration until a separate backend migration is planned.
- Record the source repository and exact snapshot used for migration so the import remains traceable.

## Explicit Constraints

- The source `slax_reader` repository is read-only for this work. No source branch, file, tag, README, redirect, or issue is modified.
- The v2 root remains a stable skeleton. Application code, application-specific configuration, and long-form application documentation stay below `apps/`, `packages/`, or `docs/`.
- Do not copy secrets, local environment files, dependency directories, build outputs, caches, or generated local state.
- Do not perform unrelated framework upgrades, visual redesigns, API rewrites, or broad refactors during the initial import.

## Impact

- New frontend applications and workspace libraries become part of the v2 pnpm workspace.
- Root-level workspace configuration exposes stable `web` and `extension` entry points; app scripts remain authoritative behind those wrappers.
- Existing v2 CI and OpenSpec checks remain the repository-level quality gates.
- Backend remains an external dependency during this change; no backend files or repository are modified.
