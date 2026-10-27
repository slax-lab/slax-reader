# Proposal

## Why

Concurrent indexing tasks for the same bookmark can fail with a `bookmark_id` unique constraint violation. The current Prisma relation mode turns the shard mapping upsert into a read followed by an insert, leaving a race when the mapping does not exist yet.

## What Changes

- Write the vector shard mapping with one parameterized PostgreSQL `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` statement.
- Keep the first assigned bucket and row identity on subsequent writes, refresh `created_at` as before, and return the stored mapping to the indexing caller.
- Cover first creation, repeated updates, competing bucket proposals, and database failures with repository regression tests; validate concurrent writers against isolated PostgreSQL.

## Capabilities

### New Capabilities

- `bookmark-vector-indexing`: Atomic allocation and stable reuse of a bookmark's vector index shard mapping.

### Modified Capabilities

None.

## Impact

- Changes `BookmarkRepo.upsertVectorShard` in `apps/api/src/infra/repository/dbBookmark.ts` and adds backend tests.
- No schema migration, new dependency, API contract, application package version, or global Prisma relationship-mode change.
- Workflow deduplication, vector deletion/insertion ordering, automatic indexing retries, and alert formatting are outside this SQL fix.
