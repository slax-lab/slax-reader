# Design

## Context

See `proposal.md` — Why. Beta and production share the PostgreSQL, logs, D1, fulltext, Hyperdrive, and KV resources, and a release applies migrations to those shared databases before its own Workers publish. This design is a compensating control for that topology; it does not make the topology safe for arbitrary DDL.

Two constraints shape the approach:

- A human has to run this on a normal release day. A rule that depends on review-API lookups, `CODEOWNERS` resolution, or inferred pull-request provenance has more ways to say "unknown" than ways to say "safe", and every unknown becomes a manual investigation.
- GitHub exposes branch tips, merge parents, deployment records, and pull-request bodies. It does not expose application code usage of a database object, and a deployment record is not proof of what is serving. The design stops where observable evidence stops.

## Goals / Non-Goals

**Goals**

- Make every added migration carry a complete, reviewable class declaration.
- Make a `contract` fail before shared data changes unless its prerequisite release is merged, contained in the release, and contained in the last commits successfully deployed to `beta` and `main`.
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

`removes` and `preserves` are nonempty comma-separated lists. `prerequisite-pr` is a positive integer. `prerequisite-merge` is a 40-hex commit. `prerequisite-change` is a nonempty change id, or `n/a` when the prerequisite is implementation-only. `confirmed-by` is exactly one `@handle`. Duplicate fields, unknown safety fields, and fields that belong to another class fail.

`removes`, `preserves`, `reason`, and `confirmed-by` are review context. The checker must not compare them to SQL, and the review must not treat their presence as proof. This is the deliberate trade: the machine guarantees a reviewer saw an explicit claim; the reviewer guarantees the claim is true. Ordinary `expand` and `migrate` migrations get no additional review machinery — the existing code-owner review on the introducing pull request is the gate.

### 3. Immutability without an adoption tree

The release diff may add migration files. It may not delete or rename one, and it may not modify one that exists in the release base — including adding a header. `migration_lock.toml` must remain unchanged.

There is no pinned adoption commit and no comparison against `main` and `beta` trees. "Existing files are never edited" gives the same protection with one rule: a file that is already there cannot receive a retroactive declaration, and a migration merged to `dev` cannot be rewritten before it reaches beta. The cost is that a mistaken migration needs a new corrective migration instead of an edit, which is the discipline the migration tooling already requires once the file has been applied.

### 4. Contract prerequisite and known-head deployment evidence

For each `contract` added by the release diff, all of the following must hold:

1. `prerequisite-pr` is a merged pull request in this repository, and `prerequisite-merge` equals its `merge_commit_sha`.
2. The pull request body carries `OpenSpec: <prerequisite-change>`, or both sides are `n/a` for an implementation-only prerequisite. Promotion and sync-back pull requests are exempt from the trailer per `REVIEW.md`.
3. `prerequisite-merge` is an ancestor of the release head, so the release contains the removal.
4. For each of `beta` and `main`, `prerequisite-merge` is an ancestor of that environment's last known deployed head.

#### Resolving the last known deployed head

A deploy workflow triggered by `pull_request_target` records its deployment against the merged pull request's head commit, not the merge commit. In a merge commit produced by that pull request, that deployed commit is the second parent. Verified against the live repository on 2026-10-28:

| Branch tip | Producing pull request | Second parent | Deployment record |
| --- | --- | --- | --- |
| `beta` `a605355f` | #419 from `dev` | `db8f456c` | `beta` environment, `sha=db8f456c` |
| `main` `3c2536d2` | #391 from `beta` | `888a0a8a` | `main` environment, `sha=888a0a8a` |

The checker therefore resolves the deployed head from the environment branch itself, without a discovery query:

1. Walk the environment branch's first parents, newest first, bounded to 50 first-parent commits.
2. For a merge commit with two parents, the second parent is a candidate deployed head.
3. Ask the deployments API for that exact commit in that environment and keep only records whose linked run is `.github/workflows/api-deploy.yml`. One merged release records an `api-deploy` and a `web-deploy` deployment at the same time (verified live: `db8f456c` has both), and only the API record is evidence here.
4. The newest `api-deploy` record's latest status must be `success` and its run must have concluded `success`. A newest record that is not successful — failed, errored, inactive, cancelled, or still running — fails the contract; there is no fallback to an older head, because a partial publish may have left some Workers on the new code.
5. A candidate with no `api-deploy` record was paths-filtered (the merge touched no API path) and is skipped.
6. The first candidate that satisfies 4 is the environment's last known deployed head. If no candidate within the bound qualifies, the contract fails closed and names the environment.

At the deploy checkpoint, the environment being deployed uses its pre-release tip `HEAD^1` — the target branch tip before the released commit — because the current run has not finished; the other environment uses its fetched branch tip. At the `dev` → `beta` promotion, both environments use their fetched tips. A `dev` deploy skips contract evidence entirely: its database is test-only.

This is a known-head lookup, not a serving resolver: candidate heads come only from commits the environment branch actually merged, and the API is asked whether a specific commit has a successful deployment record. The checker never lists deployments by environment and never selects a "latest" one.

### 5. Checkpoint surfaces

| Checkpoint | Release diff | Declaration | Immutability and hotfix | Contract evidence |
| --- | --- | --- | --- | --- |
| `promotion integrity`, base `beta` | `origin/beta...head` | Yes | Yes | Yes |
| `promotion integrity`, base `main` | — | No | No | No (unchanged gate) |
| Deploy preflight, `dev` | `HEAD^1..HEAD` | Yes | Yes | Skipped (test database) |
| Deploy preflight, `beta` / `main` | `HEAD^1..HEAD` | Yes | Yes | Yes |

The deploy preflight runs only when the release is not superseded, so a skipped run neither mutates nor reports a verdict; the newer run carries the same content and is evaluated on its own diff. The preflight is read-only: no firewall rule, Tunnel, migration, publication, or deployment credential is used before it passes.

Both checkpoints use a local git range. The promotion gate checks out the default branch and fetches the base, the head when it is not the default branch, and the two environment tips; the deploy workflow has the released commit as `HEAD`, so its first parent is the pre-release tip, and fetches the two environment tips. Each checkpoint needs enough history to answer the diff and every ancestry question the checker asks; when the checkout cannot reach a required commit, the check fails closed instead of assuming ancestry. No compare API is used, which removes the 300-file limit and its truncation failure mode.

### 6. Hotfix, rollback, and adjudication

- **Hotfix.** A release whose source branch is `hotfix/*` may add only `expand` migrations. `migrate` and `contract` fail with instructions to ship in a normal release. The promotion gate knows the source from `HEAD_REF`; the deploy workflow knows it from `github.event.pull_request.head.ref`.
- **Rollback.** An out-of-band `wrangler rollback` is invisible to the checker. The deployment record still names the pipeline deployment, while the serving Workers may be older. `REVIEW.md` requires the contract reviewer to confirm either no out-of-band rollback since the evidence deployment or a completed pipeline redeploy; until then, no contract proceeds.
- **Adjudication.** A contract that cannot satisfy prerequisite or deployment evidence must not be reclassified or forced. The manual runbook requires two named owners to record an incident reference, a backup reference, and a ledger-reconciliation statement on the pull request, then execute the destructive step outside the migration path during an announced window and ship the code change without a destructive migration. There is no fourth declaration class and no pipeline bypass.

### 7. Failure handling

| Condition | Effect |
| --- | --- |
| Deployments API unavailable | A current `contract` fails; a release whose diff adds no `contract` does not call it |
| Missing git ref or insufficient history for the bounded walk | Fail closed, naming the environment or ref |
| Pull-request or API response of an unexpected shape | Fail closed |
| Newest `api-deploy` record for a candidate is failed, errored, inactive, cancelled, or running | Current `contract` fails; no fallback |
| More than one `api-deploy` record for one candidate | Use the newest by creation time; its latest status decides |
| Superseded release | No preflight verdict, no remote mutation |

Every failure reports one fixed stage — `declaration`, `immutability`, `hotfix`, `prerequisite`, or `evidence` — with the public migration path, pull-request number, or commit SHA. Private configuration, connection values, and raw API responses never appear in output.

## Machine contract: checked versus not checked

| Checked by the machine | Not checked — human review |
| --- | --- |
| Declaration presence, field completeness, and field shape | Whether the declared class is correct |
| One class per file; duplicate, unknown, or inapplicable fields | Whether `removes` or `preserves` names the real objects |
| Added, deleted, renamed, and modified migration paths in the release diff | Whether the migration is safe for the data it touches |
| Prerequisite pull request merge state, merge SHA, `OpenSpec:` trailer, ancestry | Whether the prerequisite removed the last reader and writer |
| A successful `api-deploy.yml` record for a known commit | Whether that record reflects what is serving |
| Source branch is not `hotfix/*` for `migrate` and `contract` | Whether the incident justifies the adjudicated runbook |

## Risks / Trade-offs

- **A wrong class can pass.** An author can declare a destructive migration `expand` and a code-owner review can approve it. Accepted: the previous parser did not remove that risk either, and the declaration plus review is cheaper and more honest about where judgment lives.
- **A deployment record is not proof of serving.** Rollback, partial publishes, and manual split deployments are invisible. Mitigation: the failed-candidate rule, the reviewer's rollback confirmation, and the runbook.
- **The bounded walk can fail closed.** After more than 50 API-inert merges on an environment branch, a contract cannot resolve a deployed head. The operator resolves it by landing and deploying an API-affecting change before the contract release, which the error message names.
- **The hotfix rule depends on the source branch name.** A merge commit does not record it. Both checkpoints read it from their pull-request event, which is the same source the promotion allowlist already trusts.
- **Manual runbooks are only as good as the reviewer.** The machine can neither see a rollback nor adjudicate an exception. This is accepted; the runbooks keep those acts named and recorded.

## Rollout / migration plan

1. Human approval of this revised proposal. Until then, no implementation task starts.
2. Implement `tooling/migration-release-evidence.mjs` with unit tests over synthetic git ranges and fixture API responses. No database, deployment, or real DDL.
3. Wire the check into `promotion integrity` for `beta` and into the deploy preflight with the history each needs.
4. Document the declaration procedure, the hotfix rule, and the rollback and adjudication runbooks in `REVIEW.md`, `docs/CI.md`, `docs/BRANCHING.md`, the `.rulesync` source for `apps/api/AGENTS.md`, and `docs/api/DEVELOPMENT-DOCUMENT-EN.md`.
5. Exercise both checkpoints against synthetic repositories and fixture API responses, then use an `expand`-only migration for the first live release. Do not use a real contract as the first test.
6. Archive this change through a docs pull request after the task pull request merges.

## Open Questions

None.
