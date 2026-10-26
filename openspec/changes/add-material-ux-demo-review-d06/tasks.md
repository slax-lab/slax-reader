# Tasks

## 1. Design contract

- [x] 1.1 Add the pre-implementation demo gate to `DESIGN.md`: a step in the §10 workflow, a §10.1 subsection defining the six structural triggers, the demo coverage, the `proposal.md` approval record, and the exemption list, a §10.2 subsection keeping post-implementation hands-on acceptance independent, a §1 reading-order step, and a §11 checklist question. Verify: the sections name every trigger, coverage dimension, record field, and exemption from the delta spec, and `grep -n "material UX\|§10.1" DESIGN.md` shows the cross-references resolve.
- [x] 1.2 Update the `change-verification` capability Purpose in `openspec/specs/change-verification/spec.md` so the living spec describes both gates. Verify: `pnpm exec openspec validate --all --strict` passes and the Purpose names demo approval and the verification contract.

## 2. Agent rules and generated artifacts

- [x] 2.1 Add the material-UX demo rule to `.rulesync/rules/overview.md`: trigger list, demo coverage, the `proposal.md` approval record and its stand-alone requirement, the exemption list, review enforcement, and the note that demo approval does not replace post-implementation acceptance. Verify: every clause of the three added spec requirements appears in the source, and the rule links `DESIGN.md` as the authority.
- [x] 2.2 Add the earlier-checkpoint cross-reference to the Definition of Done section in `.rulesync/rules/overview.md` so the two human checkpoints read as one sequence. Verify: the section names both gates without duplicating the demo details.
- [x] 2.3 Run `pnpm agent:sync` and commit the rule source with the regenerated artifacts. Verify: `pnpm exec rulesync doctor --strict` and `pnpm exec rulesync generate --check` exit zero, and `grep -n "material UX" AGENTS.md CLAUDE.md` finds the rule in both generated files.

## 3. Review policy and pull request surface

- [x] 3.1 Add the approval-record step to `REVIEW.md`'s Compliance pass: for a material UX change, a missing or incomplete `proposal.md` demo approval record is an Important Compliance finding, the review verifies the record rather than the demo's design quality, and demo approval does not replace the post-implementation hands-on acceptance. Verify: the step matches the delta-spec review requirement and adds no operational documentation, per `REVIEW.md`'s own scope rule.
- [x] 3.2 Update `.github/PULL_REQUEST_TEMPLATE.md`: a checklist item for the recorded demo approval (or the exemption) and Test plan guidance that distinguishes the approval record from post-implementation acceptance evidence. Verify: the rendered template reads consistently with `REVIEW.md` and the delta spec, and does not weaken the existing evidence requirements.
- [x] 3.3 Add the apply-loop guidance to `openspec/config.yaml`: obtain the human's approval of the demo and record it in `proposal.md` before starting UI implementation of a material UX change. Verify: `pnpm exec openspec instructions apply --change add-material-ux-demo-review-d06 --json` lists the new guidance and `pnpm exec openspec validate --all --strict` passes.

## 4. Validation and delivery

- [x] 4.1 Write `openspec/changes/add-material-ux-demo-review-d06/validation.md` with commands run and results, what was exercised (rule text cross-checked against every spec scenario), and declared gaps (for example: the review gate's behavior is observable only on a later pull request; no demo was produced because this change touches no UI). Verify: every delta-spec scenario maps to a recorded check or a declared gap.
- [x] 4.2 Run the documentation and generated-file checks: `pnpm agent:check` (rulesync doctor, generate check, OpenSpec strict validation, gh-aw drift) plus `pnpm exec openspec validate --all --strict`. Verify: both exit zero; record the output summary in `validation.md`.
- [x] 4.3 Confirm the diff contains no product UI or application code: stage the change, inspect `git diff --cached --stat`, and after the commit confirm `git diff --stat origin/dev...HEAD` lists the same paths — only `.rulesync/`, generated agent artifacts, `DESIGN.md`, `REVIEW.md`, `openspec/`, and `.github/PULL_REQUEST_TEMPLATE.md`. Verify: no path under `apps/` or `packages/` appears.
- [x] 4.4 Run the local pre-push review from `REVIEW.md` (Bugs, Security, Compliance) and resolve every Important finding. Verify: the review result and resolved findings are recorded in `validation.md`.
- [ ] 4.5 Archive this change in a follow-up pull request after the task pull request merges. Verify: `openspec archive add-material-ux-demo-review-d06` moves the delta into `openspec/specs/change-verification/spec.md` and `openspec validate --all --strict` passes afterwards.
