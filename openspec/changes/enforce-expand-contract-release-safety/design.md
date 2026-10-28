# Design

## Context

See `proposal.md` — Why. Beta and production share the PostgreSQL, logs, D1, fulltext, Hyperdrive, and KV resources, and the release order applies migrations to those shared databases before the code that depends on them is updated. This design is a compensating control for that topology; it does not make the topology safe for arbitrary DDL.

Two constraints shape the approach:

- The repository already requires code-owner review on `dev`, and promotion pull requests already require `promotion integrity`. The missing piece is not another review instruction but a machine-checkable record that a specific person approved the migration's classification, plus release evidence that makes a delayed destructive step defensible.
- GitHub exposes the branch tips, the merged pull request that introduced a file, and the environment deployments. It does not expose application code usage of a database object. The design therefore stops where observable evidence stops.

## Goals / Non-Goals

**Goals**

- Make every new migration carry a complete, reviewable class declaration.
- Make a named API owner's approval the evidence that the classification and its semantic claim were reviewed.
- Make a `contract` fail before shared data changes unless its prerequisite release is merged, deployed to beta and production, and contained in the release head.
- Make migration files immutable once they reach a shared branch.
- Keep the verifier small enough to review in one sitting: header parsing, diff enumeration, and documented GitHub API reads.

**Non-Goals**

- Parsing SQL, whitelisting `expand` statements, cross-checking declared object names, or proving replacement equivalence.
- Proving that application code no longer uses an object. That judgment stays with the approving owner.
- Executing DDL, opening a database connection, or contacting Cloudflare.
- Adding a deployment trigger, deployment orchestrator, migration command, private configuration field, or runtime dependency.
- Editing already-applied migrations.

## Decisions

### 1. The verifier checks release evidence, not SQL semantics

The machine answers three questions: is the declaration complete, did a named API owner approve this migration on the pull request that introduced it, and does a `contract` carry satisfiable prerequisite and deployment evidence? It reads the leading comment block and the release diff; it never tokenizes SQL.

**Rejected approach (abandoned).** The earlier plan implemented a SQL-semantic verifier: a statement parser, a positive add-only whitelist for `expand`, object-name equivalence between `removes`/`preserves` and parsed statements, replacement-equivalence proofs for indexes, constraints, functions, and triggers, and dollar-quote/`DO` handling. It is rejected for three reasons:

- **It cannot prove the property it appears to prove.** Whether a class is honest and whether an object is dead are facts about application code and operational history, not about the migration file. A parser that accepts `expand` does not make the statement safe, and a parser that rejects an unknown form only sends the author to a different declaration.
- **Its failure mode is more review, not less risk.** Twelve review rounds produced edge cases — cascading drops, expression indexes, overloaded functions, constraint clauses — while the decision the gate exists to protect still depended on the same human reviewers.
- **Its cost is permanent.** A parser must track every future statement form the repository may use, and an unrecognized form blocks a release. The evidence model has no such tail: it reads a comment block and public API records that change rarely.

Consequence: the declaration's class is a reviewed claim, not a machine-verified fact. The spec states this boundary explicitly.

### 2. Declaration header

A new migration file starts with a leading comment block, before any SQL. The block is the only thing the verifier reads.

```sql
-- migration-safety: contract
-- removes: example_unique_key
-- prerequisite-change: example-removal-change
-- prerequisite-pr: 412
-- prerequisite-merge: 0123456789abcdef0123456789abcdef01234567
-- reason: The prerequisite release removed the last reader and writer of this key.
DROP INDEX IF EXISTS "example_unique_key";
```

```sql
-- migration-safety: adjudicated
-- adjudicated-class: contract
-- removes: example_unique_key
-- incident: https://github.com/slax-lab/slax-reader/issues/123
-- adjudicated-at: 2026-10-28T12:00:00Z
-- approved-by: @DGuang21, @api-owner-2
-- backup: R2 snapshot reference backup-20261028
-- ledger-reconciliation: prisma migrate resolve --applied 20261028_example
-- reason: The prerequisite cannot be deployed first because the key is actively corrupting data.
DROP INDEX IF EXISTS "example_unique_key";
```

Field rules (presence and shape only):

| Class | Required fields |
| --- | --- |
| `expand` | only the `migration-safety` line |
| `migrate` | `preserves`, `reason` |
| `contract` | `removes`, `prerequisite-change`, `prerequisite-pr`, `prerequisite-merge`, `reason` |
| `adjudicated` | `adjudicated-class` (`contract` or `migrate`), that class's `removes` or `preserves`, `incident`, `reason`, `adjudicated-at`, `approved-by` (two distinct handles), `backup`, `ledger-reconciliation` |

`preserves` and `removes` are nonempty comma-separated lists. `prerequisite-pr` is a positive integer. `prerequisite-merge` is a 40-hex commit. `adjudicated-at` is an ISO-8601 timestamp. `backup` and `ledger-reconciliation` are nonempty non-secret references. Duplicate fields, unknown safety fields, and fields that belong to another class fail.

`reason`, `removes`, and `preserves` are review context. The verifier must not compare them to SQL, and the review must not treat their presence as proof. This is the deliberate trade: the machine guarantees a reviewer saw an explicit claim; the reviewer guarantees the claim is true.

### 3. Named-owner approval is the classification gate

Every migration file added by the release diff requires an `APPROVED` review from a named user owner on the pull request that introduced it. The check is the same for `expand`, `migrate`, and `contract`, because the question — did an accountable API owner accept this class and its claim — is the same.

Resolution:

1. Find the commit that added the path (`commits?path=<path>&sha=<release head>`, oldest adding commit; a local `git log --diff-filter=A` when a checkout exists).
2. Map it to exactly one merged pull request (`commits/{sha}/pulls`). Ambiguity fails closed.
3. Read `CODEOWNERS` at that pull request's **base** commit and resolve named user owners for the migration path. Team handles are ignored: `GITHUB_TOKEN` cannot resolve membership, so a team entry would pass without a specific person.
4. Read the pull request's reviews with pagination, use each reviewer's latest state, and require at least one named-user owner in state `APPROVED`.

The existing `/apps/api/**` rule names one user (`@DGuang21`) plus a team, so `/apps/api/prisma/**` gains a small named-user API owner list before the check is enforced. Without it, the check has a single point of failure and the adjudicated overlay cannot find two owners.

### 4. Contract prerequisite and serving evidence

For each `contract` added by the release diff, all of the following must hold:

1. `prerequisite-pr` is a merged pull request in this repository.
2. `prerequisite-merge` equals that pull request's `merge_commit_sha`.
3. The pull request body carries `OpenSpec: <prerequisite-change>`, or both sides are `n/a` for an implementation-only prerequisite. Promotion and sync-back pull requests are exempt from the trailer per `REVIEW.md`.
4. `prerequisite-merge` is an ancestor of the `main` tip.
5. `prerequisite-merge` is an ancestor of the release head.
6. `prerequisite-merge` is an ancestor of the commit behind the latest successful **production** API deployment.
7. `prerequisite-merge` is an ancestor of the commit behind the latest successful **beta** API deployment.

Rules 6 and 7 are required because every contract mutates the shared production databases and beta's previous Workers keep serving during the migration window. Rule 5 is required because the release's own Workers must contain the removal.

#### Deployment evidence resolver

Resolve one serving commit per environment (`main`, `beta`). This is a new resolver, not a reuse of the promotion gate's beta evidence lookup, which maps a known head SHA to a deployment.

1. List deployments for the environment: `GET /repos/{repo}/deployments?environment=<main|beta>&per_page=100`, newest first. The deployment `sha` is the merge commit that was deployed (verified against the live repository: environment `main` deployments carry `sha` = the `beta` promotion merge commit).
2. Deduplicate by `sha`. The same run can produce two deployments for one commit.
3. Resolve the latest status of the newest deployment. If the newest api-deploy deployment's run is failed, cancelled, or in progress, **freeze**: a current contract fails and the resolver never falls back to an older success, because a partial publish may have left some Workers on the new code.
4. Keep only deployments whose status links to an `.github/workflows/api-deploy.yml` run (`main` is also used by other deploy workflows).
5. Read the job steps and require `Migrate databases and deploy Workers` to have concluded `success`. A superseded run (`current=false`) skips that step but still creates a successful deployment, so without this check a commit that never deployed would count as serving. This was confirmed against the live repository.
6. If no deployment satisfies these conditions, there is no serving evidence and a current contract fails closed.

"Serving" is an approximation. `wrangler rollback`, manual split deployments, and a failed cleanup after publish are invisible to the resolver. The next decision covers rollback; the resolver never claims more than pipeline evidence.

### 5. Immutability and the pinned dev adoption

For the release diff:

- An added migration file is **current** when it is absent from `main`, `beta`, and the pinned `dev` adoption tree: it needs a declaration and an approval.
- An added file that already exists on another shared branch or in the adoption tree is **historical**, not current — a migration carried from `beta` to `main`, or a hotfix migration propagated to `dev` — only when the release head content is byte-identical to that copy. It then needs no fresh declaration and does not fail. Different content under an existing path fails immutability and stays current, so declaration, ownership, and hotfix rules still apply to it.
- An added file is a **re-add** only when the target branch already carried that path before the release. The target is read at its pre-release state — the merge's first parent for a deploy, the pull request's base commit for API CI, and the base branch tip for a promotion — because after a merge the target already contains the release and a promotion's source branch already contains every migration it carries. Re-adding fails.
- A deleted or renamed migration file fails the check.
- A modified migration file fails when the same path exists on `main` or `beta`. A migration merged to `dev` after adoption may still be edited before it reaches a shared branch, including its declaration.

`main` and `beta` are read live, so no baseline bookkeeping is needed for them. The only pinned state is one `dev` adoption commit recorded at implementation: a migration file present in that tree is already applied on `dev`, is not required to carry a header, and must not receive one retroactively. This avoids a checksum break for the migrations merged before enforcement starts, without exempting anything merged afterwards.

A file added after adoption goes through the check before the `dev` deploy applies it, so its header exists when Prisma records the checksum. `migration_lock.toml` is not a migration and must stay byte-identical to `main`/`beta`.

### 6. Release-diff scoping and surfaces

| Surface | Release diff | Contract evidence | Ownership |
| --- | --- | --- | --- |
| API pull-request CI | `merge-base(base, head)..head` | Full | Full |
| `promotion integrity` | merge-base tree diff (`git/trees`, recursive) | Full | Full |
| API deploy preflight | `HEAD^1..HEAD` | Full for `beta`/`main`; skipped for `dev` (test database) | Skipped for `dev` |

Evidence is computed from the release diff only, so a release whose diff contains no current `contract` does not resolve deployments at all. A contract already on `main` or `beta` is historical: it was applied and is frozen, so it is not revalidated.

The promotion surface has no checkout of the head, so it enumerates the diff from the API instead. The compare API cannot supply it: its `files` array is capped at 300 entries and is not paginated (`page=2` returns no file list), and a routine `dev` → `beta` batch already exceeds 300 files — verified against the live repository, where `beta...dev` reported 300 files and 64 commits. Capping the whole promotion on that limit would block every promotion. The gate therefore reads one compare response for `merge_base_commit`, then two recursive `git/trees` listings and diffs only the four migration families plus `migration_lock.toml` by path and blob identity; a rename is a removed path whose blob reappears under a new path. A truncated tree listing, an unreadable tree, or an unresolvable merge base still fails closed.

The check runs before any remote access in the deploy job: no firewall rule, Tunnel, migration, or publication. It is read-only and needs no database or deployment credentials.

### 7. Hotfix, rollback, and the adjudicated overlay

- **Hotfix.** A pull request from a `hotfix/*` branch may add only `expand` migrations. `migrate`, `contract`, and `adjudicated` fail with instructions to ship in a normal release. This keeps a hotfix from carrying the release that its own prerequisite depends on. The class is parsed for frozen and re-added copies too, so byte-identical reuse of a shared file cannot smuggle a `contract` through a hotfix.
- **Rollback.** An out-of-band `wrangler rollback` is allowed only as a declared incident action. After one, no `contract` may proceed until the rolled-back target commit is redeployed through `api-deploy.yml` and the resolver names it as serving again. The machine cannot observe the rollback itself, so `REVIEW.md` requires the contract reviewer to confirm either no out-of-band rollback since the evidence deployment or a completed pipeline redeploy.
- **Adjudicated.** An `adjudicated` overlay on `contract` or `migrate` skips only the prerequisite and deployment evidence of decision 4 (items 1–3 and 6–7). It still requires a complete declaration, the diff immutability, and **two** named owners in `approved-by`, both of whom must have `APPROVED` reviews on the introducing pull request. It is not allowed in a hotfix and is not a fourth routine class.

### 8. Failure handling

| Condition | Effect |
| --- | --- |
| Deployments API unavailable | A release with a current `contract` fails; a release without one does not call it |
| Contents/tree API unavailable | Pull-request CI and the promotion gate cannot read `CODEOWNERS` or the base tree and fail closed |
| Pull-requests or actions API unavailable | Ownership and contract evidence fail closed; a release with no new migration in its diff does not call them |
| The merge base is unresolvable, or a recursive tree listing is truncated | Promotion fails closed |
| Latest API run failed, cancelled, or in progress | Current `contract` fails; no fallback to an older success |
| Duplicate or ambiguous deployment, pull request, or introducing commit | Fail closed |

Every failure reports one fixed stage — `declaration`, `ownership`, `prerequisite`, `immutability`, or `evidence` — with the public migration path, pull-request number, or commit SHA. Private configuration, connection values, and raw API responses never appear in output.

## Machine contract: checked versus not checked

| Checked by the machine | Not checked — human review |
| --- | --- |
| Declaration presence and field completeness | Whether the declared class is correct |
| One class per file; duplicate/unknown/inapplicable fields | Whether `removes` or `preserves` names the real objects |
| Added/deleted/modified migration paths in the release diff | Whether the migration is safe for the data it touches |
| Merged introducing PR and named-owner `APPROVED` review | Whether the approver actually read the SQL |
| Prerequisite PR merge SHA, `OpenSpec:` trailer, ancestry | Whether the prerequisite release removed the last dependency |
| Latest successful api-deploy deployments per environment | Whether serving code differs from deployment evidence |
| Hotfix class and adjudicated field set | Whether the incident justifies adjudication |

## Risks / Trade-offs

- **The approval is only as good as the reviewer.** The machine cannot tell a careful approval from a rubber stamp. Mitigation: the header forces an explicit class and claim, the named owner is accountable, and `REVIEW.md` keeps the semantic check as an Important review duty.
- **A wrong class can pass.** An author can declare a destructive migration `expand` and a named owner can approve it. This is accepted: the previous design's whitelist did not remove that risk either, and the named-owner approval is cheaper and more honest about where judgment lives.
- **Deployment evidence is an approximation.** Superseded runs, partial publishes, cleanup failures, and `wrangler rollback` can make the evidence differ from serving. Mitigation: step-level check, freeze on failed/in-progress latest runs, and the declared incident redeploy rule.
- **A deployments-API outage blocks contract releases.** Accepted fail-closed behavior; releases without a current contract do not call it.
- **Named-owner availability.** One named user per path can block a merge. Mitigation: the small named-user list for `/apps/api/prisma/**`, added before enforcement.
- **Adoption edge.** A `dev` migration merged before adoption is frozen by the pinned commit; a migration merged after adoption must carry its header before the `dev` deploy applies it.
- **Branch discipline.** The delivery branch suffix must equal the change-id. The Tower worktree branch is `feat/implement-migration-release-evidence`; the delivery pull request must be cut from current `origin/dev` as `feat/enforce-expand-contract-release-safety`, so the branch is renamed before the pull request opens.

## Approval

Alex Lee approved this revised release-evidence architecture on 2026-10-28, and implementation started from this revision. The SQL-semantic route recorded in decision 1 stays withdrawn.

## Rollout / migration plan

1. Human approval of this revised proposal. Until then, no implementation task starts.
2. Add the named-user API owner list for `/apps/api/prisma/**` to `.github/CODEOWNERS` and record the `dev` adoption commit in the verifier.
3. Implement `tooling/migration-release-evidence.mjs` with unit tests over synthetic diffs and fixture API responses. No database, deployment, or real DDL.
4. Wire the check into API CI, `promotion integrity`, and the deploy preflight, with the required read scopes and checkout depths.
5. Document the declaration procedure, the hotfix and rollback policy, and the evidence limits in `REVIEW.md`, `docs/CI.md`, `docs/BRANCHING.md`, the `.rulesync` source for `apps/api/AGENTS.md`, and `docs/api/DEVELOPMENT-DOCUMENT-EN.md`.
6. Exercise the checks against synthetic pull requests, then use an `expand`-only migration for the first live release. Do not use a real contract as the first test.
7. Archive this change through a docs pull request after the task pull request merges.

## Open Questions

None.
