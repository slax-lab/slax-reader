# Tasks

## 1. Import the source application

- [x] 1.1 Import tracked CLI source/configuration/READMEs/public skill from `slax-lab/slax-reader-cli@9697ec2949049d2e7ef0258cd7b9b6df2142007a` into `apps/cli`, replacing `.gitkeep`; verify the imported file inventory against that revision and confirm no nested Git metadata, dependency tree, generated build output or source lockfile is tracked.
- [x] 1.2 Preserve `@slax-lab/reader-cli`, version `1.0.0`, the `reader-cli` bin and MIT attribution; update repository/homepage/directory metadata and add the applicable CLI license/root notice exception; verify the resulting manifest and documented source commit against upstream.
- [x] 1.3 Integrate dependencies into the root pnpm lockfile, align CLI engine metadata and tsup target with the supported Node range, and add package start/test scripts; verify root `pnpm install --frozen-lockfile` succeeds after lockfile generation and inspect dependency changes for unrelated upgrades.

## 2. Integrate contracts and developer commands

- [x] 2.1 Reuse compatible type-only `@slax-reader/contracts/http` and `bookmarks` exports from a development workspace dependency, keeping incompatible legacy response/output views local; verify CLI typecheck/build pass and built output contains no private runtime import.
- [x] 2.2 Add `tooling/cli.mjs` and the root `cli` script using existing `pnpmInvocation` and subprocess conventions without deploy-environment loading; verify dispatcher help, unknown-script failure, lifecycle exclusion, literal argument forwarding, child failure status and signal propagation in root Node tests.
- [x] 2.3 Verify the root entry points with `pnpm cli -- typecheck`, `pnpm cli -- build` and `pnpm cli -- start --help` in the worktree without API/Web/Extension local configuration; confirm no unrelated service is launched.

## 3. Migrate the public skill lifecycle

- [x] 3.1 Centralize installer/sync source and arguments on the explicit monorepo `dev/apps/cli/skills/slax-reader` URL and named `slax-reader` selection; verify the external skills installer's branch/subdirectory parsing and selective discovery with an isolated local repository fixture, without installing into the developer's agent directories.
- [x] 3.2 Update both install and sync paths plus manual recovery instructions to the centralized source while retaining stamp/version and partial-success behavior; verify controlled subprocess tests cover successful sync, already-in-sync, forced sync, failed installation and absence of false success stamps.
- [x] 3.3 Verify CLI install and upgrade flows against controlled registry/package-manager fixtures, asserting the unchanged npm package identity, `_hints` repair workflow and new skill source; confirm these checks never run a real global package or agent-skill install.

## 4. Add executable compatibility coverage

- [x] 4.1 Add a Node test-runner harness that launches built CLI processes with isolated home/config/state, synthetic API keys and a loopback HTTP fixture; verify captured requests never use the production API and no existing developer configuration is accessed.
- [x] 4.2 Cover login, existing-configuration reuse, whoami, logout, missing/invalid/rejected keys and text/JSON output; verify endpoint/header compatibility, key cleanup after failed login, unsuccessful exit codes and full-key redaction.
- [x] 4.3 Cover add metadata/tags/archive mode, list/ls pagination/filtering, get text/Markdown, missing-content 404 and non-404 failure; verify exact request methods/query/body/header shapes and public output envelopes including origin/snapshot links.
- [x] 4.4 Cover archive/unarchive/star/unstar/delete/restore, numeric-ID resolution failure and representative API/network failures; verify transitions, absence of invalid trash requests, JSON-only stdout and exit status.
- [x] 4.5 Cover cached update hints, skill hints, notifier suppression and unavailable update detection with isolated state/network fixtures; verify existing `_hints` shapes and that best-effort update failures do not fail ordinary commands.

## 5. Validate the standalone package and CI

- [x] 5.1 Add package-consumer validation that packs the application through the standard package manager, inspects the archive and installs it outside the workspace; verify license/bin/version metadata, absence of private production dependencies and accidental workspace files, then run the installed bin's help/version and an authenticated loopback-fixture interaction.
- [x] 5.2 Add `.github/workflows/cli-ci.yml` with relevant pull-request-only path triggers, read-only permissions, root frozen installation, supported LTS runtime coverage, CLI checks, dispatcher regression checks and packed-consumer validation. Do not repeat the full suites after merge or on release tags; the release workflow explicitly builds and runs only release guards and the exact-archive consumer smoke check. Verify YAML/command wiring, regression assertions for this separation, and the applicable commands locally.

- [x] 5.3 Add testable release preflight/orchestration tooling and `.github/workflows/cli-release.yml` for stable `cli-v<version>` tags reachable from main; verify version/repository/tag guards, least-privilege OIDC jobs and package-wide concurrency through automated tests.
- [x] 5.4 Publish the one tested archive through npm OIDC and create the monorepo GitHub Release with the same archive, SHA-256 file and generated notes; verify fresh publication, exact-version integrity/source-commit checks, missing-asset recovery, conflicting assets, registry failures and non-regressing latest behavior against controlled adapters without public writes.
- [x] 5.5 Document npm trusted publisher fields (`slax-lab`, `slax-reader`, `cli-release.yml`, no environment, allow direct publish), built-in token permissions, no required user-added Secrets, new-version/tag procedure and retry behavior; verify docs match workflow names and explicitly distinguish offline validation from the unperformed first real OIDC release.

## 6. Update documentation and repository guidance

- [x] 6.1 Move source guides to `docs/cli/`, preserve English/Chinese usage material and repair README/guide links for monorepo locations; verify referenced local files exist and old-repository links remain only as intentional provenance.
- [x] 6.2 Document root CLI developer commands, the corrected Node requirement, unchanged user authentication/configuration, source/license provenance and merge-before-release skill-source availability in root README, CLI documentation and `docs/LOCAL-SETUP.md`; verify the documented local commands and keep existing setup/preflight behavior unchanged.
- [x] 6.3 Update CLI guidance in `.rulesync/rules/overview.md` and regenerate with `pnpm agent:sync`; verify `pnpm exec rulesync generate --check` passes and no generated skill files were hand-edited.

## 7. Run final acceptance and review

- [x] 7.1 Run root frozen installation, `pnpm cli -- typecheck`, `pnpm cli -- build`, `pnpm cli -- test`, the packed-consumer validation command and `pnpm test:preflight` on the final worktree. Synchronize the API root-command contract with the new CLI scripts and run the API CI sequence (`config:init`, `gen:all`, `lint`, `typecheck`, `test`, `build`) with synthetic generation-only database URLs; verify every required check passes and record any environmental blocker without claiming completion.
- [x] 7.2 Run `pnpm exec openspec validate --all --strict` and the Bugs, Security and Compliance passes in `REVIEW.md` against change `migrate-reader-cli`; verify all Important findings are resolved and completed task marks correspond to actual evidence.
- [x] 7.3 Inspect final Git status/diff and present the worktree, branch, source revision, validation results and remaining release-only prerequisites; verify the original checkout/mobile commit is untouched and no commit, push, npm publication, legacy-repository modification or production account operation occurred without separate authorization.
