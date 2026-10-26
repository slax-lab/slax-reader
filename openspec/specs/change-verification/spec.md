# change-verification Specification

## Purpose
Defines what proves a change may be implemented and when it counts as done: a material UX change may use an optional, human-chosen requirements-discovery demo whose accepted feedback updates the requirements before dependent implementation and whose approval authorizes implementation only, a behavior change must be exercised in a running environment with the verification recorded as evidence, that evidence travels with the pull request, and review policy enforces the verification contract so unverified behavior cannot merge silently.

## Requirements

### Requirement: Behavior changes are exercised in a running environment before review

A change that alters observable behavior SHALL NOT be presented for review (pull request opened or marked ready) until the changed behavior has been exercised in a running environment. The scenarios to exercise SHALL be derived from the change's own delta-spec WHEN/THEN scenarios and proposal intent — they are the acceptance criteria — and from the affected app's documented smoke flows, which guard against regression. The exercise is driven by an agent wherever an agent can operate the environment (browser-use, computer-use, API calls); human verification is reserved for what an agent cannot judge, such as whether behavior matches design intent. For UI-visible changes this human judgment is a hard precondition for opening the pull request: the human exercises the change hands-on in the agent-prepared running environment, and the adjustment loop closes before the pull request opens — unlike agent-executable verification, this acceptance step has no declared-gap path. Automated checks (typecheck, lint, unit and integration tests) MUST also run, but MUST NOT substitute for exercising the behavior. Declaring a verification gap — naming what was not verified and why — is acceptable; presenting the change with no account of verification is not. A change that touches code without altering observable behavior (a refactor) SHALL record smoke-level verification derived from its diff's touched surface and the affected app's documented smoke flows. Documentation- and typo-scale changes are exempt when they state the exemption.

#### Scenario: Behavior change is verified before its pull request

- **WHEN** an agent completes a behavior-changing implementation and prepares its pull request
- **THEN** the pull request is not opened until the changed behavior has been exercised in a running environment, or a verification gap has been declared with its reason

#### Scenario: Verification scenarios come from the change's spec

- **WHEN** a behavior change carries an OpenSpec change with delta-spec scenarios
- **THEN** the exercised scenarios cover those WHEN/THEN scenarios and the proposal's intent before the pull request opens

#### Scenario: Non-behavioral code change is smoke-tested from its diff

- **WHEN** a change touches code without altering observable behavior (a refactor) and has no OpenSpec proposal
- **THEN** the pull request records smoke-level verification of the diff's touched surface and the affected app's documented smoke flows

#### Scenario: Documentation-only change is exempt

- **WHEN** a change touches only documentation, comments, or typos
- **THEN** it may be presented for review without running-environment verification, stating the exemption in its Test plan

#### Scenario: UI-visible change carries the design verification matrix

- **WHEN** a behavior change alters UI presentation
- **THEN** the evidence includes screens across the themes, responsive widths, and recorded states that `DESIGN.md` requires, attached as pull request media

#### Scenario: UI-visible change is accepted hands-on before its pull request

- **WHEN** a behavior change alters UI presentation or user-facing interaction and its implementation and agent-driven verification are complete
- **THEN** the agent hands the human a running environment and the acceptance checklist, the human exercises the change hands-on and confirms it matches intent — any requested adjustments implemented and re-verified first — and only then is the pull request opened

#### Scenario: Mobile behavior change requires native acceptance

- **WHEN** a behavior change affects the mobile app
- **THEN** acceptance is exercised on real Android/iOS targets, and unit, host, or browser checks alone do not establish it

### Requirement: Verification evidence is recorded and travels with the change

For a behavior change, the verification SHALL be recorded in `openspec/changes/<change-id>/validation.md`: what was run (commands and results), what was exercised in the running environment, and what was not verified with the reason. The pull request body SHALL follow the repository pull request template — every section present, no free-text replacement — and its Test plan section SHALL summarize the verification, linking `validation.md` when the details live there.

#### Scenario: Behavior-changing pull request carries its evidence

- **WHEN** a behavior-changing pull request is opened
- **THEN** its body follows the repository template and its Test plan states how the change was verified, linking `validation.md` when the details live there

#### Scenario: Partial verification is declared, not hidden

- **WHEN** part of the behavior could not be verified
- **THEN** `validation.md` names what was not verified and why, and the Test plan says so

#### Scenario: Human acceptance is recorded

- **WHEN** a UI-visible change completes human acceptance
- **THEN** `validation.md` records who accepted, on what date, and which adjustments were made during acceptance

### Requirement: Media evidence stays out of git history

Screenshots and recordings produced as verification evidence SHALL be uploaded as GitHub pull request attachments (via `gh --attach`, requiring gh v2.99.0+) and MUST NOT be committed to the git repository. The text record (`validation.md` and the Test plan) MUST stand alone: it stays complete and reviewable without the media, because the automated review evaluates text only and the record outlives the attachment links.

#### Scenario: UI verification attaches media without committing it

- **WHEN** a change includes UI verification with screenshots or recordings
- **THEN** the media appears as GitHub attachment links in the pull request body and no media files appear in the diff

#### Scenario: Text record survives dead links

- **WHEN** an attachment link in an old pull request becomes unavailable
- **THEN** `validation.md` and the Test plan still describe what was verified and what the result was

### Requirement: Review policy enforces the evidence contract

The repository review policy SHALL treat a behavior-changing pull request as an Important compliance finding when its body drops the template's Test plan section, carries an empty evidence trail, or presents evidence that contradicts observable facts (for example claiming a check that CI shows failing). The existing merge gate thereby blocks the pull request. A pull request that declares an unverified gap with its reason SHALL NOT be flagged for that declaration; whether the declared gap is acceptable is the human reviewer's decision.

#### Scenario: Missing evidence trail blocks the merge

- **WHEN** a behavior-changing pull request's body lacks the Test plan section or the section carries no evidence
- **THEN** the automated review reports an Important compliance finding and the merge gate fails for that head

#### Scenario: Declared gap is not a finding

- **WHEN** a pull request declares "X was not verified, because Y" in its Test plan or `validation.md`
- **THEN** no Important finding is reported for that declaration, and a human reviewer decides whether the gap blocks the merge

#### Scenario: Evidence contradicting facts is a finding

- **WHEN** a pull request claims a verification that observable facts contradict (for example a green check that CI shows red)
- **THEN** the automated review reports an Important compliance finding

### Requirement: Author agents close the review-feedback loop

When review feedback (automated or human) arrives on a pull request, the author agent SHALL address it without waiting for a human reminder: poll the pull request's review comments, resolve or explicitly answer every Important finding, and push the fixes. Pushing re-triggers the automated review; when no run fires, the author agent comments `/review`. Human IM reminders are a fallback, not the mechanism.

#### Scenario: Important findings are answered without being chased

- **WHEN** the automated review posts Important findings on a pull request
- **THEN** the author agent pushes fixes or posts explicit answers without a human prompting it in IM

#### Scenario: No review run fires after a fix push

- **WHEN** the author agent pushes fixes and no new review run starts for the pushed head
- **THEN** the author agent comments `/review` to request the on-demand review

### Requirement: OpenSpec skill files stay in sync with the pinned generator

Continuous integration MUST fail when the OpenSpec-generated agent skill files (for example `.agents/skills/openspec-*` and `.claude/skills/openspec-*`) differ from what the pinned `@fission-ai/openspec` package generates, so the skill files change only in deliberate tool-upgrade pull requests. This extends the existing drift guards (rulesync, gh-aw) to the OpenSpec toolchain.

#### Scenario: Stale skill files fail CI

- **WHEN** a pull request edits OpenSpec-generated skill files without regenerating them with the pinned package version
- **THEN** the repository's agent-config guard job fails

#### Scenario: Skill files regenerated with a wrong version fail CI

- **WHEN** a pull request regenerates the skill files with an `@fission-ai/openspec` version other than the pinned one (for example a globally installed CLI)
- **THEN** the resulting diff makes the agent-config guard job fail

### Requirement: Material UX changes offer an optional requirements-discovery demo

A change is **material UX** when it restructures any of: information architecture (which content groups or surfaces exist and how they are organized), the navigation model (how users move between surfaces and return, including entry points and back behavior), a multi-step flow (the number, order, or composition of steps in a task), a core interaction (the primary gesture or control through which users perform a central product action), primary-action placement (which control is the main call to action on a surface and where it sits), or a whole-screen layout (the arrangement of a screen's main regions). For a material UX change, before dependent implementation begins, the agent SHALL ask the human whether they want a static mockup or clickable demo of the intended structure. The question SHOULD be asked while requirements are still being shaped, so the demo can inform them. The agent SHALL NOT treat the demo as required. The agent SHALL proactively recommend the demo, and state the specific reason, when either: the requirements or intended behavior are vague, incomplete, or contested and a static mockup or clickable demo would give the human something concrete to react to, exposing missing or conflicting requirements; or reversing the structural decision after implementation would rebuild multiple screens, flows, or tests. When the human accepts, the requirements-discovery contract below and the approval-record contract apply. When the human declines, implementation proceeds without a demo, an approval record, or a decision note; the agent SHALL NOT repeat the offer for the same change, and the conversation is the decision record. Changes outside the trigger list — token or color corrections, copy changes, bug fixes restoring already-approved behavior, and local component adjustments inside an existing approved pattern — are exempt: no offer is required and implementation may proceed.

#### Scenario: Material UX change offers the demo

- **WHEN** a change restructures information architecture, the navigation model, a multi-step flow, a core interaction, primary-action placement, or a whole-screen layout
- **THEN** the agent asks the human, before dependent implementation, whether they want a static mockup or clickable demo

#### Scenario: Requirement uncertainty carries a recommendation

- **WHEN** the requirements or intended behavior are vague, incomplete, or contested and visualization or interaction would make them concrete enough for the human to react to
- **THEN** the agent recommends the demo and names the uncertainty it would resolve

#### Scenario: High-rework-risk change carries a recommendation

- **WHEN** reversing the planned structural decision after implementation would rebuild multiple screens, flows, or tests
- **THEN** the agent recommends the demo and explains the concrete rework it would avoid

#### Scenario: Human declines the demo

- **WHEN** the human declines the demo offer
- **THEN** implementation proceeds without a demo or approval record
- **AND** the agent does not repeat the offer for the same change
- **AND** the absence produces no Compliance finding and does not block the pull request

#### Scenario: Non-material UI change is exempt

- **WHEN** a change corrects a token or color, edits copy, fixes a bug to restore already-approved behavior, or adjusts a component inside an existing approved pattern
- **THEN** no demo offer is required and implementation may proceed

### Requirement: An accepted demo is a requirements-discovery step that gates dependent implementation

When the human accepts the demo offer, the demo SHALL be presented before any dependent implementation begins, and implementation whose requirements or design depends on the UX decisions under exploration SHALL NOT begin until the demo feedback has been incorporated into the change's requirements as this requirement specifies. The wait applies across layers: UI implementation, backend behavior, data models, API contracts, and test expectations all wait when they depend on those decisions. Only work that is demonstrably independent of those decisions MAY proceed; examples include environment setup, technical research or spikes, independent benchmarks, and generic tooling. Demonstrably independent means the work's requirements and design cannot change based on the UX outcome, not merely that the work touches another layer or directory. Demo feedback SHALL first update the change's requirements: `openspec/changes/<change-id>/proposal.md` always, and the delta spec or design when the requirements or design change. The updated artifacts are the implementation target. If feedback changes the approved structure, scope, or requirements direction, the agent SHALL present a revised demo and obtain approval for the changed part before implementing it. While the offer is unanswered, dependent implementation SHALL NOT begin, and demonstrably independent work MAY proceed.

#### Scenario: Dependent implementation waits for the demo feedback

- **WHEN** the human accepts the demo offer and the UX decisions are not yet resolved
- **THEN** UI implementation, backend behavior, data models, API contracts, and test expectations that depend on those decisions do not begin until the feedback is incorporated into the requirements

#### Scenario: Independent work proceeds

- **WHEN** work is demonstrably independent of the unresolved UX decisions, such as environment setup, a technical spike, an independent benchmark, or generic tooling
- **THEN** that work may proceed while the demo is pending

#### Scenario: Demo feedback updates the requirements first

- **WHEN** demo feedback changes a requirement
- **THEN** `proposal.md` and, when the requirements or design change, the delta spec or design are updated before dependent implementation begins
- **AND** the implementation follows the updated requirements

#### Scenario: Scope-changing feedback repeats the demo

- **WHEN** demo feedback changes the approved structure, scope, or requirements direction
- **THEN** a revised demo is presented and approved for the changed part before that part is implemented

#### Scenario: Offer is unanswered

- **WHEN** the agent has offered the demo and the human has not answered
- **THEN** dependent implementation does not begin, while demonstrably independent work may proceed

### Requirement: An accepted demo is covered and approved as specified

When the human accepts the demo offer, the demo SHALL cover the main flow from entry to completion including at least one representative branch, the key states the affected surface can present (empty, loading, error, disabled or unavailable, selected, and the interactive states `DESIGN.md` §8 requires), the themes the `DESIGN.md` theme-support matrix requires for that surface, and the responsive widths its layout rules require. A dimension that does not apply SHALL be named with its reason rather than omitted silently. After the feedback is incorporated, the approval SHALL be recorded in `openspec/changes/<change-id>/proposal.md`, stating who approved and their role, the approval date, the demonstrated scope (the surfaces, flow steps, and design decisions the demo covered), the states, themes, and widths that were covered, the feedback that changed the requirements and the resulting requirement changes, any adjustments or conditions the human required, and the decision that the updated requirements may be implemented. The record SHALL be self-contained prose: when the demo was a temporary artifact, a chat attachment, or an expiring link, the record still describes the approved structure and the requirements it settled well enough for a reviewer to check the implementation against them. Screenshots and recordings of the demo MUST follow the repository's existing media rule — attached, never committed.

#### Scenario: Accepted demo covers the material surface

- **WHEN** the human accepts the demo offer
- **THEN** the demo shows the main flow with a representative branch, the surface's key states, and the themes and responsive widths `DESIGN.md` requires
- **AND** any inapplicable state, theme, or width is named with its reason

#### Scenario: Opt-in approval record is complete

- **WHEN** the human approves the demo after the feedback is incorporated
- **THEN** `proposal.md` records the approver and role, the date, the demonstrated scope, the covered states/themes/widths, the feedback and resulting requirement changes, required conditions, and the authorization to implement the updated requirements

#### Scenario: Record survives a temporary demo

- **WHEN** the demo lived in a temporary preview, a chat attachment, or an expiring link
- **THEN** the `proposal.md` record still describes the approved structure and requirements so implementation can be reviewed against them after the artifact is gone

#### Scenario: Conditional approval is carried into implementation

- **WHEN** the human approves the demo subject to requested adjustments
- **THEN** the conditions are recorded in the same approval record and the updated requirements and implementation apply them
- **AND** a requested adjustment that changes the approved structure or requirements direction returns to the human through a revised demo before that part is implemented

### Requirement: The demo checkpoint does not gate review and does not replace hands-on acceptance

The repository review policy SHALL NOT require a demo or a demo approval record for a material UX change. Their absence SHALL NOT be reported as an Important Compliance finding and SHALL NOT block the merge. The review SHALL NOT re-review a demo's design quality. Demo approval, when the human chose the demo, authorizes implementation of the updated requirements only: post-implementation human hands-on acceptance remains mandatory for a UI-visible change before its pull request opens, and neither the demo nor its approval replaces it. The hands-on acceptance requirement and its no-declared-gap rule are unchanged.

#### Scenario: Missing demo record does not block

- **WHEN** a material UX change has no demo and no approval record
- **THEN** the review reports no Compliance finding for the absence and the merge gate is not blocked for that reason

#### Scenario: Approval does not replace hands-on acceptance

- **WHEN** a material UX change with an accepted and approved demo completes implementation
- **THEN** the human still exercises the implemented change hands-on in the running environment before the pull request opens
