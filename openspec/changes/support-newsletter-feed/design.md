# Design

The approved detailed design, interfaces, failure decisions and implementation tasks are in [Independent Newsletter Storage and Inbox Copies](../../../docs/superpowers/plans/2026-10-28-newsletter-independent-storage.md), approved by the user on 2026-10-28.

## Storage and ownership

The existing sr_platform_bind stores stable receiving addresses without new columns or triggers. Existing sr_user.deleted_at is the sole account-deletion state: recipient lookup joins live users, and admission/publication recheck the live owner under its existing row lock. Cleanup retains Newsletter bindings as address reservations; a partial unique index prevents duplicate addresses. Normal application provisioning never replaces an issued address. One sr_newsletter_feed row represents one message with owner, opaque sender key, sender/name, message hash, pending/ready/cancelled state, title/summary, nullable final content key, truncation and received/publication timestamps. A BIGINT primary key is a decimal string outside persistence. Owner/source/message uniqueness owns deduplication; no separate receipt, generic source, binding pointer, processing lease, retry schedule or counter remains.

Short owner-locked transactions admit/quota-check and publish. R2 work occurs between transactions with immutable per-attempt keys. Final publication rechecks user, Lab, exact binding, deadline and mail state, and atomically publishes coherent body metadata. Disable cancels pending rows under the same lock; re-enable cannot resurrect them. Another actual delivery may resume pending work, but no automatic mechanism or SMTP retry guarantee exists.

## Content lifecycle

Newsletter final bodies use newsletter-content only. Retain current quiet MIME extraction/sanitization and attachment explanations; no raw EML/attachment binary or replay body is stored. Newsletter-specific scheduled tasks, body scanning, GC cursors and reference-lookup indexes are deferred. Keep the five-minute publication deadline as the current per-attempt processing bound. Owner deletion revokes first and removes Newsletter content independently of bookmarks. Known unpublished writes are discarded; indeterminate commits are reconciled or retained, never eagerly deleted. Interrupted writes or failed deletes can leave orphan R2 objects in this first release; no background collection is promised.

## RSS and read aggregation

All shipped RSS tables, HTTP contracts, repository/service/content behavior, Web local schema and PowerSync projections retain upstream values. The facade projects existing RSS and ready mail through UNION ALL and one typed ordering/cursor, with owner/source/enabled-kind binding. Newsletter IDs/selectors have a newsletter: prefix. Numeric IDs are compared numerically. Source DTOs are discriminated unions with no fake mail polling fields.

Explicit RSS history probes delegate to the unchanged public RSS service, anchored with an ordinary cursor at the oldest authorized cached RSS row and limit=1. Web re-reads its expanded loaded window from the head after the probe, retaining old rows on failure. RSS-only mode delegates to the unchanged RSS panel/composable; mixed REST behavior belongs to FeedPanel/useFeed.

## Independent Inbox acquisition

Save accepts only an owned ready mail and live enabled owner. It copies received content through SnapshotBundle to distinct HTML/text keys, including the normal plain-HTML marker. One owner/message/destination-locked transaction publishes the owner-isolated bookmark and user relation without adding a per-bookmark sharing override. New copies follow the owner's current global sharing setting, using the ordinary bookmark read/share policy. Stable identity is slax-newsletter://message/<id> with private_user; no article URL or crawl job is used. Repeat/restore also use final authorization, preserve annotations and explicit sharing choices, and never overwrite a successful snapshot. Generic acquire/retry/sync/import paths reject internal mail identities before mutation.

Post-commit indexing/cache/changelog/notification use established helpers with strict private diagnostics and atomic D1 replacement for the new path. Index failure does not delete a committed copy; a repeat can repair it. Unknown COMMIT outcomes retain uncertain files. No project-wide snapshot recovery/outbox is introduced. Existing Inbox copies remain readable when Newsletter is disabled, and the two R2 lifetimes are independent.

The Inbox source header reuses SnapshotArticleSource with localized Newsletter text and sender metadata. A source without a URL uses the same semantic tokens and layout as ordinary sources but renders a non-link without an external arrow; existing website source links remain unchanged. Remove the former saved-content paragraph.

## Verification

Run regression-first tests, real native PostgreSQL races, real fresh Worker/DB/R2/D1 smoke, full API/Web checks, strict OpenSpec, zero-RSS-diff audit, fresh Bugs/Security/Compliance review and renewed hands-on acceptance. Hosted receiving remains a separate operator exercise. Archive through a docs PR after merge.
