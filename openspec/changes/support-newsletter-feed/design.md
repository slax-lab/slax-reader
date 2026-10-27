# Design

## Context and approved scope

The 2026-10-27 review revision supersedes the initial address registry, deployment boolean and asynchronous acknowledgement design. The user approved implementation in the existing worktree and original PRs. Dev uses `feed+<account>@newsletterreader.slax.dev`; production will use `feed+<account>@newsletterreader.slax.com`. The dev Edge is `reader-backend`, serving `reader-api.slax.dev`. One literal `feed` routing rule plus Cloudflare Subaddressing handles all registered users. Preserve root Catch-all, Feishu MX and `daguang@slax.app` forwarding.

Newsletter remains REST-first. With Newsletter enabled, unified RSS/Newsletter lists and bodies use authenticated REST and one server cursor. RSS-only sessions retain their original local-first stream and REST fallback. No Newsletter PowerSync stream is introduced.

## Identity and user settings

Use a dedicated immutable `newsletter` row in `sr_platform_bind`: `platform_id` and `user_name` contain the canonical complete issued address. First provisioning validates the initial account token as 1–59 safe lowercase ASCII characters, then fixes that address permanently. Renaming does not replace it. A partial unique index on `(platform, platform_id)` protects Newsletter addresses without changing historical OAuth identity semantics. Generic binding upsert/unbind must not mutate this identity, and Newsletter is excluded from login-platform output.

GET `/v1/user/newsletter_address` is read-only and belongs to UserController. POST `/v1/user/setting/enable` with `key=lab:newsletter` enables the Lab and attempts idempotent provisioning; no separate address POST remains. Expected missing/invalid/reserved-account conditions keep the Lab enabled so the first-account form remains reachable. GET exposes the repair state. Infrastructure failures remain failures. Disable cancels pending receipts under the user row lock, but retains address ownership. Deletion retires the binding permanently.

The legacy address table is compatibility state, not a second runtime authority. Preserve its UUID as the binding UUID. Preflight aborts on multiple historical addresses per user, conflicting owners or unmapped receipts. Bidirectional database projections keep old recipients and receipt joins working during overlap. Database guards preserve and retire Newsletter reservations even if old generic deletion code tries to delete all bindings. Destructive legacy-table removal is a later contract release.

## Generic Feed sources and rolling migration

Create physical `sr_feed` with all source fields, indexes, defaults, constraints and existing IDs. Install old-to-new INSERT/UPDATE/DELETE mirroring and explicit-column backfill in one transaction holding `SHARE ROW EXCLUSIVE` on the old source table. This prevents stale backfill overwrite and deleted-row resurrection.

During overlap, RSS writes remain solely in `sr_rss_feed`; generic reads use `sr_feed`, and new Newsletter publication writes `sr_feed`. Keep old storage until every shared-database writer is retired. Generic-only Newsletter orphan cleanup locks the source and rechecks subscriptions before removing entries/source; RSS age pruning stays RSS-only. Completed active Newsletter bodies are not subject to the RSS 30-day policy. R2 garbage collection then removes unreferenced immutable objects after its grace period.

RSS PowerSync queries read physical `sr_feed AS sr_rss_feed`, preserving the old client table name and column projection. Every subscription/entry lookup stays owner-anchored and RSS-kind-filtered. Publish rules only after the matching database and collection-owner migrations. Actual hosted sync alias delivery and A/B isolation remain operator acceptance; service health and REST reads cannot prove them. Existing clients must not reset their local database.

## Receipt identity, synchronous publication and recovery

Physical `receipt_id BIGINT GENERATED ... AS IDENTITY` becomes the receipt primary key and maps to Prisma `id`; retain the old UUID physical `id` as unique `legacy_id` for overlapping callers. Add integer `binding_id` and preserve owner-checked legacy address mapping. Public Feed UUIDs do not change. Preserve old raw/lease/retry columns until pending obligations and old callers are retired; never cast UUIDs into integers.

Receive validates the full envelope domain/prefix, active binding/user/Lab, bounded MIME and unique identity. Limits remain 5 MiB raw input, 200 sources/user and 200 unique admitted messages per UTC day. Sender source identity hashes user UUID plus normalized MIME From. Message-ID dedupe is scoped to owner/source; fallback identity includes body and attachment content hashes. A pending duplicate resumes; completed/cancelled duplicates do not republish or spend quota. Final publication rechecks active owner/Lab/binding and pending lease under the user lock, then atomically creates source/subscription/entry and marks done. No database transaction spans R2 work.

The email event awaits content storage and final publication. Transient failures propagate as sanitized exceptions; policy failures use a generic permanent rejection. Immutable object keys prevent losing concurrent writers from replacing the winning body. Durable cancelled state survives disable/re-enable and fences late work.

Review found that arbitrary Worker exceptions are not a documented guarantee of original-sender retry. Therefore this revision retains bounded recovery while making acknowledgement synchronous: stage only sanitized HTML plus safe MIME metadata as a newly generated MIME document under `newsletter-staged/`. It contains no original EML or binary attachment bytes. Its MIME encoding lets older Workers parse it safely; JSON would have been misparsed and cancelled by old cron code. The existing five-minute Newsletter job recovers these staged receipts and old raw-backed receipts, five at a time, and sweeps unreferenced payloads. Other five-minute jobs must remain. Removing durable staging/recovery requires a separate accepted SMTP failure/retry experiment and drained historical obligations; the requested simplification is deliberately incomplete until that gate passes.

## Private content, attachments and tracking

Use a pure quiet shared ContentParser extraction path that bypasses host hooks, network work and private-content logs. MIME sender/subject/date stay authoritative. Keep sanitized full mail when extraction changes useful text or removes links/images, preserving confirmation and multi-article messages. Append escaped attachment filename/type/size and an explanation after extraction; attachment-only messages remain readable. Preserve existing HTTP(S) download links including signed query parameters. Never manufacture binary/CID download URLs or store attachment bytes.

Before sanitization strips dimensions/styles, remove explicit 1x1, either-axis-zero and clearly hidden images, including hidden ancestors. Never fetch an image to measure it or infer tracking from query parameters alone. Normal images use the existing signed lazy RSS image proxy, with no direct-source fallback/prewarming. Unknown-dimension tracking cannot be detected reliably; privacy text remains.

The local EML tool offers offline HTML/text/report preview with a restrictive CSP and no DB/R2/network, plus localhost-only raw-byte replay through Wrangler's local email endpoint. URLSearchParams preserves `+`. Synthetic fixtures establish local behavior; the user's real EML arrives later and must remain private/local unless separately sanitized and approved.

## Deployment admission and rollback

Remove `NEWSLETTER_ENABLED` from code, types, examples and private configs. A valid `NEWSLETTER_DOMAIN` plus the user Lab controls admission. Only dev has a valid domain during the pilot. Because deployment uses `--keep-vars`, beta/prod/legacy-main set the domain explicitly to an empty string so an old remote value cannot silently remain active. Production later uses the selected `.com` subdomain after its separate readiness review.

Merge reviewed private config before the corresponding API source PR; config merge alone does not deploy. Apply additive migrations, deploy matching Edge/Core/Web, publish RSS compatibility rules, then enable one or two controlled users and the single dev routing rule. Stop by disabling/restoring only that rule and clearing the domain explicitly; preserve all reservations/content and unrelated routing. Hosted base-rule matching, newsletter-platform acceptance, SMTP infrastructure failure/retry and RSS sync delivery are distinct live checks.
