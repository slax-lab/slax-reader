# Spec Delta

## MODIFIED Requirements

### Requirement: Reviewer notification uses the existing readiness path

An archive pull request SHALL use the existing automated-review gate and `ready-for-human-review` notification path. Its body SHALL explain that the task pull request has merged, the archive pull request was created automatically to archive its spec changes, and the task pull request author must inspect the archive and click **Ready for review** to start automatic review and the required pull-request CI workflows. The instruction SHALL explain that passing automation leads to team review and merge, which completes the archive. The author SHALL NOT need to approve workflows or comment `/review` for this path. When the gate declares readiness, the notification bridge SHALL send the established group card and name `slax-lab/reader-core` as the requested review team without requiring an individual Feishu mention. The archive workflow SHALL NOT call Feishu directly, create a separate reminder channel, or notify before the readiness gate passes.

#### Scenario: The archive pull request is created

- **WHEN** the bot creates a draft archive pull request with the default token
- **THEN** its body explains why the archive exists and tells the task pull request author to inspect it and click **Ready for review**

#### Scenario: The task author starts review

- **WHEN** the task pull request author marks the archive pull request ready for review
- **THEN** the same human action starts automatic review and all required pull-request CI workflows, and the `workflow_run` gate evaluates the automatic review before readiness notification

#### Scenario: The task author starts an on-demand review

- **WHEN** no automatic review is running and the task pull request author comments `/review` on the archive pull request
- **THEN** the existing on-demand review and `workflow_run` gate evaluate the archive pull request before readiness notification

#### Scenario: An archive pull request becomes ready

This scenario concerns the gate's readiness label, not the draft-to-ready transition.

- **WHEN** the archive pull request has the `slax-lab/reader-core` review team and the gate adds `ready-for-human-review`
- **THEN** the existing bridge sends one ready-for-review group card that names `slax-lab/reader-core` as the requested review team

#### Scenario: The archive bot authors the pull request

- **WHEN** the configured archive bot authors an archive pull request in `slax-reader`
- **THEN** the notification bridge recognizes that bot as eligible for team notifications instead of dropping its events as a non-team author
