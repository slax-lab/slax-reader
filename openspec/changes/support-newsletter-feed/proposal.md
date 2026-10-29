# Proposal

## Why

Users need permanent Newsletter receiving addresses and one Web Feed for RSS and email. Newsletter must remain independent of the shipped RSS storage and write pipeline. Saving received mail to Inbox must create an independent snapshot, including messages without a web article URL.

## What Changes

- Receive bounded MIME through the Edge email handler and existing newsletter platform bindings with stable addresses, using feed+account addresses.
- Create one purpose-built sr_newsletter_feed row per message; keep admission, deduplication, cancellation and readable content metadata together. No sr_feed or sr_newsletter_receipt, no RSS DDL/mirror/backfill or Newsletter writes to RSS tables.
- Keep synchronous publication without processing leases, replay payloads, automatic recovery or Newsletter-specific scheduled tasks. Defer orphan-body collection to a later iteration. Preserve configured limits, quiet parsing, attachment metadata, CID images embedded as raster data URLs, proxy images and tracking-pixel removal; do not use Readability.
- Add an independent newsletter_v1 PowerSync stream and local Newsletter table; combine both local lists in the Web Feed. Keep private REST Feed endpoints for authenticated bodies, writes and clients without local storage. Preserve original RSS APIs, fetching, history, retention, save behavior and PowerSync. Put mixed Web behavior in Feed-owned adapters and delegate RSS-only mode to unchanged RSS code.
- Add Save to Inbox by copying the received R2 body into a separate standard HTML/text bookmark snapshot; create an owner-isolated bookmark/relation atomically and follow ordinary account-default sharing without a Newsletter-specific override. Repeats/restore preserve personal state and deliberate sharing choices.
- Show entry-specific Save to Inbox progress in both the mixed Feed list and reader preview, with localized saving text, a motion-aware spinner and duplicate activation prevention. The user requested this acceptance correction on 2026-10-28.
- Configure only dev newsletterreader.slax.dev for the pilot; defer beta/prod/legacy-main domain configuration until dev validation. The planned production suffix remains newsletterreader.slax.com. Use one literal feed route plus Cloudflare Subaddressing, without per-user routes or a new infrastructure service.
- Present a locally remembered per-user collapsible address card with clear information hierarchy. Labs enablement alone must not issue a permanent address; creation uses the existing setting endpoint only after an explicit full-address confirmation, with accessible inline conflict feedback.

## Capabilities

### New Capabilities

- newsletter-feed: Stable receiving addresses, independent message persistence, synchronous publication, private Feed reads and copied Inbox snapshots.

### Modified Capabilities

- rss-labs: Always-visible Web Feed navigation and mixed-source presentation; shipped RSS storage/contracts/behavior remain unchanged.

## Impact

API Workers, one initial Newsletter migration, R2 content, additive Feed contracts and Web UI. Saved copies use ordinary shared bookmark indexing and diagnostics with best-effort post-commit effects; shared search normalization and embedding are unchanged. The only added runtime dependency is pinned postal-mime for MIME parsing; there is no data compatibility for unshipped trials. Newsletter and RSS remain separate database tables and sync streams. RSS model/repository/service/content/local-first differences from this PR are reverted to the reviewed upstream baseline.

## Human approval (2026-10-28)

The user approved docs/superpowers/plans/2026-10-28-newsletter-independent-storage.md after independent review, initially confirmed disabled single-bookmark sharing (superseded below), and authorized implementation in the existing worktree, updates to original PRs and local API/Web startup for renewed acceptance. This supersedes earlier generic-source/receipt designs, no-save decisions and RSS compatibility rollout requirements. Local trial data is disposable: directly revise the initial unmerged DDL without cleanup migrations or compatibility layers. No remote deployment or console mutation is authorized by this implementation request.

## Acceptance adjustments (2026-10-28)

The user explicitly replaced the special disabled-sharing default with normal bookmark sharing: new copies have no per-bookmark override and follow the owner's current global setting; repeats/restores preserve deliberate per-bookmark choices. The source header must reuse SnapshotArticleSource styles with a localized Newsletter label and sender, without the former implementation/privacy paragraph, synthetic web link or external arrow. These requested local corrections are authorized within the existing change and require renewed hands-on acceptance before PR handoff.

## Newsletter setup demo approval (2026-10-28)

The requesting user accepted the interactive setup-card preview and explicitly authorized implementation in the existing worktree, followed by local API/Web startup for renewed hands-on acceptance. The approved structure retains the title, complete address and copy action when collapsed; records disclosure preference locally per signed-in user; emphasizes permanent-address information over secondary receiving details; previews the complete candidate; and requires a cancellable confirmation before account/address writes. Occupied account names and reserved mailboxes receive actionable inline feedback without losing the draft. Labs only enables the feature; confirmed creation remains on the existing setting-enable endpoint, without a new table or endpoint.

The demo provided ready, unconfigured, occupied, loading, unavailable and simulated network-failure states, Chinese/English labels, light/dark/e-ink themes and desktop/768px/390px controls. The user's adjustment added symmetric 10px horizontal padding to the disclosure button so its arrow remains clear of the hover background edge; this corrected version was accepted. This is approval to implement, not acceptance of the production implementation or authorization to deploy. The plan is [Newsletter Setup Interaction](../../../docs/superpowers/plans/2026-10-28-newsletter-setup-interaction.md).

## Team-feedback revision approval (2026-10-28)

The user approved [Newsletter Team Feedback](../../../docs/superpowers/plans/2026-10-28-newsletter-team-feedback.md) and authorized implementation, a final independent review and local API/Web startup. The revision removes the new binding address unique index and handwritten CHECK constraints, retains serialized application reservation, generates the initial migration through Prisma, documents every message field, flattens domain modules, moves mail extraction into HtmlBuilder, rejects internal create PUTs in the sync orchestrator and restores ordinary search helpers. Only first Newsletter configuration accepts 6–15 lowercase ASCII letters/digits; ordinary Reader account policy and issued bindings remain unchanged. Renewed product acceptance and PR handoff remain pending.


## Newsletter body typography correction (2026-10-28)

The user requested Article detail's existing basic styles for Newsletter bodies and emphasized a simple reusable implementation. Reuse the Article reset/content mixins under a Newsletter-only preview namespace. Native HTML lists should receive the same indentation without requiring the complete Article processing pipeline. Keep receiving/sanitization, storage, Feed structure, RSS presentation and saved-Inbox rendering unchanged. This is an authorized refinement of the existing readable-preview behavior; renewed real-app acceptance remains pending before PR handoff.


## Renewed local acceptance (2026-10-29)

The requesting user confirmed that the current local implementation meets expectations after the account-validation revision, reader-scroll correction and shared Article body typography, and explicitly authorized a brief review and update to original PR #349. The existing runtime and synthetic fixture evidence retain their recorded scope; this acceptance does not authorize hosted deployment or merge.


## Scope audit (2026-10-29)

The user requested a whole-PR audit for unrelated changes left by prior iterations. Restore the generic cron-test title, generator-owned route formatting and unrelated dependency ordering; remove the temporary MIME release-age exception after validating the frozen lockfile. General Reader settings must retain their prior accepted spelling and format; only first Newsletter issuance has the new lowercase-alphanumeric rule. Retain atomic account-conflict checks required by the setup flow. Private configuration PR #7 now configures dev only; beta/prod/legacy-main domain settings are deferred until dev validation. Earlier plan documents are historical records rather than current construction instructions.

## Local-first, CID and timing revision approval (2026-10-29)

The user approved the reviewed five-part revision and explicitly authorized implementation in the existing worktree, careful review and local API/Web startup for hands-on acceptance. Add independent Newsletter local-first metadata without changing RSS persistence or its stream. Remove Readability while retaining HTML security sanitization and the existing tracking-image filter (explicitly confirmed). Resolve MIME Content-ID references into raster base64 data URLs embedded in stored HTML; ordinary binary attachments remain metadata-only. Correct existing Mobile bookmark source/original-link presentation only, deferring a Mobile Newsletter feature. Record privacy-safe complete email-event and phase timings with a five-second observation target, without a timeout, Workflow or raw-EML persistence. Hosted console changes and PowerSync publication remain operator actions, not authorization to deploy.

## Local-first revision acceptance (2026-10-29)

After the revised local environment was made available, the requesting user reported that local testing was normal and explicitly authorized committing and updating the original PR. This acceptance covers the local Newsletter revision presented for verification. It does not establish hosted SMTP/PowerSync results or native device acceptance. Mobile remains 1.0.25/build 784 under the user's explicit no-bump decision.
