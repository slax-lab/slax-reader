## MODIFIED Requirements

### Requirement: PDF downloads extend the foreground cache queue

The application SHALL use the existing foreground download queue for automatic PDF caching under the same eligibility, cache-window and retention policy as ordinary articles, with prioritized reader range requests. Following the user's performance-change instruction, no standalone PDF offline-download button SHALL be exposed or required. Requested blocks SHALL be deduplicated and validated against the immutable document version. Files and task metadata SHALL be isolated by environment, account and bookmark access context. Only a completely downloaded document whose size, final range/length and descriptor identity match SHALL be recorded as offline-complete; no content hash is computed on the device. The PDF Reader SHALL NOT show offline/completion badges or partial-cache rows; state remains internal. No OS background transfer service SHALL be introduced.

#### Scenario: Reading overlaps prefetch
- **WHEN** PDF.js requests bytes already cached or scheduled by prefetch
- **THEN** the queue reuses valid blocks or joins/promotes existing work instead of independently downloading the same block

#### Scenario: Download is interrupted
- **WHEN** connectivity is lost, the application backgrounds or restarts
- **THEN** valid completed blocks survive and missing ranges resume on foreground
- **AND** a partial file is not reported as a complete offline download

#### Scenario: Account changes during download
- **WHEN** an account or environment is replaced while a PDF request is pending
- **THEN** old tasks and resource handles are revoked and late responses cannot write or display in the new scope

### Requirement: PDF metadata and bytes have native-client contracts

Mobile SHALL consume the existing authenticated `/v1/bookmark/metadata` response's nested `data.pdf` descriptor and existing `/v1/bookmark/pdf` binary delivery without introducing a backend route or changing server range behavior. The client SHALL treat the descriptor document identity as an opaque version string and SHALL validate descriptor size, response media type, Content-Range and actual length, and handle binary successes and HTTP errors without decoding PDF as HTML/JSON. A missing ETag on valid 200/206 delivery SHALL NOT cause rejection; any supplied ETag is an optional additional consistency check, not a mandatory server capability. Only a full file whose bytes were delivered for one unchanged descriptor identity and whose size matches SHALL be marked offline-complete. The client SHALL NOT compute SHA-256 or another content hash of PDF bytes.

#### Scenario: A resumed document has a different identity
- **WHEN** the authorized metadata identity, size or a supplied ETag changes, or the completed byte count differs from the descriptor size
- **THEN** incompatible partial bytes are invalidated rather than combined or labelled complete

#### Scenario: Existing range delivery omits ETag
- **WHEN** the existing backend returns valid PDF 206 bytes matching the requested range and descriptor total size without ETag
- **THEN** the mobile client accepts the range without requiring a new endpoint, conditional-response feature or deployment
- **AND** offline completion relies on size, range/length and unchanged descriptor identity; it is not represented as cryptographic verification
