# Spec Delta

## Purpose

Defines the `setup` command Web and Extension expose as the single entry point for whatever preparation steps a contributor or agent needs before `dev` starts cleanly, mirroring the Backend's existing `setup:api` naming convention across all three apps and leaving room for `setup` to grow beyond artifact generation over time.

## ADDED Requirements

### Requirement: Web and Extension expose a `setup` command

The Web app SHALL expose a `setup` script in `apps/web/package.json`, and the Extension app SHALL expose a `setup` script in `apps/extension/package.json`. Each SHALL be reachable through the root dispatcher as `pnpm web -- setup` and `pnpm extension -- setup` respectively, without requiring changes to the root dispatcher scripts (`tooling/web.mjs`, `tooling/extension.mjs`, `tooling/run-app.mjs`).

#### Scenario: Running setup through the root dispatcher

- **WHEN** a contributor runs `pnpm web -- setup`
- **THEN** the command resolves to the `setup` script defined in `apps/web/package.json` and runs to completion without a non-zero exit code on a healthy checkout

#### Scenario: Extension setup through the root dispatcher

- **WHEN** a contributor runs `pnpm extension -- setup`
- **THEN** the command resolves to the `setup` script defined in `apps/extension/package.json` and runs to completion without a non-zero exit code on a healthy checkout

### Requirement: `setup` fully generates the framework's build-time artifacts before `dev` needs them

Web's `setup` SHALL generate the `.nuxt/` directory, including `.nuxt/tsconfig.server.json`, by running Nuxt's project preparation step to completion before exiting. Extension's `setup` SHALL generate the `.wxt/` directory, including `.wxt/tsconfig.json`, by running WXT's project preparation step to completion before exiting. Running `setup` SHALL be safe to repeat and SHALL succeed whether or not the target generated directory already exists.

`setup` SHALL be the app's designated entry point for every preparation step a contributor or agent needs before `dev` can run cleanly, not only artifact generation. Each app's existing `type` script (Nuxt/WXT project preparation) SHALL remain a narrower, independently runnable script for callers that only need type/prepare output (e.g. `typecheck`), and `setup` SHALL invoke it rather than duplicating its command. Future preparation steps SHALL be added to `setup` directly; `type` SHALL NOT grow additional responsibilities beyond project preparation to stay reusable on its own.

#### Scenario: `setup` delegates to `type` instead of duplicating it

- **WHEN** `apps/web/package.json` or `apps/extension/package.json` defines its `setup` script
- **THEN** `setup` invokes the app's own `type` script (e.g. `pnpm run type`) rather than repeating the underlying `nuxt prepare` / `wxt prepare` command inline

#### Scenario: `type` keeps working standalone after `setup` exists

- **WHEN** a caller runs `pnpm web -- type` or `pnpm extension -- type` directly, without going through `setup`
- **THEN** the command still runs the framework's project preparation step on its own and succeeds independently of `setup`

#### Scenario: Setup after a full cache wipe

- **WHEN** `apps/web/.nuxt` does not exist and a contributor runs `pnpm web -- setup` followed by `pnpm web -- dev`
- **THEN** `.nuxt/tsconfig.server.json` exists before Nuxt's dev server begins compiling application code
- **AND** the dev server does not fail with a `TSCONFIG_ERROR` for a missing `.nuxt/tsconfig.server.json`

#### Scenario: Setup after an extension cache wipe

- **WHEN** `apps/extension/.wxt` does not exist and a contributor runs `pnpm extension -- setup` followed by `pnpm extension -- dev`
- **THEN** `.wxt/tsconfig.json` exists before the Extension's dev server begins compiling application code

#### Scenario: Setup is re-run on an already-prepared app

- **WHEN** a contributor runs `pnpm web -- setup` (or `pnpm extension -- setup`) while `.nuxt/` (or `.wxt/`) already exists from a prior run
- **THEN** the command completes successfully and leaves the generated directory in a valid, current state
