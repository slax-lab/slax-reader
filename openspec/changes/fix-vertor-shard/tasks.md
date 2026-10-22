# Tasks

## 1. Atomic mapping write

- [x] 1.1 Replace the Prisma shard upsert with one parameterized PostgreSQL conflict-handling statement; verify repository tests cover creation, stable mapping updates, competing bucket proposals, and propagated errors.

## 2. Validation and review

- [x] 2.1 Validate concurrent first allocations over separate connections to isolated PostgreSQL and record that all callers return one persisted mapping without bookmark uniqueness failures.
- [x] 2.2 Run `pnpm api -- gen:all`, the focused backend tests, backend typecheck, formatting checks, and `openspec validate --all --strict`; review generated diffs and record the results.
- [x] 2.3 Complete the Bugs, Security, and Compliance pre-push review from `REVIEW.md`, resolve Important findings, and record the review and application-version impact assessment.
