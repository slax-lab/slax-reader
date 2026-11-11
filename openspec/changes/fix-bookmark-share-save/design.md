# Design

## Context

See `proposal.md` for the observed failure. `ShareService.updateBookmarkShare` reads a share, then chooses two repository methods. Both methods have no other production callers. The current PostgreSQL schema already has `@@unique([bookmark_id, user_id])`.

The installed Prisma 7.2.0 generated client emitted SELECT/INSERT rather than native upsert for the tested compound-key `.upsert()` call; concurrent first saves reproduced P2002. The user selected a native SQL trial after comparing this with a multi-statement Prisma transaction.

## Goals / Non-Goals

**Goals:** Eliminate the existence-read decision with one database-native save and return the written state directly.

**Non-Goals:** Do not change cloud cache configuration, UI error presentation, visitor annotation rights, schema or unrelated repository writes.

## Decisions

### One parameterized repository save

Replace the two production write methods with one `saveBookmarkShare` method using `this.prismaPg().$queryRaw` tagged-template parameters. Insert all current settings, target `(bookmark_id, user_id)` on conflict, update only the visibility/profile/action settings and `is_enable`, and return the saved fields needed by the existing response. Preserve UUID, ID, creation time and share code on conflict. Do not interpolate SQL text or issue a follow-up SELECT.

This reuses the repository's existing raw-query conventions and its PostgreSQL client's connection lifecycle. A plain Prisma `.upsert()` does not provide the required native operation in the tested configuration; a multi-statement Prisma transaction is a viable but larger alternative.

### Keep admission in the service

Keep UID/legacy-ID resolution, ownership and moderation checks. Remove the share-existence read, nested create/update functions and ineffective creation loop. Generate an insertion candidate code for legacy-ID requests, while UID requests pass an empty code. The conflict update never replaces an existing code, even when the candidate differs. Return the written row's settings using the current response mapping.

Unexpected database errors propagate through the existing API error boundary; they must not all be relabeled as duplicate-share errors. No retries or new locking mechanism are needed for the reproduced failure.

## Risks / Trade-offs

- Legacy updates generate an unused insertion candidate code when the record already exists; the SQL preserves the original code and avoids an existence read.
- Share triggers also update metadata and visibility statistics. Verify the native statement against the actual migrated local database, including an article with comments and a false-to-true visibility transition.
- Read-only endpoints may still return cached settings. This fix removes stale existence reads from saving; it does not establish that deployed Hyperdrive caching is enabled or solve all cached reads.
- Local HTTP evidence cannot establish the cloud cache configuration. Record local results and any remaining cloud verification gap separately.

## Migration Plan

No database migration or dependency upgrade. Deliver as one task branch from `origin/dev` targeting `dev` after proposal review. Regenerate backend artifacts with `pnpm api -- gen:all`, inspect drift and run relevant checks. Deployment remains a separate action. Rollback reverts the API change without a schema rollback.
