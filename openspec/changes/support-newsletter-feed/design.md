# Design

## Context and approved scope

The 2026-10-27 review revision supersedes the initial address registry, deployment boolean and asynchronous acknowledgement design. The user approved implementation in the existing worktree and original PRs. Dev uses `feed+<account>@newsletterreader.slax.dev`; production will use `feed+<account>@newsletterreader.slax.com`. The dev Edge is `reader-backend`, serving `reader-api.slax.dev`. One literal `feed` routing rule plus Cloudflare Subaddressing handles all registered users. Preserve root Catch-all, Feishu MX and `daguang@slax.app` forwarding.

Newsletter remains REST-first. With Newsletter enabled, unified RSS/Newsletter lists and bodies use authenticated REST and one server cursor. RSS-only sessions retain their original local-first stream and REST fallback. No Newsletter PowerSync stream is introduced.

## Identity and user settings

Use a dedicated immutable `newsletter` row in `sr_platform_bind`: `platform_id` and `user_name` contain the canonical complete issued address. First provisioning validates the initial account token as 1–59 safe lowercase ASCII characters, then fixes that address permanently. Renaming does not replace it. A partial unique index on `(platform, platform_id)` protects Newsletter addresses without changing historical OAuth identity semantics. Generic binding upsert/unbind must not mutate this identity, and Newsletter is excluded from login-platform output.

GET `/v1/user/newsletter_address` is read-only and belongs to UserController. POST `/v1/user/setting/enable` with `key=lab:newsletter` enables the Lab and attempts idempotent provisioning; no separate address POST remains. Expected missing/invalid/reserved-account conditions keep the Lab enabled so the first-account form remains reachable. GET exposes the repair state. Infrastructure failures remain failures. Disable cancels pending receipts under the user row lock, but retains address ownership. Deletion retires the binding permanently.

Newsletter is a first release. Its unshipped migration creates no dedicated address registry or legacy projection. The platform binding is the only receiving identity; retirement and immutable-identity guards preserve reservations through generic deletion. Previously exercised local trial migration history is not shared deployment history and requires explicit operator-directed local repair/reset, not production compatibility code.

## Generic Feed sources and rolling migration

Create physical `sr_feed` with all source fields, indexes, defaults, constraints and existing IDs. Install old-to-new INSERT/UPDATE/DELETE mirroring and explicit-column backfill in one transaction holding `SHARE ROW EXCLUSIVE` on the old source table. This prevents stale backfill overwrite and deleted-row resurrection.

During overlap, RSS writes remain solely in `sr_rss_feed`; generic reads use `sr_feed`, and new Newsletter publication writes `sr_feed`. Keep old storage until every shared-database writer is retired. Generic-only Newsletter orphan cleanup locks the source and rechecks subscriptions before removing entries/source; RSS age pruning stays RSS-only. Completed active Newsletter bodies are not subject to the RSS 30-day policy. R2 garbage collection then removes unreferenced immutable objects after its grace period.

RSS PowerSync queries read physical `sr_feed AS sr_rss_feed`, preserving the old client table name and column projection. Every subscription/entry lookup stays owner-anchored and RSS-kind-filtered. Publish rules only after the matching database and collection-owner migrations. Actual hosted sync alias delivery and A/B isolation remain operator acceptance; service health and REST reads cannot prove them. Existing clients must not reset their local database.

## Receipt identity, synchronous publication and recovery

Use direct `id BIGINT` auto-increment receipt primary keys and required integer `binding_id`, validated against the owning Newsletter platform row. Public Feed UUIDs do not change. Store current recovery references in `payload_key`; no old UUID/address/raw fields exist. Lease/retry fields support the active recovery workflow, not older versions.

Receive validates the full envelope domain/prefix, active binding/user/Lab, bounded MIME and unique identity. Limits remain 5 MiB raw input, 200 sources/user and 200 unique admitted messages per UTC day. Sender source identity hashes user UUID plus normalized MIME From. Message-ID dedupe is scoped to owner/source; fallback identity includes body and attachment content hashes. A pending duplicate resumes; completed/cancelled duplicates do not republish or spend quota. Final publication rechecks active owner/Lab/binding and pending lease under the user lock, then atomically creates source/subscription/entry and marks done. No database transaction spans R2 work.

The email event awaits content storage and final publication. Transient failures propagate as sanitized exceptions; policy failures use a generic permanent rejection. Immutable object keys prevent losing concurrent writers from replacing the winning body. Durable cancelled state survives disable/re-enable and fences late work.

Worker failure has not been proven to cause original-sender retries. Therefore receive awaits publication and retains bounded recovery: stage sanitized HTML/metadata as versioned JSON under `newsletter-staged/`, including truncation and publication date. It contains neither original EML nor binary attachment bytes. Recovery reads the parsed representation directly without reparsing synthetic MIME. The five-minute Newsletter job retries five current pending receipts and sweeps unreferenced staged payloads; shared cron jobs remain. Removing active recovery requires a separate accepted SMTP failure/retry experiment.

## Private content, attachments and tracking

Use a pure quiet shared ContentParser extraction path that bypasses host hooks, network work and private-content logs. MIME sender/subject/date stay authoritative. Keep sanitized full mail when extraction changes useful text or removes links/images, preserving confirmation and multi-article messages. Append escaped attachment filename/type/size and an explanation after extraction; attachment-only messages remain readable. Preserve existing HTTP(S) download links including signed query parameters. Never manufacture binary/CID download URLs or store attachment bytes.

Before sanitization strips dimensions/styles, remove explicit 1x1, either-axis-zero and clearly hidden images, including hidden ancestors. Never fetch an image to measure it or infer tracking from query parameters alone. Normal images use the existing signed lazy RSS image proxy, with no direct-source fallback/prewarming. Unknown-dimension tracking cannot be detected reliably; privacy text remains.

The local EML tool offers offline HTML/text/report preview with a restrictive CSP and no DB/R2/network, plus localhost-only raw-byte replay through Wrangler's local email endpoint. URLSearchParams preserves `+`. Synthetic fixtures and the user's accepted real-EML local test establish local behavior; raw mail remains private/local, and only explicitly authorized screenshots are attached to the PR.

## Deployment admission and rollback

Remove `NEWSLETTER_ENABLED` from code, types, examples and private configs. A valid `NEWSLETTER_DOMAIN` plus the user Lab controls admission. The user approved preconfiguring all environment domains on 2026-10-28: dev uses newsletterreader.slax.dev; beta/prod/legacy-main use newsletterreader.slax.com. This supersedes empty-domain admission during the dev pilot. Matching deployment makes Lab provisioning available in those environments; it does not configure receiving DNS or routes. Because deployment uses `--keep-vars`, a later operator rollback must explicitly clear the domain rather than merely omit its key.

Merge reviewed private config before the corresponding API source PR; config merge alone does not deploy. Apply additive migrations, deploy matching Edge/Core/Web, publish RSS compatibility rules, then enable one or two controlled users and the single dev routing rule. Stop by disabling/restoring only that rule and clearing the domain explicitly; preserve all reservations/content and unrelated routing. Hosted base-rule matching, newsletter-platform acceptance, SMTP infrastructure failure/retry and RSS sync delivery are distinct live checks.
