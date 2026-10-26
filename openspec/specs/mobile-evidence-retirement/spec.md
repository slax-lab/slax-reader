# mobile-evidence-retirement Specification

## Purpose
Define the repository's retention, documentation, fixture, and CI behavior after the native mobile evidence artifacts are retired.

## Requirements

### Requirement: Mobile evidence artifacts are retired

The repository SHALL NOT retain the former mobile evidence directory, the evidence coverage ledger, the native-evidence verifier, or an evidence-only CI job. Mobile validation SHALL continue to verify the source manifest, copied assets, localization, fixtures, architecture, types, and tests without claiming native render parity.

#### Scenario: Mobile validation runs

- **WHEN** Mobile CI or `pnpm mobile -- check` runs
- **THEN** source, asset, localization, fixture, architecture, type, and test checks run without coverage or native-evidence verification

#### Scenario: Historical material mentions evidence

- **WHEN** documentation, fixture material, or an archived OpenSpec record refers to the retired evidence
- **THEN** it records retirement without a path or placeholder path into the deleted directory

### Requirement: External evidence references are removed

Documentation, fixture guidance, tooling, tests, and active OpenSpec changes SHALL NOT link to or require the retired evidence directory. Source-manifest and fixture inputs that remain executable SHALL continue to work without the deleted artifacts.

#### Scenario: Repository audit

- **WHEN** the repository is searched for external references to the retired evidence directory
- **THEN** no executable or documentation reference remains

#### Scenario: Historical reference cleanup

- **WHEN** a historical fixture plan, report, guard test, or capture executor depended on a retired evidence artifact
- **THEN** the evidence binding and the dependent harness are removed, and no placeholder path is left in executable or plan data
