# agentic-pr-review Specification

## Purpose
Automated, policy-driven review of pull requests: it decides when a review runs, which repository policy it must apply, how its findings are published on the pull request, and when its verdict blocks a merge.

## Requirements

### Requirement: Review runs on pull request readiness and on demand

The system SHALL request exactly one review per pull request when the pull request is opened, reopened, or marked ready for review; a pull request opened as a draft MUST NOT be reviewed until it is marked ready. It SHALL accept an explicit `/review` comment as a request to re-run the review. It MUST NOT start a new review on ordinary pushes to an open pull request. `/review` requests from actors without write access to the repository MUST be ignored.

#### Scenario: New pull request is reviewed once

- **WHEN** a pull request targeting the default branch is opened (or a draft is marked ready for review)
- **THEN** exactly one review run starts for that pull request

#### Scenario: Push does not trigger a new review

- **WHEN** commits are pushed to a pull request that has already been reviewed
- **THEN** no new review run starts

#### Scenario: Comment re-runs the review

- **WHEN** a user with write access comments `/review` on the pull request
- **THEN** a new review run starts for that pull request

#### Scenario: Unauthorized comment is ignored

- **WHEN** a user without write access comments `/review`
- **THEN** no review run starts

### Requirement: Reviews are skipped for fork pull requests

The system MUST NOT execute the review agent for pull requests whose head branch lives in a fork, and MUST NOT require repository secrets for those pull requests. For a skipped review the merge gate MUST still report a non-pending, passing result, so an un-reviewed fork pull request is never blocked by a permanently missing check.

#### Scenario: Fork pull request is skipped cleanly

- **WHEN** a pull request is opened from a fork of this repository
- **THEN** no agent execution occurs, no repository secret is used, and the gate reports a passing result for that commit

### Requirement: Findings follow the repository review policy

Every review MUST apply `REVIEW.md` at the repository root, as it exists on the pull request's head branch, as its review policy. The review MUST group findings by the passes that policy defines, MUST respect the severities and the per-review finding limits it allows, MUST apply the recurring-pattern tag it defines, and MUST omit the subjects it excludes. This specification does not restate the policy's contents: `REVIEW.md` remains their single source of truth.

#### Scenario: The policy file drives the review

- **WHEN** a pull request edits `REVIEW.md` — a pass name, a finding limit, or the excluded subjects — and the review runs for that pull request
- **THEN** the review follows the edited policy rather than any value fixed in the workflow

#### Scenario: Nit-only review is summarized, not blocking

- **WHEN** a review finds only suggestions that the policy classifies as Nits
- **THEN** the review reports at most the policy's nit limit, leads its summary with "No blocking issues", and produces no Important finding

#### Scenario: Recurring patterns carry the policy's tag

- **WHEN** a finding matches a pattern that the policy lists as recurring
- **THEN** the finding carries the tag the policy defines for it

#### Scenario: Excluded subjects are not reported

- **WHEN** every candidate finding concerns a subject that the policy excludes
- **THEN** no finding is reported for it

### Requirement: Compliance findings reference the linked OpenSpec change

For pull requests that change behavior, the review MUST perform the compliance pass that `REVIEW.md` defines: locate the `OpenSpec: <change-id>` line in the pull request body, read the referenced change under `openspec/changes/<change-id>/`, and verify the implementation against that change's stated intent. A missing reference and any divergence the pass detects MUST be reported as findings at the severity the policy assigns to them; which pull requests count as behavior-changing also comes from the policy.

#### Scenario: Missing change reference on a behavior change

- **WHEN** a pull request that the policy counts as behavior-changing has no `OpenSpec:` line in its body
- **THEN** the review reports a compliance finding for the missing reference at the policy's severity

#### Scenario: Divergence from the referenced change

- **WHEN** the pull request body names a change id and the implementation diverges from that change's artifacts
- **THEN** the review reports a Compliance finding describing the divergence

#### Scenario: Non-behavioral change opts out

- **WHEN** a pull request body states `OpenSpec: n/a` and the pull request is not behavior-changing under the policy
- **THEN** no Compliance finding is reported for the change reference

### Requirement: Findings are published through GitHub review surfaces

The system SHALL publish at most one consolidated review per run on the pull request, containing the summary and, when applicable, inline comments on specific lines. The review event MUST be `COMMENT`; the system MUST NOT submit `APPROVE` or `REQUEST_CHANGES` reviews. Comments and reviews MUST be authored only through validated write operations; the agent itself MUST NOT hold write permission.

#### Scenario: One consolidated review per run

- **WHEN** a review run completes with a summary and inline findings
- **THEN** the pull request shows one review containing that summary and those inline comments

#### Scenario: No approval is ever submitted

- **WHEN** a review run finds no problems at all
- **THEN** the review is published as a comment review and the pull request is left unapproved

#### Scenario: A flagged review is not published

- **WHEN** threat detection flags the agent's output as a possible prompt-injection or hijack attempt
- **THEN** the run fails before any review is published, the pull request gains no review from that
  run, and the required check fails closed instead of reporting a review nobody can read

#### Scenario: Agent cannot write directly

- **WHEN** the agent attempts any repository write that is not a configured review output
- **THEN** the write does not occur

### Requirement: The merge gate reflects Important findings

The system SHALL expose a status check whose name is stable across runs. That check MUST report failure when the review produced at least one Important finding, and success when the review produced none. A passing result MUST rest on positive evidence about the run's own stages: the review system declined to activate the run — the pause, a fork pull request, and the other conditions its activation decision is compiled from — or the run was activated and its agent either executed or was deliberately not started by a configured guardrail (a budget cap). A run that stopped for any other reason, including a configuration failure in a stage before the agent, MUST report failure whose description names the stage that stopped it; when no single stage stopped the run, the description MUST name the pre-agent stage outcomes rather than a stage. A description MUST NOT name a cause the check has not verified: a skip says that no review was produced unless the check can confirm the cause. The check MUST report a result for every pull request it applies to, including a review that was skipped and a run that could not produce a review; it MUST NOT leave a pull request waiting on an unreported check, and a run whose stages end in a combination the gate does not recognize as a decline or a guardrail stop MUST fail closed rather than pass as a skip.

#### Scenario: Important finding blocks merge

- **WHEN** a review reports one or more Important findings
- **THEN** the stable status check reports failure for the reviewed commit

#### Scenario: No Important finding allows merge

- **WHEN** a review reports only Nits or nothing at all
- **THEN** the stable status check reports success for the reviewed commit

#### Scenario: An unpublished run is described as unpublished

- **WHEN** a run ends without publishing a review, whether it was blocked by threat detection or the
  agent produced nothing
- **THEN** the status check's description says that no review was published rather than quoting a
  verdict about a review that does not exist

#### Scenario: Review failure is reported, not silent

- **WHEN** a run ends without producing a review (for example the model endpoint is unreachable)
- **THEN** the status check reports failure with an infrastructure message distinguishable from a findings verdict, and a subsequent `/review` request can replace it with a real verdict

#### Scenario: A run stopped before the agent fails the check

- **WHEN** a review run's activation stage fails — for example because the compiled workflow no longer matches its Markdown source, so the run is refused before the agent starts — and every later stage is skipped
- **THEN** the status check reports failure for the reviewed commit, and its description names the stage that stopped the run instead of reporting a skipped review

#### Scenario: An unrecognized stage outcome fails closed

- **WHEN** a review run's stages before the agent end in a combination that is neither a decline by the system nor a successful start (for example the run is cancelled before the agent begins)
- **THEN** the status check reports failure rather than a passing skip

#### Scenario: A review the system declined to activate still passes

- **WHEN** the review run is not activated — reviews are paused, the pull request comes from a fork, or another condition compiled into that decision declines it
- **THEN** the status check reports a passing skip, and the pull request is not blocked by the absent review

#### Scenario: A skip description claims no unverified cause

- **WHEN** a review run is declined and the status check reports the passing skip
- **THEN** the description states that no review was produced, and names a cause only where the check can confirm one for that run

#### Scenario: An activated run whose agent a guardrail stopped still passes

- **WHEN** the review run is activated but its agent is deliberately not started because a configured guardrail (a budget cap) stopped it
- **THEN** the status check reports a passing skip, and the pull request is not blocked by the absent review

### Requirement: Reviews use the project's own model credentials

Reviews MUST be executed against the project's configured model provider using a repository secret, not a GitHub-hosted model. The real credential MUST NOT be present in the agent's execution environment or in any published artifact, log, or comment; only an intermediary trusted by the workflow may hold it.

#### Scenario: Credential is isolated from the agent

- **WHEN** a review run executes
- **THEN** the agent process runs without the real provider credential while the request to the model provider is still authenticated by the workflow's intermediary

#### Scenario: Credential never leaks into output

- **WHEN** a review run finishes, successfully or not
- **THEN** no workflow artifact, log, or pull request comment contains the provider credential

### Requirement: Workflow source and compiled workflow stay in sync

The repository MUST keep the review workflow's Markdown source and its compiled GitHub Actions workflow consistent. Continuous integration MUST fail when the compiled workflow does not match what the current source compiles to.

#### Scenario: Stale compiled workflow fails CI

- **WHEN** a pull request changes the review workflow's Markdown frontmatter without regenerating the compiled workflow
- **THEN** the repository's configuration guard job fails

### Requirement: Reviews can be paused without blocking merges

The system SHALL provide a settings-only pause control that an operator can use to stop reviews for a period without editing repository files. The subject of the prohibitions below is this change's review system — the review agent, its deterministic jobs, and the command path that triggers it. They do not constrain people, who remain free to comment, approve, request reviews, or merge; they do not constrain GitHub; and they do not apply to other workflows.

While reviews are paused, the system MUST NOT execute the review agent, MUST NOT make model-provider requests, and MUST NOT write review content to the pull request: no submitted review, no review summary, no inline review comment, and no reviewer request. The one permitted output is a short reply to an explicit on-demand request (`/review`) that names the paused subject as the automated review, says the pause is deliberate rather than a failure, and states that human review is unaffected; automatic runs stay silent. A status check is not written content, so the merge gate MUST still report a passing result (as a skipped check rather than as a completed review), and the pause itself MUST NOT add or dismiss approvals or block a merge. The pause covers on-demand runs as well as automatic ones, and restoring the control MUST resume reviews for pull requests opened or re-requested afterwards.

#### Scenario: Pause stops execution and spend

- **WHEN** an operator pauses reviews and a pull request is then opened
- **THEN** no review agent executes, no model-provider request is made, and nothing is written to the pull request

#### Scenario: A paused on-demand request is answered without a review

- **WHEN** a user comments `/review` while reviews are paused
- **THEN** no review agent executes, no review is published, and the only output is a reply saying that the automated review is paused, that the pause is deliberate, and that human review is unaffected

#### Scenario: People are unaffected by the pause

- **WHEN** reviews are paused and a person comments, approves, or requests a review on a pull request
- **THEN** the system neither prevents nor reverses that action and reports no review of its own

#### Scenario: Automatic runs stay silent while paused

- **WHEN** a pull request is opened while reviews are paused and nobody requests a review
- **THEN** nothing is written to the pull request and the only visible trace is the skipped check

#### Scenario: Pausing does not disturb the merge path

- **WHEN** an operator pauses reviews and a pull request is opened while the gate is a required check
- **THEN** the gate reports a passing result, no approval is added or dismissed by the pause, and the pull request is not blocked by the absent review

#### Scenario: Restoring the control resumes reviews

- **WHEN** an operator restores the pause control and a new pull request is opened
- **THEN** the review runs and its verdict is reported as before

#### Scenario: Pausing requires no repository change

- **WHEN** an operator pauses reviews for a day and later restores it
- **THEN** no commit, recompilation, or workflow edit was required

#### Scenario: A paused review is distinguishable from a completed review

- **WHEN** a pull request is opened while reviews are paused
- **THEN** the review's check reports as skipped and nothing is written to the pull request, so the pull request record distinguishes "not reviewed" from "reviewed and clean"
