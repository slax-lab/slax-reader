# Proposal

## Status: retrospective origin, revised plan, approved for implementation (subject to prerequisites)

This change began as a retrospective record of an implementation that predated its proposal. That implementation was merged into a local `dev` history that is not the delivery base. The delivery base was later restored; the implementation is preserved on its task branches. This revision, produced after an information-architecture review of the first proposal, replaces that implementation plan instead of asking the human to approve it item by item. The human approved this revision for implementation on 2026-10-26, subject to the H3 prerequisites.

**Implementation base (2026-10-26).** The H3 prerequisites landed on `dev` at `751e337b`: F05 merged in PR #392; D06 was separately approved, implemented in PR #393 with the demo as an optional requirements-discovery step, and archived in PR #394. R08 implementation starts from that base. Where this revision was written against D06's pre-approval branch, its material-UX text is reconciled to D06's archived optional semantics.

**Previously merged locally, now preserved on task branches; `dev` restored.**

- At revision time, the delivery base was `recovery/base` at `773d6093` (ten commits ahead of then-`origin/dev` at `9188be24`). It contains none of F05, D06, R08, or I09.
- No approval record existed for any of those implementations. Their change directories are inconsistent: D06 carries a `validation.md` on its branch, while R08, F05, and I09 do not. The old merges are history, not approval.
- The first revision of this proposal asked the human to adjudicate items A1–A11 and wording items W1–W18. That record is withdrawn. Git history keeps it; it is not the plan.
- **Implementation start was gated by the prerequisites.** This approval covers R08 implementation only. Sections 3–6 stayed unchecked until F05 and D06 were separately approved and on the delivery base, and D06's `change-verification` delta was archived or reconciled. Those gates cleared on 2026-10-26; section 3 records the evidence. The change is implemented on the delivery base; it is not re-applied from `e8d7c422`.
- **Cancellation note.** The user canceled the C10 documentation-consistency work. Its branch and artifacts are not part of this plan; no docs-consistency tooling, generated-path check, scope-header check, or CI-path/test/spec coordination remains. The branch table and any adopted scope headers are verified by human review against the owning documents.

## Approval record

| Field | Value |
| --- | --- |
| Approver | Alex Lee |
| Date | 2026-10-26 |
| Decision | Approved for implementation, subject to the H3 prerequisites |
| Scope | This change (`reduce-governance-rules-duplication-r08`) only. The approval adopts the recommended H1–H4 choices below and does not approve D06. |

- **H1 — verification-exemption scope:** include comments in all verification-exemption texts. The root rules, the Definition of Done, the `change-verification` requirement, its scenario, and the pull-request template exempt documentation-, comment-, and typo-scale changes when the change states the exemption.
- **H2 — no-proposal verification inputs:** include the diff's touched surface, any related living specs, and the affected app's documented smoke flows in the `change-verification` requirement and scenario, the Definition of Done, and the root rules.
- **H3 — prerequisite strategy:** sequence F05 → D06 → R08. R08 does not absorb F05's or D06's content. Section 3 stayed blocked until both prerequisites were separately approved and on the delivery base, and D06's `change-verification` delta was archived or reconciled; those gates cleared on 2026-10-26.
- **H4 — document scope headers:** adopt the four-field Owns / Does not own / Intake / Outflow block for the six documents R08 creates or edits (`DESIGN.md`, `REVIEW.md`, `docs/BRANCHING.md`, `docs/CI.md`, `docs/DEFINITION-OF-DONE.md`, `docs/release/VERSIONING.md`), with human review of label presence and accuracy.

**D06 was not approved by this record.** This approval covers R08 only. D06 was separately approved, implemented with the demo as an optional requirements-discovery step, and archived on 2026-10-26 (PR #393, archive PR #394); its `change-verification` delta is in the living spec.

### Historical delivery status

| Change | Preserved branch and commits | Content | On `recovery/base`? | Relationship to this revision |
| --- | --- | --- | --- | --- |
| F05 | `feat/fix-governance-documentation-facts-f05` at `c8e34890` | README facts and repository map, including `apps/mobile`; API Node range | No | Prerequisite |
| D06 | `feat/add-material-ux-demo-review-d06` at `02f80058` | `DESIGN.md` §10.1 and §10.2, `REVIEW.md` step 6, PR template checklist, root material-UX checkpoint, `change-verification` delta | No | Prerequisite |
| R08 (first attempt) | `feat/reduce-governance-rules-duplication-r08` at `e8d7c422` (`828cc730`, `e8d7c422`; old merge `a4b12fe6`) | First deduplication attempt, framed as A1–A11 | No | Superseded by this revision |
| I09 | `feat/build-canonical-documentation-index-i09` at `d7057cf6` | `docs/README.md` documentation index, mobile release docs | No | Independent follow-up; not required by R08 |

The D06 row records the preserved pre-approval branch content. D06's approved implementation (PR #393, archive PR #394) uses the optional requirements-discovery form described under "Implementation base": `DESIGN.md` §10.1/§10.2 in the optional form, the `REVIEW.md` no-finding clause, and no PR-template mandatory item.

The dependency chain is F05 → D06 → R08. I09 remains an independent follow-up, not a prerequisite and not a dependent of R08.

### Dependencies and delivery sequence

- **Prerequisites.** F05 (`c8e34890`, merged in PR #392) supplies the README repository map, including `apps/mobile`. D06 (approved and implemented in PR #393, archived in PR #394) supplies `DESIGN.md` §10.1/§10.2 in the archived optional form, the root optional-demo checkpoint, the `REVIEW.md` no-finding clause, and a `change-verification` delta. H3 is decided: sequence F05 → D06 → R08. Both prerequisites are on the delivery base (`dev` at `751e337b`), and D06 is archived. R08 does not absorb their content.
- **Independent follow-up.** I09 (`d7057cf6`) adds `docs/README.md` as a human documentation entry point. R08 does not depend on it. If I09 is re-authored, adding a `docs/BRANCHING.md` row and splitting the CI and branch routes is an editorial improvement, verified by human review.
- **Archive gate.** D06's `change-verification` delta and R08's delta target the same capability. D06 must be archived first, or both must be archived in one docs pull request with reconciled blocks.
- **No re-application.** R08 is re-authored on the delivery base; it does not cherry-pick or merge `e8d7c422`.

`design.md` § "Dependencies and delivery sequence" gives the branch evidence, the diffstats, and the approved H3 sequence. `design.md` § "I09 documentation index (independent)" describes the optional index work.

## Why

The repository's governance documents repeated the same policies in several places. The first R08 attempt reduced the line count but mostly moved copies: it treated authority as a single flat "one owner per topic" relation, left procedures in the root rules, and created new duplicates between the root rules, the new Definition of Done, `docs/CI.md`, `docs/release/VERSIONING.md`, and `REVIEW.md`. It also assumed a delivery base that no longer exists.

An information-architecture review of the first proposal found five structural problems and several concrete defects:

- one-owner-per-topic flattened five distinct layers — normative spec, operational document, machine contract, agent entry, and index;
- the root rules still carried setup commands, branch commands, the evidence-recording procedure, and a generated-output table;
- verification policy drifted across four texts, and the review compared only three of them;
- the new Definition of Done absorbed UI demo approval, hands-on acceptance, review enforcement, and Mobile acceptance — three owners in one file;
- scoped application rules were cut down to section pointers, which weakens the rule an app agent actually reads;
- `docs/release/VERSIONING.md` pointed Web/API release conditions at `docs/CI.md`, which does not state them;
- the generated-output table existed in three copies with no check of its own;
- the plan was written against a history that `recovery/base` no longer contains.

Duplication has two costs: a policy drifts between copies, and an edit in one document can silently redefine a contract another document owns. The goal is not fewer lines; it is one owner per layer, with each layer answering a different question.

## What Changes

- Adopt a five-layer authority model — normative spec, operational document, machine contract, agent entry, index — with one owner per topic per layer. A topic may legitimately appear in several layers; the layers must not restate each other's job.
- Create `docs/BRANCHING.md` as the operational owner of long-lived branch responsibilities, the protection table, approvals and merge methods, task-branch discipline, promotion, sync-back, and hotfix steps. Keep `openspec/specs/release-branching/spec.md` normative and `.github/rulesets.expected.json` the machine contract.
- Scope `docs/CI.md` to CI: scope selection, workflow and gate mechanics, the promotion-integrity check, ruleset drift detection, review readiness, daily validation, Mobile EAS, release verification, and local commands. Its H1 becomes `# Continuous Integration (CI)`; the filename stays `CI.md`. Move the protection table and branch policy out.
- Create `docs/DEFINITION-OF-DONE.md` as an evidence-only document: when verification applies, how to derive it, how to record it, and where the per-application guides are. It does not own the UI demo, hands-on acceptance, the design verification matrix, review enforcement, or Mobile acceptance details.
- Make `DESIGN.md` the complete UI workflow owner: §10.1 optional material-UX demo checkpoint (from D06), §10.2 hands-on acceptance procedure with no declared-gap path, and §6 the verification matrix. `docs/DEFINITION-OF-DONE.md` records acceptance evidence and points there.
- Create `docs/release/VERSIONING.md` as the decision protocol. Restore the full indirect-effects list in the root rules. Point Web and API release conditions at `docs/web/deployment.md` and `docs/api/DEV-AND-CI-EN.md`, not `docs/CI.md`.
- Rewrite the root agent rules to roughly 50–60 lines: non-delegable obligations and pointers only. Remove the repository map, setup commands, per-branch contracts, promotion/hotfix mechanics, the manifest table, the evidence-recording procedure, and the per-application smoke list. Keep a three-line generated-output summary and one statement of the same-capability rule.
- Keep the imperative in scoped application rules and add the `DESIGN.md` section reference: the Web theme, raw-color, and SVG rules and the Extension semantic-variable and SVG rules are restored as requirements, not pointer-only summaries.
- Unify the verification-policy texts. Four policy texts state the exemption scope and the no-proposal smoke inputs; the PR template mirrors them. The direction is the approved H1 choice; the no-proposal "related living specs" input is the approved H2 choice.
- Add a short scope-and-change-policy block to each long-lived governance document this change creates or edits. The block names Owns / Does not own / Intake / Outflow; the documentation index routes without restating it. H4 was approved on 2026-10-26.
- Record the prerequisites: H3 sequences F05 → D06 → R08. Both landed on the delivery base on 2026-10-26 (F05 PR #392; D06 PR #393, archive PR #394). I09's documentation index remains an independent follow-up; R08 does not depend on it.
- Keep `REVIEW.md`, `.github/PULL_REQUEST_TEMPLATE.md`, and `openspec/config.yaml` as pointers to the owners; do not duplicate D06's material-UX treatment or the DoD procedure there.

Non-goals:

- Re-deciding the adopted structural direction listed under "Approved structural decisions".
- Approving the first implementation, re-applying `e8d7c422`, or treating the old merges as review.
- Implementing before the section 3 prerequisites are separately approved and delivered; this approval covers R08 only and does not approve D06.
- Changing CI workflows, rulesets, application code, runtime dependencies, deployment paths, or package versions.
- Changing the normative requirements of `release-branching`, `agentic-pr-review`, or `ci-scope-selection`.
- Creating the I09 index or the F05/D06 content inside R08. I09 is an independent follow-up; R08 does not absorb it.

## Authority model

| Layer | Artifacts | May contain | Must not contain |
| --- | --- | --- | --- |
| Normative | `openspec/specs/**/spec.md`; `DESIGN.md` for UI design | SHALL/SHALL NOT requirements, WHEN/THEN scenarios, design intent | Commands, troubleshooting, operational steps |
| Operational | Long-lived operational documents under `docs/`, plus the root review policy `REVIEW.md` | Procedures, commands, troubleshooting, links to the normative rule | A new or changed normative threshold |
| Machine contract | `.github/rulesets.expected.json`, `rulesync.jsonc`, pinned tool versions, drift tooling | The executable contract and its checks | Prose policy |
| Agent entry | Root `AGENTS.md` and scoped `apps/*/AGENTS.md` | Non-delegable obligations, pointers, scoped imperatives | Detailed procedures, per-branch contracts, copied owner rules |
| Index | `docs/README.md` (I09) | Topic-to-owner routing | Rule restatement |

"One owner per layer" is not "one file per topic". The branch topic, for example, legitimately appears in five places: `openspec/specs/release-branching/spec.md` states the contract; `docs/BRANCHING.md` states the operational steps; `.github/rulesets.expected.json` enforces the required contexts and merge methods; the root rules state the non-delegable obligations; `docs/README.md` routes to them. None of those five is a second source of truth for another's job.

## Target document set

| Document | Layer | Owns after R08 | Does not own |
| --- | --- | --- | --- |
| `docs/BRANCHING.md` (new) | Operational | Operational branch responsibilities (one line per branch), protection table, approvals and merge methods, task branches, promotion, sync-back, hotfix, promotion-gate troubleshooting | The normative branch rules; the enforced ruleset state; CI workflow mechanics |
| `docs/CI.md` (rescoped) | Operational | CI scope selection, workflow and gate mechanics, promotion-integrity check, ruleset drift workflow, review readiness, daily validation, Mobile EAS, release verification, local commands | Branch protection, promotion, sync-back, or hotfix policy |
| `docs/DEFINITION-OF-DONE.md` (new) | Operational | When verification applies, deriving it, recording it, per-application verification guides | The optional UI demo checkpoint and hands-on acceptance procedure (`DESIGN.md` §10.1/§10.2), the design matrix (§6), review enforcement (`REVIEW.md`), Mobile acceptance details (`apps/mobile/AGENTS.md`) |
| `docs/release/VERSIONING.md` (new) | Operational | The version-decision protocol and manifest table | Per-application channel mechanics (their release docs); Web/API deployment conditions (their deployment docs) |
| `DESIGN.md` | Normative design contract | Design intent, profiles, tokens, §6 matrix, §10.1 optional demo checkpoint, §10.2 hands-on acceptance | Repository workflow, review policy, verification evidence recording |
| `REVIEW.md` | Operational | Review passes, Important/Nit calibration, compliance pass, the material-UX no-finding rule (D06) | Review automation operations; the DoD procedure |
| Root `AGENTS.md` (from `.rulesync/rules/overview.md`) | Agent entry | Non-delegable obligations, pointers, generated-output summary | Procedures, repository map, setup commands, manifest table, branch mechanics |
| `apps/web/AGENTS.md`, `apps/extension/AGENTS.md` | Agent entry (scoped) | App-specific design deltas as imperatives, with `DESIGN.md` section references | The full `DESIGN.md` rule |
| `apps/mobile/AGENTS.md` | Agent entry (scoped) | Mobile architecture, lifecycle, native acceptance details | The central evidence-recording procedure |
| `docs/README.md` (I09, independent) | Index | Topic-to-owner routing | Rule restatement or document scope |

## Branch and CI split

`docs/BRANCHING.md` keeps the heading `## Branch protection and required contexts`, the branch-policy intro, the existing protection table, and the approval-policy sentences, so branch policy stays in one place. The terminal gate-job and Node.js coverage paragraphs at `docs/CI.md:17-19`, and the approval paragraph's `main` six-suite-gate sentence, stay in `docs/CI.md`, because they are CI mechanics. The table is verified by human review against `.github/rulesets.expected.json`; no automated checker is part of this plan. Its sections are: one-line operational branch responsibilities; branch protection and required contexts; reviews and merge methods; task branches; promotion and sync-back; hotfix flow; promotion mechanics (`PR review gate` hangs, `/review`, self-approval); ruleset drift pointer.

`docs/CI.md` keeps everything that is CI mechanics: scope selection, the terminal gate-job contract, Node.js coverage, the promotion-integrity check, ruleset drift detection and its tooling, the required configuration check, the review readiness label, daily full validation, Mobile EAS builds, release verification, and local verification. It opens with a one-line pointer to `docs/BRANCHING.md` and drops the protection table and the branch-policy prose. The filename stays `CI.md`; the H1 expands the abbreviation to `# Continuous Integration (CI)`.

## Definition of Done, design, and Mobile

`docs/DEFINITION-OF-DONE.md` owns general verification evidence only. Its sections are: When this applies; Deriving what to verify; Recording evidence; UI-visible evidence; Per-application verification guides; Review pointer.

- The optional material-UX demo checkpoint stays in `DESIGN.md` §10.1, including the record fields and the rule that an absent demo or record is not a finding. The DoD does not repeat them.
- Hands-on acceptance stays in `DESIGN.md` §10.2, which owns the procedure and states that it has no declared-gap path. The DoD records who accepted, the date, and the adjustments.
- The design verification matrix stays in `DESIGN.md` §6. The DoD points to it.
- Review enforcement stays in `REVIEW.md`. The DoD carries one pointer.
- Mobile native acceptance stays in `apps/mobile/AGENTS.md` and the `change-verification` scenario. The DoD only links the Mobile verification guide; it does not add a central Mobile requirement.

## Root rules and scoped rules

The root rules keep an intro and ten short sections: OpenSpec workflow and archiving obligations; design checkpoints; branches and pull requests; verification evidence; review; package versions; generated artifacts; secrets; documentation language; personal local instructions. Each obligation names its owner. The root does not contain a repository map, setup commands, per-branch contracts, promotion/hotfix mechanics, the package manifest table, the full verification procedure, the per-application smoke list, or the material-UX record fields.

The root states the version trigger and the full indirect-effects list because an agent reading only the root must not miss them; `docs/release/VERSIONING.md` owns the decision protocol. The root states the exemption sentence because it is a decision rule, not a procedure; the DoD and the spec own the verification details. The root states the three generator classes in three lines; the machine configuration is authoritative for the paths, and the existing drift checks verify the generators.

Scoped rules keep the imperative and add the section reference. Exact target wording is in `design.md` § "Scoped rules".

## Verification policy alignment

The four policy texts are the root rules, `docs/DEFINITION-OF-DONE.md`, the `change-verification` requirement paragraph, and the `change-verification` "Documentation-only change is exempt" / "Non-behavioral code change is smoke-tested from its diff" scenarios. `.github/PULL_REQUEST_TEMPLATE.md` mirrors them.

Today the base texts disagree in two ways: the requirement paragraph omits `comment`, while the scenario includes it; and the DoD adds "any related living specs" while the scenario lists only the diff's touched surface and the app's smoke flows. R08 resolves both explicitly:

- **H1, exemption scope (approved).** All policy texts exempt "documentation-, comment-, and typo-scale changes". The alternative — narrow all texts to documentation- and typo-scale — was not chosen.
- **H2, no-proposal inputs (approved).** All texts derive refactor smoke verification from the diff's touched surface, any related living specs, and the app's documented smoke flows. The alternative — remove "any related living specs" from the DoD and keep the spec's two inputs — was not chosen.

The exact sentences for both approved choices are in `design.md` § "Verification policy decisions".

## Document scope and change policy (approved H4)

The user proposed that each long-lived governance or operational document open with a short statement of its scope and its intake/outflow policy, so the document resists rot. H4 was approved on 2026-10-26: the six documents R08 creates or edits adopt the four-field block, with human review of label presence and accuracy.

Approved form, immediately after the H1:

- **Owns:** the topics this document is the operational owner of.
- **Does not own:** the adjacent topics and their owners.
- **Intake:** what may be added and what approval it needs. A new normative threshold goes to the spec first.
- **Outflow:** when content leaves, where it goes, and how inbound links are kept working.

Apply it to the six documents R08 creates or edits: `DESIGN.md`, `REVIEW.md`, `docs/BRANCHING.md`, `docs/CI.md`, `docs/DEFINITION-OF-DONE.md`, and `docs/release/VERSIONING.md`. Exempt: `README.md`, `docs/README.md` (the index gets a one-line routing scope), change artifacts and evidence, generated files, historical records, and scoped app `AGENTS.md`. Human review checks that the four labels exist and are accurate. The example and the applicability boundary are in `design.md` § "Document scope headers".

## Preserved hard constraints

Deduplication must not remove or weaken these:

- the optional material-UX requirements-discovery demo: when the human accepts it, dependent implementation waits for the feedback, the requirements are updated first, and the approval is recorded in the change's `proposal.md` with the fields `DESIGN.md` §10.1 lists; an absent demo or record is not a Compliance finding;
- post-implementation human hands-on acceptance for UI-visible changes before the pull request opens, with no declared-gap path; demo approval authorizes implementation only;
- Mobile behavior changes accepted on real Android or iOS targets, with native acceptance evidence recorded in `validation.md`; unit, host, and browser checks alone do not establish it;
- human review of an OpenSpec proposal before implementing observable behavior;
- the `OpenSpec: <change-id>` line in behavior-changing pull requests;
- the per-application version-decision request, with no assumption while a decision is pending;
- one task = one branch = one pull request; no commits on `dev`, `beta`, or `main`; agents never merge promotion, sync-back, or hotfix pull requests;
- the secrets prohibition and the generated-file discipline.

Each row has a named owner and check in `design.md` § "Preserved hard constraints".

## Approved structural decisions

These structural decisions were adopted for this revision and remain in force. They are not a claim that the old implementation was approved; the implementation approval is recorded separately in § "Approval record".

| # | Decision | Implementation |
| --- | --- | --- |
| 1 | Five-layer authority model; one owner per topic per layer | Design D1; delta requirement "Governance authority is layered" |
| 2 | New `docs/BRANCHING.md` owns branch responsibilities, protection, promotion, sync-back, hotfix | Design D2; `docs/BRANCHING.md` target spec |
| 3 | `docs/CI.md` keeps only CI scope, workflows, gates, and troubleshooting | Design D2; `docs/CI.md` target spec |
| 4 | DoD owns general verification evidence; `DESIGN.md` owns the complete UI demo + hands-on + matrix; Mobile details stay scoped | Design D3; DoD target spec; delta requirement "Deduplication preserves hard constraints" |
| 5 | Root rules carry non-delegable obligations and pointers; scoped design rules keep the imperative plus a link | Design D4/D5; root and scoped target specs |
| 6 | Restore the full version indirect-effects scope | Design D7; root target spec; W1 |
| 7 | Correct the Web/API deployment pointers | Design D7; W12 |
| 8 | Unify the four verification-exemption texts | Design D6; H1 |
| 9 | Make the living-specs input explicit | Design D6; H2 |
| 10 | Update the retrospective status to "previously merged locally, preserved on task branches, dev restored" and declare F05/D06 prerequisites; keep I09 as an independent follow-up | Status and dependencies sections; Design D10 |
| 11 | Keep the filename `docs/CI.md`; the H1 may expand "Continuous Integration" | Design D2; W15 |
| 12 | Revise proposal artifacts only; implementation starts only after the section 3 prerequisites | Status and approval-record sections; tasks sections 2 onward |

## Adjudication decisions

The human decided every item on 2026-10-26 as part of the implementation approval. No adjudication item remains open.

| # | Decision | Approved choice | Exact wording |
| --- | --- | --- | --- |
| H1 | Verification-exemption scope across root, DoD, spec requirement, spec scenario, and PR template | Option A (approved): include comments everywhere. All texts exempt documentation-, comment-, and typo-scale changes when the change states the exemption. | `design.md` § "Verification policy decisions" — H1 (A); the `change-verification` delta carries it |
| H2 | No-proposal smoke-verification input | Option A (approved): align up to the diff's touched surface, any related living specs, and the app's documented smoke flows. | `design.md` § "Verification policy decisions" — H2 (A); the `change-verification` delta carries it |
| H3 | Prerequisite strategy | Sequence F05 → D06 → R08; do not absorb their content inside R08. | `design.md` § "Dependencies and delivery sequence"; § "Approval record" |
| H4 | Document scope headers | Adopt the four-field Owns / Does not own / Intake / Outflow block for the six documents R08 creates or edits; human review checks presence and accuracy. | `design.md` § "Document scope headers"; the `agent-rule-governance` delta carries it |

No other decision is open. The old A1–A11 items are either resolved above, mapped to a preserved constraint, or covered by the H1–H4 decisions. **D06 is not approved by this record**; it was separately approved, implemented in PR #393, and archived in PR #394 on 2026-10-26, so section 3's gate is satisfied.

## Capabilities

### New Capabilities

- `agent-rule-governance`: the five-layer authority model, the root and scoped agent-rule contracts, generated-artifact ownership, verification-policy consistency, document scope headers, and the hard constraints deduplication must preserve.

### Modified Capabilities

- `change-verification`: the exemption scope adds comment-only changes, and the no-proposal refactor input adds related living specs. Both were approved as recommended on 2026-10-26; the requirement and scenario are updated together so the spec no longer disagrees with itself.

### Unchanged Capabilities

`release-branching`, `agentic-pr-review`, and `ci-scope-selection` keep their requirements. `docs/BRANCHING.md` is the operational implementation of `release-branching`, not a change to it. No other change owns a delta for these capabilities in this plan.

## Impact

- This change directory: `proposal.md`, `design.md`, two delta specs (`agent-rule-governance`, `change-verification`), `tasks.md`, `validation.md`, `.openspec.yaml`.
- After implementation (approved 2026-10-26): `.rulesync/rules/overview.md`, `web-design.md`, `extension-design.md`, `design-system.md`, `mobile-architecture.md`; generated `AGENTS.md`, `CLAUDE.md`, `apps/web/AGENTS.md`, `apps/extension/AGENTS.md`, `apps/mobile/AGENTS.md`; `DESIGN.md`, `REVIEW.md`, `docs/BRANCHING.md`, `docs/CI.md`, `docs/DEFINITION-OF-DONE.md`, `docs/release/VERSIONING.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `openspec/config.yaml`.
- Independent follow-up: `docs/README.md` (I09), if re-authored.
- No `apps/`, `packages/`, `deploy/`, workflow, ruleset, dependency, or package-version change. No version decision applies.
- CI: the `agent-config drift check` is the only gate whose input changes. No required context or merge method changes.
- OpenSpec archive: D06's `change-verification` delta and R08's delta target the same capability. D06 must be archived first, or both must be archived in one docs pull request with reconciled blocks.
