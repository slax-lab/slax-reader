# Design

## Context

See proposal.md for motivation. The planning baseline is dev commit e0058d02feb72d86a48db4c149188e7972090d9b, including merged CLI channel automation from PR #229. The isolated branch is ci/minimize-ci-scope. The initial implementation was left uncommitted for inspection; delivery through PR #238 was subsequently authorized.

Frontend CI currently has one unconditional check job for Web, Extension, shared types, preflight, design references, and icons. Its tooling/*.mjs trigger includes API, Mobile, and CLI scripts. API CI selects every deploy path. Mobile CI selects docs/mobile/** and runs again on dev/beta/main pushes; the baseline also still has native Android/iOS jobs. PR #231 independently removes those native jobs and changes Mobile version ownership. API and Frontend CI repeat on main pushes; CLI validation already runs only on PRs.

agent-config always installs the workspace, runs rulesync and OpenSpec, installs pinned gh-aw, and performs a full compilation. Its exact job name, agent-config drift check, is a required context. tooling/check-gh-aw-drift.sh also reads its gh-aw pin from agent-config.yml, so moving or deleting that configuration would create unnecessary compatibility work.

CLI release evaluation intentionally runs on every dev/beta/main push, then skips unless apps/cli changes and its stable manifest version increases. That contract belongs to the merged cli-release-channels change and remains intact. githubRelease currently passes generate_release_notes: true. The public cli-v1.0.2-dev description includes unrelated Web PRs #226/#227 and Mobile PR #193.

## Goals / Non-Goals

**Goals:** Make expensive work follow explicit dependencies, preserve full PR coverage, explain selections, and make release descriptions accurate across promotion and retries.

**Non-Goals:** Package-graph-aware lockfile diffing, individual-test impact analysis, changing AI review policy, editing live rulesets, publishing a release, rewriting historical releases, or adding standalone native CLI binaries. Native Mobile build removal remains owned by PR #231.

## Decisions

### 1. One selection policy with explicit conservative boundaries

Add a dependency-free Node utility under tooling for change enumeration and pure path-to-scope selection. Use local Git with validated immutable revision arguments, the PR's actual base/head, and a complete merge-base comparison. Read NUL-delimited paths and preserve deletion and rename coverage; disabling rename detection is acceptable when it represents renames as old-path deletion plus new-path addition. Fail visibly when comparison cannot be established. Emit machine-readable booleans plus human-readable reasons.

Keep existing application workflow identities, remove top-level path filters from their PR triggers, and use lightweight detection followed by job/step conditions for independent scopes. A dedicated tooling workflow owns inexpensive repository tooling checks. A shared policy avoids copying broad directory heuristics into scripts; workflow regression fixtures verify that every suite consumes the correct detection outputs. Workflow/policy edits must select their own validation. Detection does not require pnpm installation.

This retains application-local environments and avoids a large all-workflows migration. A single new orchestration workflow was considered, but would complicate the required job name, gh-aw pin lookup, and existing workflow contract fixtures without being necessary to remove the expensive fan-out. Keeping top-level path filters was also considered and rejected: GitHub can limit the changed-file window used for triggering, so it could omit a true consumer before the local detector runs. The minimum here is the justified expensive checks; unrelated workflows can still have a small detection-only run.

Initial scope matrix:

| Changed input | Selected expensive work |
| --- | --- |
| Web runtime/config/tests | Web typecheck/tests and required contracts, selection, and icon prerequisites |
| Extension runtime/config/tests | Extension compile/tests and required shared prerequisites |
| API runtime/config/tests | API generation, lint, typecheck, tests, and offline Worker build |
| Mobile runtime/config/tests | Existing Mobile application validation, respecting the job set after integrating PR #231 |
| CLI runtime/config/tests | Existing full CLI checks on both supported Node versions |
| packages/contracts/** | All five application consumers |
| frontend-types, frontend-utils, selection | Web and Extension, including applicable package checks |
| tooling/web.mjs or tooling/extension.mjs | Its corresponding app plus relevant tooling tests |
| tooling/run-app.mjs and tooling/env-files.* | Web and Extension plus relevant tooling tests |
| tooling/api.mjs | API and relevant dispatcher tests |
| tooling/mobile.mjs and executable Mobile deploy helpers | Mobile and relevant tooling tests |
| tooling/cli.mjs | CLI and relevant dispatcher tests |
| tooling/cli-release*.mjs or CLI release workflow | Release/CLI tooling tests; no Web or Extension suite |
| tooling/pnpm-command.mjs | Every app dispatcher consumer plus its tooling tests |
| ordinary docs/mobile guides or deploy/mobile/README.md | No application compilation or bundle solely for prose |
| docs/mobile evidence/manifests consumed by validators | Relevant evidence/fixture validation, with its documented prerequisites |
| docs/design/reference/** | Design provenance checks; icon checks only for consumed provenance inputs |
| Web registry source and icon validation inputs | Icon validation and affected Web validation |
| API Cloudflare template and executable local infrastructure | API checks and documented frontend configuration tooling consumers |
| Mobile deployment inputs | Mobile-related checks, never API solely for deploy directory membership |
| root package.json, pnpm-workspace.yaml, pnpm-lock.yaml | Conservative full validation and relevant configuration guards |

Do not discard arbitrary Markdown or JSON by extension: Nuxt content and Mobile fixture inputs are executable or validator-consumed inputs. Ordinary prose exceptions must be explicit; unfamiliar application paths remain conservative. The separate evidence-only Mobile job and coverage ledger were later retired in `retire-mobile-evidence`; source, asset, and fixture validation remain part of `pnpm mobile -- check`.

The Web schema at `apps/web/env.schema.ts` also selects Extension release tooling because its shared-configuration fallback imports that schema directly; it does not select the unrelated Extension application suite.

### 2. Separate checks by purpose and remove repeated application validation

Frontend CI retains its workflow identity but separates Web, Extension, and shared prerequisite handling. Keep pnpm icons:check before accepting selected Web checks, preserving runtime-icon-registry. Move root tooling validation out of unconditional Web/Extension and duplicate CLI matrix execution; retain actual CLI compatibility coverage on Node 22.22.2 and 24.15.0. Existing CLI workflow fixtures that currently require pnpm test:preflight inside each matrix job must instead verify that its relevant coverage is selected in the tooling lane.

Remove push triggers from application CI, retaining PR validation for task and promotion PRs. Releases keep their own build and consumer smoke tests; API/Web deployment workflows keep their existing triggers, immutable-source checks, permissions, and release-specific verification. CLI release keeps its lightweight all-branch-push detect job, as required by the existing release contract.

Use per-workflow/per-PR concurrency with cancel-in-progress for read-only validation. Do not apply this to AI review, deployment, or release serialization, whose cancellation contracts differ.

Integrate the latest state of PR #231 before editing Mobile CI. If it has merged, preserve its reduced job set. If it remains open, preserve native job ownership and apply selection to the existing jobs without independently deleting them or editing its Mobile capability deltas.

### 3. Preserve the required configuration context and scope its steps

agent-config stays triggered for every PR and keeps the exact agent-config drift check job name. Perform lightweight scope detection before pnpm installation. Install only when one of its checks is selected; set up gh-aw only for compiled-workflow inputs. Rulesync scope includes .rulesync, rulesync configuration, all generated agent paths, and shared toolchain changes. OpenSpec scope includes its specs, active changes, configuration, and relevant toolchain changes. gh-aw scope includes Markdown workflows/imports, aw.json, compiled locks, .github/aw, its pinned setup, and drift tooling.

When gh-aw is selected, retain full compile --strict --purge --no-check-update, including orphan detection; do not substitute per-file compilation. Keep required reporting in the executing guard job rather than introducing a dependent success job that can be skipped after upstream failure. A successful no-op is explicit. Do not use a top-level paths filter on this required workflow: GitHub documents that skipped required workflows can leave checks pending, while internal conditions can complete the workflow normally.

### 4. Generate and bind CLI-scoped descriptions before publication

Keep release eligibility, version derivation, tag creation, npm publishing, and archive verification intact. Replace generate_release_notes: true with an explicit body generated during preparation and transferred with the validated release artifact. Include the source revision, version, channel, baseline, and scoped entries. Record a notes digest and baseline identity in release metadata and validate them before distribution writes.

Discover applicable tags from complete fetched Git history. Parse only stable CLI tags and the exact dev/beta suffixes. Select the highest lower base version in the candidate's channel that is an ancestor of its source. Exclude the candidate tag even on retries. The first preview channel uses the highest lower ancestor stable CLI tag; no applicable tag is a clearly labelled first-release case. Git enumeration/ancestry failures are errors, not first releases. This avoids using the repository's latest Release, which can belong to a different channel or product.

Collect non-merge commits in that range with CLI-relevant paths: apps/cli/**, packages/contracts/**, tooling/cli*.mjs, tooling/pnpm-command.mjs, .github/workflows/cli-*.yml, and docs/cli/**. Present shared inputs as shared inputs, and include only the affected CLI portion of a mixed change. Do not use generic root package/lockfile changes as changelog inclusion criteria; unrelated app dependency updates would recreate the noise. Do not infer new features from a manifest-only version increase. Avoid an unfiltered Full Changelog link presented as CLI-only.

Use prepared notes when creating a missing Release; preserve the description of an already existing matching Release during asset reconciliation. Historical notes are not automatically repaired by this local change. Documentation continues to distinguish the installable tgz from GitHub's automatic whole-repository source archives.

### 5. Verify observable selection and publication behavior

Create table-driven selection fixtures covering every matrix row, unions of scopes, actual PR bases, rename/delete inputs, filenames with spaces, a change set larger than GitHub's trigger diff window, and failed/incomplete history. Verify workflow routing and required-status failure paths, not merely text mirroring the implementation.

Extend controlled release process fixtures with unrelated Web/Mobile commits, multiple channels, promotion merges, first-channel fallback, a manifest-only release, malformed history, an existing candidate tag, changed notes, and resumed asset upload. Assert the Release POST contains the explicit CLI body and lacks generate_release_notes. Preserve exact-byte package checks and no-write failure tests. Local verification must not create public tags, Releases, or npm versions.

### 6. Add independent daily full validation

The human adopted the follow-up in PR #238 comment 6211394910. Add `full-ci.yml`, scheduled at 20:23 UTC (04:23 Asia/Shanghai the following day) and available through `workflow_dispatch`. Require the dev ref before running the suites; dev is the repository's default branch, which GitHub uses for schedules. Results remain visible in Actions without adding messaging or publication jobs.

Expose the six existing validation workflows through `workflow_call` with a boolean `full_validation` input, defaulting to false. The daily caller passes true to every workflow. Full mode skips the change detector and unconditionally enables the application, tooling, design, and configuration validations. Standalone icon and evidence lanes remain unnecessary because the full Web and Mobile suites already execute those validators. PR mode keeps complete-diff selection and fails when detection fails.

Jobs depending on the skipped detector use an explicit cancellation status function and distinguish successful PR selection from full mode, so GitHub's implicit success condition cannot silently skip daily checks. Configuration steps honor full mode without consulting scope outputs. Each reusable workflow includes its own identity in its concurrency key because the GitHub workflow context belongs to the caller; daily calls cannot cancel sibling suites or PR runs. The parent daily workflow serializes its own runs without canceling executing validation. No deployment, release, AI review, or write-permission workflow is called.

Regression fixtures evaluate the workflow graph with every selection output false and the detector skipped, cover detector failure and cancellation in PR mode, verify all six calls and configuration steps, exercise the dev-ref guard, and test concurrency isolation under the shared caller name.

## Risks / Trade-offs

- Incorrect routing could silently omit checks. Mitigation: consumer matrix fixtures, conservative unknown inputs, workflow-output wiring checks, and visible detection failures.
- Root manifests/lockfile can still select more work than necessary. Mitigation: retain this explicit conservative boundary; semantic dependency-graph minimization is separate work.
- Several lightweight detectors remain because workflow identities are preserved. Mitigation: run them without dependency installation and share their implementation; optimize checkout overhead separately if measured cost warrants an orchestration migration.
- Splitting frontend jobs may duplicate a small setup cost when both apps change. Mitigation: cache package downloads and keep expensive suites independent; measure before adding artifact-sharing complexity.
- A mixed commit can have an application-oriented subject despite touching shared CLI contracts. Mitigation: group and reference the actual CLI-relevant paths rather than advertise the unrelated subject as a CLI feature.
- Concurrent Mobile work can change job structure. Mitigation: sequence integration with PR #231 and preserve its capability ownership.
- Existing workflow fixtures assert old command placement. Mitigation: update them to prove equivalent coverage in the new lane and preserve release/deployment contracts.

## Migration Plan

1. Obtain human review of these artifacts before implementation.
2. Refresh the worktree from dev and integrate the reviewed state of PR #231.
3. Add and verify selection policy/routing, then apply it to application and configuration workflows and root tooling tests.
4. Add CLI-scoped notes and extend controlled release fixtures and operations documentation.
5. Run focused checks, strict OpenSpec validation, and all three local REVIEW.md passes. The initial inspection checkpoint leaves edits uncommitted; the later authorized delivery uses the task branch and PR.
6. A later authorized PR targets dev with OpenSpec: minimize-ci-scope. Deployment, release publication, and ruleset changes are not performed as part of local verification. Rollback is a later reviewed revert of the workflow/tooling changes; no data migration or remote state repair is required.

During PR integration, preserve the Extension release checks added by merged PR #241. Route them through their own Extension-tooling scope and a Node 24 tooling lane, including the ZIP inspector and the shared CLI release helper they import. Keep its existing branch publication queue non-canceling. A regression fixture must evaluate concurrency keys across successive heads, independent PRs, and independent workflows.
