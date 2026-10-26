# Proposal

## Why

The repository's only human design checkpoint currently happens after implementation: a UI-visible change is exercised hands-on once the code exists. That is the wrong order for material UX work — an agent can build a whole navigation model, a multi-step flow, or a full-screen layout before any human has seen the intended structure, and the disagreement surfaces as rework. The human adopted the rule on 2026-10-26: material UX changes present a static mockup or clickable demo and obtain approval before implementation, the approval is recorded in `proposal.md`, review policy treats a missing record as Important, and post-implementation hands-on acceptance stays in place.

## What Changes

- Extend the `change-verification` capability with a **pre-implementation design gate**: a change that restructures information architecture, the navigation model, a multi-step flow, a core interaction, primary-action placement, or a whole-screen layout SHALL present a static mockup or clickable demo and obtain human approval before UI implementation starts.
- Define what the demo covers: the main flow, the key states the affected surface can show (empty, loading, error, disabled/unavailable, selected, and the states `DESIGN.md` §8 requires), the themes from `DESIGN.md`'s theme-support matrix, and the responsive widths from its layout rules. Inapplicable dimensions are named with the reason.
- Define the approval record: it lives in `openspec/changes/<change-id>/proposal.md` and states who approved, the date, the demonstrated scope, the covered flow/states/themes/widths, requested adjustments or conditions, and the decision that implementation may start. The record is text-first and stands alone; demo media follows the existing no-commit rule.
- Define the exclusions: token or color corrections, copy changes, bug fixes that restore already-approved behavior, and local component adjustments inside an existing approved pattern stay outside the gate.
- Extend `REVIEW.md`'s Compliance pass: a material UX change whose `proposal.md` carries no substantive approval record is an Important Compliance finding; post-implementation hands-on acceptance remains a separate, unchanged requirement.
- Make the rule discoverable where decisions are made: `DESIGN.md` (reading order, change workflow, agent checklist), the root agent rules source (`.rulesync/rules/overview.md`, regenerated with `pnpm agent:sync`), the OpenSpec apply guidance in `openspec/config.yaml`, and the pull request template.

Non-goals:

- Demo tooling or a required demo format — a static mockup, a clickable prototype, or a temporary preview build all satisfy the rule.
- Automated validation of demo fidelity or of the approval's authenticity; the reviewer verifies that the record exists and covers the material scope, not that the human's approval was well-founded.
- Any change to the existing post-implementation human acceptance, verification-evidence, or media rules.
- Any product UI code, token, or application-behavior change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `change-verification`: adds the pre-implementation material-UX demo approval requirement and the review-policy requirement that enforces it; the capability purpose broadens from "when a change counts as done" to "what proves a change may be implemented and when it counts as done".

## Impact

- `openspec/changes/add-material-ux-demo-review-d06/` — proposal, delta spec, design, tasks, validation.
- `DESIGN.md` — scope/reading order, change workflow (new pre-implementation gate and post-implementation acceptance subsections), agent checklist.
- `.rulesync/rules/overview.md` and the artifacts regenerated from it (`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/`, `.agents/`) — the agent-facing rule; `apps/mobile/AGENTS.md` is unaffected because the mobile rule source is not edited.
- `REVIEW.md` — Compliance pass gains the approval-record check.
- `.github/PULL_REQUEST_TEMPLATE.md` — a checklist item and Test plan guidance for the approval record.
- `openspec/config.yaml` — apply guidance line.
- No application code, runtime behavior, API contract, dependency, or deployment change.
