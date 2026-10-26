# Spec Delta

## MODIFIED Requirements

### Requirement: Behavior changes are exercised in a running environment before review

A change that alters observable behavior SHALL NOT be presented for review (pull request opened or marked ready) until the changed behavior has been exercised in a running environment. The scenarios to exercise SHALL be derived from the change's own delta-spec WHEN/THEN scenarios and proposal intent — they are the acceptance criteria — and from the affected app's documented smoke flows, which guard against regression. The exercise is driven by an agent wherever an agent can operate the environment (browser-use, computer-use, API calls); human verification is reserved for what an agent cannot judge, such as whether behavior matches design intent. For UI-visible changes this human judgment is a hard precondition for opening the pull request: the human exercises the change hands-on in the agent-prepared running environment, and the adjustment loop closes before the pull request opens — unlike agent-executable verification, this acceptance step has no declared-gap path. Automated checks (typecheck, lint, unit and integration tests) MUST also run, but MUST NOT substitute for exercising the behavior. Declaring a verification gap — naming what was not verified and why — is acceptable; presenting the change with no account of verification is not. A change that touches code without altering observable behavior (a refactor) SHALL record smoke-level verification derived from its diff's touched surface, any related living specs, and the affected app's documented smoke flows. Documentation-, comment-, and typo-scale changes are exempt when the change states the exemption.

#### Scenario: Behavior change is verified before its pull request

- **WHEN** an agent completes a behavior-changing implementation and prepares its pull request
- **THEN** the pull request is not opened until the changed behavior has been exercised in a running environment, or a verification gap has been declared with its reason

#### Scenario: Verification scenarios come from the change's spec

- **WHEN** a behavior change carries an OpenSpec change with delta-spec scenarios
- **THEN** the exercised scenarios cover those WHEN/THEN scenarios and the proposal's intent before the pull request opens

#### Scenario: Non-behavioral code change is smoke-tested from its diff

- **WHEN** a change touches code without altering observable behavior (a refactor) and has no OpenSpec proposal
- **THEN** the pull request records smoke-level verification of the diff's touched surface, any related living specs, and the affected app's documented smoke flows

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
