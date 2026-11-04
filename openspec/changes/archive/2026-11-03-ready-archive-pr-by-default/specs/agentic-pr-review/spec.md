# Spec Delta

## ADDED Requirements

### Requirement: Automatic review admits the archive bot after human approval

The automatic pull request review workflow SHALL allow `github-actions[bot]` as an actor so that a human-approved archive PR workflow can activate and execute the review agent. This admission SHALL apply only to the automatic review workflow. The on-demand `/review` command workflow SHALL retain its existing actor restrictions and SHALL NOT admit bot-authored review commands. Human workflow approval remains required for runs created with the default `GITHUB_TOKEN`.

#### Scenario: A human approves an archive PR's workflows

- **WHEN** an archive PR created by `github-actions[bot]` has its workflows approved by a user with write access
- **THEN** the automatic review activates and executes its agent instead of skipping the bot actor

#### Scenario: A bot comments `/review`

- **WHEN** `github-actions[bot]` writes a `/review` comment on a pull request
- **THEN** the on-demand command workflow does not treat that comment as an admitted review request
