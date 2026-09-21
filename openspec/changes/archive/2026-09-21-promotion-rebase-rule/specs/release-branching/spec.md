## ADDED Requirements

### Requirement: Promotion pull requests merge with rebase

Promotion pull requests (`dev` → `beta` and `beta` → `main`) MUST be merged with the rebase merge method and MUST NOT be squash-merged. Rebase replays onto the target branch only the patches it does not already have, keeping the landed commits' patches and messages identical to what was reviewed on the source branch; a squash merge forges one new commit per promotion and diverges the branches' histories further with every promotion.

#### Scenario: Rebase replay keeps landed commits faithful

- **WHEN** a promotion pull request is merged with rebase
- **THEN** the commits landing on the target branch carry the same patches and commit messages as the reviewed commits on the source branch

#### Scenario: Squash is never used for a promotion

- **WHEN** a promotion pull request between long-lived branches is merged
- **THEN** the merge method is rebase, not squash — even though the ruleset allows both methods
