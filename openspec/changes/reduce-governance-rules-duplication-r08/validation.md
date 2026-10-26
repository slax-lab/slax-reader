# Validation

## Status

Implementation of `reduce-governance-rules-duplication-r08` is complete on `feat/implement-layered-governance-r23`, cut from `dev` at `751e337b` (F05 PR #392, D06 PR #393, D06 archive PR #394). This file records the prerequisite verification, the implementation checks, the reconciliation with D06's archived optional material-UX semantics, the document exercise, the local pre-push review, and the declared gaps. The task pull request and the archive follow-up are pending (tasks 6.3 and 7.1).

The earlier revision-time record of the proposal artifacts remains valid; its key results are retained in § 7 rather than repeated command by command. It verified the R18 plan, not an implementation.

## 1. Prerequisite verification (2026-10-26)

| Check | Evidence |
| --- | --- |
| F05 is on the base | `README.md:25` says "This monorepo hosts all Slax Reader code"; the repository table has an `apps/mobile` row (`README.md:31`); `packages/reader-embed` is listed |
| D06 is on the base in its approved optional form | `DESIGN.md` has `### 10.1` (optional demo offer, recommendation triggers, feedback-first wait, approval record) and `### 10.2` (hands-on acceptance); `REVIEW.md` "Do not report" states an absent demo or record is not a finding |
| D06's delta is archived | `openspec/changes/archive/2026-10-26-add-material-ux-demo-review-d06/` exists; `openspec/specs/change-verification/spec.md` contains the four archived material-UX requirements; `openspec list` shows no active D06 change |
| I09 is independent | `docs/README.md` is absent; no R08 task depends on it; task 5.1 is marked not applicable |
| Base history | `git log --oneline -1` → `751e337b Merge pull request #394 ...`; the preceding commits include #393 (D06) and #392 (F05) |

The H3 gate is satisfied. R08 does not absorb F05's or D06's content.

## 2. Implementation checks

All commands ran in `/Users/boxcounter/Code/Slax/slax-reader/.tower/worktrees/wt-34` on 2026-10-26.

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | exit 0 (worktree had no `node_modules`) |
| `pnpm agent:sync` | exit 0. Wrote `AGENTS.md`, `CLAUDE.md`, `apps/web/AGENTS.md`, `apps/extension/AGENTS.md`, `apps/mobile/AGENTS.md`; no other generated output changed |
| `pnpm agent:check` | exit 0. Rulesync doctor and `generate --check` passed; `openspec validate --all --strict` → `Totals: 76 passed, 0 failed (76 items)`; gh-aw compiled 2 workflows with 0 warnings and reported "Compiled workflows match their sources." |
| `pnpm exec openspec validate reduce-governance-rules-duplication-r08 --strict` | `Change 'reduce-governance-rules-duplication-r08' is valid`, exit 0 |
| `pnpm test:ci` | 67 tests passed, 0 failed, exit 0 (CI scope, workflow gates, rulesets, promotion gate) |
| `pnpm test:preflight` | 104 passed, 0 failed, 2 skipped, exit 0 |
| `pnpm design:check` | `Validated 33 design reference files`, exit 0 |
| `git diff --check` | no output, exit 0 |

Structural and link checks:

- The root source `.rulesync/rules/overview.md` is 56 lines; generated `AGENTS.md` is 59 lines (50–60 target). The obligation set and owner pointers match `design.md` D4.
- The branch table in `docs/BRANCHING.md` matches `.github/rulesets.expected.json` for all three branches and merge methods. A script compared required contexts and allowed merge methods, normalizing the human-readable "merge commit only" to `merge`; result `MATCH`.
- The six documents required by H4 (`DESIGN.md`, `REVIEW.md`, `docs/BRANCHING.md`, `docs/CI.md`, `docs/DEFINITION-OF-DONE.md`, `docs/release/VERSIONING.md`) each contain exactly one non-empty **Owns**, **Does not own**, **Intake**, and **Outflow** label immediately after the H1.
- Every path referenced by the changed documents exists: `docs/web/deployment.md`, `docs/api/DEV-AND-CI-EN.md`, `docs/cli/RELEASE.md`, `docs/extension/RELEASE.md`, `docs/mobile/release.md`, the four per-application development guides, `docs/mobile/README.md`, `apps/mobile/AGENTS.md`, the three cited specs, `.github/rulesets.expected.json`, `rulesync.jsonc`, `tooling/check-gh-aw-drift.sh`, `tooling/rulesets.mjs`, `tooling/ci-scope.mjs`, `tooling/ci-workflow.test.mjs`, and `docs/design/reference/`.
- Every `DESIGN.md` section cited by the scoped rules exists: §4.2, §4.3, §5.1, §5.2, §6, §7, §7.3, §7.4, §9, §10.1, §10.2.
- The retained pointers remain correct: `tooling/rulesets.mjs:204` points at `docs/CI.md` for ruleset-drift authentication, and `docs/mobile/release.md:80` points at `docs/CI.md` for the Mobile EAS contract; both sections remain in `docs/CI.md`.
- No stale pointer to `"Definition of Done" in AGENTS.md` remains in the living documents; the only occurrences are the historical context in this change's `design.md`/`validation.md` and the recorded review-target description.

## 3. Verification-policy alignment

The approved H1/H2 wording is identical across the policy surfaces:

- **Root rules:** "Documentation-, comment-, and typo-scale changes are exempt when the change states the exemption." and "derived from its diff's touched surface, any related living specs, and the affected app's documented smoke flows".
- **`docs/DEFINITION-OF-DONE.md`:** the same two sentences.
- **`change-verification` requirement:** the same two sentences.
- **`change-verification` scenarios:** "touches only documentation, comments, or typos" and the three refactor inputs.
- **`.github/PULL_REQUEST_TEMPLATE.md`:** the exemption line includes comments; the refactor line includes related living specs.

## 4. Material UX reconciliation with D06's archived form

- D06 was approved and implemented with the demo as an **optional** requirements-discovery step, then archived (PR #393, archive PR #394). Its two requirements state that a missing demo or record is not a Compliance finding and never blocks a merge, while hands-on acceptance stays mandatory.
- The `change-verification` delta is a `MODIFIED` block for the first requirement. A sentence-level diff against the living requirement shows only the two intended changes: the refactor input adds "any related living specs", and the exemption adds "comment". Every other sentence is byte-identical, so the archive applies cleanly on top of D06's four added requirements.
- Earlier R08 text that described the demo as a mandatory gate was reconciled in this branch: `proposal.md` § "Preserved hard constraints" and § "Dependencies and delivery sequence", `design.md` § "Target file specifications" and § "Preserved hard constraints", and `agent-rule-governance` § "Deduplication preserves hard constraints" now state the optional semantics; the scenario "Material UX demo is declined or absent" records the no-finding rule. The root rules, `REVIEW.md`, `DESIGN.md` §10.2, and the pull request template carry the same semantics.
- A follow-up independent review found one Important finding: several current-target design sections still carried the pre-approval mandatory form. This branch sweeps them: the D4 root outline and the duplication audit now state the optional offer, the no-finding rule, and no Important consequence; D10 and the prerequisites table describe D06's approved implementation (PR #393) and archive (PR #394) instead of the pre-approval `REVIEW.md` step and PR-template item; the migration plan and open questions record the cleared section 3 gate; the rejected self-contained H3 alternative is explicitly marked as history, and the remaining pre-approval wording in the revision-time facts and the historical delivery-status table is explicitly historical. No current-target mandatory-demo claim remains.
- No mandatory-demo wording was restored.

## 5. Document exercise (task 6.1)

The documentation set was opened and inspected file by file: all six H4 documents, the root rules source and generated outputs, the scoped rule sources and generated app files, the pull request template, and `openspec/config.yaml`.

- Each document's H1, scope block, and section order render as intended; tables in `docs/BRANCHING.md` and `docs/CI.md` parse (header, separator, one row per branch or section).
- `docs/CI.md` no longer contains the protection table, the branch-policy intro, or the approval-policy prose; `docs/BRANCHING.md` contains them once.
- `docs/DEFINITION-OF-DONE.md` has no Material UX, Mobile, or Review-enforcement section; each reference points at `DESIGN.md` §10.1/§10.2, `apps/mobile/AGENTS.md`, or `REVIEW.md`.
- No documentation index exists (`docs/README.md` absent), so there was no index route to check; this is I09's independent scope.

Declared gap: the Markdown files were inspected as rendered structure and raw text, not in a browser. This is a documentation-only change and the verification exemption applies; the structural exercise above was still performed.

## 6. Local pre-push review (task 6.2)

The review followed `REVIEW.md`'s three passes.

| Pass | Result |
| --- | --- |
| Bugs | Two findings, both fixed: (1) the root `openspec update` generator entry omitted the `agent-config drift check`, which `agent-rule-governance` requires for each generator class — added; (2) the DoD's UI-visible bullet implied §6 requires responsive widths and states, which §6 does not own — reworded to point at the matrix while crediting `DESIGN.md` for the theme, width, and state requirements. No remaining bug findings. |
| Security | No secrets, credentials, new dependencies, network calls, or executable code. `git diff --check` clean. No findings. |
| Compliance | The diff implements this change's proposal and delta with one change-id; H1/H2 texts agree; H4 labels are present; the optional material-UX semantics match the archived living spec; no hard constraint was removed. No Important findings. |

The fixes were re-verified: `pnpm agent:sync` regenerated the changed root outputs, and `pnpm agent:check` passed again with `Totals: 76 passed, 0 failed`.

## 7. Proposal-revision record (retained)

The R18 revision was validated before implementation: `openspec validate --all --strict` → 76 passed, 0 failed; `git diff --check` clean; the approval record names Alex Lee, 2026-10-26, with H1–H4 decided; and the delivery-history claims were checked against `recovery/base`. That record verified the plan artifacts, not this implementation. Its detailed command transcript is retained in git history for the branch's earlier commits.

## 8. Scope and package impact

- Implementation diff: `.rulesync/rules/overview.md`, `design-system.md`, `web-design.md`, `extension-design.md`, `mobile-architecture.md`; generated `AGENTS.md`, `CLAUDE.md`, `apps/web/AGENTS.md`, `apps/extension/AGENTS.md`, `apps/mobile/AGENTS.md`; `DESIGN.md`, `REVIEW.md`, `docs/BRANCHING.md` (new), `docs/CI.md`, `docs/DEFINITION-OF-DONE.md` (new), `docs/release/VERSIONING.md` (new), `.github/PULL_REQUEST_TEMPLATE.md`, `openspec/config.yaml`; and this change directory.
- No `apps/**` source, `packages/**`, `deploy/**`, workflow, ruleset, dependency, or `package.json` change. The only `apps/**` files changed are generated agent guidance under `apps/*/AGENTS.md`.
- No package-version decision applies: this is a documentation and agent-rule change with no shipped behavior, runtime dependency, native integration, or build/package output.
- CI: the `agent-config drift check` is the only gate whose input changes. No required context or merge method changes.

## 9. Declared gaps

- **Task pull request not opened.** Task 6.3 stays unchecked: the mission commits the implementation for independent review and does not push or open the pull request until the tower reports the reviewed result.
- **Archive pending.** Task 7.1 waits for the task pull request to merge; D06's delta is already archived, so no active delta collision remains.
- **Human review of H4 accuracy and the branch table is pending.** Presence and mechanical table equality were verified here; the approved H4 record assigns the accuracy judgment to human review.
- **No browser rendering.** See § 5: Markdown was inspected structurally, not rendered in a browser. The documentation exemption applies, and the structural exercise was performed anyway.
- **I09 not implemented.** The documentation index remains an independent follow-up; task 5.1 is not applicable in this change.
