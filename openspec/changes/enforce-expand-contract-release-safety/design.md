# Design

## Context

See `proposal.md` — Why. Beta and production share the PostgreSQL, logs, D1, fulltext, Hyperdrive, and KV resources, and a release applies migrations to those shared databases before its own Workers publish. This design is a compensating control for that topology; it does not make the topology safe for arbitrary DDL.

Two constraints shape the approach:

- A human has to run this on a normal release day. A rule that depends on review-API lookups, `CODEOWNERS` resolution, or inferred pull-request provenance has more ways to say "unknown" than ways to say "safe", and every unknown becomes a manual investigation.
- GitHub exposes branch tips, merge parents, deployment records, and pull-request bodies. It does not expose application code usage of a database object, and a deployment record is not proof of what is serving. The design stops where observable evidence stops.

## Goals / Non-Goals

**Goals**

- Make every added migration carry a complete, reviewable class declaration.
- Make a `contract` fail before shared data changes unless its prerequisite release is merged, contained in the release, and backed by a successful `api-deploy` record with a green migration and publication step.
- Keep a release diff additive for migration files.
- Keep the checker small enough to review in one sitting and to run twice per release: header parsing, git range enumeration, and documented GitHub API reads.

**Non-Goals**

- Parsing SQL, whitelisting `expand` statements, or proving replacement equivalence.
- Resolving `CODEOWNERS`, reading pull-request reviews, or inferring which pull request introduced a file.
- Discovering "the latest deployment" per environment or claiming that a commit is serving.
- Adding a deployment trigger, deployment orchestrator, migration command, private configuration field, or runtime dependency.
- Editing already-applied migrations.

## Decisions

### 1. Two checkpoints, no pull-request gate

The check runs where a migration can reach shared data:

1. **`dev` → `beta` promotion** — `promotion integrity` evaluates the promotion diff. The promotion decides what enters the beta release line, and its result is visible before the merge that triggers the beta deploy.
2. **API deploy preflight** — the same check runs in `api-deploy.yml` after the superseded-release check and before the first remote access, for every environment.

Pull-request CI runs no migration-evidence verdict. A third surface would repeat the same declaration and diff checks without adding a decision, and it would put release policy in the path of every ordinary pull request.

A promotion to `main` adds no migration stage. Beta has already applied those migrations to the shared database, and the main deploy preflight re-evaluates the same release diff before production mutation. The main promotion keeps its existing `promotion integrity` contract — allowed source, suite gates, and beta deployment evidence.

### 2. Declaration header

A new migration file starts with a leading comment block, before any SQL. The block is the only thing the checker reads.

```sql
-- migration-safety: contract
-- removes: example_unique_key
-- prerequisite-change: example-removal-change
-- prerequisite-pr: 412
-- prerequisite-merge: 0123456789abcdef0123456789abcdef01234567
-- confirmed-by: @DGuang21
-- reason: The prerequisite release removed the last reader and writer of this key.
DROP INDEX IF EXISTS "example_unique_key";
```

```sql
-- migration-safety: migrate
-- preserves: user_bookmarks.id
-- reason: Backfills a default before the next release adds the constraint.
```

Field rules (presence and shape only):

| Class | Required fields |
| --- | --- |
| `expand` | only the `migration-safety` line |
| `migrate` | `preserves`, `reason` |
| `contract` | `removes`, `prerequisite-change`, `prerequisite-pr`, `prerequisite-merge`, `confirmed-by`, `reason` |

`removes` and `preserves` are nonempty comma-separated lists. `prerequisite-pr` is a positive integer. `prerequisite-merge` is a 40-hex commit — the commit the prerequisite release deployed, not necessarily the pull request's merge commit; that merge commit must be an ancestor of it. `prerequisite-change` is a nonempty change id, or `n/a` when the prerequisite is implementation-only. `confirmed-by` is exactly one `@handle`. Duplicate fields, unknown safety fields, and fields that belong to another class fail.

`removes`, `preserves`, `reason`, and `confirmed-by` are review context. The checker must not compare them to SQL, and the review must not treat their presence as proof. This is the deliberate trade: the machine guarantees a reviewer saw an explicit claim; the reviewer guarantees the claim is true. Ordinary `expand` and `migrate` migrations get no additional review machinery — the existing code-owner review on the introducing pull request is the gate.

### 3. Immutability without an adoption tree

The release diff may add migration files. It may not delete or rename one, and it may not modify one that exists in the release base — including adding a header. `migration_lock.toml` must remain unchanged.

There is no pinned adoption commit and no comparison against `main` and `beta` trees. "Existing files are never edited" gives the same protection with one rule: a file that is already there cannot receive a retroactive declaration, and a migration merged to `dev` cannot be rewritten before it reaches beta. The cost is that a mistaken migration needs a new corrective migration instead of an edit, which is the discipline the migration tooling already requires once the file has been applied.

### 4. Contract prerequisite and direct deployment evidence

For each `contract` added by the release diff, all of the following must hold:

1. `prerequisite-pr` is a merged pull request in this repository.
2. That pull request's `merge_commit_sha` is an ancestor of `prerequisite-merge`, so the declared commit contains the prerequisite change.
3. The pull request body carries `OpenSpec: <prerequisite-change>`, or both sides are `n/a` for an implementation-only prerequisite. Promotion and sync-back pull requests are exempt from the trailer per `REVIEW.md`.
4. `prerequisite-merge` is an ancestor of the release head.
5. A direct `GET /repos/{repo}/deployments?sha=<prerequisite-merge>` finds at least one deployment record for a shared environment whose linked run is `.github/workflows/api-deploy.yml` and whose deployment status, run conclusion, and `Migrate databases and deploy Workers` step conclusion are all successful.

#### Why the declared commit is a deployed head

A deploy workflow triggered by `pull_request_target` records its deployment against the merged pull request's head commit, not the merge commit. Verified against the live repository on 2026-10-28: PR #416's merge commit `db8f456c` has `beta` deployment records only because it happened to be the `dev` tip at the next promotion, while its own `dev` deployment is recorded against its head `34e14cf7`. A pull request's merge commit usually has no deployment of its own.

`prerequisite-merge` therefore names the commit the API release pipeline deployed — the deployment record's `sha` — and requirement 2 ties it back to the prerequisite pull request with one local ancestry check. The author reads the record and declares its commit; the check reads only that commit. This is a declaration rule, not a resolver.

#### The direct lookup

The check makes one deployments read per contract and keeps only records that satisfy all of:

- the environment is `beta` or `main` — a `dev` deployment targets the test database and is not evidence for shared data;
- the linked run path is `.github/workflows/api-deploy.yml` — the `web-deploy` record created by the same release is not evidence;
- the deployment's latest status, the run's conclusion, and the run's `Migrate databases and deploy Workers` step conclusion are all `success`.

Records are grouped by environment. For each environment, the newest record by `created_at` decides; a tie at the newest timestamp with different outcomes is ambiguous and fails. Every environment that has a record must pass. If no shared-environment record exists, the contract fails closed.

There is no branch-history walk, no listing of deployments by environment, no selection of a "latest deployment", no waiting for a record to appear, and no fallback to another commit. The API is read only for the commit the author declared.

#### Failure and the human-review path

A missing, failed, in-progress, or ambiguous verdict fails the contract and names the human-review path: the author either declares the deployed commit the pipeline recorded, or uses the adjudicated runbook. A named reviewer records the manual confirmation on the pull request; the pipeline never bypasses the check. The check reports "commit X has a successful `api-deploy` record to `beta`/`main` with the migration and publication step green"; it never claims that X is the current serving version.

### 5. Checkpoint surfaces

| Checkpoint | Release diff | Declaration | Immutability and hotfix | Contract evidence |
| --- | --- | --- | --- | --- |
| `promotion integrity`, base `beta` | `origin/beta...head` | Yes | Yes | Yes |
| `promotion integrity`, base `main` | — | No | No | No (unchanged gate) |
| Deploy preflight, `dev` | `HEAD^1..HEAD` | Yes | Yes | Skipped (test database) |
| Deploy preflight, `beta` / `main` | `HEAD^1..HEAD` | Yes | Yes | Yes |

The deploy preflight runs only when the release is not superseded, so a skipped run neither mutates nor reports a verdict; the newer run carries the same content and is evaluated on its own diff. The preflight is read-only: no firewall rule, Tunnel, migration, publication, or deployment credential is used before it passes.

Both checkpoints use a local git range. The promotion gate fetches the base and the head; the deploy workflow has the released commit as `HEAD`, so `HEAD^1` is the pre-release tip and `fetch-depth: 2` is sufficient. Contract evidence needs no branch history or environment tips: one deployments read per contract, then the linked run and its jobs. A missing commit for the diff or an ancestry check fails closed instead of assuming it. No compare API is used, which removes the 300-file limit and its truncation failure mode.

### 6. Hotfix, rollback, and adjudication

- **Hotfix.** A release whose source branch is `hotfix/*` may add only `expand` migrations. `migrate` and `contract` fail with instructions to ship in a normal release. The promotion gate knows the source from `HEAD_REF`; the deploy workflow knows it from `github.event.pull_request.head.ref`.
- **Rollback.** An out-of-band `wrangler rollback` is invisible to the checker. The deployment record still names the pipeline deployment, while the serving Workers may be older. `REVIEW.md` requires the contract reviewer to confirm either no out-of-band rollback since the evidence deployment or a completed pipeline redeploy; until then, no contract proceeds.
- **Adjudication.** A contract that cannot satisfy prerequisite or deployment evidence must not be reclassified or forced. The manual runbook requires two named owners to record an incident reference, a backup reference, and a ledger-reconciliation statement on the pull request, then execute the destructive step outside the migration path during an announced window and ship the code change without a destructive migration. There is no fourth declaration class and no pipeline bypass.

### 7. Failure handling

| Condition | Effect |
| --- | --- |
| Deployments, actions, or jobs API unavailable | A current `contract` fails; a release whose diff adds no `contract` does not call it |
| Missing git ref for the release diff or an ancestry check | Fail closed, naming the ref |
| A deployment record not tied to exactly one run and step, or an unexpected API shape | Fail closed |
| Newest `api-deploy` record for a shared environment is failed, errored, inactive, cancelled, or running | Current `contract` fails; no fallback |
| Newest records for one environment share a timestamp but disagree | Ambiguous; fail closed |
| No `api-deploy` record for the declared commit in `beta` or `main` | Fail closed and name the human-review path |
| Superseded release | No preflight verdict, no remote mutation |

Every failure reports one fixed stage — `declaration`, `immutability`, `hotfix`, `prerequisite`, or `evidence` — with the public migration path, pull-request number, or commit SHA. Private configuration, connection values, and raw API responses never appear in output.

## Machine contract: checked versus not checked

| Checked by the machine | Not checked — human review |
| --- | --- |
| Declaration presence, field completeness, and field shape | Whether the declared class is correct |
| One class per file; duplicate, unknown, or inapplicable fields | Whether `removes` or `preserves` names the real objects |
| Added, deleted, renamed, and modified migration paths in the release diff | Whether the migration is safe for the data it touches |
| Prerequisite pull request merge state, its merge commit as an ancestor of the declared commit, `OpenSpec:` trailer, ancestry in the release head | Whether the prerequisite removed the last reader and writer |
| A successful `api-deploy.yml` record with the migration and publication step green for the declared commit | Whether that record reflects what is serving |
| Source branch is not `hotfix/*` for `migrate` and `contract` | Whether the incident justifies the adjudicated runbook |

## Risks / Trade-offs

- **A wrong class can pass.** An author can declare a destructive migration `expand` and a code-owner review can approve it. Accepted: the previous parser did not remove that risk either, and the declaration plus review is cheaper and more honest about where judgment lives.
- **A deployment record is not proof of serving.** Rollback, partial publishes, and manual split deployments are invisible. Mitigation: the newest-record rule, the reviewer's rollback confirmation, and the runbook.
- **The declared commit must match a deployment record.** A pull request's merge commit usually has no deployment of its own, so the author must declare the commit the deployment recorded. The failure message states that rule and the human-review path; a wrong declaration cannot be silently corrected by a fallback.
- **The hotfix rule depends on the source branch name.** A merge commit does not record it. Both checkpoints read it from their pull-request event, which is the same source the promotion allowlist already trusts.
- **Manual runbooks are only as good as the reviewer.** The machine can neither see a rollback nor adjudicate an exception. This is accepted; the runbooks keep those acts named and recorded.

## Rollout / migration plan

1. Human approval of this revised proposal. Until then, no implementation task starts.
2. Implement `tooling/migration-release-evidence.mjs` with unit tests over synthetic git ranges and fixture API responses. No database, deployment, or real DDL.
3. Wire the check into `promotion integrity` for `beta` and into the deploy preflight. Neither needs branch history beyond the release diff; the deploy step needs `deployments`, `actions`, and `pull-requests` read scopes.
4. Document the declaration procedure, the hotfix rule, and the rollback and adjudication runbooks in `REVIEW.md`, `docs/CI.md`, `docs/BRANCHING.md`, the `.rulesync` source for `apps/api/AGENTS.md`, and `docs/api/DEVELOPMENT-DOCUMENT-EN.md`.
5. Exercise both checkpoints against synthetic repositories and fixture API responses, then use an `expand`-only migration for the first live release. Do not use a real contract as the first test.
6. Archive this change through a docs pull request after the task pull request merges.

## Open Questions

None.

## Approval

The user approved this revision for implementation on 2026-10-28. The two checkpoints, the direct deployment lookup, and the fixed `prerequisite-merge` semantics — the commit recorded by the successful `api-deploy` deployment, with the prerequisite pull request's merge commit as its ancestor — are approved as written.
