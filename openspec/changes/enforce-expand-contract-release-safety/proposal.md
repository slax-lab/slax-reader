# Proposal

## Why

Beta and production share PostgreSQL, logs, D1, fulltext, Hyperdrive, and KV. A merged release into `beta` runs its migrations against the shared production databases before production Workers update, and every release migrates before its own Workers publish. The root cause is that topology plus the release order, not a missing review comment. Today the only guard is `REVIEW.md`'s instruction that a destructive migration must demonstrate an expand/contract split.

The previous version of this proposal tried to compensate with SQL-semantic verification: a parser, an add-only whitelist for `expand`, object-name equivalence checks, and replacement proofs. That approach is rejected and is not part of this plan. A parser cannot answer the question that matters — whether the declared class is honest and whether serving code still uses an object — because the answer lives in application code, dynamic SQL, and the reviewer's judgment, not in the migration file. The attempt also produced a large verifier whose own edge cases dominated twelve review rounds while the release risk stayed exactly where it was.

This version verifies **release evidence**. The author declares a class; a named API owner approves that classification and its semantic claim on the pull request; the machine checks that the declaration is complete, that the approval exists, and that a `contract` is backed by the required release and deployment evidence before shared data changes. The machine never claims a declaration is semantically true.

## What Changes

- **Keep the per-file declaration header.** Every new migration file starts with a structured comment block declaring exactly one of `expand`, `migrate`, or `contract`. `migrate` declares `preserves` and `reason`; `contract` declares `removes`, `prerequisite-change`, `prerequisite-pr`, `prerequisite-merge`, and `reason`. `removes`, `preserves`, and `reason` are author claims for human review; the check verifies presence and shape only.
- **Require a named API owner approval for every new migration.** The approval on the introducing pull request is the evidence that the class and its semantic claim were reviewed, and it applies to `expand`, `migrate`, and `contract` alike. Owners come from `CODEOWNERS` read at the pull request's base branch, so a pull request cannot grant itself ownership; team handles do not satisfy the check because the workflow token cannot resolve membership.
- **Bind a `contract` to a prerequisite release and to serving evidence.** The named prerequisite pull request must be merged, its `merge_commit_sha` must equal `prerequisite-merge`, its body must carry the matching `OpenSpec:` trailer, and that commit must be contained in the `main` tip, the release head, and the commits behind the latest successful production and beta API deployments.
- **Make the release diff immutable for migrations.** A release may add migration files. It may not delete or rename one, and it may not modify a file that already exists on `main` or `beta`. Files already merged to `dev` at adoption are frozen by a pinned adoption commit, so work in flight needs no retroactive rewrite.
- **Keep the exceptional `adjudicated` overlay, narrowed.** It applies to a `contract` or `migrate` whose prerequisite cannot be satisfied. It requires two distinct named-owner approvals, an incident reference, a backup reference, a ledger-reconciliation reference, and an adjudication timestamp, and it skips only the prerequisite deployment evidence.
- **Make hotfix releases expand-only.** A hotfix may add only `expand` migrations; a `migrate`, `contract`, or `adjudicated` declaration must go through a normal release.
- **Block contracts after an out-of-band Worker rollback until the pipeline redeploys.** The machine cannot see `wrangler rollback`; the rule is carried by the contract review checklist and by the evidence resolver, which accepts only a pipeline deployment as serving evidence.
- **Scope all evidence to the current release diff.** A release with no new `contract` resolves no deployment evidence, so expand-only and historical-contract releases are not blocked by a deployments-API outage.

Not changing: migration command names or their order, `migration_lock.toml`, `_prisma_migrations`, existing applied migrations, deployment triggers and environments, shared resource identities, private configuration, runtime dependencies, or application behavior.

## Capabilities

### New Capabilities

- `migration-release-safety`: per-file declarations, named-owner approval for every new migration, contract prerequisite and deployment evidence, release-diff immutability, expand-only hotfixes, the adjudicated overlay, and fail-closed evidence handling.

### Modified Capabilities

- `api-release-deployment`: the deploy workflow runs a migration-evidence preflight before any remote access, and the API path filters cover the evidence checker itself.
- `release-branching`: the `promotion integrity` check asserts the migration release evidence on the promotion head, and the hotfix flow admits only `expand` migrations.

## Impact

- New: `tooling/migration-release-evidence.mjs` and `tooling/migration-release-evidence.test.mjs`. The verifier parses only the leading comment header of a migration file; it contains no SQL parser, no statement whitelist, no object-name cross-check, no replacement analysis, and executes no DDL.
- Changed: `tooling/promotion-gate.mjs` and its test, `tooling/ci-scope.mjs` and its test, `package.json` (the local command and `test:ci`), `.github/workflows/api-ci.yml`, `.github/workflows/api-deploy.yml`, `.github/workflows/promotion-gate.yml`, `.github/CODEOWNERS` (the named-user API owner list for `/apps/api/prisma/**`), `REVIEW.md`, `docs/CI.md`, `docs/BRANCHING.md`, `.rulesync/**` and the generated `apps/api/AGENTS.md`, `docs/api/DEVELOPMENT-DOCUMENT-EN.md`.
- Migration files: new files in the four families gain a declaration header. The pinned `dev` adoption commit freezes files already merged to `dev`; existing applied migrations, `migration_lock.toml`, and `_prisma_migrations` are not modified.
- No API or Web package-version bump: `docs/release/VERSIONING.md` excludes Web and API changes from package-version increments, and this change touches release tooling, workflows, and documentation only. Revisit only if implementation grows into CLI/Extension/Mobile logic, shipped UI/assets, runtime dependencies, native integration, or build/package output.
- Implementation approval and start have not been granted: this change contains planning artifacts only, and every implementation task stays unchecked until the human approves the revised architecture.
