# change-verification Specification

## Purpose
Defines what proves a change may be implemented and when it counts as done: a material UX change needs a human-approved demo before implementation, a behavior change must be exercised in a running environment with the verification recorded as evidence, that evidence travels with the pull request, and review policy enforces both gates so neither unapproved design nor unverified behavior can merge silently.

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
