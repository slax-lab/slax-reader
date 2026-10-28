# Spec Delta

## Purpose

Make a migration release state its class explicitly, keep release diffs additive, and require a `contract` to wait for the release and the deployments that removed its last readers. The checker reads declarations, local git ranges, and deployment records; it never parses SQL, reads reviews, resolves `CODEOWNERS`, infers the pull request that introduced a file, or claims that a commit is serving.

## ADDED Requirements

### Requirement: Migration release evidence is checked at two checkpoints

The migration release check MUST run at exactly two checkpoints: in `promotion integrity` for a pull request whose base is `beta`, and in the API deploy workflow after the superseded-release check and before the first remote access, for every environment.

The check MUST NOT produce a pull-request CI gate, MUST NOT read pull-request reviews or `CODEOWNERS`, and MUST NOT infer the pull request that introduced a file. Ordinary `expand` and `migrate` migrations are covered by the repository's existing code-owner review, and the check MUST NOT duplicate it.

A pull request whose base is `main` MUST NOT gain a migration stage in `promotion integrity`: the beta deployment has already applied those migrations to the shared databases, and the main deploy preflight re-evaluates the same release diff before production mutation.

The deploy preflight MUST run only when the release is not superseded and MUST complete before a firewall rule is created, a Tunnel is opened, a database is contacted, or a Worker is published. It MUST be read-only and MUST NOT require database or deployment credentials.

#### Scenario: A dev-to-beta promotion carries a migration
- **WHEN** a pull request from `dev` to `beta` adds a migration file
- **THEN** `promotion integrity` evaluates the declaration, the release-diff immutability, the hotfix rule, and any current `contract` evidence

#### Scenario: An ordinary pull request adds a migration
- **WHEN** a pull request targeting `dev` adds a migration
- **THEN** no migration release evidence verdict is required or reported by pull-request CI

#### Scenario: A merged release deploys
- **WHEN** a merged pull request triggers the API deploy workflow and the release is not superseded
- **THEN** the preflight evaluates the release diff before any remote access, and a failure leaves no firewall rule, Tunnel, database contact, or publication

#### Scenario: A beta-to-main promotion is opened
- **WHEN** a pull request from `beta` to `main` is opened
- **THEN** `promotion integrity` keeps its existing suite-gate and beta-deployment contract and adds no migration stage, while the main deploy preflight evaluates the release diff before production mutation

### Requirement: Every added migration carries a complete declaration

A migration file under `apps/api/prisma/pg_migrations/**/migration.sql`, `apps/api/prisma/logs_migrations/**/migration.sql`, `apps/api/prisma/d1_migrations/*.sql`, or `apps/api/prisma/d1_migrations/fulltext/*.sql` that the release diff adds MUST begin with a leading comment block containing exactly one `-- migration-safety: expand`, `-- migration-safety: migrate`, or `-- migration-safety: contract` line.

A `migrate` file MUST also declare nonempty `-- preserves:` and `-- reason:` fields. A `contract` file MUST also declare nonempty `-- removes:`, `-- prerequisite-change:`, `-- prerequisite-pr:`, `-- prerequisite-merge:`, `-- confirmed-by:`, and `-- reason:` fields. An `expand` file MUST NOT declare any other safety field.

`removes` and `preserves` MUST be comma-separated lists with at least one nonempty entry. `prerequisite-pr` MUST be a positive integer. `prerequisite-merge` MUST be a 40-hex commit. `prerequisite-change` MUST be a nonempty change id, or `n/a` when the prerequisite is implementation-only. `confirmed-by` MUST be exactly one `@handle`. Duplicate, unknown, or class-inapplicable safety fields MUST fail. Ordinary SQL comments that do not use the safety field prefixes MUST be ignored.

`removes`, `preserves`, `reason`, and `confirmed-by` are author claims for human review. The check MUST verify only that they are present and shaped as documented; it MUST NOT compare them with SQL statements, resolve `confirmed-by` against `CODEOWNERS`, or assert that they are true.

`migration_lock.toml` is not a migration and MUST NOT be enumerated for declarations.

#### Scenario: A declared migration is complete
- **WHEN** the release diff adds a migration with one valid class line and every field that class requires
- **THEN** the declaration check passes

#### Scenario: A new migration has no declaration
- **WHEN** the release diff adds a migration without a leading `migration-safety` declaration
- **THEN** the check fails and names the undeclared path

#### Scenario: A required field is missing
- **WHEN** a `migrate` file omits `preserves` or a `contract` file omits `prerequisite-pr`, `prerequisite-merge`, or `confirmed-by`
- **THEN** the check fails

#### Scenario: A field is duplicated, unknown, or belongs to another class
- **WHEN** a header repeats a safety field, uses an unrecognized safety field, or declares `prerequisite-pr` on an `expand` file
- **THEN** the check fails instead of ignoring the field

#### Scenario: A claim is present but false
- **WHEN** a declaration names an object that the SQL does not touch, or a `confirmed-by` handle whose owner did not confirm the claim
- **THEN** the declaration check still passes, because verifying that claim is a human review duty and not a machine assertion

### Requirement: Release diffs only add migration files

The release diff MUST NOT delete or rename a migration file in any of the four families. It MUST NOT modify a migration file that exists in the release base, including by adding or changing a declaration header. `migration_lock.toml` MUST remain unchanged.

A head that lags behind the target branch is not a deletion: only paths the diff reports as deleted count.

#### Scenario: A release deletes or renames a migration
- **WHEN** the release diff contains a deleted or renamed migration path
- **THEN** the check fails on immutability and names the path

#### Scenario: A release edits an existing migration
- **WHEN** the release diff modifies a migration that exists in the release base
- **THEN** the check fails on immutability

#### Scenario: A release adds a migration
- **WHEN** the release diff adds a migration file that does not exist in the release base
- **THEN** the immutability check passes and the declaration check applies

#### Scenario: A frozen migration gains a declaration
- **WHEN** the release diff adds or changes a declaration on a migration that exists in the release base
- **THEN** the check fails on immutability

#### Scenario: A lagging branch lacks a migration
- **WHEN** the head does not contain a migration that exists on the target branch but the release diff contains no deletion for it
- **THEN** the check does not report a deletion

#### Scenario: The migration lock file changes
- **WHEN** the release diff deletes, renames, or modifies `migration_lock.toml`
- **THEN** the check fails on immutability

### Requirement: A contract is backed by a prerequisite release and known-head deployment evidence

A `contract` added by the release diff MUST declare `prerequisite-change`, `prerequisite-pr`, `prerequisite-merge`, and `confirmed-by`, and all of the following MUST hold before shared data changes:

1. `prerequisite-pr` is a merged pull request in this repository, and `prerequisite-merge` equals that pull request's `merge_commit_sha`.
2. The pull request body carries `OpenSpec: <prerequisite-change>`, or both use `n/a` for an implementation-only prerequisite. Promotion and sync-back pull requests are exempt from the trailer.
3. `prerequisite-merge` is an ancestor of the release head.
4. For each of `beta` and `main`, `prerequisite-merge` is an ancestor of that environment's last known deployed head.

The last known deployed head MUST be resolved from the environment branch's own first-parent history, newest first and bounded to 50 first-parent commits. For a merge commit with two parents, the second parent is the commit the environment's deploy workflow recorded its deployment against, so it is a candidate. For each candidate:

- only deployment records whose linked run is `.github/workflows/api-deploy.yml` count as evidence; the `web-deploy` record for the same commit does not;
- a candidate whose newest `api-deploy` record is not successful — failed, errored, inactive, cancelled, or still running — MUST fail the contract; the check MUST NOT fall back to an older head;
- a candidate with no `api-deploy` record in that environment was paths-filtered and MUST be skipped;
- the first candidate whose newest `api-deploy` deployment and run both concluded successfully is the environment's last known deployed head.

If no candidate within the bound qualifies, the contract MUST fail closed and name the environment.

At the deploy checkpoint, the environment being deployed MUST use `HEAD^1`, the target branch tip before the released commit, because the current run has not finished; the other environment MUST use its fetched branch tip. At the `dev` → `beta` promotion checkpoint, both environments MUST use their fetched tips. A deploy whose target is `dev` MUST skip prerequisite and deployment evidence because that database is test-only.

A contract already present in the release base is historical: it was applied and is frozen, so it MUST NOT be revalidated.

#### Scenario: A valid contract passes
- **WHEN** a contract names a merged prerequisite pull request whose merge commit is contained in the release head and in the last known deployed heads of both `beta` and `main`
- **THEN** the contract evidence check passes

#### Scenario: The prerequisite is not merged
- **WHEN** `prerequisite-pr` names an open or closed-unmerged pull request
- **THEN** the check fails

#### Scenario: The declared merge commit is not the prerequisite's merge commit
- **WHEN** `prerequisite-merge` names a commit other than the prerequisite pull request's `merge_commit_sha`
- **THEN** the check fails, even when that commit is an ancestor of every branch

#### Scenario: The prerequisite is not contained in the release
- **WHEN** `prerequisite-merge` is not an ancestor of the release head
- **THEN** the check fails on prerequisite evidence

#### Scenario: The OpenSpec trailer does not match
- **WHEN** the prerequisite pull request body carries an `OpenSpec:` value other than `prerequisite-change`
- **THEN** the check fails on prerequisite evidence

#### Scenario: The prerequisite is not in a deployed head
- **WHEN** `prerequisite-merge` is not an ancestor of the last known deployed head for `beta` or for `main`
- **THEN** the check fails on evidence and names the environment

#### Scenario: A candidate merge has no API deployment record
- **WHEN** an environment branch's newest merge touched no API path, so no `api-deploy` deployment exists for its deployed commit
- **THEN** the check skips that candidate and evaluates the next merge in the bounded walk

#### Scenario: The newest API deployment for a candidate failed
- **WHEN** a candidate head's newest `api-deploy` deployment is failed, errored, inactive, cancelled, or still running
- **THEN** a current contract fails and the check does not use an older head

#### Scenario: No candidate within the bound has deployment evidence
- **WHEN** none of the last 50 first-parent commits on an environment branch has a successful `api-deploy.yml` record
- **THEN** the contract fails closed and the error names the environment

#### Scenario: A release adds no contract during a deployments outage
- **WHEN** the release diff adds no current `contract` and the deployments API is unavailable
- **THEN** the check does not call the deployments API and the release is not blocked by that outage

#### Scenario: A dev deploy carries a contract
- **WHEN** the target environment is `dev` and the release adds a contract
- **THEN** declaration and immutability checks run, and prerequisite and deployment evidence are skipped because the database is test-only

### Requirement: Hotfix releases carry only expand migrations

A release whose source branch is `hotfix/*` MUST add only `expand` migrations. A `migrate` or `contract` declaration introduced by a hotfix MUST fail, and the change MUST ship through a normal release.

#### Scenario: A hotfix adds an expand migration
- **WHEN** a hotfix release adds only `expand` migrations
- **THEN** the check passes

#### Scenario: A hotfix adds a contract
- **WHEN** a hotfix release adds a `contract` migration
- **THEN** the check fails on the hotfix stage and instructs the author to ship it in a normal release

#### Scenario: A hotfix adds a migrate migration
- **WHEN** a hotfix release adds a `migrate` migration
- **THEN** the check fails, because a hotfix carries only additive change

### Requirement: The check reports evidence, not semantics

The check MUST NOT parse SQL, classify statements, compare declared object names with statement targets, resolve the `confirmed-by` handle, or claim that a commit is serving. Its results MUST be described as declaration, immutability, hotfix, prerequisite, and deployment-record findings, never as proof that the migration is safe or that a commit is the serving version.

The semantic judgment — whether the class is correct, whether the named objects are the ones touched, whether the `confirmed-by` handle's owner confirmed the claim, and whether serving code still uses an object — MUST remain a review obligation recorded in `REVIEW.md`.

An out-of-band `wrangler rollback` is invisible to the check. `REVIEW.md` MUST require a contract reviewer to confirm either that no out-of-band rollback happened since the evidence deployment or that a pipeline redeploy completed. A contract that cannot satisfy evidence MUST NOT be reclassified or forced; the adjudicated runbook MUST require two named owners to record an incident reference, a backup reference, and a ledger-reconciliation statement on the pull request, and MUST run the destructive step outside the migration path. The check MUST NOT accept a fourth declaration class.

#### Scenario: A destructive statement is declared expand
- **WHEN** an `expand` declaration approves a file that contains a destructive statement
- **THEN** the check does not detect the statement; the code-owner review is the only guard, and the review policy requires it

#### Scenario: The check reports a result
- **WHEN** the check fails or passes
- **THEN** its output names a stage and a public reference, and never claims the migration is semantically safe or the commit is serving

#### Scenario: A rollback happened after the evidence deployment
- **WHEN** an out-of-band rollback occurred after the deployment that produced the evidence
- **THEN** the machine records nothing new, and the contract reviewer must block the contract until a pipeline redeploy completes

#### Scenario: An adjudicated declaration is attempted
- **WHEN** a migration declares `-- migration-safety: adjudicated`
- **THEN** the check fails as an unknown class, and the adjudicated runbook remains the only path

### Requirement: Failures are explicit and fail closed

Every failure MUST report one fixed stage among `declaration`, `immutability`, `hotfix`, `prerequisite`, and `evidence`, with the public migration path, pull-request number, or commit SHA. It MUST NOT print private configuration, connection values, resource identifiers, or raw API responses.

A release whose diff adds no `contract` MUST NOT call the deployments API. A missing git ref, insufficient history for the bounded walk, an unexpected API response shape, or a deployment record that cannot be tied to a workflow run MUST fail closed.

#### Scenario: The deployments API is unavailable during a contract release
- **WHEN** the release diff adds a current contract and the deployments API cannot be read
- **THEN** the check fails on evidence and the release mutates nothing

#### Scenario: The checkout lacks the history the walk needs
- **WHEN** the bounded first-parent walk cannot reach enough history to resolve a deployed head
- **THEN** the check fails closed and names the environment, instead of assuming a head

#### Scenario: A deployment record is not tied to a workflow run
- **WHEN** a deployment record has no linked run or an unexpected status
- **THEN** the check fails closed instead of counting it as evidence
