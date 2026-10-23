# Design

## Context

See `proposal.md` for the observed failure. `semanticNormalize` uses the mapping returned by `BookmarkRepo.upsertVectorShard` to delete and insert vectors. PostgreSQL already enforces a unique index on `bookmark_id`; the method currently preserves `bucket_idx` and refreshes `created_at` when a mapping exists. Prisma 7.2.0 with the configured `relationMode = "prisma"` emits separate SELECT and INSERT statements for this call.

## Goals / Non-Goals

**Goals:** Make mapping allocation atomic under concurrent writers while retaining the caller's mapping shape and existing update behavior.

**Non-Goals:** Serialize the whole indexing operation or change workflow dispatch, vector mutations, retry behavior, alert formatting, database schema, or global relation mode.

## Decisions

- Use a tagged, parameterized `$queryRaw` INSERT with `ON CONFLICT (bookmark_id) DO UPDATE SET created_at = EXCLUDED.created_at` and return all four mapping fields. PostgreSQL resolves competition on the existing unique index in one statement, and returning the persisted bucket prevents callers from using their losing random proposal.
- Preserve the application-provided timestamp behavior. Do not update the persisted bucket or row ID on conflict.
- Keep database errors visible. Retrying Prisma P2002 errors would retain the read/insert race and add round trips; changing global relation mode would alter unrelated relationship handling.
- Execute the repository's tagged SQL against PGlite for portable regression coverage. Additionally validate simultaneous writers using separate connections to a temporary PostgreSQL instance; PGlite serializes submitted queries and does not by itself prove multi-session behavior.

## Risks / Trade-offs

- Concurrent writes to the same bookmark can wait on a row lock; the statement is short and performs no network work while holding that lock.
- Atomic mapping allocation does not serialize later vector deletion and insertion. That existing behavior is outside this focused repair.

## Migration Plan

Ship through the normal API deployment path after review. No database migration or configuration change is required. Reverting the method restores the old implementation without changing stored rows.
