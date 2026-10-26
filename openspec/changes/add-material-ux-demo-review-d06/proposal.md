# Proposal

## Status

**Approved on 2026-10-26.** Alex Lee, in the Slax Reader product-owner role, approved this revised direction on 2026-10-26 and authorized its implementation. The approval supersedes the unapproved mandatory-demo design that this change directory and branch `feat/add-material-ux-demo-review-d06` (commit `02f80058`) carried before, and covers the optional requirements-discovery semantics stated in this proposal, `design.md`, and the delta spec:

- The demo is optional and is offered to the human for every material UX change; the agent never treats it as required.
- The agent recommends the demo when requirements or intended behavior are vague, incomplete, or contested and visualization or interaction would make them concrete enough to react to, and when reversing the structural decision after implementation would rebuild multiple screens, flows, or tests. The recommendation names the uncertainty it would resolve or the rework it would avoid.
- When the human accepts, all implementation whose requirements or design depends on the unresolved UX decisions waits — UI implementation, backend behavior, data models, API contracts, and test expectations. Only demonstrably independent work proceeds: environment setup, technical research or spikes, independent benchmarks, and generic tooling.
- Demo feedback updates the requirements first: `proposal.md` always, and the delta spec or design when requirements or design change. Those updated artifacts are the implementation target. Feedback that changes the approved structure, scope, or requirements direction returns to a revised demo and approval for the changed part.
- When the human declines, implementation proceeds with no demo, approval record, or decision note; the agent does not repeat the offer, and the conversation is the decision record.
- A missing demo or approval record is explicitly not a Compliance finding and never blocks a pull request.
- Post-implementation human hands-on acceptance stays unchanged for UI-visible changes: the demo authorizes implementation, not shipment, and neither checkpoint replaces the other.

Conditions recorded with the approval: the superseded mandatory-gate implementation is amended rather than delivered as-is; `reduce-governance-rules-duplication-r08` is reconciled in its own follow-up and is not edited by this change; archiving follows the task pull request's merge.

This revision was prepared on branch `feat/make-material-ux-demo-optional-d20` (commit `250006f1`) and imported into this change directory together with the implementation amendment.

## Why

The repository's only human design checkpoint currently happens after implementation: a UI-visible change is exercised hands-on once the code exists. For material UX work, an agent can build a whole navigation model, a multi-step flow, or a full-screen layout before any human has seen the intended structure, and the disagreement surfaces as rework.

The earlier proposal turned that observation into a mandatory gate: every material UX change would need a demo and a recorded approval before UI implementation, and review would treat a missing record as Important. The human did not approve that. A mandatory demo slows every material change whether or not its risk justifies it, and a missing record would block delivery even when the human consciously chose to skip the demo.

The first optional revision removed the gate but kept a second error: it treated the demo as a visual approval step and paused only UI. That misreads what a demo is for. A demo turns a vague requirement into something the human can see and react to; the feedback often changes what the product must do, and the data model, API contract, and test expectations all encode that decision. Building any of them while the UX decision is unresolved converts a requirements conversation into rework.

The adopted direction gives the human the decision and gives the demo its proper scope. The agent offers the demo for a material UX change and recommends it both when the requirements are still vague enough that visualization or interaction would help and when reversing the structure would be expensive. If the human accepts, the demo is a requirements-discovery step: dependent implementation across all layers waits, feedback updates the requirements first, and only demonstrably independent work proceeds. If the human declines, implementation proceeds without a demo, a record, or a review finding.

## What Changes

- Extend the `change-verification` capability with an **optional requirements-discovery demo** for material UX changes:
  - Before dependent implementation begins, the agent SHALL ask the human whether they want a static mockup or clickable demo of the intended structure.
  - The agent SHALL recommend the demo when requirements or intended behavior are vague or contested and visualization or interaction would make them concrete enough to react to, and when reversing the structural decision after implementation would rebuild multiple screens, flows, or tests. The recommendation names the uncertainty it would resolve or the rework it would avoid.
  - The human decides. When they decline, implementation proceeds with no demo, approval record, or decision note, and the agent does not repeat the offer for the same change.
- Define the accepted-demo contract as requirements discovery, not visual sign-off:
  - All implementation whose requirements or design depends on the unresolved UX decisions waits — UI implementation, backend behavior, data models, API contracts, and test expectations included.
  - Only work that is demonstrably independent may proceed; examples are environment setup, technical research or spikes, independent benchmarks, and generic tooling.
  - Demo feedback first updates `proposal.md` and, when requirements or design change, the delta spec or design. Those updated artifacts are the implementation target.
  - Feedback that changes the approved structure, scope, or requirements direction returns to a revised demo and approval for the changed part before implementation.
- Define the record for an accepted demo: it lives in `proposal.md` and names who approved and their role, the date, the demonstrated scope, the covered flow/states/themes/widths, the feedback that changed the requirements and the resulting changes, required conditions, and the decision that the updated requirements may be implemented. A declined demo leaves no record: implementation proceeds, the agent does not repeat the offer for the same change, and the conversation is the decision record. The record is not a review gate; its absence is not an Important finding and never blocks a pull request.
- Define what an accepted demo covers: the main flow with a representative branch, the surface's key states, the themes and responsive widths `DESIGN.md` requires for that surface, and a named reason for every inapplicable dimension.
- Preserve the material UX definition and exemptions: information-architecture, navigation-model, multi-step-flow, core-interaction, primary-action-placement, and whole-screen-layout changes are material; token or color corrections, copy changes, bug fixes restoring approved behavior, and local component adjustments inside an existing approved pattern are exempt.
- Preserve post-implementation human hands-on acceptance unchanged: the optional demo authorizes implementation only and never replaces the acceptance a UI-visible change still needs before its pull request opens.
- Align the implementation to the approved direction: amend the superseded mandatory-gate text in `DESIGN.md`, the rules source and its generated artifacts, `REVIEW.md`, the pull request template, the apply guidance, and the living `change-verification` Purpose; reconcile the R08 dependency wording in its own follow-up.

Non-goals:

- Demo tooling or a required demo format — a static mockup, a clickable prototype, or a temporary preview build all satisfy the offer.
- Automated validation of demo fidelity, approval authenticity, or whether the agent asked.
- Pausing work merely to reserve capacity; dependent work waits because its requirements are unresolved, and demonstrably independent work is not blocked.
- Requiring a written record or a repeated question when the human declines; the conversation is the decision record.
- Weakening the post-implementation hands-on acceptance, verification-evidence, or media rules.
- Any product UI code, token, or application-behavior change.
- Editing `reduce-governance-rules-duplication-r08` in this change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `change-verification`: adds the optional material-UX requirements-discovery demo, the recommendation duty for requirement uncertainty and high rework risk, the dependent-implementation wait with an independent-work allowance, the feedback-first requirements update, the opt-in approval record, and the rule that review neither requires a demo nor treats its absence as a finding; post-implementation acceptance stays normative and independent.

## Impact

Implementation artifacts of this change:

- `openspec/changes/add-material-ux-demo-review-d06/` — proposal, design, delta spec, tasks, validation.
- `DESIGN.md` — §10 workflow, a §10.1 optional requirements-discovery subsection, §10.2 independent acceptance, §1 reading order, §11 checklist question; the superseded mandatory-gate text is replaced.
- `.rulesync/rules/overview.md` and the artifacts regenerated from it (`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/`, `.agents/`) — the rule offers, recommends, waits for dependent work, updates requirements from feedback, and records rather than requires.
- `REVIEW.md` — the mandatory approval finding is removed, a missing demo or record is explicitly not reported, and the hands-on acceptance check is unchanged.
- `openspec/specs/change-verification/spec.md` — the Purpose describes the optional requirements-discovery checkpoint and the done contract.
- `openspec/config.yaml` — apply guidance for the offer/recommend/feedback-first sequence.
- `.github/PULL_REQUEST_TEMPLATE.md` — restored to its pre-D06 content; no demo item.
- `reduce-governance-rules-duplication-r08` — its own follow-up updates every mandatory-gate reference; exact locations and required wording are in `design.md` § "R08 dependency reconciliation". Not edited by this change.

No application code, runtime behavior, API contract, dependency, deployment, or package version change.
