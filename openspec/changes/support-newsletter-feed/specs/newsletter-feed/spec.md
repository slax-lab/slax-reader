## Purpose

Enable private Newsletter delivery and reading through permanent account-derived addresses, safely combined with RSS in the Web Feed.

## ADDED Requirements

### Requirement: Permanent account-derived receiving address
The system SHALL provision a Newsletter address only for an authenticated active user with Newsletter enabled and explicit deployment admission configuration. The receiving local part SHALL be feed+ followed by the first validated lowercase account token of at most 59 ASCII characters. A permanent newsletter platform binding SHALL retain the complete canonical address, and Web SHALL display/copy the complete prefixed address. GET SHALL have no provisioning side effect; existing user setting enable SHALL idempotently provision the address. An issued address SHALL remain stable after account changes and SHALL never be reassigned after retirement or user deletion.

#### Scenario: Provision and rename
- **WHEN** a user provisions an address and later changes account or display name
- **THEN** GET and repeated user-setting enable return the original receiving address

#### Scenario: Missing, invalid or reserved account
- **WHEN** no address exists and the current account is missing, invalid or already reserved
- **THEN** provisioning returns an actionable error and Web allows setting a valid available account without inventing an address suffix

#### Scenario: Concurrent provisioning and deletion
- **WHEN** competing requests attempt the same prefix or a deleted user previously held it
- **THEN** at most one owner receives it and the reservation remains unavailable to others

#### Scenario: Fixed prefix and length boundary
- **WHEN** a user provisions with a 59-character safe account or a 60-character account
- **THEN** the former receives a 64-octet local part and the latter receives invalid_account without creating a binding; no truncation or extra suffix occurs

#### Scenario: Existing immutable receiving binding
- **WHEN** a valid receiving address is already bound in the configured domain and the user later renames
- **THEN** GET and repeated user-setting enable render feed+ followed by the original stored token, without replacing the issued binding

#### Scenario: Existing business mail service
- **WHEN** the account is daguang in the selected Newsletter subdomain
- **THEN** it can receive a prefixed Newsletter address without claiming daguang@slax.app, and root/foreign-domain mail cannot enter its Newsletter

### Requirement: Bounded private incoming Newsletter
The Edge Worker SHALL accept email through a dedicated email handler. Ownership SHALL derive from the full SMTP envelope recipient, configured domain and active platform binding, never header To. Dispatch SHALL require feed+ and exactly one valid non-empty account token, accepting case variations but rejecting bare feed, unprefixed accounts, other prefixes and additional plus details before content storage. Newsletter Lab and active user SHALL be checked at admission and final commit. The system SHALL bound raw mail to 5 MiB, MIME nesting, part count and headers, admit at most 200 sources per user and 200 new messages per UTC day, and preserve binary attachment metadata without storing attachment bytes. It SHALL not log private email data.

#### Scenario: Valid message and MIME variants
- **WHEN** an enabled user's bound envelope address receives HTML, plain text or multipart mail
- **THEN** one user-isolated sender source and a safe readable entry are created, independent of envelope bounce sender and header To

#### Scenario: Disabled, unknown or oversized delivery
- **WHEN** a routed message targets another domain, an unknown or retired address, a disabled/deleted user, an exceeded quota or exceeds input bounds
- **THEN** it is rejected without publishing a Feed entry or disclosing address existence in the rejection

### Requirement: Durable idempotent publication
A new email delivery SHALL be acknowledged by application code only after final body storage and atomic publication complete. After body or database publication failures, pending mail rows SHALL resume only when a new incoming delivery or explicit EML replay supplies the message again. There SHALL be no scheduled Newsletter recovery or stored recovery payload. Message-ID deduplication SHALL be scoped to user and sender source, and fallback identity SHALL include stable body content. A duplicate SHALL preserve the existing entry and quota. R2 content SHALL exist before entry references are published. User deletion and Lab disable SHALL fence in-flight final commits.

#### Scenario: Concurrent duplicates
- **WHEN** the same email is delivered concurrently or retried with revised payload but the same Message-ID
- **THEN** exactly one entry is published and one daily slot is consumed

#### Scenario: Publication failure after admission
- **WHEN** R2 body publication or entry commit fails after message admission
- **THEN** the message stays pending and the failure propagates; a new delivery can publish one entry without consuming another daily slot, with no automatic background retry

#### Scenario: Disable or delete while processing
- **WHEN** a user disables Newsletter or deletes the account while an accepted message is processing
- **THEN** processing cannot publish new entries for that user

### Requirement: Safe retained Newsletter body
The system SHALL sanitize email HTML, escape plain text, remove unsafe embeds and CID/relative image references, use signed controlled image URLs and preserve truncation metadata. Newsletter SHALL not be subject to RSS 30-day entry pruning. Orphaned Newsletter content SHALL be collected independently without visiting RSS or Inbox objects. Newsletter ingestion SHALL not create Inbox bookmarks or trigger AI processing.

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
Web SHALL always show Feed in navigation, support stable address provisioning/copy with a first-time account form, and combine independently gated RSS and Newsletter through REST whenever Newsletter is enabled. RSS-only sessions SHALL retain existing local-first reads and REST fallback. Newsletter SHALL have no PowerSync stream or client subscription in this rollout. Newsletter sender names SHALL use a local avatar fallback. It SHALL explain lazy remote image privacy and unsupported first-version actions. Local cache and body state SHALL follow account and per-kind enablement. Dev rollout SHALL use feed+account@newsletterreader.slax.dev and one literal feed@newsletterreader.slax.dev routing rule to reader-backend with Cloudflare Subaddressing enabled. The production address SHALL use feed+account@newsletterreader.slax.com; beta/prod/legacy-main configuration SHALL preconfigure newsletterreader.slax.com while operational acceptance starts in dev. Setting the domain SHALL permit user-Lab provisioning after deployment but SHALL not configure Cloudflare receiving routes. Existing root-domain mail records, Catch-all rules and literal business forwarding SHALL be preserved.

#### Scenario: Both Labs disabled
- **WHEN** the user opens Feed with both features disabled
- **THEN** Feed remains visible with setup guidance and no disabled content

#### Scenario: Newsletter with healthy or pending local synchronization
- **WHEN** Newsletter is enabled and a local PowerSync database is healthy, pending or unavailable
- **THEN** Feed subscriptions, entries and body use authenticated REST without subscribing to a Newsletter stream or waiting for its first sync; mixed list order and pagination come from the server

#### Scenario: Switch between REST Feed and RSS-only local mode
- **WHEN** Newsletter is enabled or disabled while RSS remains enabled
- **THEN** the Feed switches between REST and RSS-only local mode, fences obsolete requests/previews/cursors, and never exposes stale local Newsletter rows as RSS

#### Scenario: Refresh and retained REST pages
- **WHEN** Newsletter content changes or a REST refresh fails
- **THEN** an explicit refresh/reload can retrieve new mail, existing loaded pages remain visible until replacement succeeds, and a new offline session does not promise Newsletter persistence

#### Scenario: Narrow and themed reading
- **WHEN** a user provisions and reads on narrow or wide Web in light, dark or eink theme
- **THEN** controls remain usable by keyboard, address text does not overflow and reader content follows existing tokens

#### Scenario: Dev activation and rollback
- **WHEN** an operator enables the dev literal feed route and Subaddressing after Worker readiness and later stops the pilot
- **THEN** registered enabled dev users receive mail without per-user routes, unknown feed+ details and the bare feed address are rejected by the Worker, and rollback disables/restores only the pilot feed route while preserving reservations and content

### Requirement: Independent first-release persistence
The system SHALL use immutable newsletter platform bindings and one sr_newsletter_feed row per message, combining admission, pending/ready/cancelled deduplication and final content metadata. It SHALL NOT create sr_feed, sr_newsletter_receipt, Newsletter subscriptions or earlier schema compatibility. The unmerged initial migration SHALL be revised directly without RSS ALTER, mirror, backfill or trial cleanup migrations. Newsletter SHALL NOT write any sr_rss table. Existing RSS model, HTTP contracts, fetching/history/retention/save and synchronization SHALL remain unchanged.

#### Scenario: Independent receive and existing RSS writers
- **WHEN** Newsletter is received while existing RSS clients read, write or refresh
- **THEN** Newsletter uses only its own mail table/content and every RSS table/schema/behavior remains the same as before the feature migration

### Requirement: Synchronous processing and setup
New email delivery SHALL await content storage and atomic publication. Existing pending duplicates SHALL resume; ready or cancelled duplicates SHALL not publish. No original raw EML or attachment binary SHALL be retained for new mail. Shared cron schedules SHALL remain, but no Newsletter recovery handler, staged payload or recovery cursor SHALL exist. Only per-message states without processing leases SHALL remain for deduplication and cancellation. A configured domain and user Lab SHALL control admission without NEWSLETTER_ENABLED. Dev SHALL configure newsletterreader.slax.dev; beta, prod and the legacy main copy SHALL configure newsletterreader.slax.com. The system SHALL NOT assume original-sender retries are guaranteed after Worker infrastructure failure. Automatic recovery is deferred to a later iteration.

#### Scenario: Account repair after enabling
- **WHEN** the user enables Newsletter with a missing, invalid or reserved initial account
- **THEN** the Lab remains enabled with an actionable setup state, and account repair followed by repeated enable can provision once

#### Scenario: Disable then re-enable
- **WHEN** a message was pending before Newsletter was disabled and later re-enabled
- **THEN** its durable cancelled state prevents late publication


#### Scenario: Production domain prepared before receiving rollout
- **WHEN** the reviewed beta/prod/legacy-main configuration is deployed with matching Newsletter code
- **THEN** eligible users can provision feed+account@newsletterreader.slax.com, while actual delivery still requires the separately configured production receiving domain and literal feed route

### Requirement: Private content processing and EML diagnostics
Newsletter processing SHALL reuse a quiet pure content extraction path, fall back to sanitized full mail when extraction loses useful content, preserve existing HTTP(S) links and append safe attachment metadata after extraction. Explicit 1x1/zero-sized or hidden tracking images SHALL be removed before sanitization without remote measurement. MIME subject/sender/date remain authoritative. Offline preview SHALL perform no network or storage calls; local EML replay SHALL preserve plus details and target localhost only.

#### Scenario: Attachment-only or multi-article mail
- **WHEN** mail contains only a binary attachment or multiple useful content sections
- **THEN** a readable metadata body or complete sanitized fallback remains, with no invented download URL or stored attachment binary

### Requirement: Independent private Inbox copy
An authenticated live user with Newsletter enabled SHALL be able to save an owned ready mail without an article URL. Save SHALL copy received content to distinct standard bookmark HTML/text R2 keys, including the HTML snapshot marker, without fetching an original web URL. The bookmark, owner relation and explicitly disabled single-bookmark sharing SHALL be published atomically. A successful response SHALL identify a committed ready bookmark. The system SHALL not assume private_user alone disables public reads.

#### Scenario: Save and repeat
- **WHEN** a user saves a mail, repeats or saves concurrently
- **THEN** one live private bookmark is published with copied content, repeats reuse it and no duplicate quota/bookmark/index rows or personal-state overwrite occur

#### Scenario: Save progress and retry
- **WHEN** a Save to Inbox request is pending in the mixed Feed list or reader preview
- **THEN** both surfaces show saving text and busy state for that entry, with a spinner respecting reduced-motion/eink settings, prevent duplicate activation, and leave other entries without a misleading spinner; completion shows the saved link and failure restores a retryable save action

#### Scenario: Trash restore and deliberate sharing
- **WHEN** a copied bookmark is restored by saving again
- **THEN** it returns to Inbox with marks/tags/star/title and any deliberate sharing choice preserved; a newly created copy defaults to disabled single-bookmark sharing even with global sharing on

#### Scenario: Failure and independent lifetimes
- **WHEN** storage/index/commit fails, Newsletter is disabled, or one content copy is deleted
- **THEN** no referenced successful body is deleted, indeterminate commits are reconciled safely, index failure can be repaired without recopying, and Feed/Inbox content lifetimes stay independent

#### Scenario: Internal snapshot and private indexing
- **WHEN** an internal Newsletter bookmark enters generic acquisition/retry/sync/import paths or its indexing fails
- **THEN** no network crawl or pending-state mutation occurs and no mail subject/body/provider error data is logged; strict indexing failure is distinguishable from legitimate empty content
