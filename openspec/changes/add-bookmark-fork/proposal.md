# Proposal

## Why

Readers need to save another user's Reader snapshot as their own durable copy, including from a phone without the Extension. Current capture rows are already private per user, but there is no Fork operation and shared media generation can still replace multiple users' saved bodies.

## What Changes

- Add online Fork creation through a public reader button and Reader `/b/<uuid>` URL submissions, backed by one authorized copy operation. Ordinary URL collection keeps its existing local-first workflow; successful Forks synchronize through PowerSync.
- Support ordinary articles, URL shortcuts, downloaded/uploaded PDFs, YouTube and podcasts in the first release. Copy the ready saved presentation and available supplementary content; external images, video and audio retain their existing playback/resource behavior.
- Store direct provenance in one nullable `sr_user_bookmark.forked_from_id` integer column referencing the source user-bookmark identity. Keep independently owned content after source deletion and render safe, permission-aware Fork attribution alongside Source.
- Preserve one personal copy per original resource. Return an existing successful copy unchanged, restore a ready trashed copy, and distinguish pending, failed and deletion-in-progress destinations.
- Make new private media captures and Forks own their stored content revisions. Shared generation remains a computation cache; later actions by another user cannot replace a completed private snapshot. Explicit owner refresh remains supported for ordinary captures.
- Cover Extension/REST, Web, Telegram and supported bookmark imports. Give older queued Reader-URL sync operations a terminal visible failure without crawling the Reader shell or blocking unrelated sync work.

## Capabilities

### New Capabilities

- `bookmark-fork`: Authorized online copying, supported entry points, stable direct provenance, duplicate/lifecycle behavior, mobile Web action and attribution.
- `private-bookmark-snapshots`: Independent ownership and coherent publication of new saved content across article, PDF and media formats, including storage failure recovery and shared-media isolation.

### Modified Capabilities

- `youtube-ai-article`: Preserve shared computation and legacy behavior while freezing completed new captures/Forks, limiting owner catch-up to the pinned pending request, and applying takedown to private content.
- `podcast-article`: Freeze new capture/Fork bodies and translations against saved episode inputs; preserve moderation, costs and legacy publication.

## Impact

- API: new Fork and uncached Fork-metadata endpoints; existing add adapters; bookmark/media orchestration, R2 publication/cleanup, sync compatibility, search and notification effects.
- PostgreSQL: one additive nullable column, no provenance table, JSON provenance or mandatory historical backfill. Existing media references remain for moderation/takedown and retention.
- Web/contracts: online command, typed responses, Source/Fork display, media snapshot version handling, SSR cache safety and Reader URL saved-state resolution. Extension integration requires release-impact assessment.
- Delivery: additive migration first, API and client rollout, agent-driven runtime verification and human UI acceptance. No new external service or package is proposed.

## Non-goals

Offline Fork submission, multiple saved versions of the same resource, bulk conversion of historical public/shared-media records, copying other users' personal state, media-file downloading, provenance-preserving export/import, and changes to default sharing visibility.

The user selected all formats and online-only creation on 2026-10-22. Detailed design and acceptance scenarios are submitted for review before implementation.

## Settled media dependency

The previously merged media implementations (PR #219) are archived by the separate `docs/archive-media-specs` dependency, reconciled with current `dev` at commit `1041a594`. This change now owns scoped modifications to the living `youtube-ai-article` and `podcast-article` capabilities. The modifications express the already-approved private capture and Fork isolation policy while preserving legacy unmanaged behavior, budgets, acquisition gates and moderation. Historical unchecked acceptance tasks remain unchanged in the archives.
