# Tasks

## 1. Database

- [x] Add `owner_deleted Boolean @default(false)` to the `sr_user_collection` model in `apps/api/prisma/pgsql.prisma`.
- [x] Create the PostgreSQL migration with the column, backfill, fill trigger, and owner-state propagation trigger.
- [x] Apply the migration locally and regenerate Prisma and runtime types.

## 2. Sync rules

- [x] Rewrite `subscribed_collections` to use anchored owner subqueries with `collection.status = 1` and `collection.owner_deleted = false`.
- [x] Rewrite `collection_bookmark_comment` to use one anchored subquery for the collection status and owner state.
- [x] Rewrite `rss_v1` to use subqueries anchored on `current_user_id` while preserving the RSS Labs gate.

## 3. Tests

- [x] Update `apps/api/test/infra/powersyncRules.test.ts` for the anchored rules and add regression assertions against global joins.
- [x] Add a PostgreSQL integration test for the `owner_deleted` fill and propagation triggers.

## 4. Verification

- [x] Run the API typecheck and unit tests.
- [x] Run the PostgreSQL trigger integration test against the local database.
- [x] Run `openspec validate --all --strict`.
- [x] Record the running-environment sync evidence in `openspec/changes/local-first-ddl/validation.md`.
- [x] Re-verify on the branch merged with current `dev`, measure per-subscription parameter cost and the out-of-order deployment behavior, and correct `design.md` and `validation.md`.

## 5. Archive

- [ ] After this pull request merges, archive `local-first-ddl` through a docs pull request.
