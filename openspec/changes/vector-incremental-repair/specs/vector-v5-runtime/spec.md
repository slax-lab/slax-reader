## ADDED Requirements

### Requirement: Independently usable sources survive unavailable siblings

Article processing SHALL use available stored substantive text and eligible images independently. A missing original SHALL NOT block stored text; missing extracted text SHALL allow reuse of substantive text from an available stored HTML body using the existing conversion path. No external refetch, fabricated content, or new parser dependency is permitted. Missing all substantive inputs SHALL remain explicit. Existing PDF byte-path and ownership constraints remain unchanged.

#### Scenario: Stored text survives missing HTML
- **WHEN** stored text is usable but the referenced HTML object is absent
- **THEN** text is embedded without making the absent object a prerequisite

#### Scenario: HTML survives missing Markdown
- **WHEN** Markdown is absent but stored HTML has substantive text or eligible images
- **THEN** available stored content is processed without re-fetching the origin

### Requirement: Repairs invalidate incomplete source reuse

An explicit content repair SHALL observe changes to relevant stored image availability and identity even when article text and HTML are unchanged. Reuse SHALL NOT permanently conceal a newly available modality or a changed source-processing policy.

#### Scenario: Previously missing image is restored
- **WHEN** an article was embedded from text and its stored image later becomes available
- **THEN** the next content repair includes the restored eligible image instead of reusing the text-only representation unchanged

### Requirement: Record-local rejection is isolated from batch siblings

A deterministic provider input rejection SHALL isolate the offending text input within bounded subdivision, preserving successful sibling articles. Authentication, throttling, transport and provider service failures SHALL remain failures rather than silent skipped data.

#### Scenario: One text input is rejected
- **WHEN** one input in a multi-article batch has a deterministic provider rejection
- **THEN** valid sibling articles are processed and only the rejected input's article records the failure

### Requirement: Accepted cleanup uses asynchronous verification

Deletion and shrinking SHALL preserve deterministic cleanup IDs and separate mutation acceptance from native visibility. They SHALL NOT classify a normally accepted deletion as failed after a subsecond polling window. Visibility retries SHALL not repeat embedding or successful write work merely because removal is not visible yet.

#### Scenario: Chunk deletion is accepted but delayed
- **WHEN** native deletion is accepted and the old chunks remain visible initially
- **THEN** the result carries cleanup identifiers and verification waits separately until removed identifiers are absent


## MODIFIED Requirements

### Requirement: Processing reuses complete committed content and truthful outcomes

One maintenance implementation SHALL serve live and bulk work from current committed business state and existing committed content, using the established application resource lifecycle rather than a separate connection graph. Fitting complete text SHALL remain whole; text model/request overflow SHALL cause bounded lossless subdivision rather than arbitrary transfer-page chunks or truncation. Available substantive source processing SHALL retain truthful partial coverage; unavailable optional siblings and explicitly recognized image-content rejections SHALL NOT invalidate valid text or images; PDF processing SHALL follow the human-approved size policy of 2026-11-04 below. Missing credentials, operational provider failures, invalid provider outputs and failed mutations MUST NOT become successful empty results. Confirmed record-local image rejection SHALL be reported as a safe skip while usable contributions proceed. Responses SHALL preserve written, deleted, empty and failed targets. Written SHALL mean native mutation accepted, not ready, fully searchable or globally query-visible. Live and bulk work MUST NOT invent readiness fields or rely on an operator receipt-verification/recovery state machine.

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
- **WHEN** a size-selected PDF/text stage, operational image request or vector mutation fails
- **THEN** the target reports failure or explicit incomplete coverage rather than successful empty output; a recognized optional-image content rejection instead skips only that image when other substantive inputs are usable
- **AND** an approved large-PDF text-only result never claims full visual modalities

### Requirement: Current-state maintenance adds no coordination platform

Live hooks and the native Workflow SHALL refresh minimal targets using current authoritative state. Replays SHALL replace deterministic IDs rather than accumulate duplicate contributions. This change MUST NOT add PostgreSQL vector tables, fields, migrations or triggers, a new coordination platform, run/item stores, queues or leases. Preference state SHALL be stored in the existing API D1 database (`slax_vector_preference_state` and `slax_vector_preference_entry`, keyed by user) and SHALL NOT contain article vectors. The existing per-owner Durable Object SHALL only serialize one owner's maintenance and SHALL NOT persist preference state; legacy state found in its storage SHALL be moved into D1 once without reading article history and the object storage SHALL then be erased. Absent owner state SHALL bootstrap in bounded pages and become usable only after complete initialization; normal operations SHALL not rescan history. Failed dispatch SHALL remain visible and repairable through explicit refresh rather than an invented durable recovery guarantee.

#### Scenario: Old target is retried after deletion
- **WHEN** a previously admitted target is retried after its save or user is deleted
- **THEN** current eligibility drives cleanup and the old request does not authorize resurrection

#### Scenario: Legacy owner object state exists
- **WHEN** an owner's Durable Object still holds earlier preference tables
- **THEN** the sums, counts and per-article tokens are written to D1 without enumerating articles or reading article vectors, the object storage is erased, and later maintenance uses only D1

#### Scenario: Maintenance creation fails
- **WHEN** the native Workflow cannot be created
- **THEN** the failure is reported without pretending a nonexistent ledger will recover it automatically
