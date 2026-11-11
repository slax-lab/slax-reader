# Proposal

## Why

Immediately re-enabling mark visibility on a newly saved bookmark can fail with a `(bookmark_id, user_id)` unique constraint violation. The service chooses INSERT after an existence read, although the database already contains the row; delayed success is consistent with a stale Hyperdrive read, but the deployed cache configuration has not been verified.

## What Changes

- Save share settings with one parameterized PostgreSQL `INSERT ... ON CONFLICT (bookmark_id, user_id) DO UPDATE ... RETURNING` through the existing Prisma client.
- Remove the service's share-existence read and separate create/update branches.
- Preserve ownership and moderation checks, response fields, existing share identity and codes, and the current settings mapping.
- Add regression coverage and exercise immediate off/on saves against real local Workers and PostgreSQL.

## Capabilities

### New Capabilities

- `bookmark-share-settings`: Reliable owner updates to per-bookmark share settings without an existence-read-dependent insert decision.

### Modified Capabilities

None.

## Impact

- API only: `apps/api/src/domain/share.ts`, `apps/api/src/infra/repository/dbBookmark.ts`, associated tests and generated DI artifacts if regeneration changes them.
- No schema, dependency, request/response contract or visitor-permission changes.
- Hyperdrive configuration, frontend toggle presentation and duplicate failure toasts are outside this change.
- Cross-app version applicability must be checked before implementation handoff under `docs/release/VERSIONING.md`.

## Review

The native SQL approach was discussed in chat and selected for a trial on 2026-11-11. The user approved this proposal and requested implementation and a pull request on 2026-11-11.
