# Design

## Context

See `proposal.md` for motivation and scope. The source snapshot is `slax-lab/slax-reader-cli@9697ec2949049d2e7ef0258cd7b9b6df2142007a`. It contains a Commander CLI, tsup build, TypeScript checks, bilingual documentation and a public skill, but no automated tests or CI. The destination has only `apps/cli/.gitkeep`, already matched by `pnpm-workspace.yaml`.

The CLI uses API-key HTTP endpoints, not application internals. `src/lib/config.ts` uses the `reader-cli` configuration namespace and a default API base of `https://api-reader.slax.com`. Both `src/commands/install.ts` and `src/lib/skillSync.ts` independently reference the old skills repository. The source manifest claims Node 18, despite Commander 14 requiring Node 20 or newer. The destination requires `^22.22.2 || ^24.15.0 || >=26.0.0`.

`packages/contracts` is private and exports TypeScript source. Its `http` and `bookmarks` modules already cover several CLI request types, but not all legacy response views. The root already has Node test-runner coverage, app dispatchers, and path-filtered CI. `tooling/run-app.mjs` loads deploy environment files, which is not appropriate for CLI execution.

## Goals / Non-Goals

**Goals:**

- Maintain a reproducible source import with a small, reviewable integration delta.
- Keep the installed CLI independent of a monorepo checkout and private workspace packages.
- Verify executable behavior and actual HTTP requests without accessing a real account, changing global installs, or reading developer credentials.
- Keep developer agent rules and the public consumer skill distinctly scoped.

**Non-Goals:**

- Do not rewrite the command layer, remove existing heartbeat/update behavior, broaden bookmark features, or redesign the API.
- Do not force CLI configuration into `deploy/local` or add it to the Web/Extension/API setup orchestration.
- Do not merge unrelated local mobile work, rebase repository history, or perform release operations.

## Decisions

### 1. Import an attributable snapshot, not a submodule or history rewrite

Import tracked application files from the pinned source revision into `apps/cli`; keep `src`, `tsconfig.json`, `tsup.config.ts`, package metadata, READMEs and `skills/slax-reader/SKILL.md`. Move the source `docs/*` guides to `docs/cli/`, repairing relative links in both language versions. Omit the source lockfile, dependency/build directories, Git metadata and obsolete placeholder.

Record the repository and commit in the CLI development documentation. Preserve the source's MIT declaration and attribution in the package and distinguish it from the repository's Apache-2.0 license in the root notice. The inspected source tree has no standalone LICENSE file despite its MIT declaration; carry an explicit MIT license/attribution based on that declaration rather than silently changing the package to Apache-2.0.

A submodule would keep the separate release/maintenance boundary the migration is intended to remove. Rewriting history would introduce unnecessary operational risk.

### 2. Preserve the published boundary and unify developer tooling

Keep `@slax-lab/reader-cli`, version `1.0.0`, the `reader-cli` binary at `dist/index.js`, ESM output, and the executable shebang. Update `repository.url`, `repository.directory` and `homepage` for `slax-lab/slax-reader` and `apps/cli`. Import dependency versions without opportunistic upgrades; let the root lockfile own their resolution.

Align package engine metadata, build target and installation prerequisites to the root supported Node range. This is explicitly disclosed rather than falsely promising Node 18 or downgrading dependencies.

Add `start` and `test` beside upstream `build`, `dev`, `typecheck` and publication lifecycle scripts. Root `tooling/cli.mjs` exposes available application scripts, forwards arguments as data through `pnpmInvocation`, and preserves exit/signal status. Reuse existing subprocess conventions from `tooling/api.mjs`; avoid a broad dispatcher refactor and avoid the deploy-environment loading in `run-app.mjs`. Exclude publication/lifecycle hooks from ordinary help/dispatch. `pnpm cli -- start --help` runs the built client, while `pnpm cli -- --help` lists developer scripts.

### 3. Reuse wire types without creating a private runtime dependency

Use type-only imports from `@slax-reader/contracts/http` and `@slax-reader/contracts/bookmarks` for the response envelope and compatible add/archive/star/trash request shapes. Declare the workspace contracts package as a development dependency so npm consumers do not attempt to install a private `0.0.1` package. Keep CLI output envelopes, formatted list/detail models, and legacy response views local; do not cast incompatible contracts just to remove duplication.

Retain the source's `src` typecheck boundary by checking how shared-source imports interact with `rootDir` and adjusting the typecheck configuration without changing wire behavior. No runtime import of private contracts may remain in `dist`, and the packed manifest must contain no private workspace production dependency. Expanding shared types or changing API runtime behavior is not needed for this migration.

### 4. Make the monorepo skill source explicit and shared

Keep the public skill at `apps/cli/skills/slax-reader/SKILL.md`, outside generated `.agents`/`.claude`/`.codex` directories. Point installer, sync, upgrade and manual repair instructions at the explicit branch/subdirectory source `https://github.com/slax-lab/slax-reader/tree/dev/apps/cli/skills/slax-reader`, selecting `--skill slax-reader` when invoking the skills installer. Verify the external installer's branch/subdirectory syntax and discovery with a local repository fixture before finalizing those arguments.

Centralize source/arguments used by install and sync rather than retaining the two hard-coded copies. Preserve state stamp/version semantics, partial-success reporting, and `_hints` behavior. Do not install repository development skills or fall back silently to an unrelated root skill discovery.

The explicit `dev` URL avoids assuming that the default branch is `main`, but it cannot become remotely usable until this change is merged. Local fixture verification is the pre-merge acceptance check; public-source availability is a documented release prerequisite, not an excuse to publish or push during migration.

### 5. Exercise the executable and package, not only imports

Use the repository's existing Node test-runner approach for `apps/cli/test/*.test.mjs` and root dispatcher tests. CLI tests build first and launch the real `dist/index.js` in isolated homes/config directories. A loopback HTTP server implements the exercised endpoints and captures methods, headers, query parameters and bodies. Initial login uses a synthetic `sr-` key and the local API base; later heartbeat requests stay on that server. Notifier-only behavior is controlled with the existing CI/notifier environment variables and state fixtures.

Cover login/whoami/logout, unauthenticated failures, add/list/ls/get, Markdown and missing content, archive/unarchive/star/unstar/delete/restore, and API/network failures. Assert the public success/error JSON envelopes, exit status, text output and absence of full keys. For install/upgrade/skill, intercept registry access and external package-manager processes with test-only subprocess fixtures; assert exact commands, selective skill installation and version stamps without modifying global packages or agent installations.

Pack `apps/cli` using the standard package manager command and install the resulting archive into an isolated consumer outside the workspace. Execute the installed `reader-cli` bin, verify version/help and at least an authenticated local-fixture interaction. Inspect shipped files, license, bin metadata and production dependencies. Do not use symlinks back into the workspace as evidence that standalone publication works.

### 6. Keep integration changes local to the CLI workflow

Add `.github/workflows/cli-ci.yml` using existing checkout/pnpm/Node patterns, read-only contents permissions, root frozen installation, CLI typecheck/build/tests, root dispatcher tests and packaging validation. Trigger for CLI, relevant contracts, root package/lockfile and CLI tooling/workflow changes; test supported LTS baselines consistent with the engine declaration.

Update root README and local setup instructions with CLI commands and authentication guidance. Update the `.rulesync/rules/overview.md` source for the root CLI entry, then regenerate guidance with `pnpm agent:sync`; never edit generated guidance by hand. Keep new durable documentation in English, preserving imported translations with path corrections.

### 7. Publish a single verified artifact to npm and GitHub Releases

Add `.github/workflows/cli-release.yml` for pushed `cli-v*` tags, accepting only canonical stable SemVer matching the CLI manifest. Validate the tag commit is reachable from `origin/main` and the repository is `slax-lab/slax-reader` before granting publishing permissions. No release from pull requests, branches, mismatched versions or prereleases is permitted. Use package-wide concurrency without canceling an in-progress release.

The build job uses read-only permissions and runs frozen installation, typecheck, executable tests and consumer validation on the exact packed archive. Transfer that single archive and a release manifest/checksum to the publish job; do not repack after testing. Publish that archive with npm >=11.5.1 on a supported GitHub-hosted Node runtime through OIDC. Only the publish job has `id-token: write` and `contents: write`. No NPM_TOKEN or personal access token is needed. Configure npm's trusted publisher with organization `slax-lab`, repository `slax-reader`, workflow `cli-release.yml`, no environment name, and explicitly allow direct `npm publish`. Do not fall back to long-lived tokens.

Create the tag's GitHub Release with generated notes only after npm success; attach the same `.tgz` bytes and a SHA-256 checksum. On retry, query the exact npm version: only a genuine registry 404 means unpublished, while authentication/network failures abort. An existing version must match the candidate archive integrity and source commit metadata before skipping publish. Existing assets must match expected bytes; add missing assets without overwriting conflicts. An old rerun must not move npm `latest` or GitHub's latest release backward. Reject a new version that is not newer than npm latest. Serialize publication per package. No unpublish, automatic version increment, tag mutation or overwrite is performed.

Use testable release tooling with controlled registry, npm and GitHub adapters to exercise fresh publication, mismatches, partial success and reruns without public writes. Document real OIDC/npm/GitHub integration as unverified until a maintainer configures the trust and creates an authorized release tag. The migration keeps source version `1.0.0`; a later release must use a new version rather than overwrite upstream 1.0.0.

## Risks / Trade-offs

- [Unsupported old runtime claims] → Disclose the corrected Node requirement in metadata/docs and verify on supported LTS runtimes.
- [Private workspace types leak into the npm package] → Keep imports type-only and validate a packed installation outside the workspace.
- [Skill discovery selects developer skills or resolves an unmerged path] → Use explicit branch/subdirectory plus named selection; verify locally and document the merge-before-release prerequisite.
- [Tests access real credentials or change installed tools] → Isolate HOME/config/state and package-manager binaries, use synthetic keys and loopback API endpoints, and never invoke the developer's global install commands.
- [License mismatch] → Preserve the imported MIT declaration and attribution; make the exception explicit in notices rather than adopting the root license by accident.
- [Root lockfile churn] → Avoid unrelated dependency upgrades and review importer/resolution changes against the pinned source.
- [Legacy defects unrelated to migration] → Report separately rather than silently expanding this change; fix migration-caused regressions before completion.

## Migration Plan

1. Prepare/review this proposal on `feat/migrate-reader-cli` in `.worktrees/migrate-reader-cli`, based on `origin/dev@226be91`.
2. After an explicit apply request, import the pinned source snapshot and integrate package/tooling/types/skill links/documentation.
3. Validate frozen installation, CLI build/typecheck/tests, root regression checks, isolated packed-consumer execution, strict OpenSpec validation and the three-pass local review.
4. Present the verified local migration. Commits, pushes, PR creation, npm publication and changes to the legacy repository remain separately authorized operations.
5. Before any later npm release, merge the source into the documented branch, verify remote skill discovery, select a new package version and follow the release process. Existing published versions remain available during migration.

Rollback before release consists of reverting the task's integration changes on its branch; no user-data or credential-store rollback is needed. A later release rollback is a separate operator decision and is not performed here.
