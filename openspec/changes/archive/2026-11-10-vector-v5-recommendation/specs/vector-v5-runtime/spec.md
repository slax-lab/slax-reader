## Purpose

Maintain user-private article vectors and reusable current-state vector processing through three fixed indexes, without adding a second persistence or coordination platform.

## ADDED Requirements

### Requirement: Article vectors are isolated by user and bookmark

An article vector SHALL belong to the pair `(userId, bookmarkId)`. Its representative ID SHALL be `a:<userId>:<bookmarkId>` and chunk IDs SHALL be `a:<userId>:<bookmarkId>:c:<n>` in the article default namespace. The system MUST NOT use a globally shared article vector, ownership arrays, reference counts or per-user namespaces. This vector separation MUST NOT require changes to existing business relationships or copies of original R2 content.

#### Scenario: Two users save the same underlying bookmark
- **WHEN** A and B have eligible relations to the same bookmark
- **THEN** refresh writes independent representatives and chunks for A and B
- **AND** neither URL nor global bookmark ID deduplicates those identities

#### Scenario: One user's save is removed
- **WHEN** A deletes a save that B also owns
- **THEN** cleanup removes only A's representative and chunks and B's vectors and original content remain intact

### Requirement: Article metadata and native owner filtering are mandatory

Article representatives and chunks SHALL retain numeric `user_id`, string `kind`, numeric `bookmark_id` and numeric `published_at`; representatives SHALL retain numeric `part_count` for chunk cleanup. Article/chunk writes MUST NOT emit `recommendable` or derive public-article admission from Collection membership. An existing article `recommendable` metadata index may remain physically present but SHALL be unused; this correction MUST NOT run production metadata/index cleanup. Collection `recommendable` visibility and filtering SHALL remain unchanged. Private vector queries SHALL retain a native numeric `user_id` equality filter before top-K. The approved unified search below SHALL derive that identity from authentication and revalidate current ownership. Its first contract has no tag filter; existing all-tags guarantees remain unchanged on /v1/bookmark/search. Native vector methods alone do not prove acceptance of the new HTTP/SSE interface. Return-only cleanup metadata MUST NOT require a metadata index without an actual filter use.

#### Scenario: Another user's vector is the closest match
- **WHEN** a personal query is executed for A and B has a higher-scoring private vector
- **THEN** the native query is constrained to A and B's record cannot contribute a private result

#### Scenario: Many chunks are replaced
- **WHEN** an article is shortened or deleted after more than ten chunks were written
- **THEN** cleanup uses its actual recorded chunk count and stable private IDs rather than a guessed fixed range

### Requirement: Fixed bindings preserve existing Worker ownership

The new runtime SHALL use exactly the article, user and Collection Vectorize bindings plus one native maintenance Workflow. AI SHALL own the native Vectorize bindings, with Core and Edge using existing VECTOR RPC. Normal development SHALL use ordinary native configuration and retain remote Vectorize access on local AI; it MUST NOT require an overlay flag, recipe/shard registry, enable switch, account guessing or implicit fallback. Missing configuration SHALL fail explicitly.

#### Scenario: Normal development starts
- **WHEN** the operator runs the existing development command with explicitly configured bindings
- **THEN** the three indexes are reachable through AI without an additional vector-specific flag

#### Scenario: Required binding is absent
- **WHEN** maintenance or deployment lacks a required binding
- **THEN** it reports a configuration error instead of silently selecting another index or marking work complete

### Requirement: Processing reuses complete committed content and truthful outcomes

One maintenance implementation SHALL serve live and bulk work from current committed business state and existing committed content, using the established application resource lifecycle rather than a separate connection graph. Fitting complete text SHALL remain whole; text model/request overflow SHALL cause bounded lossless subdivision rather than arbitrary transfer-page chunks or truncation. Required substantive image/text processing SHALL retain truthful coverage; PDF processing SHALL follow the human-approved size policy of 2026-11-04 below. Missing credentials, invalid embeddings, provider failures and failed mutations MUST NOT become successful empty results. Responses SHALL preserve written, deleted, empty and failed targets. Written SHALL mean native mutation accepted, not ready, fully searchable or globally query-visible. Live and bulk work MUST NOT invent readiness fields or rely on an operator receipt-verification/recovery state machine.

The system SHALL use original PDF byte size from existing source-size metadata to select the path before any original-body read. An original PDF of `<= 8_000_000` bytes SHALL be sent directly to Jina as one PDF input in one request. An original PDF of `> 8_000_000` bytes SHALL instead reuse text already extracted by the preceding pipeline through the existing text-embedding path, without fetching or reading the large original body for vector maintenance. The existing 50 MiB source-upload limit and acceptance SHALL remain unchanged; accepted PDFs above the direct-PDF threshold SHALL use this text fallback. The system MUST NOT split PDF pages, create temporary R2 objects/files, re-OCR, introduce a new parser or lower that upload limit to satisfy vector processing.

Missing or empty preceding-pipeline text for a larger PDF SHALL produce explicit incomplete coverage or failure, never successful empty output. The approved large-PDF text representation MUST NOT claim full visual modalities. This size policy supersedes prior planned full-visual 50 MiB and PDF page-splitting requirements, while existing privacy, identity, cleanup, publication and human release gates remain binding.

#### Scenario: Native mutation is accepted
- **WHEN** a write returns native acceptance before index convergence
- **THEN** its result remains written and does not certify query visibility or require receipt polling by the operator

#### Scenario: Fitting text crosses an I/O page
- **WHEN** a complete article fits model and request budgets but spans multiple storage reads
- **THEN** it remains one complete model input, independent of the transfer page size

#### Scenario: PDF is at or below the direct threshold
- **WHEN** the original PDF size is at most `8_000_000` bytes, including exactly `8_000_000` bytes
- **THEN** the original is sent directly to Jina once as one PDF input without page splitting or temporary objects/files

#### Scenario: PDF input needs no local page-count parser
- **WHEN** an original PDF is within the direct-upload byte threshold
- **THEN** vector maintenance base64-encodes and submits the unchanged bytes without loading a local PDF parser or predicting page count
- **AND** `pdf-lib` is absent from runtime and test imports and the API dependency declarations

#### Scenario: Provider PDF embeddings determine stored part count
- **WHEN** the PDF provider returns a nonempty vector array with the expected model and valid embeddings
- **THEN** indices must uniquely cover the contiguous range from zero through the returned count minus one, and storage uses that validated count
- **AND** an empty array, invalid model/vector, duplicate/gapped index, interrupted body or malformed JSON fails explicitly, without a fixed-page-count rejection or a new parser dependency

#### Scenario: Larger accepted PDF uses existing extracted text
- **WHEN** an accepted original PDF exceeds `8_000_000` bytes, including `8_000_001` bytes and up to the unchanged 50 MiB source-upload limit
- **THEN** vector maintenance uses the preceding pipeline's already extracted text through existing text embeddings without fetching or reading that original body
- **AND** it introduces no PDF page splitting, temporary R2 objects/files, re-OCR or new parser and makes no full-visual-coverage claim

#### Scenario: Larger PDF has no usable extracted text
- **WHEN** an original PDF exceeds `8_000_000` bytes and preceding-pipeline text is missing or empty
- **THEN** the target reports explicit incomplete coverage or failure, never successful empty output
- **AND** vector maintenance does not fetch or read the original body, split pages or re-OCR as a fallback

#### Scenario: Required modality or provider fails
- **WHEN** a required image stage, size-selected PDF/text stage or vector mutation fails
- **THEN** the target reports failure or explicit incomplete coverage rather than successful empty output
- **AND** an approved large-PDF text-only result never claims full visual modalities

### Requirement: Current-state maintenance adds no coordination platform

Live hooks and the native Workflow SHALL refresh minimal targets using current authoritative state. Replays SHALL replace deterministic IDs rather than accumulate duplicate contributions. This change MUST NOT add PostgreSQL tables, fields, migrations or triggers, database vector sums, run/item stores, queues, DO locks, leases or compatibility adapters for the discarded draft. Failed dispatch SHALL remain visible and repairable through explicit refresh rather than an invented durable recovery guarantee.

#### Scenario: Old target is retried after deletion
- **WHEN** a previously admitted target is retried after its save or user is deleted
- **THEN** current eligibility drives cleanup and the old request does not authorize resurrection

#### Scenario: Maintenance creation fails
- **WHEN** the native Workflow cannot be created
- **THEN** the failure is reported without pretending a nonexistent ledger will recover it automatically

### Requirement: Unified search streams independent retrieval before fusion

The latest human correction authorizes one authenticated `POST /v1/search` interface with body `{keyword}` only, not three independent search endpoints. The keyword SHALL be nonempty and at most 500 Unicode code points; there SHALL be no public limit or default 20. It SHALL start independent title, fulltext and vector retrieval concurrently. It SHALL return genuine SSE partial events as each channel becomes available, without waiting for all channels, followed by exactly one complete event containing all deduplicated, fused, finally admitted candidates and per-channel outcomes, with no final result cap or result_limit_reached field. Internal per-channel 100-candidate and fulltext scan budgets SHALL remain with truthful incomplete/truncation coverage; this MUST NOT become an unbounded database dump or a false exhaustive-empty claim. Shared query embedding MAY be used by the two vector branches but MUST NOT block title or fulltext delivery. Errors SHALL remain explicit per channel; a failed channel MUST NOT suppress successful branches or masquerade as an empty success. Request cancellation SHALL stop delivery and additional paged work and preserve resource cleanup.

#### Scenario: Text results precede slow embeddings
- **WHEN** title or fulltext retrieval finishes while vector inference is still pending
- **THEN** its admitted results are delivered in a partial event before vector completion
- **AND** the final complete event replaces the provisional order rather than appending duplicates

#### Scenario: One retrieval dependency fails
- **WHEN** a provider or repository fails for one channel
- **THEN** the stream reports that channel's failure and completes with available results and an explicitly partial outcome

### Requirement: Unified search covers Collection, article and RSS units

The interface SHALL include Collection-vector search returning Collections rather than member articles; fulltext search over the user's current own saves and currently readable articles in actively followed Collections; title search over those Collection articles, published/readable Collection subjects, the user's subscribed RSS feed subjects and their RSS entry list; and owner-filtered V5 vector search over the user's own article representatives. Collection search SHALL include owned and already-followed published Collections rather than inherit recommendation exclusions. Collection vectors represent aggregate member content, not a new title embedding. RSS results SHALL preserve the existing user subscription and lab-feature access boundary; no global feed catalog or RSS body/embedding search is introduced. PDF body fulltext requires existing extracted indexed text; vector participation requires an existing valid representative.

#### Scenario: Relevant Collection has no title match
- **WHEN** its aggregate content matches the query vector and current publication/read checks pass
- **THEN** a Collection hit is returned without expanding it into member-article hits

#### Scenario: RSS or Collection title matches without body indexing
- **WHEN** an authorized Collection article, Collection subject, subscribed RSS feed or RSS entry title matches
- **THEN** title retrieval can return that unit without requiring a fulltext row or embedding

### Requirement: Every streamed result preserves current scope

Caller identity SHALL come only from authentication. Article vector recall SHALL natively filter numeric user_id and representative kind. Article fulltext/title admission SHALL verify either current ownership or a currently active, nondeleted, unexpired Collection subscription together with current Collection and member readability. Published Collection title/vector results SHALL be batch-hydrated against authoritative visibility and owner state without recommendation-only exclusions. RSS admission SHALL enforce the caller's subscription and current feature access. No unadmitted title, snippet, identifier or count SHALL be emitted in partial or complete events. Final results SHALL revalidate current admission. Bounded fulltext candidate paging across D1 and PostgreSQL SHALL not fetch entire user or subscription histories; a scan budget reached before exhaustion SHALL be exposed as incomplete coverage, not a claim of no matches.

#### Scenario: Access changes during the stream
- **WHEN** a save is deleted, a subscription is removed or a Collection becomes unreadable before final admission
- **THEN** the final complete result omits that hit even if it appeared in an earlier authorized partial result

#### Scenario: Foreign private vector is most similar
- **WHEN** another user's private article is closer to the query
- **THEN** native owner filtering and final admission prevent its identifiers or content from being returned

#### Scenario: An old save relation points at a foreign private snapshot
- **WHEN** a remaining own-save relation points to a bookmark the personal reader rejects because private_user belongs to another user
- **THEN** it contributes neither an own article hit nor an own navigation origin
- **AND** a separately authorized followed-Collection origin may remain without granting personal ownership

#### Scenario: A Collection aggregate outlives its last public member
- **WHEN** the last currently eligible public member is removed or made unreadable before vector-result admission
- **THEN** the stale aggregate contributes no collection_vector result
- **AND** the Collection subject may still match title search if its own publication/read conditions hold

### Requirement: Final fusion is deterministic and source-aware

Final fusion SHALL use unweighted Reciprocal Rank Fusion with k=60 and one-based per-channel ranks, not addition of incompatible BM25, cosine or title scores. Each entity SHALL contribute at most once per channel. Stable typed identities SHALL distinguish articles, Collections, RSS feeds and RSS entries; an article matched by both own-vector and fulltext channels SHALL appear once with authorized navigation origins preserved. Deduplication MUST NOT collapse private snapshots merely because URLs match. Results SHALL retain their type and matched channels, and ties SHALL use a stable identity ordering independent of channel completion order. Existing recommendation algorithms and user preference vectors SHALL not participate in this search.

#### Scenario: One article appears in several retrieval channels
- **WHEN** the same authorized stored article matches title, fulltext and own-vector retrieval
- **THEN** the final response contains one article with the corresponding channel evidence and the standard summed reciprocal-rank score

#### Scenario: Collection article navigation is returned
- **WHEN** a partial or complete result includes an authorized Collection article origin
- **THEN** it exposes the existing reader's encoded owner-relation cb_id and owner bookmark-user UUID together with collection_code, not an unrelated body ID or another relation's alias

#### Scenario: A matching alias loses access before completion
- **WHEN** only one readable article relation's alias matched the title query and that relation becomes unreadable before final admission
- **THEN** another surviving nonmatching relation does not preserve the revoked titles-channel contribution
- **AND** other independently valid channel matches and authorized navigation origins may remain

### Requirement: Existing search and maintenance remain unchanged

The existing `/v1/bookmark/search` encoder, legacy buckets, optional all-tags behavior and response SHALL remain unchanged. The new interface does not accept tag filters in this first contract and MUST NOT pretend to implement them by post-filtering an unrelated top-K. Search SHALL be read-only apart from existing request diagnostics: no article re-embedding, preference refresh, vector mutation, recommendation admission, feed fetching or new database schema. Controllers own HTTP validation/SSE; the existing-style Domain Orchestrator owns concurrency and fusion; Repositories own SQL and native index operations. Request resources SHALL remain available until the stream's work settles, with cleanup on success, failure and cancellation.

#### Scenario: New search serves V5 results
- **WHEN** a caller uses the new unified endpoint
- **THEN** the legacy endpoint remains on its existing serving model and no automatic cutover or backfill occurs
