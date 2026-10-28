# Backend Change Commands

Run these commands from the repository root, using `pnpm api -- <command>`.

## Prisma DDL changes (`apps/api/prisma/*.prisma`)

After changing the PostgreSQL schema, run the following commands in order:

```sh
pnpm api -- gen:diff
pnpm api -- migration:local
pnpm api -- gen:all
```

1. `gen:diff` generates a SQL migration for review (`--create-only`); inspect the generated SQL before applying it.
2. `migration:local` applies migrations to the local development databases.
3. `gen:all` regenerates Prisma clients, Worker runtime types, and backend registration code.

`gen:diff` defaults to PostgreSQL. For D1 schema changes, use `pnpm api -- gen:diff:d1` instead. For the logs schema, use `pnpm api -- gen:diff:logs`, then `pnpm api -- migration:local:logs`, then `pnpm api -- gen:all`; the aggregate `migration:local` does not include logs. Use local database connections for this workflow. Remote migrations and deployment require explicit authorization.

## Migration declarations

Every migration added under `apps/api/prisma/` starts with a leading comment block declaring one class:

```sql
-- migration-safety: expand
ALTER TABLE "example" ADD COLUMN "note" text;
```

```sql
-- migration-safety: migrate
-- preserves: example.id
-- reason: Backfills a default before the next release adds the constraint.
UPDATE "example" SET "note" = '';
```

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

- `expand` is additive only. `migrate` preserves a named guarantee. `contract` removes an object and needs prerequisite evidence.
- `prerequisite-merge` is the commit recorded by a successful `api-deploy` deployment for the prerequisite release; the prerequisite pull request's merge commit must be an ancestor of it. Do not use the merge commit unless the deployment actually recorded it.
- `confirmed-by` names the API owner who confirmed that the prerequisite removed the last reader and writer. The release check verifies presence and shape only; the reviewer verifies the claim.
- Generate the migration first (`gen:diff`, `gen:diff:logs`, or `gen:diff:d1`), add the declaration before applying it locally, then run `migration:local` (or `migration:local:logs`), then `gen:all`.
- Never edit, delete, rename, or retroactively annotate an existing migration, and never change `migration_lock.toml`; add a corrective migration instead.
- A `hotfix/*` release may add only `expand` migrations; `migrate` and `contract` ship through a normal release.

## Router, cronjob, or consumer changes

After adding, changing, or removing a router, cronjob, or consumer registration, regenerate the registration code:

```sh
pnpm api -- gen:all
```

## DI, service, data, or domain changes

After adding or changing DI components, services, data/repository classes, or domain classes, regenerate dependency injection and other backend generated code:

```sh
pnpm api -- gen:all
```

## Worker variables or TOML configuration changes

After the operator changes Worker variables (`.dev.vars` / `.dev.vars.*`) or the API Wrangler TOML configuration, regenerate backend artifacts:

```sh
pnpm api -- gen:all
```

Keep secret files private: do not read, print, copy, or commit them. Secrets must not be embedded in TOML or generated types.

Review the generated diff after running these commands. If a command fails, resolve the failure before continuing; do not manually patch generated output as a substitute.
