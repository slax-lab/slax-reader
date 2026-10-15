# Proposal

## Why

The current CI filters select whole application suites for unrelated tooling, deployment documentation, and presentation changes, and repeat validation after merge. CLI Releases also use repository-wide generated notes, so the published CLI changelog includes unrelated Web and Mobile work.

## What Changes

- Define one tested policy for selecting checks from the complete pull-request diff, including shared workspace dependencies, configuration guards, tooling, design references, and Mobile evidence.
- Separate Web and Extension validation within Frontend CI; route root tooling tests to their own scoped checks instead of running application suites for every `tooling/*.mjs` edit.
- Replace API's `deploy/**` catch-all with API-specific inputs. Distinguish ordinary documentation from executable inputs and evidence consumed by checks.
- Run full application validation on pull requests, remove duplicate post-merge application CI, and cancel superseded read-only PR runs. Keep release builds, exact-archive smoke checks, deployment prerequisites, and release serialization.
- Keep the required `agent-config drift check` context present for every PR while running rulesync, OpenSpec, and gh-aw compilation only when their inputs change. Configuration drift and detection failures must still fail visibly.
- Generate CLI-only Release descriptions from an explicit previous CLI release baseline and relevant source paths, replacing repository-wide automatic notes. Preserve stable/dev/beta distribution and existing package/checksum identities.
- Document the selection matrix and verify both avoided work and retained required coverage with controlled fixtures.

## Capabilities

### New Capabilities

- `ci-scope-selection`: safe, dependency-aware selection of application, tooling, documentation-evidence, and configuration checks, with stable required status reporting.
- `cli-release-notes`: deterministic CLI-scoped release descriptions, channel-aware comparison baselines, and retry behavior.

### Modified Capabilities

None. The existing `agentic-pr-review`, `release-branching`, and `runtime-icon-registry` requirements remain in force. The merged but unarchived `cli-release-channels` change continues to own release eligibility and distribution; this change specifies how its generated notes are scoped. The concurrent Mobile version/CI work in PR #231 owns removal of native build jobs and its existing capability deltas; this change must sequence integration with that work rather than duplicate those deltas.

## Impact

- Application and agent-config workflows, a shared CI selection utility, focused tooling checks, and workflow regression fixtures.
- `tooling/cli-release.mjs`, release process fixtures, and `docs/cli/RELEASE.md`.
- New CI operations documentation and narrowly necessary root script/test routing updates.
- Root dependency manifests and the shared lockfile initially retain conservative validation fan-out; this proposal does not claim package-graph-aware lockfile minimization.
- No UI, public API, branch ruleset, historical Release, tag, or publication behavior changes. The initial implementation was kept uncommitted for inspection; the human subsequently authorized delivery through the task PR targeting dev.
