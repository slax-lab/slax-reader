# openspec-change-archiving Specification

## Purpose
Defines how merged implementation work becomes an archived OpenSpec change without relying on the original agent session, while preserving task classification, spec ordering, human review, and reviewer notification.

## Requirements

### Requirement: Merged task pull requests trigger archive evaluation

The system SHALL evaluate an OpenSpec change for archiving when its task pull request is merged into `dev` and its body identifies that change with `OpenSpec: <change-id>`. The evaluation SHALL run against the merged repository state rather than depending on the original agent session. Pull requests closed without merge, changes marked `OpenSpec: n/a`, missing or already archived changes, and archive pull requests SHALL NOT create another archive pull request.

#### Scenario: A behavior-changing task pull request merges

- **WHEN** a task pull request carrying `OpenSpec: <change-id>` merges into `dev` and that change is still active
- **THEN** the system starts an archive evaluation for the identified change using the merged repository state

#### Scenario: A pull request closes without merging

- **WHEN** a task pull request closes without being merged
- **THEN** the system does not start an archive evaluation

#### Scenario: An archive pull request merges

- **WHEN** a documentation pull request created to archive a change merges
- **THEN** the system does not create another archive pull request for that change

### Requirement: Archive eligibility preserves unfinished work and evidence

Before archiving, the system SHALL classify every unchecked task using the change artifacts, recorded validation evidence, and merged task pull request. Work proven complete MAY be checked off with its evidence recorded. A historical acceptance gap SHALL remain visible with its reason. A genuinely unfinished task, an unverified post-merge task, or insufficient evidence to distinguish these cases SHALL block archiving. The system SHALL NOT silently check off, drop, narrow, or archive around unfinished work.

#### Scenario: A completed task was not checked off

- **WHEN** validation evidence proves an unchecked task is complete
- **THEN** the system records that classification and checks off the task before archiving

#### Scenario: A post-merge verification remains unfinished

- **WHEN** an unchecked task requires verification that has not occurred or lacks sufficient evidence
- **THEN** the system does not archive the change and reports the blocking task

#### Scenario: A historical acceptance gap does not block delivery

- **WHEN** an unchecked task records an accepted historical gap and its reason in the validation record
- **THEN** the system preserves the unchecked state and explanation when classifying the change

### Requirement: Same-capability deltas are archived in a safe order

The system SHALL inspect other still-active changes for deltas affecting the same capability before archiving. It SHALL preserve required archive order and SHALL NOT overwrite, drop, or invent requirements to resolve a conflict. Archive evaluations SHALL be serialized so concurrent merge events cannot apply competing deltas to one capability simultaneously.

#### Scenario: Another active change touches the same capability

- **WHEN** a different active change carries a delta for a capability affected by the candidate archive
- **THEN** the system applies the declared sequence or reports the unresolved dependency without archiving

#### Scenario: Two eligible changes merge close together

- **WHEN** two task pull requests merge before either archive evaluation finishes
- **THEN** their archive evaluations run serially and each reassesses the current repository state before writing specs

### Requirement: A valid archive produces one reviewed documentation pull request

For an eligible change, the system SHALL apply its delta specs to the living specs, move the change into the dated archive, record the archive evidence, stage the result, and pass `openspec validate --all --strict` and `git diff --cached --check` before creating a documentation pull request. The pull request SHALL identify the archived change, summarize spec updates and unchecked-task classifications, and explicitly request the `slax-lab/reader-core` review team. A repeated evaluation for the same change SHALL NOT create a duplicate archive pull request.

#### Scenario: An eligible change archives successfully

- **WHEN** task classification and dependency checks pass and the archive result passes strict validation and the diff check
- **THEN** the system creates one documentation pull request containing the living-spec updates and dated archive and naming the `slax-lab/reader-core` review team

#### Scenario: Validation fails

- **WHEN** the archive command or either validation check fails
- **THEN** the system creates no archive pull request and reports the failure without merging or committing the result to `dev`

#### Scenario: An eligible change is evaluated again

- **WHEN** an earlier evaluation already created an open archive pull request for the same change
- **THEN** the system reports the existing pull request instead of creating another one

### Requirement: Humans control archive completion

The archive pull request SHALL follow the repository's normal automated review, code-owner review, and merge requirements. The system SHALL NOT approve or merge it automatically. Its merge into `dev` completes the archive lifecycle; closing it without merging leaves the active change in `dev` unchanged.

#### Scenario: A reviewer approves the archive

- **WHEN** required checks pass and the reviewer approves and merges the archive pull request
- **THEN** the living-spec updates and dated archive enter `dev` and the change is no longer active

#### Scenario: A reviewer rejects the archive

- **WHEN** the archive pull request is closed without merge
- **THEN** the active change remains in `dev` and no archive result is applied to that branch

### Requirement: Reviewer notification uses the existing readiness path

An archive pull request SHALL use the existing automated-review gate and `ready-for-human-review` notification path. When no automatic review run is available for the bot-authored pull request, the task pull request author SHALL initiate the existing **PR Review (on demand)** workflow by commenting `/review` on the archive pull request. When the gate declares readiness, the notification bridge SHALL send the established group card and name `slax-lab/reader-core` as the requested review team without requiring an individual Feishu mention. The archive workflow SHALL NOT call Feishu directly, create a separate reminder channel, or notify before the readiness gate passes.

#### Scenario: The task author starts an on-demand review

- **WHEN** the task pull request author comments `/review` on the archive pull request
- **THEN** the existing on-demand review and `workflow_run` gate evaluate the archive pull request before readiness notification

#### Scenario: An archive pull request becomes ready

- **WHEN** the archive pull request has the `slax-lab/reader-core` review team and the gate adds `ready-for-human-review`
- **THEN** the existing bridge sends one ready-for-review group card that names `slax-lab/reader-core` as the requested review team

#### Scenario: The archive bot authors the pull request

- **WHEN** the configured archive bot authors an archive pull request in `slax-reader`
- **THEN** the notification bridge recognizes that bot as eligible for team notifications instead of dropping its events as a non-team author

### Requirement: Archive is not an implementation checklist item

OpenSpec `tasks.md` files SHALL NOT be required to end with an archive checkbox. Completion of implementation and pre-merge verification SHALL make a change ready for its task pull request, but the system SHALL NOT archive that change before the task pull request merges.

#### Scenario: Implementation tasks are complete

- **WHEN** every implementation and pre-merge verification task is checked off
- **THEN** the change is ready for task-PR delivery and its archive still waits for the merge-triggered evaluation
