---
root: false
targets: ["agentsmd"]
description: "Backend architecture, minimal implementation, complexity approval, and required change commands"
globs: ["apps/api/**/*"]
agentsmd:
  subprojectPath: "apps/api"
---

# Backend Agent Rules

## Naming, placement, and scope

- Inspect the nearest comparable implementation before editing. Follow its file, class, method, and interface naming, directory layout, and dependency-injection conventions; see `docs/api/HOW-TO-CONTRIBUTION-EN.md`. Preserve contract names and established local exceptions rather than renaming unrelated code for consistency.
- Place behavior in its existing owning layer and feature directory. Reuse existing components before adding files, directories, services, or abstractions. Do not create parallel implementations, move responsibilities, or introduce a new layer without an approved need.
- Implement the smallest coherent change that satisfies the approved requirement and preserves existing contracts. Every changed file and added mechanism must serve that requirement or a demonstrated regression it causes. Do not perform unrelated cleanup, renaming, dependency upgrades, or opportunistic refactoring.

## Layer responsibilities and dependencies

These boundaries apply to application runtime source under `apps/api/src`; migration SQL, generation tooling, and test fixtures retain their existing locations.

- Follow `apps/api/test/helpers/layerRules.ts` (`layerOf`, `ALLOWED`, and existing I/O and composition exceptions) as the executable dependency policy. Preserve allowed same-layer edges and domain-to-infra repository delegation; do not invent a second hierarchy or add entries to `apps/api/test/script/layerArchitecture.baseline.json` to make a task pass.
- Keep entry points responsible for transport and application composition, DI responsible for wiring, handlers responsible for request handling and delegation, domain responsible for business decisions and orchestration, and infra repositories/adapters responsible for persistence and external I/O. Preserve each flow's existing call chain; do not bypass an owning layer merely because an import is permitted.
- Keep raw SQL, Prisma/database operations, Redis commands, KV/R2 operations, and external network calls in infra. DI may construct and wire clients under the existing composition exceptions; do not use that allowance to move business or persistence workflows into DI. Entry forwarding and infrastructure construction allowances do not authorize entry-layer storage operations.
- Keep middleware, utils, const, and decorators within their existing leaf/support responsibilities and allowed dependencies; do not use them as alternate persistence or network layers.
- Expose domain-facing repository operations rather than raw drivers. Aliases, re-exports, accessor-returned clients, destructuring, bracket access, `any`, or casts do not make prohibited capability use acceptable.

## Necessary complexity and user agreement

- Evaluate the necessity of all added design and implementation complexity, not only tests, race conditions, or security edge cases. Prefer the simplest sufficient solution within the existing architecture; fewer lines do not justify moving responsibilities or dropping required correctness.
- Before adding complexity whose necessity is not established by the approved requirement, explain the concrete requirement or failure it addresses, evidence of need and realistic likelihood or frequency where relevant, the simplest sufficient alternative, and the implementation, maintenance, and verification cost. Obtain the user's explicit agreement before adding it. This includes new abstraction layers, generic frameworks, configuration switches, fallback paths, retries, caching, concurrency coordination, compatibility branches, and speculative extensibility.
- Do not use hypothetical future reuse, theoretical robustness, or an extremely unlikely scenario as silent scope-expansion grounds. If agreement is unavailable, omit optional complexity; do not omit required behavior or weaken correctness or security. If the requirement cannot be met safely without a decision, explain the blocker rather than silently changing the requirement.

## Verification and review

- For API changes, run `pnpm api -- test test/script/layerArchitecture.test.ts` and resolve violations introduced by the task. Do not suppress findings, add baseline entries without reviewer agreement, or fix unrelated existing violations as part of the task.
- Run the applicable checks and record running-environment evidence under `docs/DEFINITION-OF-DONE.md`. Add or update tests for affected behavior without replacing existing tests.
- In the local review required by `REVIEW.md`, explicitly check naming, placement, layer responsibilities, call-chain changes, unrelated edits, and whether each added mechanism is necessary. Include this context in any review handoff. Passing architecture tests does not prove correct business responsibility, scope discipline, or necessary complexity; those still require review.

## Backend change commands

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
