# ci-test-matrix Specification

## Purpose

Keeps CI Node.js coverage aligned with the support range declared in the root `package.json` `engines` field: which application suites run on which pinned Node.js versions, how those pins relate to the declared range, and how the required gate contexts aggregate each matrix so a failing leg blocks a pull request without changing the gate names.

## Requirements

### Requirement: CI exercises every declared Node.js support line

The repository SHALL exercise each Node.js line declared by the root `package.json` `engines` range in the CI suites whose behavior depends on the Node.js runtime. The CLI CI suite SHALL run its typecheck, test, and package smoke commands on Node 22.22.2, Node 24.15.0, and the pinned Node 26 release. The Tooling CI `check` job SHALL run the preflight and CI tooling tests on Node 22.22.2 and the pinned Node 26 release. Every Node.js version used by these matrices SHALL be an exact patch release, matching the existing pinned style; no floating major or minor specifier is permitted. Changing the declared support range SHALL be accompanied by the matching CI matrix change in the same change.

#### Scenario: A Node 26 regression fails the CLI gate

- **WHEN** a CLI typecheck, test, or package smoke command fails on the pinned Node 26 leg while the Node 22 and Node 24 legs pass
- **THEN** the `check` matrix job concludes failure and the `CLI CI gate` context reports failure, blocking the pull request

#### Scenario: A Node 26 regression fails the tooling gate

- **WHEN** a preflight or CI tooling test fails on the pinned Node 26 leg of the tooling `check` matrix while the Node 22.22.2 leg passes
- **THEN** the `check` matrix job concludes failure and the `Tooling CI gate` context reports failure, blocking the pull request

#### Scenario: The Node 22 and Node 24 lines remain covered

- **WHEN** CI runs the CLI suite on a pull request whose scope selects it
- **THEN** the typecheck, test, and package smoke commands run on Node 22.22.2, Node 24.15.0, and the pinned Node 26 release

#### Scenario: The pinned Node 26 version satisfies the declared range

- **WHEN** the CI matrix pins a Node 26 patch release
- **THEN** that version satisfies the root `engines` range and the repository preflight Node check accepts it

### Requirement: Required gates aggregate the whole matrix under stable names

The required application gate jobs SHALL keep their exact contract names (`CLI CI gate`, `Tooling CI gate`) and SHALL aggregate every leg of their suite's matrices: a gate reports success only when every needed job — including a matrix job whose legs all passed or were skipped — reports success, and reports failure when any leg fails. Matrix legs SHALL remain additional check contexts (for example `check (26.12.1)`) rather than required contexts, so `.github/rulesets.expected.json` needs no change when a leg is added.

#### Scenario: One failed leg blocks the gate

- **WHEN** one matrix leg of the CLI or tooling `check` job fails
- **THEN** the corresponding gate job fails and the pull request cannot merge

#### Scenario: Skipped scope still reports a passing gate

- **WHEN** a pull request's diff does not select the CLI or tooling scope, so the matrix job is skipped
- **THEN** the corresponding gate job still reports success and does not block merging

#### Scenario: Adding a matrix leg leaves required contexts unchanged

- **WHEN** a Node 26 leg is added to an existing matrix
- **THEN** the required gate job names and `.github/rulesets.expected.json` stay unchanged, and the new leg appears only as an additional status context

### Requirement: Workflow contract tests pin the matrix contents

The CI workflow contract tests SHALL assert the Node.js versions of the CLI and tooling matrices, so a workflow edit that drops or changes a supported line fails the tooling test suite instead of silently reducing coverage.

#### Scenario: Removing a supported line fails contract tests

- **WHEN** a change removes Node 22.22.2, Node 24.15.0, or the pinned Node 26 release from the covered matrices without updating the declared support range
- **THEN** `pnpm test:ci` fails on the matrix assertion
