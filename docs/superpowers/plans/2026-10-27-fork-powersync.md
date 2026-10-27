# Fork PowerSync Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans with test-driven-development. The owner approved implementation in conversation on 2026-10-27.

**Goal:** Submit Reader saves through the same local insertion and PowerSync upload path as ordinary URL saves.

**Architecture:** Keep the existing connector and `/sync/changes` contract. Process ordinary operation runs through their existing transaction, and Reader creates in queue order through the existing Fork admission service, after committing preceding operations. Preserve the existing failed Reader placeholder for explicit source rejection and prior failed deliveries. Dispatch existing copy Workflows; keep their R2 implementation intact.

**Tech Stack:** Nuxt/Vue, PowerSync, TypeScript, Prisma/PostgreSQL, Cloudflare Workflows/R2.

**Spec:** `openspec/changes/add-bookmark-fork/` (approved PowerSync follow-up; original feature is merged, archival is deferred until this follow-up).

## Global Constraints

- Reuse ordinary save semantics; do not repair its existing UUID/replay/account-switch limitations in this task.
- No schema, bucket, local schema, provenance projection, R2 layout, maintenance job or version-counter changes.
- Fork must be initiated online. Its local insertion may be uploaded after connectivity recovers.
- Preserve HTTP admission for other clients and Web without local-first support.
- Keep source authorization, acquisition gates, destination ownership and existing Workflow retry behavior.
- No UI redesign; the existing button acknowledges local insertion without waiting for server admission or copying.

## Review Focus

- A mixed batch must preserve operation order around a Reader create.
- Source rejection must leave a removable failed save and allow unrelated changes to proceed.
- Lost upload responses must reuse the resource and preserve existing UUID/personal state, under ordinary-save replay semantics.
- Unknown dispatch must retain the write claim; synchronizing a committed save must not reset it into ordinary crawling.
- Slow upload must not hold the Fork button, and a premature detail refresh must not clear its local acknowledgement.

## Task 1: Server admission through the existing sync endpoint

**Files:** `apps/api/src/domain/orchestrator/sync.ts`, `apps/api/src/domain/bookmarkFork.ts`, `apps/api/src/infra/repository/dbSyncBatch.ts`; their unit/integration tests.

**Interfaces:** `BookmarkForkService.admit(ctx, sourceUuid, clientUuid?)` retains its existing result and uses a supplied UUID only for new relations. `DBSyncBatchOperation.hasPersistedReaderSave(operation)` checks the submitted UUID against the existing relation and private resource owner. Sync continues returning `{ status: true }`.

- [x] Add failing regressions for routing/order, known rejection, transient database failure, busy destination, uncertain dispatch and supplied UUID.
- [x] Run the focused API tests and record the expected failures.
- [x] Route Reader creates through existing admission; keep contiguous ordinary operations in existing transactions and do not wait for R2 copying.
- [x] Keep existing failed Reader records stable on replay; use the existing failure writer for denied sources.
- [x] Run focused tests and real PostgreSQL scenarios for client UUID, repeated saves and dependent edits.

## Task 2: Local-first Fork submission

**Files:** `apps/web/app/composables/bookmark/useBookmarkFork.ts`, `apps/web/app/components/Snapshot/SnapshotForkButton.vue`; Fork and Add URL component tests.

**Interfaces:** Reuse `useLocalBookmarks.createBookmark/getSaveState` and `bookmarkSaveGuardFor`. The local hook result may mark local acceptance with `queued: true`; it is not a database, sync or HTTP field. Existing component `accepted` remains server-acceptance-only so the page does not prematurely refresh.

- [x] Add failing tests for local-only submission, duplicate prevention, insertion failure/retry, source/account changes, and Reader URL modal closure.
- [x] Run focused Web tests and record the expected failures.
- [x] Add the local-first path to the shared Fork hook; keep the HTTP fallback and online/login checks.
- [x] Stop loading after local insertion; preserve current button states and suppress premature detail refresh.
- [x] Run Web unit tests, typecheck and a running UI smoke.

## Task 3: Validation, review and handoff

**Files:** Existing Fork OpenSpec proposal/design/spec/tasks/validation and `docs/api/bookmark-fork-fixed-paths.md`; a Chinese handoff report outside the repository.

- [x] Record the approved narrower scope and replace superseded queued-client requirements.
- [x] Exercise real `/sync/changes`, Workflow, PostgreSQL and R2 through the existing HTTP smoke harness.
- [x] Run API/Web suites, typechecks, generation, builds and strict OpenSpec validation.
- [x] Review Bugs, Security and Compliance with a fresh reviewer; fix introduced Important findings only.
- [x] Record human UI acceptance before opening the new Draft PR; original performance PR #396 is already merged.
- [ ] Update the report and PR with actual evidence and accepted inherited limitations.
- [ ] After the implementation PR merges, classify unfinished tasks and archive this change through the required documentation PR.
