# Spec Delta

## Purpose

Select the GitHub Environment that supplies a Web release's Variables and Secrets from the pull request's target branch.

## ADDED Requirements

### Requirement: Web releases select the Environment for their target branch

Web releases SHALL select GitHub Environments `dev`, `beta`, and `prod` for pull requests merged into `dev`, `beta`, and `main` respectively, retaining build profiles `preview`, `beta`, and `production`. The build profile, purge hostname, and release serialization SHALL continue to be derived from the target branch name, not from the Environment name.

#### Scenario: Production release

- **WHEN** a Web pull request is merged into `main`
- **THEN** publication and cache purging read Variables and Secrets from the `prod` Environment, not `main`
- **AND** the `production` build profile and the `r.slax.com` purge hostname are used

#### Scenario: Dev and beta releases

- **WHEN** a Web pull request is merged into `dev` or `beta`
- **THEN** the release reads from the Environment of the same name
