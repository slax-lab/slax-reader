# Design

## Context

See `proposal.md` — Why. The constraints that shape the approach:

- `DESIGN.md` is the normative UI design contract and already owns the change workflow (§10) and the theme/responsive/state matrices (§5.5, §6, §8). Its only human checkpoint is post-implementation.
- `openspec/specs/change-verification/spec.md` owns what proves a change may ship. It already requires post-implementation human hands-on acceptance and review-policy enforcement of the evidence trail.
- Root agent rules are generated from `.rulesync/rules/*.md`; `AGENTS.md` and its siblings are never hand-edited.
- `REVIEW.md` is the review agent's only policy input, read from the pull request's head branch; a new Important finding routes through the existing merge gate without workflow changes.
- `proposal.md` is the human-reviewed planning artifact for every change and is archived with it; `validation.md` is the post-implementation record.

## Goals / Non-Goals

**Goals:**

- Stop a material UX decision from reaching implementation before a human has seen its structure.
- Make the approval auditable from the repository alone, after temporary demo artifacts are gone.
- Keep the gate cheap for small, local UI work so pre-PMF velocity does not collapse.
- Keep one source of truth per concern: triggers and coverage in `DESIGN.md`, the change contract in the `change-verification` spec, review severity in `REVIEW.md`, agent-facing summary in the rules source.

**Non-Goals:**

- A demo authoring tool, template, or fidelity standard beyond "static mockup or clickable demo".
- Automated verification that a demo matches the implementation or that the approval actually happened.
- Changing post-implementation acceptance, verification evidence, or media rules.
- Turning every UI-visible change into a design review.

## Decisions

### D1: The trigger list is structural, not visual

The gate applies to changes that restructure information architecture, the navigation model, a multi-step flow, a core interaction, primary-action placement, or a whole-screen layout. These are the decisions whose reversal costs a rebuild, because every screen and test downstream depends on them. Visual polish inside an existing structure is cheap to reverse and is excluded.

Alternatives considered: (a) every UI-visible change requires a demo — turns routine fixes into ceremony and would be ignored in practice; (b) only full-screen redesigns — misses navigation-model and multi-step-flow changes, which are the most expensive to undo; (c) size thresholds (files or lines changed) — unrelated to structural risk.

### D2: The demo is presented before UI implementation, not before all work

The gate blocks UI implementation of the materially changed surface. Backend, data, contract, and test work may proceed while design approval is pending, so the gate serializes only what it must. The requirement says "UI implementation" rather than "implementation" for that reason.

### D3: Approval is recorded in `proposal.md`, text-first

`proposal.md` is where the human already reviews and authorizes a change, and it archives with the change. Recording the approval there keeps pre-implementation authorization and post-implementation evidence (`validation.md`) separate instead of mixing two different gates in one file.

Alternatives considered: a separate `design-approval.md` — another artifact to discover and a second place to look; `validation.md` — semantically the post-implementation record, and mixing the gates would blur which one a review is checking; the pull request body — arrives after implementation and is neither archived nor diff-reviewable.

The record must stand alone because demos are often temporary (a local build, a chat attachment, an expiring preview). A reviewer months later, and the archived change itself, must still describe the approved structure. This mirrors the existing media rule: media is attached, never committed, and the text record must be readable without it.

### D4: Demo format is deliberately open

A static mockup or a clickable demo satisfies the rule; the choice follows the decision under review. A clickable demo is the stronger artifact when the decision depends on motion, gesture, or transition, and a static mockup is sufficient when the interaction is conventional and the decision is about structure. Mandating one format either blocks on tooling (a runnable app build for every flow) or imports a vendor (a specific design tool).

### D5: Coverage reuses `DESIGN.md`'s matrices

The demo covers the main flow, key states, and the themes and responsive widths that `DESIGN.md` already requires for the surface (§5.5 layout, §6 theme matrix, §8 interactive states). Writing a second matrix inside the rule would drift from the design contract; the rule points at the existing source. Inapplicable dimensions must be named with a reason so silence is not mistaken for coverage.

### D6: Exclusions are explicit

Token or color corrections, copy changes, bug fixes that restore already-approved behavior, and local component adjustments inside an existing approved pattern are exempt. Without this list, every regression fix that touches layout would need a demo, and the rule would be routed around. The test is structural: if the approved information architecture, navigation, flow steps, core interaction, primary action, or screen regions do not change, the gate does not apply.

### D7: Enforcement is an Important Compliance finding, not a new tool

`REVIEW.md`'s Compliance pass gains a step: a material UX change with no approval record — or a record missing the approver, date, scope, or coverage — is Important. Important already maps to the existing review gate, so no workflow or tooling change is needed. A deterministic lint was rejected for the same reason as the existing evidence check: it can confirm section presence but not substance, and an empty record satisfies it.

The review verifies the record, not the demo's design quality; judging the design belongs to the human approval it records. Authenticity is likewise outside automation — a fabricated record is a trust failure the merge gate cannot detect, and the rule states the requirement rather than pretending to enforce it.

### D8: Post-implementation acceptance stays independent

Demo approval authorizes implementation, not shipment. The existing hands-on acceptance still runs after implementation against the built change, and neither record substitutes for the other. This is stated in the spec so a future reader cannot collapse the two gates into one.

## Risks / Trade-offs

- **Gate becomes a bottleneck** → Non-UI work continues while approval is pending, and the exemption list keeps local fixes out of the gate. The demo should be batched early in a material change rather than produced at the end of planning.
- **Agents under-classify a material change to skip the gate** → `DESIGN.md` makes the trigger list normative, `REVIEW.md` names the structural triggers, and the reviewer judges the diff's structural surface rather than the author's label. Detection is still judgment-based; that is accepted rather than solved with heuristics.
- **Static mockup hides an interaction problem** → `DESIGN.md` recommends a clickable demo when the decision depends on motion, gesture, or transition, while allowing a mockup when the interaction is conventional.
- **Approval record goes stale as implementation evolves** → The record carries conditions, and a requested adjustment that changes the approved structure returns to the human before that part is implemented. Divergence beyond those conditions is a Compliance finding under the existing intent check.
- **Human approval latency delays a change** → Accepted: that latency is the point of the gate, and it is bounded because the demo is required only for the structural scope.

## Migration Plan

- The `change-verification` capability's Purpose is edited in the main spec in this change, per the OpenSpec CLI's guidance for existing capabilities; the three added requirements enter the main spec when the change is archived.
- No repository data, runtime, or deployment migration. Once merged, the rule is active on the next change that touches a material UX surface; in-flight changes are not retroactively required to add a demo, but a new material UX scope inside one is.
- Rollback is a revert of the documentation and rule diff; no application state is affected.
