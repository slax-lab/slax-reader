# Local pre-push review

OpenSpec: cli-release-channels

Reviewed on 2026-10-14 using the three passes required by root `REVIEW.md`. No Important findings.

## Bugs

Checked push comparison, destination-specific version increases, skip behavior, original-revision checkout, branch reachability, derived build versions, manifest restoration, exact archive transfer, tag reconciliation, preview/stable dispatch, registry verification, and partial-failure retries. Existing latest-version guards remain. Controlled process checks exercise dev, beta and main, including a changed tag between validation and distribution and reproducible archive bytes.

## Security

Checked that only canonical repository branch events reach release processing, source/manifest/archive identities are bound, GitHub writes use workflow-scoped credentials, OIDC is scoped to main, and preview paths do not call npm. Subprocess arguments use executable argument arrays, tag/metadata fields are derived from validated inputs, and tag/asset conflicts fail without overwrite. No deployment environment files or credentials are read or added.

## Compliance

Matched the behavior-changing diff to `cli-release-channels` among the active changes and read its proposal, design, tasks and delta spec. The user authorized the first PR's `1.0.2` bump; subsequent versions remain dynamic. The implementation retains the PR/full-validation versus release/archive-smoke boundary and leaves branch promotion to humans. Full CLI integration and real standalone installation now pass for dev, beta and stable archives after networking and localhost access became available. README and the rulesync source overview now describe branch-driven publication; generated agent documents were regenerated rather than edited by hand. The migration's historical tag-only contract is explicitly superseded and remains flagged for its separate archive.

## Evidence and limits

- Refreshed the task worktree from live origin/dev before final validation; the primary checkout is untouched.
- Frozen dependency installation passed on Node 22.22.3.
- CLI typecheck/build and the five CLI integration cases passed; executable version is `1.0.2`.
- All 22 CLI tooling cases passed, including dev/beta/stable archive installation, help/version and controlled authenticated interactions outside the workspace. A temporary pnpm fixture dependency-layout issue found by these checks was fixed before submission.
- Root preflight/tooling checks: 104 passed, 0 failed, 2 optional checks skipped.
- Rulesync doctor and generated-file checks passed; strict OpenSpec validation: 41 passed, 0 failed; `git diff --check` passed.
- Reviewed full workflow reruns: attempt-specific artifact names avoid upload collisions, and distribution uses the immutable successful build artifact ID. Failed-job retries retain the tested original archive instead of selecting an artifact by the retry attempt number.
- npm OIDC authorization and workflow-token tag creation still require the first authorized post-merge release; local tests never create public CLI tags, Releases or npm versions.
