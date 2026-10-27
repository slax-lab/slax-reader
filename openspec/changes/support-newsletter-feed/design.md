# Design

## Context

See proposal.md for motivation. The existing RSS feed, subscription and entry tables already separate metadata from sanitized R2 body objects. The legacy email collector is unwired and logs content; it is not reused. The user confirmed dev API reader-api.slax.dev is served by reader-backend, and slax.dev has an active Catch-all Drop rule. After considering a root-domain pilot, on 2026-10-27 the user selected feed+account@newsletterreader.slax.dev for dev and feed+account@newsletterreader.slax.com for production. Cloudflare Subaddressing matches one literal feed address per subdomain and preserves the complete envelope recipient for Worker dispatch. Root Catch-all rules, slax.com Feishu MX and existing daguang@slax.app forwarding remain unchanged. Beta and main share PostgreSQL, so new email admission must not precede RSS-kind filtering on all serving releases.

## Goals / Non-Goals

Deliver the reviewed dev pilot without changing existing Mobile RSS contracts. Do not implement attachments, automatic unsubscribe, sending email or Newsletter save to Inbox. No production DNS changes are included.

## Decisions

### Identity and permanent reservation

A dedicated sr_newsletter_address registry stores canonical domain/local_part, owner and retirement time. Provision under a user row lock and a namespace advisory lock; preserve a unique reservation forever. Read an existing binding before validating the current account. First provisioning requires an ASCII email-safe account (lowercase, 1–59 characters, dots/hyphens/underscores permitted, no leading/trailing or repeated dots). The fixed feed+ consumes five of the SMTP local part's 64 octets. This is Newsletter eligibility only; global account rules remain unchanged. Conflicts are actionable errors; never silently truncate or invent a suffix. Account updates use case-insensitive availability checks serialized by advisory lock, avoiding a destructive unique migration over legacy data. Account deletion retires the address without releasing its name.

The registry continues storing the canonical account token in local_part, scoped by domain; the complete exposed mailbox is feed+<stored token>@<domain>. This requires no new migration or environment variable. Always validate a stored token before exposing it; an oversized legacy token remains reserved and requires operator remediation rather than returning an invalid mailbox. User renames do not replace a stored token. A prefix/domain transition is an explicit rollout change: old unprefixed/test-domain addresses are not aliases, and external subscriptions must be updated. Never reassign an existing reservation.

No global daguang account restriction is needed in the selected namespace: feed+daguang@newsletterreader.slax.com is distinct from the existing daguang@slax.app business address. Remove the superseded root-domain reservation branch; preserve the business forwarding and verify that root/foreign-domain envelopes cannot enter Newsletter.

### Admission and processing

NEWSLETTER_ENABLED must equal the string true and NEWSLETTER_DOMAIN must be an explicit valid domain; absent configuration disables provisioning and email admission. Dev uses newsletterreader.slax.dev and production uses newsletterreader.slax.com. Keep beta/production admission explicitly false during the dev-first rollout. Validate the SMTP envelope recipient against the complete configured domain and active registry plus Newsletter Lab. Require the exact feed+ prefix (case-insensitive), one validated non-empty account token and no extra plus or whitespace; the bare feed address is a transport entry only and must not resolve to a Reader user. Header To never controls ownership. Reject invalid/disabled/overlimit messages with a generic permanent reason. Bound raw input to 5 MiB including a streaming byte counter before parsing. Pin postal-mime 4.1.3 (MIT-0) and set MIME part/header/nesting bounds. Its recent release requires an explicit minimumReleaseAgeExclude entry; reviewed package metadata has no lifecycle install hooks and no runtime dependencies. The dependency is needed for MIME decoding and built-in aggregate part/header limits. Ignore attachments, strip CID/relative image references, escape plain text, and reuse RSS sanitization and signed image proxy. Carry truncation through the second sanitizer pass.

Store a private raw R2 object before atomically admitting a receipt. A committed pending receipt is the durable processing obligation; processing may run immediately but cron retries pending receipts with token leases. Failed raw/receipt writes are never acknowledged as success by application code; actual Cloudflare SMTP behavior on these exceptions must be verified in dev. The cron recovery batch handles at most five messages per five-minute tick (60/hour); restrict the pilot to one or two users and monitor backlog age. Pending receipts recover content/DB failures after acceptance without assuming SMTP retries. Completed or cancelled raw objects are garbage collected after a grace period. Never log addresses, bodies or tracking URLs.

Sender source identity is SHA-256(user UUID + normalized header From address), independent of ESP envelope bounce addresses. Synthetic source URLs contain only that hash. Receipt uniqueness is per user, source and Message-ID; fallback hashes sender, subject, Date and stable body. Duplicate delivery is a no-op and does not consume daily quota. Admission is serialized by user lock, counting 200 Newsletter sources (including pending unique sources) and 200 new receipts per UTC day. Final commits recheck user/Lab under the same user lock; disabling/deletion fences in-flight work. Newsletter retains content without RSS 30-day pruning; generic orphan cleanup applies.

### Reads and client compatibility

Add kind='rss' by default to sr_rss_feed. Explicitly filter every legacy RSS operation, including writes, source caps, lease mutation, history and retention. Add /v1/feed/subscriptions, /v1/feed/entries and /v1/feed/entries/:id with required kind DTOs. Authorization remains per active owner and per-kind Lab. Bind cursors to effective kinds, user and source, and validate before anchors against the selected source. Newsletter never triggers RSS network history or favicon synthesis.

rss_v1 retains its previous columns with RSS-only row selection. After synchronizing the local-first-ddl upstream change, both feed kinds use inline subscription/source-kind subqueries anchored in current_user_id plus a user-scoped Lab lookup; do not restore the old joined CTEs that enumerate global users. Apply upstream collection-owner migrations before publishing the merged rules. newsletter_v1 has disjoint source IDs and adds kind to the same local tables. Missing local kind means RSS for older projections. Web independently manages streams and caches, filters disabled kinds, and does not let one failed stream hide healthy owned cache. Feed is always discoverable, with Labs setup, account form, stable address/copy and sender placeholders. Preserve existing view=rss links.

## Risks / Trade-offs

- SMTP exception behavior is provider-controlled: verify actual failure delivery status before expanding the pilot; durable pending receipts handle post-admission failures.
- A permanent public account prefix can be guessed: user-controlled enablement, active address ownership checks and admission limits bound dev exposure. The single feed routing rule delivers all feed+ details to the Worker, which rejects unregistered details without creating receipts or objects. Explicit plus-detail rules take precedence in Cloudflare and must be inventoried before acceptance.
- Remote images use signed lazy proxy; the source may observe the first cache fetch. Show privacy text.
- Retention is indefinite in dev; caps constrain daily admission, not total lifetime storage. Revisit lifecycle before broad rollout.
- Dashboard rules are operator-managed. Do not use top-level Wrangler addresses until deployment projection restricts it to Edge.

## Migration Plan

1. Prepare dev NEWSLETTER_DOMAIN=newsletterreader.slax.dev and NEWSLETTER_ENABLED=true in private configuration. Set beta/production domain to newsletterreader.slax.com with admission explicitly false. Keep routing unchanged while deployment readiness is established.
2. Apply the additive migration to isolated dev PostgreSQL; deploy filtered RSS APIs, Web and the email-capable Edge Worker. Publish matching dev PowerSync rules and verify PostgreSQL/R2 bindings and handler readiness.
3. In the slax.dev zone's Email Routing Settings, add newsletterreader as a receiving subdomain and enable Subaddressing. Let Cloudflare create the required subdomain DNS records; preserve root records and Catch-all Drop. Inspect existing literal/plus-detail routes and other rules affected by the zone setting.
4. Provision one or two dev addresses, then add or edit only the literal feed@newsletterreader.slax.dev rule to Send to a Worker -> reader-backend. Do not enter feed+account, a wildcard or one rule per user. Verify actual Cloudflare forwarding retains the plus detail, two-user isolation, unknown/bare/wrong-prefix rejection and representative Newsletter platform acceptance.
5. To stop, disable/restore the pilot's literal feed route and disable application admission. Do not change unrelated Catch-all rules or globally disable Subaddressing if another route relies on it. Preserve schema, content and reservations.
6. Before beta/main activation, release RSS-kind and sync isolation everywhere sharing PostgreSQL, verify the actual production Edge Worker and repeat setup for newsletterreader.slax.com. Preserve root slax.com Feishu MX, slax.app business forwarding and all unrelated rules. Production activation is separate operator work.

Provider behavior and console setup: [Subaddressing](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/#subaddressing), [receiving subdomains](https://developers.cloudflare.com/email-service/configuration/subdomains/), and [SMTP local-part length](https://www.rfc-editor.org/rfc/rfc5321#section-4.5.3.1.1). Real Cloudflare matching and external Newsletter acceptance remain hosted dev tests, not claims of local Worker injection.
