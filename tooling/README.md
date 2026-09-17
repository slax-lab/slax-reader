# tooling

Repository-level development tooling: the scripts and helpers that operate on the monorepo as a whole, rather than on any single app.

## What belongs here

- Generators and codegen drivers that run across the workspace.
- Scripts used by CI or by contributors to set up, check, or release the monorepo.
- Shared build helpers that are not runtime dependencies of any app.

## What does not belong here

- Application code — that lives in `apps/`.
- Shared runtime libraries and contracts — those are `packages/`.
- Per-app build configuration. Configurations shared across apps will be published as packages too (config-as-package), so there is no top-level `config/` directory in this repository by design.

## Migration source

New — no existing repository migrates into this directory.

## Interim owner

@boxcounter — interim owner until a dedicated code owner is assigned. See `.github/CODEOWNERS`.
