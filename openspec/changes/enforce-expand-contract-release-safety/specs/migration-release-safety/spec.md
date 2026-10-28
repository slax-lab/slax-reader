# Spec Delta

## Purpose

Make every migration release carry an explicit, reviewed class declaration and make a destructive `contract` wait until its prerequisite release is serving in beta and production, without attempting to interpret SQL semantics. The check verifies declarations, named-owner approval, release-diff immutability, and deployment evidence; the truth of a declaration remains a human review judgment.

## ADDED Requirements

### Requirement: Every new migration carries a complete declaration

A migration file under `apps/api/prisma/pg_migrations/**/migration.sql`, `apps/api/prisma/logs_migrations/**/migration.sql`, `apps/api/prisma/d1_migrations/*.sql`, or `apps/api/prisma/d1_migrations/fulltext/*.sql` that the release diff adds and that is absent from `main`, `beta`, and the pinned `dev` adoption tree MUST begin with a leading comment block containing exactly one `-- migration-safety: expand`, `-- migration-safety: migrate`, or `-- migration-safety: contract` line.

A `migrate` file MUST also declare nonempty `-- preserves:` and `-- reason:` fields. A `contract` file MUST also declare nonempty `-- removes:`, `-- prerequisite-change:`, `-- prerequisite-pr:`, `-- prerequisite-merge:`, and `-- reason:` fields. An `expand` file MUST NOT declare any other safety field. Duplicate, unknown, or class-inapplicable safety fields MUST fail. Ordinary SQL comments that do not use the safety field prefixes are ignored.

`removes`, `preserves`, and `reason` are author claims for human review. The check MUST verify only that they are present and shaped as documented, and MUST NOT compare them with SQL statements or assert that they are true.

A migration file present in the pinned `dev` adoption tree, on `main`, or on `beta` MUST NOT be annotated retroactively. `migration_lock.toml` is not a migration and MUST NOT be enumerated for declarations.

#### Scenario: A declared migration is complete
- **WHEN** the release diff adds a migration with one valid class line and every field that class requires
- **THEN** the declaration check passes

#### Scenario: A new migration has no declaration
- **WHEN** the release diff adds a migration without a leading `migration-safety` declaration
- **THEN** the check fails and names the undeclared path

#### Scenario: A required field is missing
- **WHEN** a `migrate` file omits `preserves` or a `contract` file omits `prerequisite-pr` or `prerequisite-merge`
- **THEN** the check fails

#### Scenario: A field is duplicated, unknown, or belongs to another class
- **WHEN** a header repeats a safety field, uses an unrecognized safety field, or declares `prerequisite-pr` on an `expand` file
- **THEN** the check fails instead of ignoring the field

#### Scenario: A claim is present but false
- **WHEN** a declaration names an object that the SQL does not touch
- **THEN** the declaration check still passes, because verifying that claim is a human review duty and not a machine assertion

#### Scenario: A frozen migration is annotated
- **WHEN** a migration present on `main`, `beta`, or the pinned `dev` adoption tree has its header added or changed
- **THEN** the check fails on immutability

### Requirement: Every new migration is approved by a named API owner

Every migration file added by the release diff MUST have an `APPROVED` review from a named user owner on the pull request that introduced it. This requirement applies to `expand`, `migrate`, and `contract` alike, because the approval is the evidence that an accountable API owner accepted both the class and the author's semantic claim.

The check MUST resolve the introducing commit and exactly one merged introducing pull request, read `CODEOWNERS` from that pull request's base commit, resolve named user owners for the migration path, and use each reviewer's latest review state. Team handles MUST NOT satisfy the check, because the workflow token cannot resolve team membership. Ambiguous provenance or an unreadable review list MUST fail closed.

`CODEOWNERS` MUST contain a named-user owner list for `/apps/api/prisma/**` before the check is enforced, so the rule has more than one eligible named owner and the adjudicated overlay can find two.

#### Scenario: A named owner approved the introducing pull request
- **WHEN** a migration is added by a merged pull request whose base `CODEOWNERS` names the approving user as an owner of the migration path
- **THEN** the ownership check passes

#### Scenario: Only a team owns the path
- **WHEN** the only matching `CODEOWNERS` entry is a team handle
- **THEN** the ownership check fails, because team membership cannot be resolved

#### Scenario: The approval came from someone outside the owner list
- **WHEN** the introducing pull request has an approving review from a user who is not a named owner of the migration path
- **THEN** the ownership check fails

#### Scenario: The pull request changes CODEOWNERS itself
- **WHEN** the introducing pull request adds itself as an owner in its head but the base `CODEOWNERS` does not list it
- **THEN** the ownership check fails, because ownership is read from the base

#### Scenario: A review was later dismissed
- **WHEN** the only named-owner review for the introducing pull request has a latest state other than `APPROVED`
- **THEN** the ownership check fails

### Requirement: A contract is backed by prerequisite and serving evidence

A `contract` added by the release diff MUST declare `prerequisite-change`, `prerequisite-pr`, and `prerequisite-merge`, and all of the following MUST hold before shared data is changed:

1. `prerequisite-pr` is a merged pull request in this repository.
2. `prerequisite-merge` equals that pull request's `merge_commit_sha`.
3. The pull request body carries `OpenSpec: <prerequisite-change>`, or both are `n/a` for an implementation-only prerequisite. Promotion and sync-back pull requests are exempt from the trailer.
4. `prerequisite-merge` is an ancestor of the `main` tip.
5. `prerequisite-merge` is an ancestor of the release head.
6. `prerequisite-merge` is an ancestor of the commit behind the latest successful production API deployment.
7. `prerequisite-merge` is an ancestor of the commit behind the latest successful beta API deployment.

A contract already present on `main` or `beta` is historical: it was applied and is frozen, so it MUST NOT be revalidated.

#### Scenario: A valid contract passes
- **WHEN** a contract names a merged prerequisite pull request whose merge commit is contained in `main`, the release head, and both serving deployments
- **THEN** the contract evidence check passes

#### Scenario: The prerequisite is not merged
- **WHEN** `prerequisite-pr` names an open or closed-unmerged pull request
- **THEN** the check fails

#### Scenario: The declared merge commit is not the prerequisite's merge commit
- **WHEN** `prerequisite-merge` names a commit other than the prerequisite pull request's `merge_commit_sha`
- **THEN** the check fails, even when that commit is an ancestor of every branch

#### Scenario: The prerequisite is not deployed to beta
- **WHEN** the prerequisite merge commit is contained in `main` and the release head but not in the latest successful beta API deployment
- **THEN** the check fails and names the beta evidence stage

#### Scenario: The OpenSpec trailer does not match
- **WHEN** the prerequisite pull request body carries an `OpenSpec:` value other than `prerequisite-change`
- **THEN** the check fails on prerequisite evidence

#### Scenario: A historical contract is unchanged
- **WHEN** a contract already exists on `main` or `beta` and the release diff does not add or modify it
- **THEN** the check does not resolve prerequisite or deployment evidence for it

### Requirement: Migration files are immutable once released

The release diff MUST NOT delete or rename a migration file in any of the four families. It MUST NOT modify a migration file whose path exists on `main` or `beta`. A migration merged to `dev` after the adoption commit MAY be modified before it reaches a shared branch, including its declaration.

A migration file present in the pinned `dev` adoption tree, on `main`, or on `beta` MUST NOT receive a new or changed declaration; those files are frozen.

#### Scenario: A release deletes a migration
- **WHEN** the release diff contains a deleted or renamed migration path
- **THEN** the check fails on immutability and names the path

#### Scenario: A release edits a migration on a shared branch
- **WHEN** the release diff modifies a migration that exists on `main` or `beta`
- **THEN** the check fails on immutability

#### Scenario: An in-flight dev migration is edited
- **WHEN** the release diff modifies a migration that was merged to `dev` after the adoption commit and does not exist on `main` or `beta`
- **THEN** the check does not report an immutability failure

#### Scenario: A frozen migration gains a declaration
- **WHEN** the release diff adds or changes a declaration on a migration present in the `dev` adoption tree
- **THEN** the check fails on immutability

#### Scenario: A lagging branch lacks a migration
- **WHEN** the head does not contain a migration that exists on `main` but the release diff contains no deletion for it
- **THEN** the check does not report a deletion

#### Scenario: The migration lock file changes
- **WHEN** the release diff deletes, renames, or modifies `migration_lock.toml`
- **THEN** the check fails

### Requirement: Release evidence is scoped to the current release diff and fails closed

The check MUST evaluate only migration files and contract evidence introduced by the current release diff. A release whose diff adds no `contract` MUST NOT resolve deployment evidence, so an expand-only or migration-only release proceeds when the deployments API is unavailable.

The latest successful API deployment for an environment MUST be resolved from `.github/workflows/api-deploy.yml` deployments only, deduplicated by commit, with the deployment job's migration and publication step concluded successfully. When the newest API deployment run is failed, cancelled, or in progress, a current `contract` MUST fail and the check MUST NOT fall back to an older success. Duplicate or ambiguous deployment, run, or pull-request records MUST fail closed.

Every failure MUST report one fixed stage among `declaration`, `ownership`, `prerequisite`, `immutability`, and `evidence`, with the public migration path, pull-request number, or commit SHA. It MUST NOT print private configuration, connection values, resource identifiers, or raw API responses.

#### Scenario: An expand-only release during a deployments outage
- **WHEN** the release diff adds only `expand` migrations and the deployments API is unavailable
- **THEN** the check does not resolve deployments and is not blocked by that outage

#### Scenario: The newest deployment failed
- **WHEN** a current contract exists and the newest `api-deploy.yml` run for an environment failed or is in progress
- **THEN** the check fails and does not use an older successful deployment

#### Scenario: A superseded run skipped migration
- **WHEN** a deployment's run skipped the migration and publication step because a newer release superseded it
- **THEN** that deployment does not count as serving evidence

#### Scenario: The compare API truncates
- **WHEN** the promotion compare response reaches the 300-file limit or reports truncation
- **THEN** the promotion check fails closed

#### Scenario: The dev deploy has no contract evidence
- **WHEN** the target environment is `dev` and the release adds a contract
- **THEN** declaration, ownership, and immutability checks run, prerequisite and deployment evidence are skipped, and the test database may be migrated

### Requirement: Hotfix releases carry only expand migrations

A pull request from a `hotfix/*` branch to `beta` or `main` MUST add only `expand` migrations. A `migrate`, `contract`, or `adjudicated` declaration introduced by a hotfix MUST fail, and the change MUST ship through a normal release.

#### Scenario: A hotfix adds an expand migration
- **WHEN** a hotfix pull request adds only `expand` migrations
- **THEN** the check passes

#### Scenario: A hotfix adds a contract
- **WHEN** a hotfix pull request adds a `contract` or `adjudicated` migration
- **THEN** the check fails and instructs the author to ship it in a separate release

#### Scenario: A hotfix adds a migrate migration
- **WHEN** a hotfix pull request adds a `migrate` migration
- **THEN** the check fails, because a hotfix carries only additive change

### Requirement: The adjudicated overlay is exceptional

An `adjudicated` declaration MUST name `adjudicated-class` as `contract` or `migrate` and carry that class's `removes` or `preserves` field together with nonempty `incident`, `reason`, `adjudicated-at`, `approved-by`, `backup`, and `ledger-reconciliation` fields. `approved-by` MUST name exactly two distinct users, and both MUST be named owners with `APPROVED` reviews on the introducing pull request.

An adjudicated declaration skips only the prerequisite and deployment evidence of its base class. It MUST still satisfy declaration completeness, release-diff immutability, and named-owner approval, and it MUST NOT be used in a hotfix. It MUST NOT be treated as a routine fourth class.

#### Scenario: A valid adjudicated contract
- **WHEN** a contract cannot satisfy prerequisite evidence and declares an adjudicated overlay with two approved named owners, an incident, a backup, and ledger reconciliation
- **THEN** the check accepts it without resolving prerequisite or deployment evidence

#### Scenario: Only one approver is named
- **WHEN** `approved-by` names one user, or two users where one has no `APPROVED` review on the introducing pull request
- **THEN** the check fails on ownership

#### Scenario: An emergency field is missing
- **WHEN** the declaration omits `incident`, `backup`, `ledger-reconciliation`, or `adjudicated-at`
- **THEN** the check fails

#### Scenario: An adjudicated declaration is used in a hotfix
- **WHEN** a hotfix pull request introduces an adjudicated declaration
- **THEN** the check fails

#### Scenario: An adjudicated declaration tries to bypass immutability
- **WHEN** an adjudicated declaration modifies a frozen migration file
- **THEN** the check fails on immutability

### Requirement: The check makes no semantic claim about a declaration

The check MUST NOT parse SQL, classify statements, compare declared object names with statement targets, or prove that a migration preserves or removes a guarantee. Its results MUST be described as declaration, approval, immutability, and evidence findings, never as proof that the migration is safe.

The semantic judgment — whether the class is correct, whether the named objects are the ones touched, and whether serving code still uses an object — MUST remain a review obligation recorded in `REVIEW.md`. An out-of-band Worker rollback remains invisible to the check and MUST be covered by the incident and redeploy rule rather than by a machine assertion.

#### Scenario: A destructive statement is declared expand
- **WHEN** an `expand` declaration approves a file that contains a destructive statement
- **THEN** the check does not detect the statement; the named-owner review is the only guard, and the review policy requires it

#### Scenario: The check reports a result
- **WHEN** the check fails or passes
- **THEN** its output names a stage and a public reference, and never claims the migration is semantically safe
