## MODIFIED Requirements

### Requirement: The merge gate reflects Important findings

The system SHALL expose a status check whose name is stable across runs. That check MUST report failure when the review produced at least one Important finding, and success when the review produced none. A passing result MUST rest on positive evidence about the run's own stages: the review system declined to activate the run — the pause, a fork pull request, and the other conditions its activation decision is compiled from — or the run was activated and its agent either executed or was deliberately not started by a configured guardrail (a budget cap). A run that stopped for any other reason, including a configuration failure in a stage before the agent, MUST report failure whose description names the stage that stopped it. A description MUST NOT name a cause the check has not verified: a skip says that no review was produced unless the check can confirm the cause. The check MUST report a result for every pull request it applies to, including a review that was skipped and a run that could not produce a review; it MUST NOT leave a pull request waiting on an unreported check, and a run whose stages end in a combination the gate does not recognize as a decline or a guardrail stop MUST fail closed rather than pass as a skip.

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
