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

## Migration release evidence (`apps/api/prisma/**`)

Every new migration declares its release class in a leading comment block, before any SQL, so Prisma records the same file the release check reads. Generate, classify, annotate, then apply locally:

1. Generate the migration (`gen:diff`, `gen:diff:d1`, or `gen:diff:logs`) and inspect the SQL.
2. Add the declaration as the file's first lines. Choose exactly one class:
   - `expand` — adds an object or nullable column that existing serving code tolerates.
   - `migrate` — changes data or structure without removing a guarantee; add nonempty `preserves` and `reason`.
   - `contract` — removes an object; add nonempty `removes`, `prerequisite-change`, `prerequisite-pr`, `prerequisite-merge`, and `reason`.
3. Apply it locally (`migration:local` or `migration:local:logs`), then run `gen:all`.

```sql
-- migration-safety: expand
ALTER TABLE "sr_user_bookmark" ADD COLUMN "example" text;
```

```sql
-- migration-safety: contract
-- removes: example_unique_key
-- prerequisite-change: example-removal
-- prerequisite-pr: 412
-- prerequisite-merge: 0123456789abcdef0123456789abcdef01234567
-- reason: The prerequisite release removed the last reader and writer.
DROP INDEX IF EXISTS "example_unique_key";
```

Rules:

- One class per file. `expand` carries no other safety field; `migrate` and `contract` reject each other's fields. Duplicate or unknown safety fields fail the check.
- `removes`, `preserves`, and `reason` are author claims for human review. The check reads only their presence and shape; it does not compare them with SQL.
- Never annotate or edit a migration already on `main`, `beta`, or the pinned `dev` adoption commit; Prisma records its checksum. A migration merged to `dev` afterwards may still change before it reaches a shared branch.
- The pull request that introduces a migration needs an `APPROVED` review from a named owner listed for `/apps/api/prisma/**` in `.github/CODEOWNERS`; a team handle does not satisfy it.
- A `contract` needs its prerequisite release merged, matching `prerequisite-merge`, a matching `OpenSpec:` trailer, and containment in `main`, the release head, and the latest successful production and beta API deployments. An `adjudicated` overlay is exceptional and needs two named owners with approvals plus the incident, backup, and ledger-reconciliation references.
- A `hotfix/*` pull request may add only `expand` migrations.

See `REVIEW.md` for the reviewer's semantic duties and `docs/CI.md` for the three checking surfaces.

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
