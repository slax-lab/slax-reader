---
root: false
targets: ["agentsmd"]
description: "Backend commands required after schema, registration, and configuration changes"
globs: ["apps/api/**/*"]
agentsmd:
  subprojectPath: "apps/api"
---

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
