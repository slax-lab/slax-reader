# Spec Delta

## ADDED Requirements

### Requirement: Material UX changes require an approved demo before implementation

A change is **material UX** when it restructures any of: information architecture (which content groups or surfaces exist and how they are organized), the navigation model (how users move between surfaces and return, including entry points and back behavior), a multi-step flow (the number, order, or composition of steps in a task), a core interaction (the primary gesture or control through which users perform a central product action), primary-action placement (which control is the main call to action on a surface and where it sits), or a whole-screen layout (the arrangement of a screen's main regions). A material UX change SHALL NOT begin UI implementation until a static mockup or clickable demo has been presented to the human and approved. The demo SHALL cover the main flow from entry to completion including at least one representative branch, the key states the affected surface can present (empty, loading, error, disabled or unavailable, selected, and the interactive states `DESIGN.md` §8 requires), the themes the `DESIGN.md` theme-support matrix requires for that surface, and the responsive widths its layout rules require. A dimension that does not apply SHALL be named with its reason rather than omitted silently. Changes outside the trigger list — token or color corrections, copy changes, bug fixes restoring already-approved behavior, and local component adjustments inside an existing approved pattern — SHALL NOT require the gate. Non-UI work in the same change MAY proceed while design approval is pending.

#### Scenario: Material UX implementation waits for demo approval

- **WHEN** a change restructures information architecture, the navigation model, a multi-step flow, a core interaction, primary-action placement, or a whole-screen layout
- **THEN** UI implementation does not begin until `proposal.md` records the human's approval of the presented demo

#### Scenario: Demo covers the material surface

- **WHEN** a material UX demo is presented for approval
- **THEN** it shows the main flow with a representative branch, the surface's key states, and the themes and responsive widths `DESIGN.md` requires
- **AND** any inapplicable state, theme, or width is named with its reason

#### Scenario: Non-material UI change is exempt

- **WHEN** a change corrects a token or color, edits copy, fixes a bug to restore already-approved behavior, or adjusts a component inside an existing approved pattern
- **THEN** no demo or approval is required and implementation may proceed

### Requirement: Demo approval is recorded in the change proposal

The demo approval SHALL be recorded in `openspec/changes/<change-id>/proposal.md` before UI implementation begins. The record SHALL state who approved and their role, the approval date, the demonstrated scope (the surfaces, flow steps, and design decisions the demo covered), the states, themes, and widths that were covered, any adjustments or conditions the human required, and the decision that implementation may start. The record SHALL be self-contained prose: when the demo was a temporary artifact, a chat attachment, or an expiring link, the record still describes the approved structure well enough for a reviewer to check the implementation against it. Screenshots and recordings of the demo MUST follow the repository's existing media rule — attached, never committed.

#### Scenario: Approval record is complete

- **WHEN** the human approves a material UX demo
- **THEN** `proposal.md` records the approver and role, the date, the demonstrated scope, the covered states/themes/widths, required adjustments, and the authorization to implement

#### Scenario: Record survives a temporary demo

- **WHEN** the demo lived in a temporary preview, a chat attachment, or an expiring link
- **THEN** the `proposal.md` record still describes the approved structure so implementation can be reviewed against it after the artifact is gone

#### Scenario: Conditional approval is carried into implementation

- **WHEN** the human approves the demo subject to requested adjustments
- **THEN** the conditions are recorded in the same approval record and the implementation applies them
- **AND** a requested adjustment that changes the approved structure returns to the human for approval before that part is implemented

### Requirement: Review policy enforces the demo approval

The repository review policy SHALL treat a material UX change as an Important Compliance finding when its `proposal.md` carries no demo approval record, or a record that omits the approver, date, demonstrated scope, or coverage required by the approval-record contract. The review SHALL verify the record against the change's material scope and SHALL NOT re-review the demo's design quality. Demo approval SHALL NOT replace post-implementation hands-on acceptance, and an acceptance record SHALL NOT substitute for a missing demo approval.

#### Scenario: Missing approval record blocks the merge

- **WHEN** a pull request implements a material UX change whose `proposal.md` carries no demo approval record
- **THEN** the review reports an Important Compliance finding and the merge gate fails for that head

#### Scenario: Incomplete approval record is a finding

- **WHEN** an approval record exists but omits the approver, date, demonstrated scope, or covered states/themes/widths
- **THEN** the review reports an Important Compliance finding

#### Scenario: Approval does not replace hands-on acceptance

- **WHEN** a material UX change has an approved demo and its implementation is complete
- **THEN** the human still exercises the implemented change hands-on in the running environment before the pull request opens
