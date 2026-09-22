# Design — frontend snapshot migration into the v2 skeleton

## Source and migration mode

The source is the local checkout of `slax_reader` at:

```text
/Users/yjc/Documents/Company/slax-reader
```

The inspected source worktree was clean and identified by commit:

```text
8a983148fdd1da2f145e7797be070d3fbe8f791a
```

The source remote is `https://github.com/unnoo/slax_reader_frontend.git`. This is a read-only input. The first migration imports a working-tree snapshot rather than preserving Git history. The source commit and inspection date are recorded in `docs/migrations/slax-reader-web-extension.md`.

## Target layout

```text
apps/web/                 <- source apps/slax-reader-dweb
apps/extension/           <- source apps/slax-reader-extensions
packages/contracts/       <- shared API, domain, event, and route contracts
packages/frontend-types/  <- frontend-only implementation types from source commons/types-pro
packages/frontend-utils/  <- source commons/utils, renamed for frontend scope
packages/selection/       <- source commons/selection
docs/apps/web/            <- Web-specific development material
docs/apps/extension/      <- Extension-specific development material
docs/contributing/        <- contributor-facing guides
docs/architecture/        <- repository and integration explanations
docs/migrations/          <- provenance and migration records
```

The four frontend `packages` entries are justified by the source manifests and the agreed backend boundary: both applications depend on these libraries, while `selection` depends on the shared contract surface. `contracts` owns data that crosses an app/backend or app/app boundary, including API routes, domain payloads, events, and shared enums. `frontend-types` owns browser-only and local-first implementation types such as storage keys and extension panel state. The source's `types-pro` definitions are split across those two packages so v2 does not keep overlapping `types` and `contracts` packages.

## Migration sequence

1. Capture the source inventory and verify the source worktree is clean.
2. Copy only tracked, non-secret source files into their target directories.
3. Preserve source exports while adapting workspace paths. Split the source type surface between `@commons/contracts` and `@commons/frontend-types`, expose the frontend-only `utils` code as `@commons/frontend-utils`, and import the four shared libraries with Web because they are prerequisites for its build, then connect Extension in the next stage.
4. Move source-level configuration that is specific to the two applications below the relevant app directory. Keep root configuration limited to workspace orchestration and repository governance.
5. Add app-level READMEs and route long-form guidance into `docs/`.
6. Add minimal root commands that delegate to the app packages.
7. Install dependencies and run type generation, type checks, tests, and production builds for both applications.
8. Verify the extension can load in a Chromium-based browser. After all migration stages are complete, perform the combined Web/Extension smoke test against the existing development backend before merging the final pull request into `dev`.

## Environment and backend boundary

The source uses local environment files and `SLAX_BACKEND_DIR` to find a separate backend checkout. No secret values are copied. v2 documents the required variable names and safe example shapes only. Backend code stays in its existing repository, and the migration must fail clearly when required local configuration is absent rather than inventing replacement credentials or endpoints.

## Root cleanliness

The root receives only the minimum changes required for the workspace: package manager metadata, small delegating scripts, and navigation documentation. DWeb and Extension build files, manifests, assets, tests, and runtime code remain in their app directories. Shared source remains in the four narrowly named packages above.

## Validation boundaries

- `apps/web` must install, prepare, type-check, test, and build independently through its package scripts.
- `apps/extension` must prepare, compile, test, build, and package independently through its package scripts.
- Shared packages must resolve through pnpm workspace links and preserve their current import boundaries.
- Backend-connected acceptance is deferred to final verification after all migration stages, as requested by the user. It does not gate individual import stages and must not be reported as passed before it is actually run. Full dependency installation remains a separate required check.
- The user also deferred investigation of the macOS Xcode license / `better-sqlite3` installation failure until all migration stages are complete. Track it under final verification task 6.2 without blocking the next import stage or treating it as resolved.
- The source repository's status must be unchanged before and after every migration operation.
- `openspec validate --all --strict` must pass after the change is fully authored.

## Stage branches and pull requests

Stage branches originate from `feat/integrate-slax-reader-web-extension` and merge back
there after verification. The integration branch originates from `dev` and will return to
`dev` only through a pull request. Phase 2 uses `feat/import-slax-reader-web` and imports
Web plus its already shared dependencies; it does not start the Extension import.

Phase 3 uses `feat/import-slax-reader-extension`, based on integration commit `f100570`
after the Web-stage merge. Extension-specific environment, UnoCSS and ESLint configuration
is local to `apps/extension/config`; shared runtime libraries retain the four focused
package boundaries. No new root configuration file or application source is introduced.
