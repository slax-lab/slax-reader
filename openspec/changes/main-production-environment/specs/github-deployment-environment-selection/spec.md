# Spec Delta

## Purpose

Make GitHub deployment Environment names match release branches without changing application runtime behavior or private deployment configuration identities.

## ADDED Requirements

### Requirement: GitHub deployment environments follow merged target branches

Eligible API and Web deployments SHALL select GitHub Environment dev, beta, or main directly from their merged pull request's target branch. A deployment into main SHALL use main's environment-scoped Actions settings and SHALL be displayed under main in GitHub. It MUST NOT fall back to the prod GitHub Environment when main settings are missing. Existing eligibility, source revision, credential access, and concurrency rules SHALL remain unchanged.

#### Scenario: A production deployment is eligible

- **WHEN** an eligible API or Web pull request merges into main
- **THEN** its job selects GitHub Environment main, including its deployment display and environment-scoped settings

#### Scenario: A non-production deployment is eligible

- **WHEN** an eligible deployment targets dev or beta
- **THEN** its GitHub Environment remains dev or beta respectively

#### Scenario: Main settings are missing

- **WHEN** required settings are unavailable in main
- **THEN** existing input validation stops deployment without selecting prod as a fallback

### Requirement: GitHub environment naming is independent of runtime configuration

Changing the GitHub Environment SHALL preserve API's internal DEPLOY_ENVIRONMENT mapping, selected private configuration paths, RUN_ENV, RUN_TYPE, and all application runtime decisions. Production API deployment SHALL continue selecting api/prod.toml with the existing production runtime values. No application source, deployment script, public template, private configuration, or cloud-resource identity SHALL be changed for this fix.

#### Scenario: Main selects its API configuration

- **WHEN** API deployment targets main
- **THEN** GitHub selects main while internal configuration selection continues using DEPLOY_ENVIRONMENT=prod and api/prod.toml

#### Scenario: Production application behavior is preserved

- **WHEN** the workflow-only fix is applied
- **THEN** payment, safety, telemetry, resource routing, and diagnostic decisions retain their existing runtime discriminators
