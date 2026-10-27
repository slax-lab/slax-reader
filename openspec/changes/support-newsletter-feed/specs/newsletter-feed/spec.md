## Purpose

Enable private Newsletter delivery and reading through permanent account-derived addresses, safely combined with RSS in the Web Feed.

## ADDED Requirements

### Requirement: Permanent account-derived receiving address
The system SHALL provision a Newsletter address only for an authenticated active user with Newsletter enabled and explicit deployment admission configuration. The first local part SHALL be the validated lowercase account. GET SHALL have no provisioning side effect; POST SHALL be idempotent. An issued address SHALL remain stable after account changes and SHALL never be reassigned after retirement or user deletion.

#### Scenario: Provision and rename
- **WHEN** a user provisions an address and later changes account or display name
- **THEN** GET and repeated POST return the original receiving address

#### Scenario: Missing, invalid or reserved account
- **WHEN** no address exists and the current account is missing, invalid or already reserved
- **THEN** provisioning returns an actionable error and Web allows setting a valid available account without inventing an address suffix

#### Scenario: Concurrent provisioning and deletion
- **WHEN** competing requests attempt the same prefix or a deleted user previously held it
- **THEN** at most one owner receives it and the reservation remains unavailable to others

#### Scenario: Production business address reservation
- **WHEN** a user queries or provisions daguang@slax.app, including an existing stale binding for that address
- **THEN** the operation returns address_reserved without issuing or exposing a Newsletter address, while daguang@slax.dev remains eligible and an already issued different address survives a later rename to daguang

#### Scenario: Delivery to the business address
- **WHEN** a message targeting daguang@slax.app reaches the Newsletter receiver, even with a stale address registry row
- **THEN** it is rejected without writing a raw object, admitting a receipt or publishing a Newsletter entry

### Requirement: Bounded private incoming Newsletter
The Edge Worker SHALL accept email through a dedicated email handler. Ownership SHALL derive from the full SMTP envelope recipient, configured domain and active registry, never header To. Newsletter Lab and active user SHALL be checked at admission and final commit. The system SHALL bound raw mail to 5 MiB, MIME nesting, part count and headers, admit at most 200 sources per user and 200 new messages per UTC day, and omit attachments. It SHALL not log private email data.

#### Scenario: Valid message and MIME variants
- **WHEN** an enabled user's bound envelope address receives HTML, plain text or multipart mail
- **THEN** one user-isolated sender source and a safe readable entry are created, independent of envelope bounce sender and header To

#### Scenario: Disabled, unknown or oversized delivery
- **WHEN** a routed message targets another domain, an unknown or retired address, a disabled/deleted user, an exceeded quota or exceeds input bounds
- **THEN** it is rejected without publishing a Feed entry or disclosing address existence in the rejection

### Requirement: Durable idempotent publication
A new receipt SHALL be acknowledged by application code only after its processing obligation is durably committed. Accepted pending receipts SHALL be retried after body or database publication failures. Message-ID deduplication SHALL be scoped to user and sender source, and fallback identity SHALL include stable body content. A duplicate SHALL preserve the existing entry and quota. R2 content SHALL exist before entry references are published. User deletion and Lab disable SHALL fence in-flight final commits.

#### Scenario: Concurrent duplicates
- **WHEN** the same email is delivered concurrently or retried with revised payload but the same Message-ID
- **THEN** exactly one entry is published and one daily slot is consumed

#### Scenario: Publication failure after admission
- **WHEN** R2 body publication or entry commit fails after receipt admission
- **THEN** the receipt remains recoverable and retry publishes one entry without consuming another daily slot

#### Scenario: Disable or delete while processing
- **WHEN** a user disables Newsletter or deletes the account while an accepted receipt is processing
- **THEN** processing cannot recreate subscriptions or publish new entries for that user

### Requirement: Safe retained Newsletter body
The system SHALL sanitize email HTML, escape plain text, remove unsafe embeds and CID/relative image references, use signed controlled image URLs and preserve truncation metadata. Newsletter SHALL not be subject to RSS 30-day entry pruning. Orphaned content and completed raw mail SHALL be eligible for garbage collection. Newsletter ingestion SHALL not create Inbox bookmarks or trigger AI processing.

#### Scenario: Malicious email and image handling
- **WHEN** mail contains scripts, tracking images, event attributes, CID images or relative resource URLs
- **THEN** preview cannot execute active content or fetch remote images directly, and safe text remains readable

#### Scenario: RSS retention maintenance
- **WHEN** RSS pruning runs with old RSS and Newsletter entries present
- **THEN** expired RSS entries are removed and subscribed Newsletter entries remain

### Requirement: Unified independently authorized Feed
The system SHALL expose additive private no-store Feed read APIs returning an explicit RSS or Newsletter kind. Reads SHALL enforce active user ownership and each kind's Lab. Pagination SHALL bind user, selected source and effective kinds; an entry anchor SHALL belong to the requested source. Newsletter sources SHALL never trigger RSS polling, history fetches or favicon construction.

#### Scenario: Mixed kinds and independent switches
- **WHEN** both features are enabled and the user then disables only one
- **THEN** Feed shows both kinds initially and only the enabled kind afterwards without leaking disabled bodies or changing old RSS API contracts

#### Scenario: Cross-user or cross-source cursor
- **WHEN** a cursor or before anchor is reused by another user, source or effective-kind set
- **THEN** the request is rejected without revealing another user's content

### Requirement: Always-visible Web Feed and dev pilot
Web SHALL always show Feed in navigation, support stable address provisioning/copy with a first-time account form, and combine independently gated RSS and Newsletter local data or REST fallback. Newsletter sender names SHALL use a local avatar fallback. It SHALL explain lazy remote image privacy and unsupported first-version actions. Local cache and body state SHALL follow account and per-kind enablement. Dev rollout SHALL use account@slax.dev and a root-domain Catch-all to reader-backend. The production address SHALL use account@slax.app; beta/production admission SHALL remain disabled during dev acceptance. Existing literal business address rules SHALL be preserved.

#### Scenario: Both Labs disabled
- **WHEN** the user opens Feed with both features disabled
- **THEN** Feed remains visible with setup guidance and no disabled content

#### Scenario: Reload and partial sync failure
- **WHEN** owned local data exists and one stream is unavailable
- **THEN** the healthy enabled kind stays readable and cached rows remain isolated by account and kind

#### Scenario: Narrow and themed reading
- **WHEN** a user provisions and reads on narrow or wide Web in light, dark or eink theme
- **THEN** controls remain usable by keyboard, address text does not overflow and reader content follows existing tokens

#### Scenario: Dev activation and rollback
- **WHEN** an operator enables the dev root-domain Catch-all after Worker readiness and later stops the pilot
- **THEN** registered enabled dev users receive mail without per-user routes, unknown addresses are rejected by the Worker, and rollback restores the previous Catch-all action while preserving reservations and content
