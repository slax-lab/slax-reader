# Design

## Context

See proposal.md. The existing owner Durable Object already serializes changes and stores Float64 aggregate sums, but per-article rows retain only a token. Source preparation and Collection publication impose stronger completeness than callers require. The approved change fixes these paths together without adding a coordination platform.

## Goals / Non-Goals

**Goals:** preserve exact available-input sums and identity boundaries; make normal updates independent of unavailable old vectors or optional source objects; propagate repairs; preserve honest asynchronous outcomes.

**Non-Goals:** new database tables outside the existing owner object, arbitrary provider-error swallowing, source refetch/OCR, automatic production deployment, subscriber materialization, or algorithm replacement.

## Decisions

1. Store the applied normalized vector and publication timestamp with each owner entry in a new local layout. Keep an index on share group and timestamp. Bootstrap old layouts once through the existing bounded enumeration, writing at most one 100-entry page at a time. The state row is absent until the final commit, so an interrupted initialization is never treated as usable. This bounds the concrete 12,394-article production-owner memory risk identified in the saved audit inventory. Normal apply reads only changed rows/entries and their current vectors, subtracts stored contributions, and never falls back to full history because an old vector is unavailable. Explicit operator rebuild remains distinct from ordinary refresh/publish.
2. Maintain a bounded recent-action ledger in the owner state. Changes update that article's actions using committed timestamps; drop expired/deleted actions, cap at the existing 2,000-action window, and run the existing clustering over only this bounded window. No full-history or recent-action SQL scan on ordinary apply.
3. Derive Collection publication time from the indexed owner-entry timestamp, not an aggregate SQL join on each publish. Publish available shared/inherited contributions with numeric coverage. Delete obsolete user/Collection projections when used=0; never invent zero vectors. Invalid per-record vectors count as unusable, but identity mismatch, database/network/authentication failure stays an operational error.
4. Relation-only events carry an optional existing-event mode and go directly to owner apply; deletion also cleans the article identity. Content events retain source preparation and embedding. HTTP article repair schedules the same idempotent Workflow after an accepted write, so eventual visibility and owner propagation do not depend on a separate full rebuild.
5. Prepare text and image sources independently. A missing original does not block stored text; missing Markdown uses the existing stored HTML text conversion, when available, without origin fetching. Record image availability/version in reuse fingerprints so an explicit repair notices newly available images. Non-PDF sources keep source fields/coverage honest; existing PDF byte policy and ownership boundaries remain.
6. Recognize only confirmed provider image content rejections (decode, aspect ratio, raw-byte/pixel limits) as optional-image skips; retain auth, rate-limit, transport and server errors. Isolate deterministic text rejection within a batch by bounded subdivision so valid siblings complete. Preserve empty-content failure when every substantive input is unusable.
7. Accept cleanup mutations without subsecond read-after-write demands. Record all deterministic removed IDs and verify their absence in the Workflow's visibility step. Shrinks exclude removed IDs still present in the new target set; retries remain idempotent.

## Risks / Trade-offs

- Applied contributions use more owner storage: use fixed-width Float64 contribution blobs per entry to preserve exact subtraction precision, retain Float64 sums, and avoid a second platform.
- Partial Collection representations omit unavailable members: report coverage and apply the exact missing contribution when its article becomes available.
- Refreshing the bounded interest window costs more than frozen clusters: retain the existing cap and algorithm; never scan full history on each action.
- Optional provider failures can hide bugs if classified broadly: use explicit image-specific categories; unrelated errors remain failures and tests assert that boundary.
- Stored HTML extraction is limited by the existing parser and does not recreate missing originals; document true no-content outcomes instead of fabricating success.

## Migration Plan

No production action is part of implementation. The owner-object layout change is lazy and rebuilds an affected legacy owner once from current rows and existing article vectors; do not delete business data or native article indexes. Keep old-layout detection so a rollback/re-upgrade never trusts stale local sums. Existing accepted Workflows remain readable through optional event fields. Validate with the actual owner runtime, fixture-driven source-to-profile flows, and standard generation/typecheck/test/build commands before handoff.
