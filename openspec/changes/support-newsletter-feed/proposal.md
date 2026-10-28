# Proposal

## Why

Users need permanent Newsletter receiving addresses and one Web Feed for RSS and email. Newsletter must remain independent of the shipped RSS storage and write pipeline. Saving received mail to Inbox must create an independent snapshot, including messages without a web article URL.

## What Changes

- Receive bounded MIME through the Edge email handler and existing newsletter platform bindings with stable addresses, using feed+account addresses.
- Create one purpose-built sr_newsletter_feed row per message; keep admission, deduplication, cancellation and readable content metadata together. No sr_feed or sr_newsletter_receipt, no RSS DDL/mirror/backfill or Newsletter writes to RSS tables.
- Keep synchronous publication without processing leases, replay payloads, automatic recovery or Newsletter-specific scheduled tasks. Defer orphan-body collection to a later iteration. Preserve configured limits, quiet parsing, attachment metadata, proxy images and tracking-pixel removal.
- Merge existing RSS reads and ready Newsletter rows through private REST Feed endpoints. Preserve original RSS APIs, fetching, history, retention, save behavior and PowerSync. Put mixed Web behavior in Feed-owned adapters and delegate RSS-only mode to unchanged RSS code.
- Add Save to Inbox by copying the received R2 body into a separate standard HTML/text bookmark snapshot; create an owner-isolated bookmark/relation atomically and follow ordinary account-default sharing without a Newsletter-specific override. Repeats/restore preserve personal state and deliberate sharing choices.
- Show entry-specific Save to Inbox progress in both the mixed Feed list and reader preview, with localized saving text, a motion-aware spinner and duplicate activation prevention. The user requested this acceptance correction on 2026-10-28.
- Preserve dev newsletterreader.slax.dev and beta/prod/legacy-main newsletterreader.slax.com with one literal feed route plus Cloudflare Subaddressing. No per-user route or new infrastructure service.

## Capabilities

### New Capabilities

- newsletter-feed: Stable receiving addresses, independent message persistence, synchronous publication, private Feed reads and copied Inbox snapshots.

### Modified Capabilities

- rss-labs: Always-visible Web Feed navigation and mixed-source presentation; shipped RSS storage/contracts/behavior remain unchanged.

## Impact

API Workers, one initial Newsletter migration, R2 content, additive Feed contracts and Web UI. Existing search helpers need a narrow private indexing/error path and atomic D1 replacement; existing generic behavior is retained. No new dependencies, Newsletter PowerSync stream or data compatibility for unshipped trials. RSS model/repository/service/content/local-first differences from this PR are reverted to the reviewed upstream baseline.

## Human approval (2026-10-28)

The user approved docs/superpowers/plans/2026-10-28-newsletter-independent-storage.md after independent review, initially confirmed disabled single-bookmark sharing (superseded below), and authorized implementation in the existing worktree, updates to original PRs and local API/Web startup for renewed acceptance. This supersedes earlier generic-source/receipt designs, no-save decisions and RSS compatibility rollout requirements. Local trial data is disposable: directly revise the initial unmerged DDL without cleanup migrations or compatibility layers. No remote deployment or console mutation is authorized by this implementation request.

## Acceptance adjustments (2026-10-28)

The user explicitly replaced the special disabled-sharing default with normal bookmark sharing: new copies have no per-bookmark override and follow the owner's current global setting; repeats/restores preserve deliberate per-bookmark choices. The source header must reuse SnapshotArticleSource styles with a localized Newsletter label and sender, without the former implementation/privacy paragraph, synthetic web link or external arrow. These requested local corrections are authorized within the existing change and require renewed hands-on acceptance before PR handoff.
