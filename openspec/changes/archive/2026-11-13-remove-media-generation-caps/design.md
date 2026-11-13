# Design

## Context

See proposal.md. Limits currently exist in the four-hour automatic eligibility gate, plan construction, preflight gates, per-call reservations, service daily counters, and repository retry predicates. Removing only constants would leave old failures unrecoverable.

## Goals / Non-Goals

Delete the business admission policy throughout both pipelines. Keep bounded request sizing, request/chunk deadlines, ASR polling deadline, finite retries and repair calls, concurrency limits, leases, ownership checks, moderation, and complete-output validation. Do not add providers, switches, replacement high caps, automatic historical reprocessing, or a schema migration.

## Decisions

- Remove cap constants and branches rather than setting them to Infinity. Keep estimated and actual usage bookkeeping; remove reservation waiting that existed only to enforce money ceilings. Serialize cost updates where the existing accounting path requires it and propagate accounting failures.
- Remove daily start counters and spend checks from start/status/retry paths. Keep daily cost recording for observability and leave unrelated Redis declarations alone.
- Remove obsolete budget/length terminal classifications from shared article recovery. Podcast transcript recovery continues to block unsupported language, no audio/speech, and moderation. Owners can explicitly retry skipped recoverable records through existing endpoints. Preserve accumulated costs and ASR job identifiers.
- Preserve API field shapes and UI. Existing retry/generate controls derive availability from backend eligibility; no client version or presentation change is needed.
- Test above former limits as well as failures, accounting, request deadlines, locks, moderation, and owner-only recovery. Exercise the actual runners in a local running harness and distinguish provider stubs from real paid model execution in validation evidence.

## Risks / Trade-offs

- More accepted work can incur higher spend and queue delays; requested by the owner. Usage tracking and concurrency limits remain available for diagnosis.
- External provider and Cloudflare platform limits still exist; removing application business caps does not guarantee arbitrarily large media can complete.
- Old rejected records remain idle until explicitly requested. No production database updates are part of this PR.

## Migration Plan

No migration or new environment variable. Human reviews and merges the PR, then uses normal deployment. Reverting the code restores prior admission policy; recorded costs are retained throughout.
