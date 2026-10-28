# Proposal

## Why

Beta and production share PostgreSQL, logs, D1, fulltext, Hyperdrive, and KV. A merge into `beta` applies its migrations to the shared production databases before the beta Workers publish, and every release migrates before its own Workers publish. The release order is the risk: a destructive change can run while older Workers still use the object it removes.

Two earlier revisions tried to buy safety with machine completeness. One parsed SQL. The other added a pull-request evidence check, `CODEOWNERS` and review-API lookups, introducing-pull-request inference, a generic serving resolver, and an `adjudicated` class. Both grew edge cases faster than they removed risk, and neither made the release decision easier to apply. That multi-surface revision (pull request #421) is closed rather than amended. The goal here is a rule a person can execute the same way every time.

This version keeps the two things a machine can check cheaply and a reviewer can read in one minute — an explicit class in the migration file and the rule that a release only adds migration files — and adds one evidence chain for the only class that removes objects. Everything else is either the repository's existing code-owner review or a documented manual runbook.

## What Changes

- **Two checkpoints only: the `dev` → `beta` promotion and the API deploy preflight.** `promotion integrity` evaluates the migration content of a pull request targeting `beta`; the deploy workflow evaluates the same content before any remote access on every environment. There is no migration-evidence gate in pull-request CI.
- **Keep the per-file SQL comment.** Every added migration starts with exactly one `-- migration-safety:` class line: `expand`, `migrate`, or `contract`. `migrate` adds `preserves` and `reason`; `contract` adds `removes`, `prerequisite-change`, `prerequisite-pr`, `prerequisite-merge`, `confirmed-by`, and `reason`. Presence and shape are checked; `removes`, `preserves`, `reason`, and `confirmed-by` are review context and are never compared with SQL.
- **Ordinary migrations use the existing code-owner review.** `expand` and `migrate` add no review machinery. The branch rulesets already require an approving code-owner review on the pull request that introduces the file, and the check does not read reviews or `CODEOWNERS`.
- **A `contract` records its semantic confirmation and its prerequisite.** `confirmed-by` names the API owner who confirmed that the prerequisite removed the last reader and writer; the reviewer verifies that confirmation, not the machine. The prerequisite pull request must be merged, its `merge_commit_sha` must equal `prerequisite-merge`, its body must carry `OpenSpec: <prerequisite-change>`, and that commit must be contained in the release head and in the last commits successfully deployed to `beta` and `main`.
- **Deployment evidence reuses the promotion gate's known-head model.** For a known commit and environment, the checker asks whether that exact commit has a deployment record whose linked `api-deploy.yml` run succeeded. Candidate heads come from the environment branch's own first-parent merges: the second parent of a merge commit is the commit the deploy workflow recorded against. There is no "latest deployment" query and no new serving resolver.
- **A release only adds migration files.** A migration file present in the release base may not be deleted, renamed, or modified, including by adding a header. `migration_lock.toml` is not touched. There is no pinned adoption commit: existing files are simply never edited.
- **A hotfix may add only `expand` migrations.** `migrate` and `contract` ship through a normal release.
- **Rollback and adjudication are manual runbooks.** An out-of-band `wrangler rollback` blocks contracts until a pipeline redeploy, which the contract reviewer confirms. A contract that cannot satisfy prerequisite evidence is not forced through a fourth declaration class: the adjudicated runbook records two named owners, an incident, a backup, and ledger reconciliation, and runs the destructive step outside the migration path.
- **The checker never claims semantic or serving truth.** It reports declaration, immutability, hotfix, prerequisite, and deployment-record findings. Whether a class is honest, whether an object is truly unused, and whether the deployed head is what is actually serving remain review judgments.

Not changing: migration command names and order, `migration_lock.toml`, `_prisma_migrations`, already-applied migrations, deployment triggers and environments, shared resource identities, private configuration, runtime dependencies, or application behavior.

## Capabilities

### New Capabilities

- `migration-release-safety`: the declaration header, release-diff immutability, contract prerequisite and known-head deployment evidence, expand-only hotfixes, and the manual rollback and adjudication runbooks.

### Modified Capabilities

- `api-release-deployment`: the deploy workflow runs the migration release preflight after the superseded-release check and before the first remote access, and the API path filter covers the checker itself.
- `release-branching`: `promotion integrity` evaluates migration release evidence for pull requests targeting `beta`, and the hotfix flow admits only `expand` migrations.

## Impact

- New: `tooling/migration-release-evidence.mjs` and `tooling/migration-release-evidence.test.mjs`. The checker parses only the leading comment block and reads git ranges and documented GitHub API records; it contains no SQL parser, no review or `CODEOWNERS` lookup, and no introducing-pull-request inference.
- Changed: `tooling/promotion-gate.mjs` and its test, `.github/workflows/promotion-gate.yml` (the history and the base and environment tips it fetches), `.github/workflows/api-deploy.yml` (the preflight step, the history it needs, and the `deployments` and `pull-requests` read scopes), `tooling/ci-scope.mjs` and its test, `package.json`, `REVIEW.md`, `docs/CI.md`, `docs/BRANCHING.md`, the `.rulesync` source for `apps/api/AGENTS.md`, and `docs/api/DEVELOPMENT-DOCUMENT-EN.md`.
- Migration files: new files in the four families gain a declaration header. Existing and already-applied migrations, `migration_lock.toml`, and `_prisma_migrations` are not modified.
- No `CODEOWNERS` change and no API or Web package-version bump: `docs/release/VERSIONING.md` excludes Web and API changes from package-version increments, and this change touches release tooling, workflows, and documentation only.
- Implementation approval and start have not been granted: this change contains planning artifacts only, and every implementation task stays unchecked until the human approves this revision.
