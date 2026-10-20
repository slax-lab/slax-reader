# Spec Delta

## Purpose

Define a dev-only EAS cloud build trigger that runs only for an explicit Mobile version bump after Mobile CI passes.

## ADDED Requirements

### Requirement: Mobile EAS builds require a version bump and successful Mobile CI

The workflow SHALL trigger only for pushes to `dev` that change Mobile inputs. It SHALL require `apps/mobile/package.json` to increase `buildNumber` relative to `github.event.before`, require a valid non-decreasing `version` and `previousBuildNumber < buildNumber`, and require the reusable Mobile CI suite to succeed before contacting EAS.

#### Scenario: No version bump

- **WHEN** a Mobile change merges without changing `version` or `buildNumber`
- **THEN** Mobile CI may run but no EAS build is submitted

#### Scenario: Invalid bump

- **WHEN** `buildNumber` decreases, `version` decreases, or `previousBuildNumber` is not lower than `buildNumber`
- **THEN** the preflight fails and no EAS build is submitted

#### Scenario: Mobile CI failure

- **WHEN** the preflight passes but Mobile CI fails
- **THEN** the EAS job does not run

### Requirement: Preflight validates the EAS release surface

The preflight SHALL require `appVersionSource: local`, `build.production.environment: production`, the Android platform, the `SlaxShare` app extensions target, and `.easignore` rules that keep `apps/mobile/tests` and `apps/mobile/fixtures` in the archive.

#### Scenario: Missing release configuration

- **WHEN** the EAS profile, Android platform, share target, or archive rules are invalid
- **THEN** the preflight fails before EAS is called

### Requirement: Cloud builds cover both platforms and are submitted for internal testing

The workflow SHALL run `eas build --platform all --profile production --non-interactive --no-wait --auto-submit`. Each finished build SHALL be submitted with the `production` submit profile: iOS to TestFlight and Android to the Play internal track. The workflow SHALL NOT submit for App Store review or promote beyond the Play internal track. GitHub SHALL provide only `EXPO_TOKEN`; EAS environment/file secrets, signing credentials and submission credentials remain EAS-owned.

#### Scenario: Successful trigger

- **WHEN** all preconditions pass
- **THEN** iOS and Android EAS builds are queued with auto-submit and the workflow exits without waiting for them

#### Scenario: Store submission

- **WHEN** the builds complete on EAS
- **THEN** the iOS build is uploaded to TestFlight and the Android build to the Play internal track
- **AND** no App Store review submission or Play promotion beyond the internal track occurs

### Requirement: Trigger concurrency and visibility

The workflow SHALL key its workflow concurrency by commit SHA so rapid pushes do not replace a pending bump, and SHALL key the EAS job by version and build. EAS SHALL own build status; the GitHub workflow reports only whether the trigger was accepted.

#### Scenario: Rapid version bumps

- **WHEN** multiple dev pushes with distinct build numbers arrive close together
- **THEN** each commit retains its own trigger and builds for the same version are serialized

#### Scenario: EAS build failure

- **WHEN** an EAS build fails after submission
- **THEN** the GitHub trigger remains successful and the failure is visible in EAS
