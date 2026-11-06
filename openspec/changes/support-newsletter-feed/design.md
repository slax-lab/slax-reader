# Design

Earlier approved plans, including [Independent Newsletter Storage and Inbox Copies](../../../docs/superpowers/plans/2026-10-28-newsletter-independent-storage.md), record historical decisions. The current delta specifications and decisions below govern implementation; subsequent revisions supersede older construction instructions.

## Storage and ownership

The existing sr_platform_bind stores stable receiving addresses without new columns or triggers. Existing sr_user.deleted_at is the sole account-deletion state: recipient lookup joins live users, and admission/publication recheck the live owner under its existing row lock. Cleanup retains Newsletter bindings as address reservations; the existing complete-address advisory transaction lock serializes reservation SELECT and INSERT, including retained deleted-owner bindings. No new unique address index, CHECK, column or trigger is introduced; direct SQL bypasses this application guarantee. The single first-release migration is generated through the existing Prisma command, with no compatibility migration. Normal application provisioning never replaces an issued address. One sr_newsletter_feed row represents one message with owner, opaque sender key, sender/name, message hash, pending/ready/cancelled state, title/excerpt, nullable final content key, truncation and received/publication timestamps. A BIGINT primary key is a decimal string outside persistence. Owner/source/message uniqueness owns deduplication; no separate receipt, generic source, binding pointer, processing lease, retry schedule or counter remains.

Short owner-locked transactions admit/quota-check and publish. R2 work occurs between transactions with immutable per-attempt keys. Final publication rechecks user, Lab, exact binding, deadline and mail state, and atomically publishes coherent body metadata. Disable cancels pending rows under the same lock; re-enable cannot resurrect them. Another actual delivery may resume pending work, but no automatic mechanism or SMTP retry guarantee exists.

## Content lifecycle

Newsletter final bodies use newsletter-content only. Retain quiet MIME parsing, security sanitization, tracking-image filtering and ordinary attachment explanations. Remove Readability and candidate comparison. Resolve referenced MIME raster images into data URLs after text sanitization so base64 cannot consume/corrupt the text budget. Cap aggregate embedded data-URL bytes at an independent 5 MiB bound, omit whole excess references and set the existing truncation indicator; skip the remote proxy for these images and allow them only in the Newsletter preview. No raw EML, separately stored attachment binary or replay body is stored. Newsletter-specific scheduled tasks, body scanning, GC cursors and reference-lookup indexes are deferred. Keep the five-minute publication deadline as the current per-attempt processing bound. Owner deletion revokes first and removes Newsletter content independently of bookmarks. Known unpublished writes are discarded; indeterminate commits are reconciled or retained, never eagerly deleted. Interrupted writes or failed deletes can leave orphan R2 objects in this first release; no background collection is promised.

## RSS and read aggregation

All shipped RSS tables, HTTP contracts, repository/service/content behavior, Web local schema and PowerSync projections retain upstream values. The facade projects existing RSS and ready mail through UNION ALL and one typed ordering/cursor, with owner/source/enabled-kind binding. Newsletter IDs/selectors have a newsletter: prefix. Numeric IDs are compared numerically. Source DTOs are discriminated unions with no fake mail polling fields.

Explicit RSS history probes delegate to the unchanged public RSS service, anchored with an ordinary cursor at the oldest authorized cached RSS row and limit=1. Web re-reads its expanded loaded window from the head after the probe, retaining old rows on failure. RSS-only mode delegates to the unchanged RSS panel/composable. Mixed sessions use the existing owned RSS local state and a separate newsletter_v1 metadata stream/local table. Combine their enabled, owner-scoped rows with typed numeric mail ordering, per-source limits, saved-copy overlays and existing RSS history behavior. Existing metadata is usable before first sync. A pending or failed Newsletter stream never switches a healthy owned database to mixed REST; REST list mode remains only for clients without owned local storage. Body reads and mutations retain authenticated APIs.

## Independent Inbox acquisition

Save accepts only an owned ready mail and live enabled owner. It copies received content through SnapshotBundle to distinct HTML/text keys, including the normal plain-HTML marker. One owner/message/destination-locked transaction publishes the owner-isolated bookmark and user relation without adding a per-bookmark sharing override. New copies follow the owner's current global sharing setting, using the ordinary bookmark read/share policy. Stable identity is slax-newsletter://message/<id> with private_user; no article URL or crawl job is used. Repeat/restore also use final authorization, preserve annotations and explicit sharing choices, and never overwrite a successful snapshot. Generic acquire/retry/import paths reject internal mail identities before mutation. SyncOrchestrator rejects every internal create PUT before generic repository operations, including owned replays; normal PATCH/delete/restore of server-created copies remains supported.

Post-commit indexing/cache/changelog/notification use ordinary established bookmark helpers and diagnostics. New copies provide copied body text and title to ordinary indexing; failure does not fail or delete a committed copy. Repeats and restores restore user search relations/cache without rebuilding unchanged content. No strict failure/empty-result distinction, atomic replacement or repeat repair is promised. Unknown COMMIT outcomes retain uncertain files. No project-wide snapshot recovery/outbox is introduced. Existing Inbox copies remain readable when Newsletter is disabled, and the two R2 lifetimes are independent.

The Inbox source header reuses SnapshotArticleSource with localized Newsletter text and sender metadata. A source without a URL uses the same semantic tokens and layout as ordinary sources but renders a non-link without an external arrow; existing website source links remain unchanged. Remove the former saved-content paragraph.

## Confirmed address setup

The approved setup-card revision is detailed in [Newsletter Setup Interaction](../../../docs/superpowers/plans/2026-10-28-newsletter-setup-interaction.md). Plain Labs enablement changes only the feature state. Creation carries newsletter_address on the same setting-enable request; the repository checks the complete frozen address against the current account/domain under the existing user lock before inserting a binding. First creation accepts exactly 6–15 lowercase ASCII letters/digits, validated in Controller and at the transactional first-insert boundary. Existing bindings and SMTP case handling keep their issued form; general Reader settings retain their prior format and spelling, without forced lowercase conversion. Canonical lowercase values are used only for serialized conflict checks; the requested account spelling is stored unchanged. No new endpoint or background job is added. The Web card owns disclosure persistence, candidate validation, native dialog lifecycle, inline business errors and request-generation fencing. Supporting details use the existing muted auxiliary type role; permanent-address information keeps stronger text emphasis.

## Verification

Run regression-first tests, real native PostgreSQL races, real fresh Worker/DB/R2/D1 smoke, full API/Web checks, strict OpenSpec, zero-RSS-diff audit, fresh Bugs/Security/Compliance review and renewed hands-on acceptance. Hosted receiving remains a separate operator exercise. Archive through a docs PR after merge.

## Module boundaries

Keep flat NewsletterService, NewsletterContentService and NewsletterSaveService domain modules; pure MIME/policy helpers live in utils/newsletter.ts. Remove HtmlBuilder.buildNewsletterBody and its Readability import. Newsletter helpers own MIME parsing, CID lookup and full-mail security cleaning. Database writes stay separate; only API read projections combine RSS and Newsletter.


## Newsletter preview typography

FeedPanel renders Newsletter HTML in its own scoped namespace and includes the same Article reset and content-styles mixins used by the detail renderer. The Article style barrel forwards the existing base content mixin; it does not copy declarations or introduce another renderer/component. Native list detection supplements the existing processor marker in the shared mixin, so sanitized mail lists need no new DOM pass. Code blocks scroll locally within the preview's reading width. The original RSS namespace retains its existing styles. Stored messages adopt these styles at render time, with existing HTML sanitization and image transport unchanged.


## Newsletter excerpt naming

The Newsletter message column and its internal parser/publication/save data use excerpt for the first 500 characters of sanitized body text, avoiding confusion with AI-generated summaries. The existing mixed Feed response retains the RSS-derived summary field through its read projection; RSS persistence/contracts, list rendering and saved-bookmark description behavior remain unchanged. Each Newsletter Prisma field documents its actual consumers in Chinese, as requested. Regenerate and replace the unmerged initial migration in place; do not add a rename or compatibility migration.


## Dev-only rollout

The 2026-10-29 operator decision configures only newsletterreader.slax.dev. Private beta/prod/legacy-main configurations omit NEWSLETTER_DOMAIN until dev validation and a later rollout decision. The intended eventual production suffix remains newsletterreader.slax.com; omission does not clear an existing remote value under --keep-vars.

## Email-event timing and Mobile compatibility

Capture elapsed wall time from handler entry through cleanup, with one structured summary per success, duplicate, cancellation, rejection or failure. Include an opaque event ID, byte count, numeric phase durations, total_ms and slow = total_ms > 5000; never include addresses, subject, content, URLs, raw errors or base64. Five seconds is an observation target rather than a timeout or a measured hosted guarantee.

Mobile remains an ordinary Inbox consumer: display Newsletter for internal mail identities and expose original navigation only for HTTP(S) URLs in both the Reader and processing dialog. Do not add Newsletter feeds, setup, Labs or stream subscriptions to Mobile.


## Approved stream and review corrections (2026-10-29)

Use the approved [follow-up plan](../../../docs/superpowers/plans/2026-10-29-newsletter-review-followup.md). Web original actions use the same HTTP(S)-only policy as Mobile and retain internal Reader navigation. Move the mixed client comparator to the Feed utility; literal shared fixtures constrain PostgreSQL keyset and local SQLite/composition order without a shared SQL-generation framework or extra REST fallback.

An email handler awaits required publication, attempts cleanup and emits one summary, but cleanup only sets cleanup_failed and cannot change outcome or replace the original receive error. Generic ContextManager cleanup behavior stays unchanged.

The boundary streams up to 25 MiB of original input, counting and incrementally hashing every byte. @zone-eu/mailsplit 5.4.29 filters parts before postal-mime. Keep aggregate transfer-decoded HTML/plain budgets of 2 MiB each, CID raster candidates 5 MiB collectively, final embedded URLs 5 MiB and structural bytes 64 KiB. Headers aggregate to 64 KiB, depth to 32 and parts to 200, including skipped content. Ordinary attachments are drained with only metadata retained. Rebuild limited parts through library encoders/Joiner, preserving charset/multipart semantics. Text/CID over-budget content is truncated; invalid structure/oversize is rejected. Input failure/early EOF takes the sanitized infrastructure path without explicit permanent rejection. Feed splitter writes at most 64 KiB, observe backpressure, and copy retained slices.

Message-ID identity is unchanged. No-ID identity hashes the full original byte stream including discarded attachments; exact replays deduplicate, while MIME re-encodings may be distinct. Update the Prisma usage comment only; no migration or compatibility decoder is needed for this unmerged feature. CID candidates can precede HTML; first-match order includes omitted first matches, so a later duplicate ID never substitutes. No ordinary binary data reaches R2. The workerd dependency gate precedes production integration; no unsupported full-buffer fallback or runtime-flag expansion is authorized.
