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
packages/types/           <- source commons/types
packages/types-pro/       <- source commons/types-pro
packages/utils/           <- source commons/utils
packages/selection/       <- source commons/selection
docs/apps/web/            <- Web-specific development material
docs/apps/extension/      <- Extension-specific development material
docs/contributing/        <- contributor-facing guides
docs/architecture/        <- repository and integration explanations
docs/migrations/          <- provenance and migration records
```

The four `packages` entries are justified by the source manifests: both applications depend on all four libraries, while `selection` itself depends on `types` and `utils`. `packages/contracts` remains reserved for a future explicit API-contract library; this change does not force existing domain types into that name.

## Migration sequence

1. Capture the source inventory and verify the source worktree is clean.
2. Copy only tracked, non-secret source files into their target directories.
3. Retain package names and exports; adapt workspace paths. Import the four existing shared libraries with Web because they are prerequisites for its build, then connect Extension in the next stage.
4. Move source-level configuration that is specific to the two applications below the relevant app directory. Keep root configuration limited to workspace orchestration and repository governance.
5. Add app-level READMEs and route long-form guidance into `docs/`.
6. Add minimal root commands that delegate to the app packages.
7. Install dependencies and run type generation, type checks, tests, and production builds for both applications.
8. Verify the extension in a Chromium-based browser and run a Web smoke test against the existing backend integration.

## Environment and backend boundary

The source uses local environment files and `SLAX_BACKEND_DIR` to find a separate backend checkout. No secret values are copied. v2 documents the required variable names and safe example shapes only. Backend code stays in its existing repository, and the migration must fail clearly when required local configuration is absent rather than inventing replacement credentials or endpoints.

## Root cleanliness

The root receives only the minimum changes required for the workspace: package manager metadata, small delegating scripts, and navigation documentation. DWeb and Extension build files, manifests, assets, tests, and runtime code remain in their app directories. Shared source remains in the four narrowly named packages above.

## Validation boundaries

- `apps/web` must install, prepare, type-check, test, and build independently through its package scripts.
- `apps/extension` must prepare, compile, test, build, and package independently through its package scripts.
- Shared packages must resolve through pnpm workspace links and preserve their current import boundaries.
- The source repository's status must be unchanged before and after every migration operation.
- `openspec validate --all --strict` must pass after the change is fully authored.

## Stage branches and pull requests

Stage branches originate from `feat/integrate-slax-reader-web-extension` and merge back
there after verification. The integration branch originates from `dev` and will return to
`dev` only through a pull request. Phase 2 uses `feat/import-slax-reader-web` and imports
Web plus its already shared dependencies; it does not start the Extension import.
