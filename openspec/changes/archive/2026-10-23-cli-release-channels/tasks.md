# Tasks

## 1. Event eligibility and release identity

- [x] 1.0 Raise `apps/cli/package.json` to `1.0.2` in the first implementation PR; verify the resulting package and eligibility test select `1.0.2-dev` after merging into dev without hard-coding future versions.

- [x] 1.1 Refresh `ci/cli-release-channels` from live `origin/dev` and verify its base and absence of unrelated changes; retain the planning artifacts and do not alter the primary checkout.
- [x] 1.2 Implement release candidate selection from the exact branch push before/after revisions and full `apps/cli` diff; verify controlled Git-history tests cover a version-only increase, unchanged-version skip, unrelated merge, beta/main promotion, multi-version promotion, unavailable revisions, invalid identities, version decrease, and unsupported rewrite/create/delete events.
- [x] 1.3 Derive channel, base version, package version, tag, and source identity from the actual manifest and event; verify dev/beta/main cases across multiple arbitrary versions, with no hard-coded example version and branch-specific reachability failures producing actionable errors.

## 2. Prepare and verify the exact package

- [x] 2.1 Make release preparation temporarily set the derived manifest version and release metadata before an explicit build and one pack operation, restoring the original manifest in `finally`; verify process tests cover successful and failed preparation and confirm the generated executable and archive both carry the derived version.
- [x] 2.2 Extend `apps/cli/script/verify-package.mjs` to check a validated expected release version while retaining the existing default source-manifest mode; verify dev/beta/stable archives install outside the workspace, report the expected version/help, and pass the existing controlled authenticated HTTP interaction.
- [x] 2.3 Extend release metadata/archive validation to bind base version, package version, channel, branch, commit, tag, checksum, and embedded manifest identity; verify tampered bytes or any identity mismatch stop distribution before remote writes.

## 3. Tags and channel-specific distribution

- [x] 3.1 Add workflow-token tag reconciliation at the eligible event SHA after build/smoke validation; verify HTTP fixtures cover new tag creation, an identical existing tag, annotated existing tags where applicable, conflicting targets, permission/network failures, and a tag changed before distribution, without rewrite/delete calls.
- [x] 3.2 Add GitHub-only dev/beta distribution with `prerelease: true` and `make_latest: false`; verify fixture-based process tests assert the matching archive/checksum are downloadable assets and preview paths perform no npm registry or publish calls.
- [x] 3.3 Preserve main-only npm Trusted Publishing, provenance, exact-byte publication, registry identity/integrity verification, and latest-version guards; verify controlled tests cover fresh publication, already-published identical/conflicting versions, registry failures, stale versions, and npm-success/GitHub-failure recovery.
- [x] 3.4 Make Release reconciliation validate the expected prerelease state and immutable asset bytes; verify missing outputs are added, matching outputs are retained, duplicate/conflicting assets fail, and old retries do not regress latest.

## 4. Workflow integration

- [x] 4.1 Update `.github/workflows/cli-release.yml` to evaluate only dev/beta/main branch pushes and complete detect/build/distribution in the same run, preserving the workflow filename; verify no automatic-tag event dependency remains, no build runs for skipped candidates, and checkout/distribution use the original event revision and artifact.
- [x] 4.2 Scope detection/build to read permissions, preview distribution to contents write, and main publication to contents write plus OIDC; add channel-scoped non-canceling concurrency with `queue: max`; verify workflow validation and orchestration tests cover job conditions, no preview npm path, immutable artifact-ID transfer with attempt-specific names, and channel isolation.
- [x] 4.3 Update the existing release unit/process and workflow-contract tests for branch-driven behavior while retaining full validation in PR CI; verify `pnpm test:cli-tooling` passes and post-merge workflow jobs do not repeat full PR typecheck/unit/integration/root-tooling suites.

## 5. Documentation and final verification

- [x] 5.1 Update `docs/cli/RELEASE.md` and relevant development instructions and update README plus the `.rulesync/` release overview with regenerated agent documents for dynamic versions, destination-relative comparisons, per-tag prereleases, archive installation, automatic tags, retries, prospective rollout, and historical collision handling; verify documented commands/filenames/permissions match the implementation and no example version is presented as a fixed target.
- [x] 5.2 Inspect applicable remote tag rulesets read-only and document any concrete automation-permission requirement; verify the existing npm trusted-publisher identity remains `slax-lab/slax-reader` with `cli-release.yml`, and do not change external settings, tags, releases, or npm versions as part of local validation.
- [x] 5.3 Run frozen installation on a supported LTS runtime, `pnpm cli -- typecheck`, `pnpm cli -- test`, `pnpm cli -- test:package`, `pnpm test:cli-tooling`, and `openspec validate --all --strict`; verify relevant validation passes using isolated fixtures without publishing publicly, and record any environmental limits accurately.
- [x] 5.4 Read `REVIEW.md`, run its local pre-push review and OpenSpec compliance pass, and resolve Important findings before any push; verify the review records `OpenSpec: cli-release-channels`, the branch/PR scope remains one task, and the completed but unarchived migration's historical release contract is flagged for its separately reviewed archive rather than silently restored.

## Verification notes

- Frozen installation, CLI typecheck/build, the five CLI integration cases, stable package installation and executable version `1.0.2` passed on Node 22.22.3.
- Real standalone consumer installation passed for dev, beta and stable archives, including executable help/version and controlled authenticated HTTP requests outside the workspace.
- Terminal networking and localhost access were initially unavailable, then enabled. The worktree was fast-forwarded to live `origin/dev` (`8c99d34`) before final verification; its changes remain isolated from the primary checkout.
- The unarchived migration still records its historical tag-only release policy; its separately reviewed archive must retain this change's `cli-release` contract.
- Final local validation passed: 22 CLI tooling checks including all three standalone consumer builds, 5 CLI integration checks, 104 root preflight/tooling checks (2 optional checks skipped), rulesync doctor/generation checks, and 41 strict OpenSpec items.
