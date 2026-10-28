# Independent Newsletter Storage and Inbox Copies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep shipped RSS unchanged, implement Newsletter in one purpose-built mail table, and save a separate private R2 snapshot into Inbox on demand.

**Architecture:** `sr_platform_bind` owns receiving addresses. One `sr_newsletter_feed` row owns one incoming message, including its admission/deduplication state and final content pointer. A read-only Feed facade merges existing RSS reads with Newsletter rows. Inbox saving copies the received body into the established bookmark snapshot format and atomically publishes a private bookmark.

**Tech Stack:** Existing TypeScript Workers, PostgreSQL/Prisma, R2, shared contracts, Nuxt/Vue and Vitest. No new external service or dependency.

**Spec:** This document's proposed design below amends `openspec/changes/support-newsletter-feed/`. OpenSpec artifacts were reconciled with this approved revision before implementation. The user approved this plan on 2026-10-28 and later explicitly changed Inbox copies to ordinary account-default sharing during acceptance. That later request supersedes the initial disabled-sharing decision; implementation is authorized in the existing worktree.

## Status and scope

- Requested on 2026-10-28; inspected application PR #349 at `9f9594fbe3c6a023426e23384193ccaf20908ce0`. The PR is open and unmerged. Inspection baseline: `origin/dev`, merge base `f217f465c736a6b80621f78111e80ef6e833f27a`.
- The user authorized implementation, original PR updates and local integration startup on 2026-10-28. Obtain hands-on acceptance of the new save flow before the PR handoff.
- Review status: independently reviewed and corrected on 2026-10-28; no unresolved Important findings or Nits. Human proposal review approved on 2026-10-28, with the later acceptance correction changing new copies to ordinary account-default sharing. The source header reuses the existing Source module. See the final review record.

## Global Constraints

- Directly rewrite the unshipped initial Newsletter migration. Do not add cleanup migrations, trial-data compatibility, RSS data copies/backfills, mirrors or automatic local-database repair. Operator test data is disposable.
- Preserve `sr_rss_feed`, `sr_rss_subscription`, `sr_rss_entry`, `sr_rss_save_job`, RSS HTTP contracts, fetching/history/quotas/retention/save behavior, and RSS PowerSync names/rules. Newsletter must not write any RSS table.
- Remove `sr_feed` and `sr_newsletter_receipt` from the unshipped model/DDL and runtime. Do not rename a cloned RSS model to Newsletter.
- Keep stable `newsletter` addresses in existing platform bindings, existing setting enable/disable integration and `feed+<account>` addresses. Dev: `newsletterreader.slax.dev`; beta/prod/legacy-main: `newsletterreader.slax.com`.
- Retain 5 MiB per incoming EML, 200 sender sources per user and 200 newly admitted messages per UTC day. A replay of an existing identity does not consume another slot.
- No automatic Newsletter processing recovery, retry timer/counter, replay payload, queue or PowerSync stream. A pending message needs an actual new delivery or explicit EML replay to be processed again. Do not promise SMTP sender retries.
- Retain content extraction/fallback, sanitization, signed image proxying and explicit tracking-pixel filtering. Existing HTTP(S) attachment links and binary attachment names/explanations remain; do not store attachment binaries.
- Newsletter bodies have no RSS 30-day expiry. Inbox copies and Feed originals own different object keys and lifetimes. Existing image-proxy cache URLs can remain identical; copying a body does not download all remote images.
- Keep unrelated user deletion, collection, payment and scheduled work. Durable project documentation is English; human communication can be Chinese.

## Review Focus

1. Two incoming events with the same identity must publish one coherent body/metadata pair, without expired-writer overwrites or double quota charges.
2. Pending receive remains cancelled across disable/re-enable; saving rechecks the current Lab and live owner at commit. Already saved Inbox content remains readable after disabling Newsletter.
3. Concurrent/repeated saves and lost COMMIT acknowledgements must not create multiple bookmarks, erase a successful copy or overwrite user annotations.
4. A merged page must preserve global ordering across kinds, cursor ownership/filter gates, source isolation and unchanged RSS history behavior.
5. R2 failures and cleanup must not leave a published missing body, delete a referenced object or let Newsletter cleanup/retention affect RSS or Inbox copies.

## Proposed design

### 1. What the current code actually does

`sr_feed` is a source table cloned from `sr_rss_feed`, including etag, polling, history and failure fields. It is not a per-message receipt table. Current Newsletter receive writes a receipt, then a generic source, an RSS subscription and an RSS entry. `dbRss.ts`, RSS retention, RSS body storage and PowerSync rules have consequently acquired Newsletter-specific guards.

`sr_newsletter_receipt` is removable as a separate entity, but unique message identity, admission limits and disable/deletion fencing remain actual requirements. Put these responsibilities on the message row rather than silently dropping them or recreating a second ledger under another name.

RSS Save to Inbox currently acquires a bookmark through a crawl workflow using an article URL. Newsletter must save its received body, including mail with no article URL, so it must not call that RSS path or re-crawl a link found inside the email.

Source trace: `src/domain/newsletter.ts`, `src/infra/repository/{dbNewsletter,dbFeed,dbRss}.ts`, `src/domain/rss.ts`, `src/utils/snapshotBundle.ts`, `src/domain/{bookmarkFork,mediaSnapshot,userDeletion}.ts` under `apps/api`; `packages/contracts/src/{feed,rss}.ts`; Web `useRss.ts`, `RssPanel.vue` and `Article/BookmarkArticle.vue`.

### 2. One table, one row per message

Create `sr_newsletter_feed` from the following requirements, not from `LIKE sr_rss_feed`:

| Column | Type / default | Concrete purpose |
| --- | --- | --- |
| `id` | BIGSERIAL primary key | Single stable message identity; keep BIGINT as decimal strings outside PostgreSQL |
| `user_id` | INTEGER NOT NULL | Owner check in every read/write and quota query |
| `source_key` | TEXT NOT NULL, 64 lowercase hex | Opaque, stable per-owner sender key; SHA-256 of user UUID + newline + normalized sender; indexed source filtering without email addresses in selectors |
| `sender` | TEXT NOT NULL | Canonical sender mailbox from the parsed From field; not an authenticated sender claim |
| `sender_name` | TEXT NOT NULL DEFAULT '' | Sender display label; falls back to sender |
| `message_key` | TEXT NOT NULL, 64 lowercase hex | Existing Message-ID/fallback hash, scoped to owner and source |
| `state` | TEXT NOT NULL DEFAULT 'pending' | CHECK `pending`, `ready`, `cancelled`; the same row is admission and final mail |
| `title` | TEXT NOT NULL DEFAULT '' | Mail subject |
| `summary` | TEXT NOT NULL DEFAULT '' | Existing bounded plain-text excerpt |
| `content_key` | TEXT NULL | This message's final Newsletter HTML object; present only when ready |
| `content_truncated` | BOOLEAN NOT NULL DEFAULT false | Accurate existing parser/body truncation flag |
| `published_at` | TIMESTAMP(3) NULL | Parsed mail Date, used for display, not admission limits |
| `received_at` | TIMESTAMP(3) NOT NULL DEFAULT now() | First admission time, UTC daily quota and Newsletter timeline order |

Constraints/indexes:

- UNIQUE `(user_id, source_key, message_key)`.
- CHECK that ready rows have a nonempty content key and non-ready rows have no content key. Validate key/sender bounds at admission; sender length at most 254.
- `(user_id, received_at DESC, id DESC)` for timeline and daily admission.
- `(user_id, source_key, received_at DESC, id DESC)` for sender timeline/grouping.

Do not add `kind` (all rows are Newsletter), feed/site URLs, etag/last-modified, polling/history timestamps, refresh cooldown/error/failure fields, lease tokens, lease deadlines, retry/attempt/completion timestamps, attachment bytes, copied-bookmark state or a second UUID identifier.

`source_key` is a deliberate denormalization for opaque indexed filtering, not a fetchable source. Derive the source list from ready rows using the latest `(received_at,id)` label per source. No separate Newsletter source/subscription table. A sender whose first message is pending/cancelled is not displayed. The quota counts distinct sources among pending/ready rows; daily admission counts all newly admitted identities including later cancellations, matching the current admission rule.

Do not store `binding_id`: the existing one-per-user Newsletter binding is verified by its exact captured ID at admission and publication. Application provisioning does not reassign an issued address, so another persistent owner pointer adds no independent message identity. Retain the address uniqueness index and ordinary binding rows during cleanup. Reuse sr_user.deleted_at for revocation; add no binding retirement column or custom trigger.

### 3. Synchronous receive without processing leases

1. Resolve the configured envelope and active platform binding; bounded MIME parsing remains unchanged.
2. In a short transaction, lock the existing `sr_user` row, verify live owner + enabled Newsletter + exact active binding. Resolve the unique message before counting quota. Insert a pending mail row only for a new identity.
3. Ready/cancelled duplicates return without R2 writes. Pending duplicates can attempt processing with their current parsed MIME; no background replay exists.
4. Outside the transaction, sanitize/proxy the candidate and write a fresh immutable object under `newsletter-content/<owner-uuid>/<message-id>/<attempt-uuid>.html`. Never overwrite an object's key from another attempt. This is the final-body namespace, not a stored recovery payload.
5. In a second short transaction, take the same user lock and recheck owner, Lab, exact binding and message state. The first pending-to-ready update publishes the candidate's complete title/sender-name/summary/date/truncation/body together. A later contender sees ready/cancelled and cannot overwrite anything. No R2 I/O occurs under a PostgreSQL lock.
6. A failed write leaves the row pending and propagates failure. A later actual delivery may retry. Concurrent deliveries may perform redundant temporary writes, but only one object is referenced; this consciously avoids a lease subsystem.

Disabling Newsletter, under the same user lock, changes pending mail rows to cancelled. Re-enabling does not resurrect them. Ready rows remain. Deletion sets the existing sr_user.deleted_at and cancels pending mail under that lock before asynchronous cleanup. Recipient lookup excludes deleted owners; admission and publication recheck the same existing user state. No timestamp-generation field is needed: the cancelled row is the durable barrier across an off/on cycle.

Known losing attempts remove only their own unpublished key. For an unknown database COMMIT outcome, read authoritative state before cleanup; an uncertain/missing result is not proof of rollback. Retain ambiguous objects; background collection is deferred and must not be promised.

### 4. Independent storage and cleanup

Add `NewsletterContent` with `store/read/discard` and the Newsletter prefix only. Reuse existing pure sanitizer and image signer without editing RSS files or using `RssContent` as its storage owner. Newsletter details never expose an R2 key or raw mailbox recipient.

The user deferred Newsletter orphan-body collection on 2026-10-28. Do not register a Newsletter cron, list Newsletter objects in a background scan, maintain a GC cursor or add a reference-lookup index. Keep immediate discard of known unpublished candidates and the existing five-minute per-attempt publication deadline. Interrupted writes or ambiguous commits can leave orphan R2 objects until a later iteration.

Owner deletion deletes Newsletter rows/content in bounded batches while the owner is already revoked. Delete only that owner's referenced keys. If an object delete fails after its row was removed, the first release may retain that orphan; no background collector guarantees its removal. Keep the ordinary Newsletter binding row as a permanent address reservation; no separate retirement state is needed. Inbox copies continue through established bookmark trash/deletion ownership; Newsletter ingestion has no background collector for their namespaces.

Do not add a project-wide snapshot GC/recovery system in this revision. An interrupted Inbox copy before publication or an indeterminate COMMIT can leave unreachable objects in existing snapshot namespaces, as in the current snapshot copy path. Known failures are cleaned and ambiguous objects retained for safe diagnosis; no published body is deleted to avoid this limited orphan risk. Record that limitation explicitly.

### 5. Restore RSS and keep the Feed read facade

- Restore the shipped RSS model with no `kind` field. Remove the Newsletter migration's RSS locks/ALTER/clone/mirror/trigger/backfill. Do not add DROP/DELETE operations for unshipped trial tables.
- Restore Newsletter-induced diffs in `dbRss.ts`, `domain/rss.ts`, `domain/rss/content.ts`, `domain/rss/feed.ts`, the RSS image mode in `utils/imager.ts`, RSS tests and the RSS branch of `dbLab.ts` against the reviewed upstream baseline. Keep any Newsletter-only oversized-text normalization or failed-image removal in its own parser/content adapter; do not preserve it as a hidden RSS behavior change. Any unrelated RSS bug fix must leave this Newsletter PR and be separately proposed.
- Restore RSS PowerSync SQL and Web RSS local schema/adapters to their upstream values. With physically separate tables, Newsletter cannot enter RSS streams, polling, quotas, history or expiry. No new PowerSync deployment is needed for Newsletter.
- Keep the unified Web Feed entrance and independent Labs. Restore upstream `useRss.ts` and `RssPanel.vue`; put Newsletter/mixed behavior in new `useFeed.ts` and `FeedPanel.vue`. The Feed panel delegates RSS-only rendering/state to the unchanged RSS panel; its mixed REST state is active only while Newsletter is enabled. This keeps RSS-only REST fallback as well as PowerSync unchanged, instead of hiding a new data path inside the RSS composable. Preserve cached windows and request-generation fencing when changing modes. RSS-only sessions retain existing PowerSync. Newsletter-enabled combined sessions retain one REST timeline; this is presentation/read aggregation, not a change to the RSS storage/write pipeline.

The facade uses existing RSS tables read-only plus ready Newsletter rows. RSS subscription IDs and entry IDs stay unchanged UUID strings. Newsletter source selectors are `newsletter:<source_key>` and entry IDs are `newsletter:<decimal-id>`. Validate both formats strictly; never convert BIGINT to JS Number. Update Feed-only validation and errors; `/v1/rss` validation/contracts remain unchanged.

Use `UNION ALL` of explicitly mapped branch projections and one outer sort/limit, not concatenate separately paginated API results. Alias Newsletter `received_at` as its effective `sort_at`; RSS retains its existing `sort_at`. The global key is `(sort_at DESC, kind DESC, native_id DESC)`, with a typed cursor carrying the boundary kind/native ID plus user, selected source and enabled kind set. Implement branch predicates for the same order and type, rather than comparing decimal IDs lexicographically. Test same-time RSS/Newsletter ties and Newsletter IDs 9/10. Invalidate old unshipped Feed cursors; no compatibility decoder.

History fetch remains RSS-only, using the current Web expanded-window algorithm rather than a new server session or seen-ID ledger:

1. Normal Feed reads are strict keyset reads of cached data only. The facade obtains RSS source DTOs through the existing public `RssService.subscriptions`; it maps entry DTOs itself and never exposes private RSS methods.
2. Only an explicit `fetch_history=1` Load more probe, after the cached page is exhausted and with RSS enabled, may call the existing public `RssService.entries`. For that call use the selected RSS subscription (or all RSS), `limit=1`, and the existing `encodeRssCursor` anchored at the oldest currently cached, authorized RSS entry. Use `cursor`, not `before`, so the existing RSS `is_history` escape does not keep returning all old history. With no cached RSS rows, omit that cursor. This gives the unmodified RSS service zero rows beyond the cache and lets its existing eligibility/cooldown and maximum-three-source logic fetch history. Never call it for a Newsletter source.
3. That first request is a history-population probe. Preserve Web `reload(more)` behavior: ignore the probe's item list, then reread the loaded window plus one page from the Feed head using strict new cursors; atomically replace the old window after success. History inserted above the old boundary is therefore included, with no duplicate append or lost backdated entry. Old UI rows remain visible on errors. No list of seen IDs or new cursor compatibility state is stored.
4. Compute history status from the existing RSS fields/helper and recheck owner/enabled kinds after network work. Ordinary load/refresh never fetches remote history. Tests must cover repeatedly loading more than 50 historical RSS rows, newly inserted history above the prior boundary, and Newsletter-only mode making no RSS calls.

Change `FeedSubscription` to a discriminated union: the RSS variant is unchanged `RssSubscription & {kind:'rss'}`; the Newsletter variant contains only id/kind/title/sender. Do not fabricate next-fetch/check/error fields for mail sources. Keep common entry fields consumed by the UI, a Newsletter-only variant and nullable article/image URLs. Preserve the existing Feed endpoints; add `POST /v1/feed/entries/newsletter:<id>/save`, which saves owned ready mail only. Existing RSS save endpoint/path remains unchanged.

### 6. Save to Inbox by copying the mail snapshot

This endpoint requires authenticated live owner, enabled Newsletter and an owned ready mail. Missing/foreign/not-ready IDs return the same 404 shape. Use the existing Feed private/no-store envelope; retryable storage/database failures return 503. A successful response means copied content and the private bookmark/relation are committed, not that an asynchronous crawl was admitted.

Use stable internal bookmark identity `slax-newsletter://message/<id>` with `private_user=user_id`, together with the existing `(target_url,private_user)` uniqueness. Do not use a URL scraped from the mail as its identity. No new bookmark table or saved-flag column is needed. Feed `bookmark_user_uuid` is resolved from the live bookmark relation; a trashed relation appears unsaved.

Flow:

1. Read any existing successful same-owner bookmark as a hint only; all return/restore decisions are finalized under the locked validation in step 3. If live, return `already_saved` without copying or bumping personal state, including leaving an already archived bookmark archived; this matches existing RSS re-save behavior. If in Trash with a usable private snapshot, restore to unarchived Inbox, clear only deletion state, preserve stars/tags/marks/title, and return `restored`. A permanently deleted copy can be created again.
2. For a genuinely new destination, create an attempt UUID and a `SnapshotBundle` scoped to it. Read the source's owned content with ETag checking; copy with `copyHtml`, then embed the established `{schema:1,kind:'html'}` marker. The current reader rejects snapshot-owned HTML without that marker. Result: new `html/body/<uuid>.html` and `text/body/<uuid>.txt`, distinct from the Newsletter original; no remote crawl or binary attachments.
3. Assert source unchanged. In one short transaction, lock user then message, recheck live owner, enabled Lab, ready state and exact source content key, resolve a concurrent winning bookmark again, and otherwise create `sr_bookmark` (`private_user`, success, content keys, text count, subject/byline/site/summary/date) plus `sr_user_bookmark` (type 0, Inbox, not starred). The same owner→message→destination transaction handles already-saved validation and Trash restore too, even when no R2 copy was needed; remove the matching sr_user_delete_bookmark tombstone on restore. Do not use `createBookmarkBase` as an opaque shortcut: it publishes pending rows/side effects too early for this synchronous copy.
4. Concurrent losing attempts discard only their own unpublished bundle. On unknown COMMIT outcome, reconcile by owner + stable target and exact copied keys; preserve uncertain files. Do not overwrite an existing successful snapshot or its personal state.
5. Reuse established bookmark text indexing/user-search relation, cache invalidation, add changelog and notification helpers. Add an opt-in strict private-snapshot indexing path through `SearchService.addSearchRecord` and `Normalizer`: existing callers retain their current non-strict results; the Newsletter path treats tokenizer non-OK/malformed responses and processing exceptions as failure, not a fulfilled empty shard list. Nonempty valid input must not be marked repaired after normalization failure; legitimate empty/punctuation-only text remains a supported empty result. Remove raw title/content/error-body diagnostics from the shared normalization/indexing sinks; use only sanitized category/bookmark ID. Cover fulltext and semantic catch paths. The existing `MediaSnapshotService.indexSnapshot` call by itself is not sufficient proof of successful strict repair. Make the private path's FTS replacement atomic with a narrow `BookmarkSearchRepo.replaceBookmarkRawAtomic(ctx.env.DB_FULLTEXT, bookmarkId, shards)` helper: one D1 batch contains the bound DELETE and INSERT statements (or just DELETE for a legitimate empty result). The current separate delete/insert helper is not concurrency-idempotent. Existing generic callers need no behavior change or new unique-index migration. Assert parallel repeat saves leave exactly one current row per bookmark/shard, including the rollback of a failed batch. The committed row is the source of truth; index/effect failure must not roll back or delete it. A repeated save repairs idempotent index/cache effects, with changelog/notification emitted only for the actual create/restore transition. Do not report notification failure as failure to copy.

Response reuses the existing save shape: `{bookmark_user_uuid, result:'created'|'restored'|'already_saved', processing_status:'ready'}`. If a matching destination exists but has missing content/invalid state, return a retryable failure rather than treating it as saved or overwriting annotations; diagnose separately. No new save job or recovery framework.

Saving checks the Lab at admission and final publication; if the user disables and re-enables before that final check, the still-owned ready source may be saved. No extra toggle-generation column is added solely to cancel an explicit save, and Web ignores responses from an older Lab/session generation. User deletion always prevents a final commit. The saved bookmark is independent: disabling Newsletter hides Feed mail but does not gate its Inbox copy. Deleting a copy does not delete the mail. Deleting the mail through owner cleanup does not make the bookmark share its R2 pointer; deleting the whole user still removes both independently. Test lifetimes by removing one set of keys in an isolated fixture, not by adding a new user-visible mail-delete feature.

`slax-newsletter` is an internal identity, not a network URL. Add minimal recognition to bookmark source UI and all generic refresh/retry/acquisition entry points: reuse SnapshotArticleSource with a localized Newsletter label and sender, omitting the old paragraph and any external link; reject web re-crawl without changing a successful row to pending. Standard bookmark read/highlight/star/tag/archive/share behavior continues. Approved sharing default (revised during acceptance on 2026-10-28): a NEW Newsletter copy creates no single-bookmark override and follows the ordinary read/fork/collection sharing policy based on the owner's current global `snapshot_sharing`. `private_user` isolates storage/ownership and does not imply public-read denial. Do not force sharing on or off or change the global setting. Repeat/restore preserves the existing per-bookmark sharing choice, including a deliberate explicit share; later sharing continues through existing owner actions. Test anonymous/other-user access with global sharing on/off and explicit per-bookmark overrides. The copy does not re-enter the web acquisition/AI moderation pipeline; it uses the already processed received body. Do not claim it underwent the crawl workflow's separate moderation calls. Verify Mobile/CLI/Extension reading of the new normal HTML bookmark; only change application logic if evidence requires it, and ask the human about each affected application version before committing such changes.

### 7. Web behavior

Reuse RSS Save to Inbox placement and established button states for Newsletter in both list and preview. A mail needs no article URL to save. Show pending, retryable error, saved/open-bookmark states. Update only the selected Newsletter message's state by kind+id, never every row whose article_url is null. Fence late responses by owner, Labs and request generation. Refresh Feed saved state after bookmark Trash/restore operations.

Remove the address-card text saying saving is unavailable; keep sender-management and automatic-unsubscribe limitations. No new layout, theme, icon set or source-management feature. This is a local adjustment within the existing Save action pattern; human hands-on acceptance of the implemented action is still required under DESIGN.md §10.2. A structural redesign would need the optional demo offer before dependent work.

## Implementation tasks

### Task 1: Lock scope and independent schema

**Files:** amend the existing OpenSpec proposal/design/tasks and both existing delta specs after human review; edit `apps/api/prisma/pgsql.prisma` and `prisma/pg_migrations/20261022090000_newsletter_feed/migration.sql`; tests `test/infra/newsletterMigration.test.ts`, `test/domain/rss/repository.test.ts`, `test/infra/powersyncRules.test.ts`.

**Interfaces:** schema/constraints in Design §2; RSS tables and projections match upstream with zero Newsletter DDL/data writes.

- [ ] Write RED migration assertions: `sr_newsletter_feed` exists with the reviewed columns; `sr_feed`/`sr_newsletter_receipt` do not; every RSS table/trigger/index/column is unchanged before/after migration, including populated RSS data and concurrent RSS writes.
- [ ] Apply the direct initial-DDL/model rewrite and restore RSS-only backend/sync fixtures, including RSS sanitizer/image failure behavior. Keep the address uniqueness index without new binding columns or triggers. Remove obsolete compatibility claims and restore original RSS specs; do not weaken shipped RSS guarantees.
- [ ] Run `pnpm api -- test test/infra/newsletterMigration.test.ts test/domain/rss/repository.test.ts test/infra/powersyncRules.test.ts`. Inspect a real fresh PostgreSQL schema comparison and concurrent-write exercise. No reset/repair/backfill feature is written for operator trial databases.
- [ ] Run required `gen:diff` → inspect SQL → `migration:local` → `gen:all` against owned scratch resources. Consolidate any legitimate unshipped feature difference into the initial migration; omit an empty or trial-cleanup migration. Never hand-edit generated output.

### Task 2: Independent ingest, storage and lifecycle

**Files:** `src/domain/newsletter.ts`, new `src/domain/newsletter/content.ts`, `src/infra/repository/dbNewsletter.ts`, `src/infra/repository/dbLab.ts`, `src/infra/repository/dbUser.ts`, `src/domain/userDeletion.ts`; extend `test/domain/newsletter/repository.test.ts`, new `test/domain/newsletter/content.test.ts`.

**Interfaces:** `NewsletterRepo.admit(recipient, source, message, sender): Promise<{created:boolean,mail:NewsletterMail}>`; `publish(id, ownerId, bindingId, candidate): Promise<{mail:NewsletterMail,published:boolean}>`; `NewsletterContent.store(env, ownerUuid, mailId, parsed): Promise<{key:string,truncated:boolean}>`, `read(key):Promise<string>`, `discard(key):Promise<void>`. IDs remain bigint internally and string at contracts. Every parsed candidate passed to publish carries all metadata and its own key.

- [ ] RED: replay/concurrent publication yields one coherent ready row and no extra quota charge; ready/cancelled replay makes no writes; failure stays pending; only new delivery resumes; no RSS table changes; no original EML/binaries stored.
- [ ] RED: disable→enable and deletion during R2 work fence completion; quotas reserve pending messages under parallel load; same sender across users is isolated; after a write older than five minutes publication fails safely; no Newsletter-specific scheduled handler is registered.
- [ ] Implement §3–4, remove receipt/claim/release code and RSS content injection, preserve parser behavior. Replace receipt cancellation with mail-row cancellation. Keep owner cleanup and immediate unpublished-candidate discard; defer orphan-body collection and its index/cursor; do not re-add recoverNewsletter.
- [ ] Run focused Newsletter/migration/lifecycle/parser tests and actual local email-handler injection. Use native PostgreSQL clients for races; PGlite alone does not prove the multi-connection lock behavior.

### Task 3: Unified read facade over independent storage

**Files:** `src/infra/repository/dbFeed.ts`, `src/domain/feed.ts`, `src/handler/http/feedController.ts`, `packages/contracts/src/feed.ts`; `test/domain/feed/service.test.ts`, new `test/domain/feed/repository.test.ts`; restore `domain/rss.ts` and `dbRss.ts` to upstream behavior.

**Interfaces:** retain GET `/v1/feed/subscriptions`, `/entries`, `/entries/:id`; use typed selectors/IDs and source variants in §5; `FeedRepo` reads ready mail and existing RSS tables, never mutates RSS. Detail dispatches to the correct content owner.

- [ ] Write RED tests for the fixed §5 history probe plus expanded-window algorithm: cached RSS+mail interleaving, tied timestamps, numeric IDs 9/10, source filters, empty-cache RSS backfill with older dates, no repeats/missing entries, A/B isolation and gate/filter changes. Verify the RSS cursor uses the oldest cached row and `cursor` rather than `before`, including a history cache larger than 50 rows.
- [ ] RED these cases plus invalid IDs/cursors, tampered owner/kinds, wrong-source anchors, no enabled kinds, null publication dates, Newsletter-only sessions making zero RSS fetch calls, and unchanged `/v1/rss` requests/responses.
- [ ] Implement independent projections, ordering/cursor and dispatch; remove fake mail polling metadata and calls into newly exposed RSS private methods. Keep contracts/rss.ts and shipped RSS endpoint behavior unchanged.
- [ ] Run Feed and unchanged RSS service/repository/contract tests; exercise full pagination in a real Worker/PostgreSQL environment.

### Task 4: Inbox snapshot copying and bookmark integration

**Files:** new `src/domain/newsletter/save.ts`, new `src/infra/repository/dbNewsletterSave.ts`, Feed controller/service, `packages/contracts/src/feed.ts`; internal-snapshot admission guards in `src/domain/bookmark.ts`, `src/domain/crawl.ts`, `src/infra/repository/dbSyncBatch.ts`, `src/domain/orchestrator/sync.ts`, `src/domain/orchestrator/bookmarkAdd.ts`, and pre-normalization URL-add handling in `src/handler/http/bookmarkController.ts`; `src/utils/snapshotBundle.ts` is reused, not rewritten; narrowly update `src/domain/search.ts`, `src/utils/hybridSearch/normalizer.ts` and `src/infra/repository/dbBookmarkSearch.ts` for strict private indexing, safe diagnostics and atomic D1 replacement; new `test/domain/newsletter/save.test.ts` and `test/infra/newsletterSave.integration.test.ts`.

**Interfaces:** `NewsletterSaveService.save(ctx, id:bigint):Promise<FeedSaveResponse>`; `NewsletterSaveRepo.publish(ownerId, sourceId, expectedContentKey, destination):Promise<{relation,result}>`; all source/destination UUIDs/keys are server-generated; no client-supplied R2 key, owner or URL. Returned response is §6's ready save shape.

- [ ] RED: no-URL mail saves; original and copied HTML keys differ; text+plain HTML marker are present; title/date/sender/attachments/proxy URLs survive; private_user and relation ownership are correct; no single-bookmark override is created and the current account sharing default applies; no crawl/Workflow dispatch.
- [ ] RED: repeated/double-click/parallel saves yield one live bookmark and one published destination; Trash restore preserves marks/tags/star/title; two different mail rows with null article URLs stay independent; permanent copy deletion permits a new independent copy.
- [ ] RED: failure on either R2 member, failed DB commit and lost acknowledgement; tokenizer non-OK/malformed/throw and semantic-index failures with console spies proving no subject/body/email/provider response appears and the strict index result reports failure; concurrent disable/deletion; failed index repair on repeat and parallel idempotent FTS replacement/failed-batch rollback; forged/foreign IDs; anonymous/other-user read/marks/fork/collection access follows global sharing and explicit overrides, and deliberate later sharing preserved on repeat/restore; no new pending bookmark on rejection; independent deletion/read after Newsletter disable.
- [ ] Implement §6 using immutable per-attempt destination keys and existing SnapshotBundle/HTML marker. Add synchronous atomic bookmark/relation publication with ordinary default sharing, safe reconcile/discard and idempotent post-commit effects. Propagate strict indexing failures as a separately reported/logged indexing issue; the copied bookmark stays ready, and repeat save attempts repair it through the strict path. Never claim full search readiness from copy success alone. Add guards preventing internal targets from entering generic crawl/retry, including dbSyncBatch executeCreateBookmark before any success→pending transition, sync/import/orchestrator paths, and URL-add normalization before it prepends https://; no new save queue/lease/outbox.
- [ ] Run snapshot, bookmark access/deletion/fork/indexing regression tests plus native multi-connection save races. Verify original EML links never become bookmark target identity and private content is not logged.

### Task 5: Web action and accepted reading flow

**Files:** new `apps/web/app/components/FeedPanel.vue`, new `app/composables/useFeed.ts`, `app/pages/bookmarks/index.vue`, `app/components/NewsletterAddress.vue`, `app/components/Article/BookmarkArticle.vue`, source-caption helper/component if needed, existing locale files; new `tests/unit/components/FeedPanel.spec.ts` and `tests/unit/composables/useFeed.spec.ts`. Restore upstream `app/components/RssPanel.vue`, `app/composables/useRss.ts`, their RSS tests and RSS local-first files; no Newsletter compatibility layer in those files.

**Interfaces:** RSS save stays `/v1/rss/entries/:uuid/save`; Newsletter save uses the typed Feed endpoint/response. Cache updates match `kind + id`; source variants narrow before RSS polling UI is accessed. In RSS-only mode, delegate to the restored RSS panel/composable; do not run a second mixed REST request walk in parallel.

- [ ] RED tests for Newsletter save without article_url, loading/error/retry/saved states, exact selected-row update, session/gate invalidation and list/detail consistency. Preserve unchanged RSS save/management/local-first tests.
- [ ] Implement the established button pattern and mail-source caption; remove stale unsupported-saving copy. Make internal targets non-clickable and non-refreshable in supported bookmark surfaces, without broad UI redesign.
- [ ] Run Web tests/types and actual browser checks at desktop/768px/narrow width in light/dark/e-ink. Read the saved mail, search its text, highlight it, toggle star/tag/archive and verify Trash/restore behavior.
- [ ] Prepare local API/Web and obtain renewed human hands-on acceptance for save→open Inbox copy and failure→retry. Earlier screenshots do not establish this new action. If CLI/Extension/Mobile runtime logic/output must change, request each affected version decision before committing those changes per repository policy.

### Task 6: Evidence, final review and original PR updates

**Files:** `docs/api/NEWSLETTER-DEV-PILOT.md`, current OpenSpec artifacts/evidence and test guide; private configuration README only if its rollout instructions still mention RSS compatibility publication. Existing PRs #349/#7.

- [ ] Update EML local smoke to assert the independent table and save response/content copies; reuse `newsletter:test` preview/deliver. Keep user EML/reports outside Git and use synthetic fixtures in CI.
- [ ] Run complete API/Web suites, contracts/API/Web types, scoped lint, strict OpenSpec and `git diff --check`; record commands/results and skips. Run actual fresh Edge/Core/PostgreSQL/D1/R2/PowerSync smoke: original RSS still syncs and Newsletter remains REST-only; a newly saved bookmark uses existing ordinary bookmark synchronization.
- [ ] Diff-audit RSS-only files/model/PowerSync projections against the agreed upstream baseline; report and resolve every remaining Newsletter-induced RSS difference. Preserve the currently unowned local PowerSync overwrite during planning; reconcile its identical upstream content explicitly during implementation rather than silently overwriting it.
- [ ] Complete a fresh Bugs/Security/Compliance code review; fix Important findings and close the review loop. Ask version questions only for actually affected packaged applications.
- [ ] Update original PR descriptions with the independent model, copy semantics, new human acceptance screenshots, test evidence and hosted gaps. Preserve reviewer/assignment/draft state. No new private domain values, remote deployment or console mutation as part of this revision.
- [ ] After task PR merge, classify unchecked tasks and archive OpenSpec through a separate documentation PR.

## Console / rollout impact

The address and delivery topology remain unchanged: configured newsletterreader subdomain, Subaddressing and one literal feed route to the deployed email-capable Worker. This revision needs no new domain, route per user, bucket, queue or PowerSync rule publication. No Newsletter-specific cron or GC cursor is required; preserve existing shared schedules and unrelated bindings. Apply the reviewed new initial Newsletter DDL in dev and deploy matching API/Web. Existing RSS production data/writers stay valid without a compatibility rollout. Actual hosted delivery/platform confirmations remain operational acceptance, not a property proved by local injection.

## Sources and verification boundary

- Repository evidence above is inspection at the stated PR head, not proof the proposed implementation exists. No new runtime tests or deployments are claimed in this planning round.
- [Cloudflare D1 batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) documents transactional statement batches; use this for the new private-copy indexing path without a new storage service or schema migration.
- [Cloudflare R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/) documents get/put, streams, metadata and ETag condition handling. Use the existing binding and snapshot helper, not an invented `R2Bucket.copy()` API or additional S3 credentials.
- [R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/) explains immediate object visibility and concurrent-writer behavior. Immutable per-attempt keys and explicit database publication are this design's application-level choices, not an R2/PostgreSQL distributed transaction guarantee.
- [PostgreSQL explicit locking](https://www.postgresql.org/docs/16/explicit-locking.html) documents row locks until transaction end. Lock owner then mail/destination consistently; no network/R2 work under locks.

## Independent review record

Independent read-only review completed on 2026-10-28 against the complete plan and relevant repository paths, followed by rechecking corrections. Passes: Bugs, Security and Compliance; change-id `support-newsletter-feed`. Final verdict: **no unresolved Important findings or Nits; ready for human proposal review**.

Closed issues and builder gaps:

1. Already-saved/Trash paths initially read as fast returns outside final authorization. All decisions/mutations now share owner→message→destination validation; restore removes its tombstone and preserves annotations.
2. `private_user` did not prove private sharing: current visitor/fork/collection access falls back to global snapshot sharing. New copies now explicitly disable the single-bookmark share atomically. This remains a visible proposed product default for human review, not an invented existing guarantee.
3. Existing text normalization could log a subject/body prefix and swallow tokenizer failures; index retries could also race separate DELETE/INSERT statements. The plan now pins a strict private indexing path, safe diagnostics, atomic D1 replacement and failure/concurrency tests. Copy success is separated from search-index success.
4. Acquisition guard scope now names sync-batch success→pending transitions, URL pre-normalization and import/orchestrator entry points. The HTML marker, no-lease cancellation design, GC bounds, numeric cursor order and oldest-RSS-cursor/expanded-window history algorithm were checked against current code.
5. New Feed-owned UI/composable adapters restore the existing RSS implementation rather than growing Newsletter branches inside it. This is a file-ownership choice; the displayed Save action follows the existing pattern.

The reviewer set aside runtime correctness, UX aesthetics, hosted delivery/bindings and actual cross-app compatibility because no implementation exists for this plan; the tasks explicitly require those checks and human acceptance. No unreviewed important implementation question remains. No code or deployment was performed by the reviewer.


## Implementation status (2026-10-28)

Tasks 1–6 are implemented and verified in the existing worktree. The requesting user completed renewed hands-on acceptance on 2026-10-28 and authorized the original PR updates. Later user-requested simplifications reuse existing user-deletion state and defer Newsletter-specific scheduled tasks; their current verification is recorded in validation.md. Archive remains after merge. Detailed current results, superseded runs and explicit gaps are in the change validation.md. Native save concurrency coverage was consolidated into test/infra/newsletterPostgres.test.ts rather than a second duplicate integration file. The actual page mount is pages/bookmarks/index.vue.
