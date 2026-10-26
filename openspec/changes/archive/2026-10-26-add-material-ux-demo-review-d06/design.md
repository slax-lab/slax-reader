# Design

## Context

See `proposal.md` — Why. The constraints that shape this revision:

- The human adjusted the direction on 2026-10-26: the demo is optional, offered by the agent and chosen by the human; it must not become a review gate. The earlier mandatory-gate design was never approved.
- The human corrected the first optional revision's D3: a demo helps turn vague ideas or requirements into something visible or interactive, enabling deeper feedback and further requirement exploration. The demo is therefore a requirements-discovery tool, and pausing only UI while backend, data, contracts, and tests proceed is wrong — those layers encode the same unresolved UX decisions.
- `DESIGN.md` is the normative UI design contract and already owns the change workflow (§10) and the theme/responsive/state matrices (§5.5, §6, §8). Its only human checkpoint is post-implementation.
- `openspec/specs/change-verification/spec.md` owns what proves a change may ship, including the mandatory post-implementation hands-on acceptance for UI-visible changes.
- Root agent rules are generated from `.rulesync/rules/*.md`; `AGENTS.md` and its siblings are never hand-edited.
- `REVIEW.md` is the review agent's only policy input. Its Compliance pass treats divergence from the linked change as Important, so leaving the optional checkpoint unmentioned there would let a reviewer silently restore the old gate.
- `proposal.md` is the human-reviewed planning artifact for every change and is archived with it; `validation.md` is the post-implementation record.
- `reduce-governance-rules-duplication-r08` is a separate, retrospective change awaiting its own human adjudication and currently encodes the mandatory demo as a preserved hard constraint.

## Goals / Non-Goals

**Goals:**

- Treat the demo as a way to discover requirements, not as a visual sign-off that happens after the requirements are already settled.
- Keep every layer that depends on the unresolved UX decisions from being implemented prematurely — including backend behavior, data models, API contracts, and test expectations.
- Let genuinely independent work proceed so the wait does not idle the whole change.
- Make demo feedback land in the requirements before it lands in code.
- Keep the checkpoint cheap: one question and, only when the human opts in, a short approval record — no new artifact, template item, or CI check.
- Keep the review from turning an absent demo or record into a blocker.
- Preserve the post-implementation hands-on acceptance exactly as it stands.

**Non-Goals:**

- A demo authoring tool, template, or fidelity standard beyond "static mockup or clickable demo".
- Automated verification that a demo matches the implementation, that an approval happened, or that the agent asked.
- Pausing work solely to reserve capacity; the wait exists because dependent requirements are unresolved.
- Changing post-implementation acceptance, verification evidence, or media rules.
- Editing `reduce-governance-rules-duplication-r08` here.
- Importing or amending the superseded implementation in this proposal branch.

## Decisions

### D1: The offer is universal; the demo is opt-in

For every material UX change the agent asks the human whether they want a demo. Asking costs one message and guarantees the human knows the option exists. The demo itself is never required; the human decides. Alternatives rejected: (a) a mandatory gate — slows every material change regardless of risk, and the human did not approve it; (b) no offer at all — loses the checkpoint where it matters; (c) offering only above a risk threshold — the agent's own risk judgment would withhold the option from the person who should decide.

### D2: The recommendation triggers on requirement uncertainty or high rework risk

The agent recommends the demo in either of two situations and names the specific reason:

- **Requirement uncertainty.** The requirements or intended behavior are vague, incomplete, or contested, and a static mockup or clickable demo would give the human something concrete to react to — exposing missing, conflicting, or unstated requirements. The recommendation names the uncertainty the demo would resolve.
- **High rework risk.** Reversing the structural decision after implementation would rebuild multiple screens, flows, or tests. The recommendation names the concrete rebuild it would avoid.

The uncertainty trigger is the correction to the earlier design, which implicitly assumed the requirements were already well defined and only the structure was expensive. A demo is often most valuable before the requirements are settled, because the human cannot fully specify an interaction in prose. Alternatives rejected: only rework risk — misses the discovery case; only uncertainty — misses a well-understood but expensive structure; always recommending — a soft gate that becomes noise.

### D3: An accepted demo blocks every dependent implementation layer

The test is dependency, not layer. Once the human accepts the offer, work whose requirements or design would change based on the unresolved UX decisions SHALL NOT begin. That includes:

- UI implementation of the affected surface;
- backend behavior whose rules depend on the interaction or flow;
- data models whose shape depends on what the product must store;
- API contracts whose inputs, outputs, or semantics depend on the UX;
- test expectations that encode the behavior being decided.

Only work that is **demonstrably independent** may proceed. Examples are environment setup, technical research or spikes, independent benchmarks, and generic tooling. "Demonstrably independent" means the work's outcome cannot change based on the UX result; it is not enough that the work touches another layer or another directory. The author names the dependency and why the UX decision cannot affect it; when independence is not demonstrable, the work waits.

Alternatives rejected: (a) pause only UI — the earlier error: backend, data, contracts, and tests encode guesses and create exactly the rework the demo is meant to avoid; (b) pause everything including setup and spikes — idles work that cannot be invalidated and adds no safety; (c) let authors self-classify without a dependency test — the explicit "demonstrably independent" criterion keeps the classification auditable.

The offer itself is asked at planning time. While the offer is unanswered, dependent implementation does not begin, because the answer may be yes; independent work may proceed.

### D4: Demo feedback updates the requirements before implementation

Feedback is the product of the demo, so it lands in the requirements first:

- `proposal.md` is always updated with the feedback and the resulting requirement changes.
- When the requirements are specified in the change's delta spec or design, those artifacts are updated too; they are the normative target the implementation and the review check against.
- Only after the updated requirements exist does dependent implementation begin.

If the feedback changes the approved structure, scope, or requirements direction, the revised demo is presented and approved for the changed part before that part is implemented. A demo approval covers what the human actually saw and the requirements it settled, not a later, materially different direction.

Alternatives rejected: (a) implement the feedback directly — requirements and code drift, and the reviewer has nothing stable to check against; (b) treat feedback as advisory and keep the old requirements — defeats the purpose of the discovery step; (c) require a new full demo for every wording change — unnecessary; only structure, scope, or direction changes repeat the cycle.

### D5: The opt-in approval record is lightweight and unenforced

- **Opt-in:** the approval record lives in `proposal.md` and is written after the feedback is incorporated, with the fields D6 defines.
- **Opt-out:** no record is required. Implementation proceeds, and the agent does not repeat the offer for the same change; the conversation is the decision record.

The record is not checked by review, and its absence is explicitly outside the review's findings (D8). Requiring an opt-out note was rejected: a record nobody enforces adds ceremony and has no downstream artifact to inform, and re-asking would turn the human's answer into nagging. Alternatives rejected for the opt-in record: a separate `design-approval.md` file — another artifact to discover; `validation.md` — post-implementation semantics; the pull request body — arrives after implementation and is not archived.

### D6: Coverage reuses `DESIGN.md`'s matrices and applies only to accepted demos

An accepted demo covers the main flow from entry to completion with at least one representative branch, the surface's key states (empty, loading, error, disabled or unavailable, selected, and the interactive states `DESIGN.md` §8 requires), the themes its theme-support matrix requires, and its responsive widths. An inapplicable dimension is named with its reason so silence is not mistaken for coverage. Writing a second matrix inside the rule would drift from the design contract.

The approval record states who approved and their role, the date, the demonstrated scope, the covered states/themes/widths, the feedback that changed the requirements and the resulting changes, required adjustments or conditions, and the decision that the updated requirements may be implemented. It is self-contained prose because demos are often temporary (a local build, a chat attachment, an expiring preview); the record must outlive the artifact. Media follows the existing rule: attached, never committed.

### D7: Exemptions are explicit and unchanged

Token or color corrections, copy changes, bug fixes that restore already-approved behavior, and local component adjustments inside an existing approved pattern are exempt from the offer. The test is structural: if the approved information architecture, navigation, flow steps, core interaction, primary action, or screen regions do not change, the checkpoint does not apply. Without this list, routine fixes would receive a question that has no decision behind it.

### D8: Review explicitly does not enforce the checkpoint

This reverses the earlier D06 decision to make a missing approval record an Important Compliance finding.

`REVIEW.md` must state that a material UX change without a demo or an approval record is not reported as a finding, and the existing hands-on acceptance check stays. The carve-out is necessary: `REVIEW.md`'s Compliance pass otherwise treats divergence from the change's intent as Important, so an author whose human declined the demo could still be blocked by a reviewer applying the general rule. With the carve-out, the review checks the acceptance that remains mandatory and does not re-litigate the human's choice.

The review also does not re-review a demo's design quality and cannot verify authenticity; a fabricated record is a trust failure outside automated enforcement.

### D9: Post-implementation acceptance stays independent and mandatory

Demo approval authorizes implementation, not shipment. The existing `change-verification` requirements and `REVIEW.md` acceptance check remain unchanged: a UI-visible change is exercised hands-on by the human in the running environment before its pull request opens, with no declared-gap path. The two checkpoints are independent, and neither record substitutes for the other.

### D10: The superseded implementation must be amended before delivery

The earlier implementation on `feat/add-material-ux-demo-review-d06` (commit `02f80058`) stated the opposite rule: a mandatory gate, an Important finding for a missing record, and agent/design/template text that repeated it. It also reflected the corrected D3 — its §10.1 paused only UI. It was intentionally absent from the proposal-only branch; this change now amends it — not merged as-is and not partially cherry-picked, because the generated agent files and the design contract would otherwise propagate the removed gate and the wrong wait scope beside the new rule.

Required end state (implemented by this change):

| File | Superseded D06 content | Required content |
| --- | --- | --- |
| `DESIGN.md` | Mandatory §10.1 gate that pauses only UI; reading-order step; checklist question | §10.1 defines the optional requirements-discovery checkpoint: offer, recommendation triggers (requirement uncertainty, high rework risk), the dependent-work wait across layers and the independent-work allowance, feedback-first requirements update, opt-in coverage/approval record, no record on opt-out, exemptions; §10.2 keeps acceptance independent; §1 and §11 say "offered and, when accepted, recorded", not "approved" |
| `.rulesync/rules/overview.md` + regenerated `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/`, `.agents/` | "Obtain approval before implementation; missing record is Important" | Ask; recommend on requirement uncertainty or rework risk; when accepted, wait all dependent implementation and update requirements from feedback first; demonstrably independent work may proceed; absence is not a finding; acceptance unchanged; run `pnpm agent:sync` |
| `REVIEW.md` | Step 6 reports a missing or incomplete approval record as Important | No mandatory finding; a "Do not report" entry names the absent demo/record; the hands-on acceptance check stays |
| `.github/PULL_REQUEST_TEMPLATE.md` | Checklist item and Test plan guidance for the recorded approval | Restore the pre-D06 content; no mandatory demo item |
| `openspec/config.yaml` | Apply guidance to obtain approval before UI implementation | Apply guidance to offer, recommend, and update requirements from demo feedback before dependent implementation; implementation may proceed when the human declines |
| `openspec/specs/change-verification/spec.md` | Purpose describes two gates | Purpose describes the optional requirements-discovery checkpoint and the done contract |

### D11: R08 is reconciled in its own follow-up

R08 is a separate retrospective change that is itself awaiting human adjudication, so this change records the required wording instead of editing it. Its textual references fall into four groups: (a) owner/authority statements naming "material UX demo approval"; (b) the preserved hard-constraint bullet that makes a missing record Important; (c) the scenario that turns a missing record into a finding; (d) descriptive references in the proposal, design, and validation (including the PR-template row that claims the template keeps a material UX approval item). All of them must move to the optional requirements-discovery checkpoint semantics now that this proposal is approved.

Reconciling R08 before approval would make it cite an unapproved rule, and editing it inside this branch would violate one-task-one-change scope. The follow-up is tracked as an unchecked task in `tasks.md` with the exact locations in § "R08 dependency reconciliation" below.

### D12: No new ceremony beyond the question and the opt-in record

No new artifact file, no pull request template item, no CI check, no configuration gate. The only mandatory agent action is asking; the only record is the opt-in approval record when the human chooses the demo. A decline leaves no artifact and triggers no follow-up question. This follows directly from the human's "not mandatory" direction: every added artifact would recreate the gate under another name.

## Risks / Trade-offs

- **The wait serializes more work than the UI-only rule did** → The independent-work allowance keeps setup, spikes, benchmarks, and generic tooling moving. The human can decline the demo, which releases all work. The demo should be produced early once accepted, not at the end of planning.
- **Authors over-classify work as independent** → The "demonstrably independent" test requires naming the dependency and why the UX result cannot change it; ambiguous cases wait. A reviewer can challenge the claim against the diff.
- **Recommendations become frequent because uncertainty is common** → Each recommendation names a specific uncertainty; the human can decline in one message, and a decline is explicitly not a finding.
- **A decline leaves no written trace** → Accepted: the conversation is the record and no downstream artifact depends on it; requiring a note or repeating the question would add ceremony without changing the implementation basis.
- **Feedback loops repeat without converging** → Only structure, scope, or direction changes require a new demo; wording-level feedback updates the requirements directly. The human controls the loop and can settle the requirements at any round.
- **Feedback changes requirements after some independent work was built** → Independent work is chosen so it cannot be invalidated; if it turns out to depend on the UX, it was misclassified and is redone or discarded, which the dependency test is meant to prevent.
- **Superseded branch delivered unamended** → The alignment task stays unchecked, and the delivery check requires no mandatory-gate or UI-only wording to survive in `DESIGN.md`, `REVIEW.md`, the rules source, or the generated files.
- **R08 remains inconsistent until its follow-up** → R08 is already blocked on human adjudication; the required edits are listed here and tracked separately.
- **Optional demo is chosen on a low-risk change** → Harmless: the cost is a demo the human asked for, not a gate.

## R08 dependency reconciliation

Current locations in `openspec/changes/reduce-governance-rules-duplication-r08/` (line numbers as of this revision; match the quoted text if they drift). None of these files is edited in this mission.

| File | Current reference | Required direction |
| --- | --- | --- |
| `specs/agent-rule-governance/spec.md:16` | Owner bullet: "the UI design contract, material UX demo approval, and the design verification matrix: `DESIGN.md`" | "the UI design contract, the optional material UX requirements-discovery checkpoint, and the design verification matrix: `DESIGN.md`" |
| `specs/agent-rule-governance/spec.md:36` | Scenario: "`DESIGN.md` governs the material UX demo approval that precedes implementation" | "`DESIGN.md` governs the optional material UX requirements-discovery checkpoint that may precede implementation" |
| `specs/agent-rule-governance/spec.md:54` | Scoped-design requirement names "material UX demo approval" | "the optional material UX requirements-discovery checkpoint" |
| `specs/agent-rule-governance/spec.md:93–94` | Hard constraint: "material UX demo approval before UI implementation, recorded … and reported as an Important Compliance finding when missing"; the next bullet keeps "demo approval authorizing implementation only" | Replace `:93` with: the agent offers the demo, recommends it for requirement uncertainty or high rework risk, waits dependent implementation, and updates requirements from feedback; a missing demo or record is not a Compliance finding. Keep `:94` and condition it: an accepted demo's approval authorizes implementation only; post-implementation hands-on acceptance is unchanged |
| `specs/agent-rule-governance/spec.md:104–105` | Scenario: "Material UX record is missing → Important Compliance finding" | Replace with a scenario asserting that a missing demo/approval record produces no finding, or delete it; the "UI acceptance is skipped" scenario stays |
| `proposal.md:56`, `:62` | Authority-map rows name "material UX demo approval" | "optional material UX requirements-discovery checkpoint" |
| `proposal.md:85–86` | Preserved hard-constraint bullet: mandatory approval, Important when missing; the next bullet keeps "demo approval authorizes implementation only" | Rewrite `:85` as the optional requirements-discovery checkpoint; keep `:86` with "an accepted demo's approval authorizes implementation only" |
| `proposal.md:106` | Says the PR template keeps a "material UX record" | The template carries no demo item; remove that clause |
| `proposal.md:117` | A3: "`DESIGN.md` owns material UX demo approval" | "`DESIGN.md` owns the optional material UX requirements-discovery checkpoint" |
| `design.md:37` | Row says the mandatory rule's "Important Compliance finding and 'approval authorizes implementation, not shipment' stay" | Remove the Important-finding clause; keep "an accepted demo's approval authorizes implementation, not shipment" |
| `design.md:64`, `:108`, `:161`, `:163`, `:187` | Describe the mandatory approval, its Important finding, and §10.1 ownership | Same substitution: optional requirements-discovery checkpoint; §10.1 defines the offer/recommendation/wait/feedback sequence; at `:161` the `REVIEW.md` column changes from "treats a missing record as Important" to "does not report it"; acceptance ownership is unchanged |
| `design.md:96` | Root rules keep "the material UX checkpoint" | "the optional material UX requirements-discovery checkpoint" |
| `design.md:148` | Window row says the PR template keeps "material UX approval" | The template keeps no demo item; the rest of the row is unchanged |
| `validation.md:31`, `:67` | Describe `DESIGN.md` §10.1 as owning mandatory demo approval | Rewrite to the optional requirements-discovery checkpoint once R08's own artifacts are reconciled |

R08's `tasks.md` carries no material-UX reference, so it needs no edit for this topic.

## Migration Plan

- The proposal revision changed proposal artifacts only. The approved implementation amendment lands in this same change directory on the D06 branch. No repository data, runtime, deployment, or application-state migration.
- The implementation amendment is complete in this change (D10); reconcile R08 (D11) in its own branch, and archive this change after the implementation pull request merges.
- Rollback is a revert of the documentation and policy diff; no application state is affected.
