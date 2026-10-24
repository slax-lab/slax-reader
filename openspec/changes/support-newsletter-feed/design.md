# Design

## Context

See proposal.md for motivation. The existing RSS feed, subscription and entry tables already separate metadata from sanitized R2 body objects. The legacy email collector is unwired and logs content; it is not reused. The user confirmed dev API reader-api.slax.dev is served by reader-backend, and slax.dev currently has an active Catch-all Drop rule. Beta and main share PostgreSQL, so new email admission must not precede RSS-kind filtering on all serving releases.

## Goals / Non-Goals

Deliver the reviewed dev pilot without changing existing Mobile RSS contracts. Do not implement attachments, automatic unsubscribe, sending email or Newsletter save to Inbox. No production DNS changes are included.

## Decisions

### Identity and permanent reservation

A dedicated sr_newsletter_address registry stores canonical domain/local_part, owner and retirement time. Provision under a user row lock and a namespace advisory lock; preserve a unique reservation forever. Read an existing binding before validating the current account. First provisioning requires an ASCII email-safe account (lowercase, 1–64 characters, dots/hyphens/underscores permitted, no leading/trailing or repeated dots). Conflicts are actionable errors; never silently invent a suffix. Account updates use case-insensitive availability checks serialized by advisory lock, avoiding a destructive unique migration over legacy data. Account deletion retires the address without releasing its name.

### Admission and processing

NEWSLETTER_ENABLED must equal the string true and NEWSLETTER_DOMAIN must be an explicit valid domain; absent configuration disables provisioning and email admission. Dev uses slax.dev. Validate the SMTP envelope recipient against the complete configured domain and active registry plus Newsletter Lab. Header To never controls ownership. Reject invalid/disabled/overlimit messages with a generic permanent reason. Bound raw input to 5 MiB including a streaming byte counter before parsing. Pin postal-mime 4.1.3 (MIT-0) and set MIME part/header/nesting bounds. Its recent release requires an explicit minimumReleaseAgeExclude entry; reviewed package metadata has no lifecycle install hooks and no runtime dependencies. The dependency is needed for MIME decoding and built-in aggregate part/header limits. Ignore attachments, strip CID/relative image references, escape plain text, and reuse RSS sanitization and signed image proxy. Carry truncation through the second sanitizer pass.

Store a private raw R2 object before atomically admitting a receipt. A committed pending receipt is the durable processing obligation; processing may run immediately but cron retries pending receipts with token leases. Failed raw/receipt writes are never acknowledged as success by application code; actual Cloudflare SMTP behavior on these exceptions must be verified in dev. The cron recovery batch handles at most five messages per five-minute tick (60/hour); restrict the pilot to one or two users and monitor backlog age. Pending receipts recover content/DB failures after acceptance without assuming SMTP retries. Completed or cancelled raw objects are garbage collected after a grace period. Never log addresses, bodies or tracking URLs.

Sender source identity is SHA-256(user UUID + normalized header From address), independent of ESP envelope bounce addresses. Synthetic source URLs contain only that hash. Receipt uniqueness is per user, source and Message-ID; fallback hashes sender, subject, Date and stable body. Duplicate delivery is a no-op and does not consume daily quota. Admission is serialized by user lock, counting 200 Newsletter sources (including pending unique sources) and 200 new receipts per UTC day. Final commits recheck user/Lab under the same user lock; disabling/deletion fences in-flight work. Newsletter retains content without RSS 30-day pruning; generic orphan cleanup applies.

### Reads and client compatibility

Add kind='rss' by default to sr_rss_feed. Explicitly filter every legacy RSS operation, including writes, source caps, lease mutation, history and retention. Add /v1/feed/subscriptions, /v1/feed/entries and /v1/feed/entries/:id with required kind DTOs. Authorization remains per active owner and per-kind Lab. Bind cursors to effective kinds, user and source, and validate before anchors against the selected source. Newsletter never triggers RSS network history or favicon synthesis.

rss_v1 retains its previous columns with RSS-only row selection. newsletter_v1 has disjoint source IDs and adds kind to the same local tables. Missing local kind means RSS for older projections. Web independently manages streams and caches, filters disabled kinds, and does not let one failed stream hide healthy owned cache. Feed is always discoverable, with Labs setup, account form, stable address/copy and sender placeholders. Preserve existing view=rss links.

## Risks / Trade-offs

- SMTP exception behavior is provider-controlled: verify actual failure delivery status before expanding the pilot; durable pending receipts handle post-admission failures.
- A permanent public account prefix can be guessed: user-controlled enablement, exact pilot routes and admission limits bound dev exposure.
- Remote images use signed lazy proxy; the source may observe the first cache fetch. Show privacy text.
- Retention is indefinite in dev; caps constrain daily admission, not total lifetime storage. Revisit lifecycle before broad rollout.
- Dashboard rules are operator-managed. Do not use top-level Wrangler addresses until deployment projection restricts it to Edge.

## Migration Plan

1. Apply additive migration to isolated dev PostgreSQL; deploy filtered RSS APIs and sync rules, and the email-capable Edge Worker with admission off.
2. Configure dev NEWSLETTER_DOMAIN=slax.dev and NEWSLETTER_ENABLED=true after confirming dev PostgreSQL, R2 and PowerSync resources match.
3. Provision one or two account addresses, add exact Email Routing rules to reader-backend, preserve Catch-all Drop, and exercise positive/negative/failure scenarios.
4. Stop by deleting/disabling exact rules or setting NEWSLETTER_ENABLED=false. Preserve address reservations and data. Do not roll back the additive schema while new code/data exists.
5. Before beta/main activation, release RSS-kind filtering and sync isolation everywhere sharing PostgreSQL, decide production domain routing, and repeat acceptance. No apex slax.com MX changes.
