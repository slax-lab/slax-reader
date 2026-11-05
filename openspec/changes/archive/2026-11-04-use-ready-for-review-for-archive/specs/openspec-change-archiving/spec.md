# Spec Delta

## MODIFIED Requirements

### Requirement: A valid archive produces one reviewed documentation pull request

For an eligible change, the system SHALL apply its delta specs to the living specs, move the change into the dated archive, record the archive evidence, stage the result, and pass `openspec validate --all --strict` and `git diff --cached --check` before creating a documentation pull request. The pull request SHALL be created as a draft, SHALL identify the archived change, and SHALL summarize spec updates and unchecked-task classifications. GitHub CODEOWNERS SHALL request the `slax-lab/reader-core` review team when the task pull request author marks the draft ready for review. A repeated evaluation for the same change SHALL NOT create a duplicate archive pull request.

#### Scenario: An eligible change archives successfully

- **WHEN** task classification and dependency checks pass and the archive result passes strict validation and the diff check
- **THEN** the system creates one draft documentation pull request containing the living-spec updates and dated archive and explaining how the task pull request author starts review

#### Scenario: The task author marks the archive ready

- **WHEN** the task pull request author inspects the draft archive pull request and clicks **Ready for review**
- **THEN** the archive pull request becomes non-draft and GitHub CODEOWNERS requests `slax-lab/reader-core` review

#### Scenario: Validation fails

- **WHEN** the archive command or either validation check fails
- **THEN** the system creates no archive pull request and reports the failure without merging or committing the result to `dev`

#### Scenario: An eligible change is evaluated again

- **WHEN** an earlier evaluation already created an open archive pull request for the same change
- **THEN** the system reports the existing pull request instead of creating another one

### Requirement: Reviewer notification uses the existing readiness path

An archive pull request SHALL use the existing automated-review gate and `ready-for-human-review` notification path. Its body SHALL explain that the task pull request has merged, the archive pull request was created automatically to archive its spec changes, and the task pull request author must inspect the archive and click **Ready for review** to start automatic review. The instruction SHALL explain that a passing automatic review leads to team review and merge, which completes the archive. The author SHALL NOT need to approve workflows or comment `/review` for this path. When the gate declares readiness, the notification bridge SHALL send the established group card and name `slax-lab/reader-core` as the requested review team without requiring an individual Feishu mention. The archive workflow SHALL NOT call Feishu directly, create a separate reminder channel, or notify before the readiness gate passes.

#### Scenario: The archive pull request is created

- **WHEN** the bot creates a draft archive pull request with the default token
- **THEN** its body explains why the archive exists and tells the task pull request author to inspect it and click **Ready for review**

#### Scenario: The task author starts review

- **WHEN** the task pull request author marks the archive pull request ready for review
- **THEN** the human-triggered automatic review and `workflow_run` gate evaluate the archive pull request before readiness notification

#### Scenario: The task author starts an on-demand review

- **WHEN** no automatic review is running and the task pull request author comments `/review` on the archive pull request
- **THEN** the existing on-demand review and `workflow_run` gate evaluate the archive pull request before readiness notification

#### Scenario: An archive pull request becomes ready

- **WHEN** the archive pull request has the `slax-lab/reader-core` review team and the gate adds `ready-for-human-review`
- **THEN** the existing bridge sends one ready-for-review group card that names `slax-lab/reader-core` as the requested review team

#### Scenario: The archive bot authors the pull request

- **WHEN** the configured archive bot authors an archive pull request in `slax-reader`
- **THEN** the notification bridge recognizes that bot as eligible for team notifications instead of dropping its events as a non-team author
