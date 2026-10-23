# Proposal

## Why

The branching model assumes three protected environment branches, but the protection was designed as one uniform ruleset copied onto all of them. In practice the ruleset was later narrowed to `dev` only, leaving `beta` and `main` with zero protection — direct pushes, force-pushes, and deletion are all possible today — and nothing detected the drift, because ruleset state lives only in GitHub settings and is neither codified in the repository nor checked.

The deeper problem is the model itself: the three branches gate three different decisions and own three different risk classes, so they need three different kinds of protection, not one uniform one. `dev` gates individual-change quality (yet application CI suites are not required checks, so failing tests do not block merges). `beta` gates batch release-readiness and has real internal consumers, yet has no gate at all. `main` gates provenance — its tree must be identical to what `beta` validated — yet today nothing enforces even the merge-commit-only discipline that keeps histories convergent. The hotfix path is undefined, so an urgent fix when the upstream branch carries unready work has no sanctioned route.

## What Changes

- Replace the uniform-protection requirement with per-branch protection contracts: each long-lived branch gets an explicit contract (state guarantee, allowed write paths, entry conditions, consumer assumptions), and rulesets become the enforceable subset of those contracts.
- `dev`: keep PR-only, no deletion, no force-push, and review requirements; **add the scoped application CI suites as required status checks** so red typecheck/tests block merges (skipped scopes still count as passing, keeping ci-scope selection compatible).
- `beta` and `main`: introduce dedicated rulesets restoring baseline protection (PR-only, no deletion, no force-push) and restricting `allowed_merge_methods` to merge commits only, making the merge-commit-only promotion/sync-back discipline structural instead of documented. No approving-review requirement for promotions: the content was reviewed on `dev`, and the administrator's merge is the designed release-decision act (admin bypass in `pull_request` mode remains for exceptional cases). `hotfix/*` heads fall outside that rationale, since they never passed through `dev`, so hotfix pull requests require one approving review from an approver other than their author.
- Add a required **promotion integrity** status check on `beta` and `main`: it asserts the pull request's head branch is an allowed source (`dev` or `hotfix/*` for `beta`; `beta` or `hotfix/*` for `main`) and that required validation on the head has succeeded. For promotions to `main` it additionally requires a successful deployment of the head commit to the beta environment.
- Define the **hotfix flow**: a `hotfix/<name>` branch is cut from the branch that needs the urgent fix (`beta` or `main`), merges back to that branch under expedited gates, and the fix is then propagated back downstream (to `dev`, and to `beta` when the hotfix landed on `main`) before normal promotions resume.
- Codify the expected ruleset state as version-controlled JSON in the repository and add a **scheduled drift-detection workflow** that compares the live rulesets (via the GitHub API) against the codified state and opens an issue on drift. This is detection, not a blocking pull-request gate.
- Update the agent-facing rules source (`.rulesync/`) and `docs/CI.md` to describe the per-branch model, and regenerate the agent instruction files.

## Capabilities

### New Capabilities

### Modified Capabilities

- `release-branching`: the uniform-protection requirement is replaced by per-branch protection contracts with differentiated required checks and merge-method enforcement; a hotfix flow requirement is added; a requirement for codified ruleset state with scheduled drift detection is added.

## Impact

- GitHub repository rulesets: one new ruleset for `beta`/`main` (or restructured per-branch rulesets), applied through the GitHub API/settings; expected state codified in-repo.
- `.github/workflows/`: new promotion-integrity check workflow; new scheduled ruleset drift-detection workflow; required-check wiring changes on `dev` (application CI contexts become required).
- `tooling/`: a script to export/compare repository rulesets against the codified JSON, with tests.
- `openspec/specs/release-branching/spec.md`, `.rulesync/` sources and regenerated agent files, `docs/CI.md`.
- No application code, no shipped UI/assets, no package output changes; CLI/Extension/Mobile versions are unaffected.
- Token/permissions: reading rulesets in CI requires a token with repository Administration read permission (a fine-grained PAT or GitHub App); the default `GITHUB_TOKEN` is insufficient.
