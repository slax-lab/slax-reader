## Purpose

Enable private Newsletter delivery and reading through permanent account-derived addresses, safely combined with RSS in the Web Feed.

## ADDED Requirements

### Requirement: Permanent account-derived receiving address
The system SHALL provision a Newsletter address only for an authenticated active user with Newsletter enabled, configured receiving domain and explicit confirmation of the complete candidate address. The receiving local part SHALL be feed+ followed by the first validated lowercase account token of at most 59 ASCII characters. A permanent newsletter platform binding SHALL retain the complete canonical address, and Web SHALL display/copy the complete prefixed address. GET and Labs enablement alone SHALL have no provisioning side effect. Confirmed creation SHALL use the existing setting-enable endpoint and match the confirmed address against the current candidate under the owner row lock, rejecting a stale account/domain rather than issuing an unconfirmed address. An issued address SHALL remain stable after account changes and SHALL never be reassigned after user deletion. The system SHALL use the existing sr_user.deleted_at for account revocation, without adding a binding retirement field or custom binding trigger. Cleanup SHALL retain the ordinary Newsletter binding row as the address reservation.

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

#### Scenario: Existing stable receiving binding
- **WHEN** a valid receiving address is already bound in the configured domain and the user later renames
- **THEN** GET and repeated user-setting enable render feed+ followed by the original stored token, without replacing the issued binding

#### Scenario: Account deletion uses existing user state
- **WHEN** an owner is deleted through the existing user-deletion flow, including while an email is being processed
- **THEN** sr_user.deleted_at prevents address access, new admission and late publication, pending mail is cancelled, and the retained binding reserves the issued address without a separate retirement column or trigger

#### Scenario: Existing business mail service
- **WHEN** the account is daguang in the selected Newsletter subdomain
- **THEN** it can receive a prefixed Newsletter address without claiming daguang@slax.app, and root/foreign-domain mail cannot enter its Newsletter

### Requirement: Bounded private incoming Newsletter
The Edge Worker SHALL accept email through a dedicated email handler. Ownership SHALL derive from the full SMTP envelope recipient, configured domain and active platform binding, never header To. Dispatch SHALL require feed+ and exactly one valid non-empty account token, accepting case variations but rejecting bare feed, unprefixed accounts, other prefixes and additional plus details before content storage. Newsletter Lab and active user SHALL be checked at admission and final commit. The system SHALL bound raw mail to 5 MiB, MIME nesting, part count and headers, admit at most 200 sources per user and 200 new messages per UTC day, and preserve binary attachment metadata without storing attachment bytes. It SHALL not log private email data.

#### Scenario: Valid message and MIME variants
- **WHEN** an enabled user's bound envelope address receives HTML, plain text or multipart mail
- **THEN** one user-isolated sender source and a safe readable entry are created, independent of envelope bounce sender and header To

#### Scenario: Disabled, unknown or oversized delivery
- **WHEN** a routed message targets another domain, an unknown address, a disabled/deleted user, an exceeded quota or exceeds input bounds
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
The system SHALL sanitize email HTML, escape plain text, remove unsafe embeds and CID/relative image references, use signed controlled image URLs and preserve truncation metadata. Newsletter SHALL not be subject to RSS 30-day entry pruning. The first release SHALL NOT register a Newsletter-specific scheduled task or scan bodies for orphan collection. Known unpublished candidates SHALL retain immediate cleanup; interrupted or ambiguous writes MAY leave orphan objects until a later iteration. Newsletter ingestion SHALL not create Inbox bookmarks or trigger AI processing.

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
The system SHALL use existing newsletter platform bindings, without new binding columns or triggers, and one sr_newsletter_feed row per message, combining admission, pending/ready/cancelled deduplication and final content metadata. It SHALL NOT create sr_feed, sr_newsletter_receipt, Newsletter subscriptions or earlier schema compatibility. The unmerged initial migration SHALL be revised directly without RSS ALTER, mirror, backfill or trial cleanup migrations. Newsletter SHALL NOT write any sr_rss table. Existing RSS model, HTTP contracts, fetching/history/retention/save and synchronization SHALL remain unchanged.

#### Scenario: Independent receive and existing RSS writers
- **WHEN** Newsletter is received while existing RSS clients read, write or refresh
- **THEN** Newsletter uses only its own mail table/content and every RSS table/schema/behavior remains the same as before the feature migration

### Requirement: Synchronous processing and setup
New email delivery SHALL await content storage and atomic publication. Existing pending duplicates SHALL resume; ready or cancelled duplicates SHALL not publish. No original raw EML or attachment binary SHALL be retained for new mail. Shared cron schedules SHALL remain, but no Newsletter recovery or body-collection handler, staged payload, GC cursor or recovery cursor SHALL exist. Only per-message states without processing leases SHALL remain for deduplication and cancellation. A configured domain and user Lab SHALL control admission without NEWSLETTER_ENABLED. Dev SHALL configure newsletterreader.slax.dev; beta, prod and the legacy main copy SHALL configure newsletterreader.slax.com. The system SHALL NOT assume original-sender retries are guaranteed after Worker infrastructure failure. Automatic recovery is deferred to a later iteration.

#### Scenario: Account repair after enabling
- **WHEN** the user enables Newsletter with a missing, invalid or reserved initial account
- **THEN** the Lab remains enabled without issuing an address, and account repair followed by confirmed creation can provision once

### Requirement: Confirmed collapsible Newsletter setup
The setup card SHALL remember its disclosure preference locally per signed-in user, tolerate unavailable local storage and avoid carrying another user's address, draft, error or confirmation across sessions. Collapsed ready state SHALL retain the title, full address, fixed-address status and copy action. Unconfigured state SHALL retain an actionable setup summary. Expanded state SHALL emphasize the address and its permanence, with privacy/attachment/management details in lower-emphasis supporting text, using existing Web semantic tokens in light/dark/e-ink at desktop, 768px and narrow widths. The disclosure control SHALL have symmetric 10px horizontal padding and visible keyboard focus.

#### Scenario: Confirm before first creation
- **WHEN** a user submits a valid candidate or presses Enter in the account field
- **THEN** a labelled modal shows the full candidate and explains that it cannot change, including after account rename; cancelling performs no writes, while confirmation submits the frozen candidate with pending/duplicate-submit protection

#### Scenario: Occupied account or reserved address
- **WHEN** account setting reports an occupied name or address creation reports a reservation conflict
- **THEN** Web retains the draft, expands the form, identifies the affected field with an announced actionable message and permits another name; infrastructure failure instead offers retry without exposing raw error text

#### Scenario: Disclosure preference and identity changes
- **WHEN** a user collapses the card, reloads, changes signed-in user or loses local-storage access
- **THEN** their available local preference is restored independently; no other user's sensitive state or in-flight confirmation is reused, and storage failure does not block setup/copy

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

### Requirement: Independent Inbox copy
An authenticated live user with Newsletter enabled SHALL be able to save an owned ready mail without an article URL. Save SHALL copy received content to distinct standard bookmark HTML/text R2 keys, including the HTML snapshot marker, without fetching an original web URL. The owner-isolated bookmark and owner relation SHALL be published atomically. A new copy SHALL follow ordinary account-default sharing without creating a per-bookmark override. A successful response SHALL identify a committed ready bookmark. The system SHALL not assume private_user alone disables public reads.

#### Scenario: Save and repeat
- **WHEN** a user saves a mail, repeats or saves concurrently
- **THEN** one live private bookmark is published with copied content, repeats reuse it and no duplicate quota/bookmark/index rows or personal-state overwrite occur

#### Scenario: Save progress and retry
- **WHEN** a Save to Inbox request is pending in the mixed Feed list or reader preview
- **THEN** both surfaces show saving text and busy state for that entry, with a spinner respecting reduced-motion/eink settings, prevent duplicate activation, and leave other entries without a misleading spinner; completion shows the saved link and failure restores a retryable save action

#### Scenario: Trash restore and deliberate sharing
- **WHEN** a copied bookmark is restored by saving again
- **THEN** it returns to Inbox with marks/tags/star/title and any deliberate sharing choice preserved; a newly created copy follows the owner's current global sharing setting

#### Scenario: Standard Inbox source and sharing defaults
- **WHEN** a user opens a saved mail or changes the account's global sharing setting
- **THEN** the Inbox header reuses the standard Source module with localized Newsletter and sender metadata, no synthetic link/external arrow or implementation/privacy paragraph; absent a deliberate per-bookmark override, the ordinary sharing policy follows the current global setting

#### Scenario: Failure and independent lifetimes
- **WHEN** storage/index/commit fails, Newsletter is disabled, or one content copy is deleted
- **THEN** no referenced successful body is deleted, indeterminate commits are reconciled safely, index failure can be repaired without recopying, and Feed/Inbox content lifetimes stay independent

#### Scenario: Internal snapshot and private indexing
- **WHEN** an internal Newsletter bookmark enters generic acquisition/retry/sync/import paths or its indexing fails
- **THEN** no network crawl or pending-state mutation occurs and no mail subject/body/provider error data is logged; strict indexing failure is distinguishable from legitimate empty content
