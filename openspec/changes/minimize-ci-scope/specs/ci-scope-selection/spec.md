# Spec Delta

## Purpose

Select the smallest justified set of repository checks for a complete change while preserving shared-consumer coverage, configuration validation, and reliable required status reporting.

## ADDED Requirements

### Requirement: Selection uses the complete change and validated revisions

Pull-request CI SHALL select checks from the complete diff between the PR's merge base and head, using that PR's actual base branch. Selection SHALL account for additions, deletions, and both sides of renames. Missing revisions, failed comparisons, malformed inputs, and incomplete file listings MUST NOT produce a successful empty selection. Selection SHALL identify why each check was selected or skipped.

#### Scenario: A later push changes another application

- **WHEN** a PR already contains Web changes and a later commit changes only CLI files
- **THEN** selection includes both Web and CLI validation for the current PR head

#### Scenario: Promotion uses its own base

- **WHEN** a PR promotes dev into beta or beta into main
- **THEN** selection compares against the actual destination rather than assuming dev is the base

#### Scenario: A renamed or deleted input affects a consumer

- **WHEN** a file is deleted or renamed across application scopes
- **THEN** checks cover the consumers of its old and new paths

#### Scenario: Selection cannot establish a complete diff

- **WHEN** revision resolution or diff enumeration fails
- **THEN** CI reports a visible failure rather than treating the change as unrelated

### Requirement: Application checks follow application and shared dependencies

CI SHALL independently select Web, Extension, API, Mobile, and CLI suites. A change limited to one application's implementation SHALL NOT select unrelated application suites. Shared contracts SHALL select all application consumers; shared frontend packages SHALL select Web and Extension. Changes to root dependency manifests, workspace configuration, or the shared lockfile SHALL initially select all potentially affected application suites conservatively.

#### Scenario: Web-only or Extension-only change

- **WHEN** a PR changes only Web implementation or only Extension implementation
- **THEN** only that application's suite runs, together with its required shared and validation prerequisites

#### Scenario: Shared contracts change

- **WHEN** packages/contracts changes
- **THEN** Web, Extension, API, Mobile, and CLI suites remain selected

#### Scenario: Shared frontend dependency changes

- **WHEN** packages/frontend-types, packages/frontend-utils, or packages/selection changes
- **THEN** Web and Extension validation remain selected without selecting API, Mobile, or CLI solely for that change

### Requirement: Tooling and document changes select their actual checks

CI SHALL distinguish application execution inputs, root tooling tests, ordinary documentation, design-reference validation, and Mobile evidence consumed by validators. A CLI tooling change MUST NOT select Web or Extension suites solely because it is under tooling. Mobile deployment files MUST NOT select API solely because they are under deploy. Documentation or design-reference changes SHALL retain their applicable validation without selecting unrelated application compilation or bundling.

#### Scenario: CLI publication tooling changes

- **WHEN** only CLI release orchestration or its tests change
- **THEN** relevant CLI tooling validation runs without Web or Extension typecheck and unit suites

#### Scenario: Mobile deployment input changes

- **WHEN** a Mobile deployment input changes without an API input change
- **THEN** its Mobile-related validation remains covered and API CI is not selected

#### Scenario: Ordinary Mobile guide changes

- **WHEN** only a prose Mobile guide changes and no validator consumes it as evidence
- **THEN** no Mobile application bundle or native build runs solely for that guide

#### Scenario: Validator-owned evidence changes

- **WHEN** a Mobile manifest, fixture record, or evidence input consumed by existing validation changes
- **THEN** its relevant validation still runs

#### Scenario: Web icons change

- **WHEN** Web icon source, registry metadata, generated registry output, or its validation inputs change
- **THEN** required icon validation remains a prerequisite of accepted Web checks

### Requirement: Required configuration status remains stable and trustworthy

Every PR SHALL retain the required status context agent-config drift check. Rulesync, OpenSpec, and compiled agentic-workflow validation SHALL run whenever their respective source, generated output, configuration, or toolchain inputs change. Unrelated changes SHALL skip those expensive operations while completing the required context. A failed selected operation or failed selection MUST fail that context; an upstream failure MUST NOT be hidden by a skipped dependent job. The existing PR review policy, review gate, pause behavior, and watchdog SHALL retain their contracts.

#### Scenario: An application-only PR has no configuration inputs

- **WHEN** selection succeeds and no agent-configuration validation is relevant
- **THEN** the stable configuration status completes successfully with an explicit skip explanation and no unnecessary dependency installation or gh-aw setup

#### Scenario: Agentic workflow source or output changes

- **WHEN** a compiled workflow input or generated output changes
- **THEN** the full pinned compilation drift check runs, including orphan-output detection

#### Scenario: Configuration selection or validation fails

- **WHEN** detection or any selected configuration operation fails
- **THEN** agent-config drift check fails rather than remaining pending or passing through a dependency skip

### Requirement: Full validation belongs to PRs and superseded runs can stop

Full application CI SHALL run for affected PRs and SHALL NOT repeat solely because the same changes were merged into dev, beta, or main. A newer PR head SHALL cancel superseded read-only validation for that PR while retaining validation for its complete current diff. Release and deployment workflows SHALL retain their own build, artifact verification, publication guards, and serialization independently of this cancellation.

#### Scenario: A validated change merges

- **WHEN** affected changes merge into a release branch
- **THEN** application PR suites do not rerun merely due to the branch push
- **AND** independently eligible release or deployment work retains its required verification

#### Scenario: A PR receives another push

- **WHEN** a newer head supersedes in-progress read-only application CI
- **THEN** the obsolete run is canceled and the new run validates all affected scopes of the PR
- **AND** an executing publication or deployment is not canceled by that policy
