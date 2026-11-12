# Design

## Context

See proposal.md. The per-owner Durable Object serializes changes. Its earlier SQLite layouts stored Float64 sums, per-article tokens and, in the first merged version of this change, a full contribution vector per article. Source preparation and Collection publication impose stronger completeness than callers require. The approved change fixes these paths together without adding a coordination platform.

## Goals / Non-Goals

**Goals:** preserve exact available-input sums and identity boundaries; make normal updates independent of unavailable old vectors or optional source objects; propagate repairs; preserve honest asynchronous outcomes.

**Non-Goals:** new bindings or databases, PostgreSQL vector tables, persistent Durable Object state, copies of article vectors, arbitrary provider-error swallowing, source refetch/OCR, automatic production deployment, subscriber materialization, or algorithm replacement.

## Decisions

1. Persist state in the existing API D1 database `DB`: `slax_vector_preference_state` (one row per user: seq, mean version, raw/centered/shared/inherited Float64 sums of about 8 KiB each, counts, clusters) and `slax_vector_preference_entry` (one row per user article: weight, share group, 8-byte vector token, publication time; index on user, share group and publication time). No article vector is copied; the vectors stay only in Vectorize. Storage is about 32 KiB per user plus tens of bytes per article. Each commit is one `db.batch()` (state row plus changed entries), which D1 runs as one transaction; the Durable Object queue guarantees one writer per user, so no conditional write is needed. Bootstrap pages at most 100 article rows and writes the state row last, so an interrupted bootstrap is never usable.
   Ordinary apply reads only the changed entries, their current rows and current vectors. The article write path already reads the stored vector before replacing or deleting it; content refresh, relation deletion and the explicit repair route hand that vector over (the repair route through `acceptedPrevious` on the Workflow event). Apply subtracts the stored contribution by matching its token against the current or handed-over vector. If neither matches (a vector replaced by a path that did not hand it over), the owner is rebuilt once rather than subtracting a guess.
   The Durable Object no longer persists anything. On its first maintenance after deployment, if its storage still holds v2 or v3 tables, it reads sums, counts and tokens, writes them to D1 without enumerating articles, then calls `deleteAll()`. v2 entries lack publication time; it is read for current Collection members in pages of 1,000 IDs. The unusable first layout rebuilds once. If D1 already holds the user's state, stale object tables are ignored and erased.
2. Interest clusters are recomputed with the existing Ward algorithm on rebuild and on explicit user refresh, from `listRecentUserActions` (90 days, 2,000 actions) and a batched by-ID read of those articles' vectors. Ordinary events carry the stored clusters and drop a cluster whose medoid stopped contributing. This keeps per-article action history and vectors out of storage. Clusters currently have no production reader.
3. Derive Collection publication time from the indexed owner-entry timestamp, not an aggregate SQL join on each publish. Publish available shared/inherited contributions with numeric coverage. Delete obsolete user/Collection projections when used=0; never invent zero vectors. Invalid per-record vectors count as unusable, but identity mismatch, database/network/authentication failure stays an operational error.
4. Relation-only events carry an optional existing-event mode and go directly to owner apply; deletion also cleans the article identity. Content events retain source preparation and embedding. HTTP article repair schedules the same idempotent Workflow after an accepted write, so eventual visibility and owner propagation do not depend on a separate full rebuild.
5. Prepare text and image sources independently. A missing original does not block stored text; missing Markdown uses the existing stored HTML text conversion, when available, without origin fetching. Record image availability/version in reuse fingerprints so an explicit repair notices newly available images. Non-PDF sources keep source fields/coverage honest; existing PDF byte policy and ownership boundaries remain.
6. Recognize only confirmed provider image content rejections (decode, aspect ratio, raw-byte/pixel limits) as optional-image skips; retain auth, rate-limit, transport and server errors. Isolate deterministic text rejection within a batch by bounded subdivision so valid siblings complete. Preserve empty-content failure when every substantive input is unusable.
7. Accept cleanup mutations without subsecond read-after-write demands. Record all deterministic removed IDs and verify their absence in the Workflow's visibility step. Shrinks exclude removed IDs still present in the new target set; retries remain idempotent.

## Risks / Trade-offs

- Exact subtraction depends on the caller handing over the replaced vector; a path that replaces a vector without doing so causes one owner rebuild, which is correct but costs one bounded history pass.
- D1 is single-threaded per database and shares `DB` with business tables. Each event writes one batch of a few rows; bulk sync should keep its existing sequential pacing.
- Clusters are no longer refreshed by ordinary events; they change on explicit refresh or rebuild.
- Partial Collection representations omit unavailable members: report coverage and apply the exact missing contribution when its article becomes available.
- Optional provider failures can hide bugs if classified broadly: use explicit image-specific categories; unrelated errors remain failures and tests assert that boundary.
- Stored HTML extraction is limited by the existing parser and does not recreate missing originals; document true no-content outcomes instead of fabricating success.

## Migration Plan

No production action is part of implementation. Deployment applies migration 00066 through the existing `migration:remote:d1` step before Workers deploy. Each owner's object state moves to D1 lazily on its next maintenance and the object storage is erased; owners with no object state bootstrap once. Do not delete business data or native article indexes. A rollback to the Durable Object layout would find no object state and rebuild each owner once; the D1 tables can then be dropped. Existing accepted Workflows remain readable through optional event fields. Validate with the actual owner runtime, fixture-driven source-to-profile flows, and standard generation/typecheck/test/build commands before handoff.
