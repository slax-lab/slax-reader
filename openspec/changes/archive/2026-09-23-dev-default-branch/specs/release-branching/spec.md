# Spec Delta

## MODIFIED Requirements

### Requirement: Three long-lived environment branches

The repository SHALL maintain exactly three long-lived branches: `dev` (integration, serving the test environment), `beta` (serving the beta environment), and `main` (serving production). `dev` MUST be the repository's default branch, so that pull requests opened without a deliberate base choice — including fork pull requests, whose base defaults to the upstream default branch — target the integration branch, and `main` is only ever targeted deliberately.

#### Scenario: Branch to environment mapping is stable

- **WHEN** a change lands on `dev`, `beta`, or `main`
- **THEN** it belongs to the test, beta, or production release line respectively, and `dev` is the default branch from which default-branch-loaded automation runs

#### Scenario: Undirected pull requests land on the integration branch

- **WHEN** a pull request is opened without deliberately choosing a base branch, including a pull request from a fork
- **THEN** its base is `dev`, and `main` receives changes only through deliberately opened promotion pull requests
