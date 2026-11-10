# Proposal

## Why

A surviving or cached PowerSync Worker can request old SQLite dependencies that are missing from a newer deployment and receive HTML instead of executable resources. Startup then falls back to REST, but tag editing still fails because the UI treats an injected adapter as an available local writer.

## What Changes

- Preserve the current split Worker, content-hashed JavaScript/WASM dependencies, SDK versions, and Worker generation. Do not embed WASM or combine the runtime into one bundle.
- Target 7 days of historical Worker dependency retention after replacement, preserving recoverable, verified original files at their original production URLs. Active dependencies never expire merely because their build is old. Historical recovery is best effort: gaps produce warnings rather than block publication.
- Reuse the existing Pages deployment history as the source of original bytes. Before publication, merge eligible verified historical dependencies and report unavailable or invalid history in CI warnings and the release summary. Validate the new build's own complete resource set independently; current-resource defects stop publication. A small generated asset index describes only the current build's Worker dependencies; it contains no release state or credentials.
- Require revalidation for mutable Worker entry URLs and the mutable asset index, while preserving immutable caching for content-hashed dependencies.
- Restore REST add/create/remove tag operations using actual writer availability and data origin. Preserve identifiers, failed-operation state, read-only restrictions, and normal local writes.
- Preserve database identity, pending mutations, platform selection, and bounded startup recovery. Correct the misleading terminal fallback message.
- Verify successive releases, the 7-day boundary, first-rollout recovery, rollback through the retention pipeline, effective headers, and real REST tag operations.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-local-sync`: Best-effort historical dependency retention over a 7-day replacement-based window, non-blocking historical warnings, mandatory current-resource validation, mutable entry caching, and data-preserving recovery.
- `bookmark-tag-presentation`: Capability-aware editing transport and identity selection, including REST fallback and failure-state preservation.

## Impact

- Web build metadata/header generation, `tooling/web-pages-deploy.mjs`, its workflow/tests, and `docs/web/deployment.md`.
- The PowerSync plugin's terminal diagnostics, bookmark tag components, and their regression tests.
- No new storage service, cloud resource, SDK upgrade, database migration, full-runtime bundle, or logging platform.
- Complete retention depends on access to the existing Pages snapshots; inaccessible or invalid historical resources reduce compatibility coverage without blocking a healthy new build. Rollback uses the same current-resource checks and historical warning policy; switching the Pages pointer directly bypasses this preparation.
- The Extension consumes the hosted `/x/ext-bridge` runtime; retain its smoke check and required version-impact decision before implementation handoff.

## Non-goals

Indefinite support for old pages, whole-application asset retention, cold offline startup guarantees, SDK recovery redesign, general runtime failover, automatic REST replay of failed local writes, database resets, forced refresh, global missing-asset routing changes, or a tag UI redesign.

## Review and delivery

On 2026-11-02 the human requested this narrower planning revision: preserve splitting and hashes, retain old resources, correct Worker entry caching, and keep tag REST fallback. The human selected a 7-day retention period after runtime replacement, then explicitly required historical recovery failures to warn and continue, with current-build resource defects remaining blocking. On 2026-11-02 the human approved implementation of this revised scope, explicitly confirming seven-day Worker dependency retention, entry caching, and tag REST fallback, and requested a new worktree and post-implementation review.

The initial rollout can restore only historical runtimes whose original bytes remain recoverable. It cannot remotely invalidate already fresh legacy browser caches or repair an already aborted Worker. Human hands-on acceptance of implemented tag editing is required before the task PR. After the task PR merges, classify unfinished work and archive through a separate documentation PR.
