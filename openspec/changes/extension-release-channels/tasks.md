# Tasks

## 1. Approved scope and setup

- [x] 1.1 Inspect the existing extension/CLI workflows, package/configuration owners and GitHub Environment variable names; confirm with the human that unchanged versions skip building and publication.
- [x] 1.2 Obtain human review and implementation approval for proposal.md, design.md and the extension-release delta spec; verify approval preserves the version-increase rule and GitHub-only distribution.
- [x] 1.3 Prepare the isolated ci/extension-release-channels worktree with frozen dependencies and synthetic build inputs; verify installation does not change the lockfile or require secret files.

## 2. Eligibility and source identity

- [x] 2.1 Add extension release selection in tooling/extension-release.mjs using complete before/after Git history and the destination's extension versions; verify unrelated merges, unchanged versions, version-only increases, promotions and multiple intermediate versions with controlled Git fixtures.
- [x] 2.2 Validate repository/ref/event/checkout identity, stable Chrome-compatible versions and branch ancestry; verify wrong repository/branch, forced/created/deleted pushes, missing history and version decreases fail without packaging.
- [x] 2.3 Verify the matching merged PR before an eligible build, with bounded read-only retry and no build on direct/unmerged events; test matching merge/squash/rebase task events, promotion merge commits, missing association and API errors.

## 3. Public configuration and exact package

- [x] 3.1 Validate EXTENSION_BUILD_CONFIG against the extension public schema and release restrictions, and derive preview/beta/production profiles from the branch; test missing/invalid/unknown values, credential rejection and a stripped build subprocess environment.
- [x] 3.2 Generate a temporary WXT release configuration and invoke pnpm extension -- zip with channel display versions and unchanged numeric package/manifest versions; verify all three channels retain their existing extension IDs and ordinary local builds remain unchanged.
- [x] 3.3 Validate the exact ZIP, safe entries, manifest version/version_name, profile identity and referenced resources; emit source metadata and SHA256SUMS and verify corruption, traversal, wrong profile/version and changed-byte rejection tests.

## 4. GitHub workflow and publication

- [x] 4.1 Add .github/workflows/extension-release.yml with branch-push detection, successful skip output, separate read-only build and write-only distribution responsibilities, branch concurrency and immutable artifact-ID transfer; verify workflow tests cover permissions, conditions, pinned toolchain and no npm/store publication.
- [x] 4.2 Create the exact ext-v channel tag and GitHub Release only after artifact verification, attach the tested ZIP/checksum, and preserve the monorepo Latest selection; verify all three channel identities and exact uploaded bytes with controlled GitHub adapters.
- [x] 4.3 Implement retry reconciliation without overwriting tags or assets; verify partial-upload recovery, duplicate/conflicting assets, moved tags, wrong prerelease state, authentication/network failure and queued older events.
- [x] 4.4 Wire focused release-tooling tests into the existing root/PR validation path and run them; verify ordinary extension validation and CLI release tests still pass without changing CLI publication behavior.

## 5. Documentation and rollout

- [x] 5.1 Add docs/extension/RELEASE.md and links from existing extension documentation; verify channel examples, version-bump procedure, ZIP installation, permission/configuration setup and retry/rollback instructions match the implementation.
- [x] 5.2 Document the required dev/beta/main EXTENSION_BUILD_CONFIG shape using placeholders, and confirm operator-provided public values before configuring any remote variables; verify the rollout checklist distinguishes missing setup from a completed release.
- [x] 5.3 Build and inspect synthetic preview/beta/production archives locally, run appropriate regression tests and strict OpenSpec validation, and complete REVIEW.md Bugs/Security/Compliance passes; resolve Important findings before any behavior-changing push.
- [ ] 5.4 Prepare the task PR targeting dev with OpenSpec: extension-release-channels and actual validation evidence; verify no tag, GitHub Release, browser-store upload or long-lived-branch merge was performed during implementation.

The human approved implementation and push on 2026-10-15 and chose to configure EXTENSION_BUILD_CONFIG later. Remote configuration is intentionally left to the human; local verification uses synthetic public inputs.

Validation completed locally: 16 focused release tests (including the final detect-command fixture), 104 preflight/tool tests with 2 platform skips, 63 extension tests, extension typecheck, actual preview/beta/production WXT ZIP inspection, and 22 CLI tooling tests (the network-dependent consumer test passed on retry after an npm timeout). Strict OpenSpec validation passed all 43 items. Local Bugs, Security and Compliance review used change-id extension-release-channels and found no remaining Important findings. No application end-to-end or live publication test was performed.
