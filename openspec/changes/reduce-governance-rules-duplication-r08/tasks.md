# Tasks

## 1. Revised proposal artifacts (this revision)

- [x] 1.1 Read the complete first R08 artifacts and the information-architecture review; record every structural defect and its resolution. Verify: `design.md` § "Context" maps each review P0/P1 finding to D1–D11, and `proposal.md` § "Why" states the defects without reusing the A1–A11 framing.
- [x] 1.2 Rewrite `proposal.md` around the five-layer authority model, `docs/BRANCHING.md`, the DoD/DESIGN/Mobile split, the root and scoped rule targets, verification alignment, the dependency chain, and H1–H4. Verify: every item in the mission context maps to a proposal section or a design decision; no sentence claims approval of the old implementation.
- [x] 1.3 Rewrite the `agent-rule-governance` delta and add the `change-verification` delta. Verify: each requirement has at least one WHEN/THEN scenario; the MODIFIED requirement copies the full living requirement; `openspec validate --all --strict` passes.
- [x] 1.4 Update the historical delivery status and the dependency mapping. Verify: the status table names F05/D06/R08/I09 with commits and base presence; the dependency chain names F05 and D06 as prerequisites and I09 as an independent follow-up.
- [x] 1.5 Write `tasks.md` and `validation.md`, leaving implementation work, verification, and archive unchecked. Verify: `openspec validate --all --strict` and `git diff --check` pass; `validation.md` records the commands, results, and declared gaps.

## 2. Human re-approval (recorded 2026-10-26)

- [x] 2.1 Human confirms the approved structural decisions and decides H1–H4. Verify: `proposal.md` § "Approval record" names Alex Lee, 2026-10-26, and the decision "approved for implementation, subject to the H3 prerequisites", and records each H1–H4 choice; no H item remains unclassified.
- [x] 2.2 If the human revises or rejects a structural decision, update `proposal.md`, `design.md`, and the delta specs before implementation. Verify: **not applicable** — the approval adopts the recommended H1–H4 choices without revising or rejecting a structural decision, so no artifact wording changes.

## 3. Prerequisites (blocking; satisfied 2026-10-26)

- **Gate:** cleared on 2026-10-26. F05 and D06 were separately approved and landed on `dev` at `751e337b` (F05 PR #392; D06 PR #393 with the demo as an optional requirements-discovery step; D06 archive PR #394). This R08 approval covers R08 only; D06's approval and archive remain separate records.
- [x] 3.1 Confirm F05 and D06 are separately approved and on the delivery base. Verify: `README.md` has the `apps/mobile` row and the "all Slax Reader code" wording; `DESIGN.md` has §10.1/§10.2 in their approved optional form; `REVIEW.md` has the material-UX no-finding clause.
- [x] 3.2 Confirm D06's `change-verification` delta is archived, or schedule a combined archive with R08. Verify: `openspec list` shows no active D06 delta; `openspec/specs/change-verification/spec.md` contains the four archived material-UX requirements.
- [x] 3.3 Confirm I09 is an independent follow-up, not a prerequisite. Verify: no R08 implementation task depends on `docs/README.md`.

## 4. Implementation (completed)

- [x] 4.1 Create `docs/BRANCHING.md` with the H4 scope block, the unchanged `## Branch protection and required contexts` heading, the branch-policy intro, protection table, and approval-policy sentences moved from `docs/CI.md:7-21`, and the sections in `design.md` § "Target file specifications". Verify by human review that the table matches `.github/rulesets.expected.json`, the terminal gate-job and Node.js coverage paragraphs and the `main` suite-gate sentence remain in `docs/CI.md`, and every internal link resolves.
- [x] 4.2 Rescope `docs/CI.md`: H1 `# Continuous Integration (CI)`, scope block, pointer to `docs/BRANCHING.md`, move the branch-policy heading, intro, table, and approval-policy sentences out, and keep the terminal gate-job and Node.js coverage paragraphs and the approval paragraph's `main` suite-gate sentence under CI-owned headings. Verify: no branch policy remains; the gate-job, Node.js coverage, and suite-gate content is unchanged; the other CI sections and commands are unchanged; links resolve.
- [x] 4.3 Create `docs/DEFINITION-OF-DONE.md` with the evidence-only sections in `design.md`; no Material UX, Mobile, or Review enforcement sections. Verify: every UI, Mobile, and review reference points to its owner; the H1/H2 wording matches the chosen options.
- [x] 4.4 Create `docs/release/VERSIONING.md` with the decision protocol, the full indirect-effects list, the manifest table, and the corrected Web/API pointers. Verify: the Web/API sentence points at `docs/web/deployment.md` and `docs/api/DEV-AND-CI-EN.md`; no release condition points at `docs/CI.md`.
- [x] 4.5 Rewrite `.rulesync/rules/overview.md` to the target outline; remove the repository map, setup commands, per-branch contracts, promotion/hotfix mechanics, manifest table, full DoD procedure, and per-app smoke list; keep one same-capability rule. Verify: the root is 50–60 lines; every remaining obligation names an owner; the version and exemption sentences match the chosen H1/H2 wording.
- [x] 4.6 Restore the scoped imperatives and add section references in `web-design.md` and `extension-design.md`; update `design-system.md` and the mobile evidence pointer. Verify: each scoped file has an imperative plus a section reference; every cited `DESIGN.md` section exists.
- [x] 4.7 Add the no-gap and DoD-recording sentences to `DESIGN.md` §10.2; update `REVIEW.md`'s DoD pointer and generated-file list; update `.github/PULL_REQUEST_TEMPLATE.md` and `openspec/config.yaml`. Verify: `REVIEW.md` does not duplicate D06's material-UX step; the PR template keeps every existing requirement; the config guidance points at the DoD.
- [x] 4.8 Add the H4 scope block to the six required documents. Verify by human review that each has the four non-empty labels and that no block restates the index's routing.
- [x] 4.9 Run `pnpm agent:sync` and review the generated diff. Verify: `AGENTS.md`, `CLAUDE.md`, `apps/web/AGENTS.md`, `apps/extension/AGENTS.md`, and `apps/mobile/AGENTS.md` match their sources; no other generated output changes.
- [x] 4.10 Run the standard checks: `pnpm agent:check`, `pnpm exec openspec validate --all --strict`, `git diff --check`, and a manual link check of the changed documents. Verify: every command exits zero and the manual link check resolves; record the results in `validation.md`.
- [x] 4.11 Confirm the retained pointers: `tooling/rulesets.mjs:204` and `docs/mobile/release.md:80` still point at `docs/CI.md` correctly. Verify: no false pointer remains.
- [x] 4.12 Reconcile this change with D06's archived optional material-UX semantics: update the preserved-constraint wording in `proposal.md`, `design.md`, and the `agent-rule-governance` delta so a declined or absent demo is not a finding, while hands-on acceptance keeps its no-declared-gap path; confirm the `change-verification` MODIFIED requirement copies the full living requirement and differs only in the H1/H2 sentences. Verify: a sentence-level diff against the living spec shows only the two intended sentences; `REVIEW.md`, the root rules, and the pull request template carry the optional wording.

## 5. Independent follow-up (I09 documentation index)

- [x] 5.1 **Not applicable in this task.** I09 was not re-authored, so `docs/README.md` does not exist and no index row is added; I09 remains an independent follow-up. If it is re-authored later, it should add a `docs/BRANCHING.md` row, split the CI and branch routes, and add the DoD and VERSIONING rows.

## 6. Verification and delivery

- [x] 6.1 Exercise the documentation change in the running environment: open the six documents and any index present, follow the internal links, and confirm the branch table and CI sections render as intended. Verify: the exercise is recorded in `validation.md` with what was checked and any declared gap.
- [x] 6.2 Run the local pre-push review from `REVIEW.md` (Bugs, Security, Compliance) and resolve every Important finding. Verify: the review result and resolutions are recorded in `validation.md`.
- [ ] 6.3 Open the task pull request with an `OpenSpec: reduce-governance-rules-duplication-r08` line and a Test plan linking `validation.md`. Verify: the body follows `.github/PULL_REQUEST_TEMPLATE.md`; no free-text replacement. **Pending delivery protocol:** the mission commits the implementation for independent review and does not push or open the pull request until the tower reports the reviewed result.

## 7. Archive

- [ ] 7.1 Archive this change in a follow-up pull request after the task pull request merges and after D06's `change-verification` delta is archived or reconciled. Verify: the `agent-rule-governance` delta is applied to `openspec/specs/agent-rule-governance/spec.md`; the `change-verification` delta is applied; `openspec validate --all --strict` passes; the archive pull request names `Archive: reduce-governance-rules-duplication-r08`.
