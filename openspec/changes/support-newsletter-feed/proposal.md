# Proposal

## Why

Users need a dedicated Newsletter receiving address and one Feed destination for RSS and email reading. The legacy mail collector only extracts a URL, has no Worker email entry point, and cannot satisfy this requirement.

## What Changes

- Add a user-Lab-gated Newsletter feature with an account-derived, permanent receiving address and user-isolated sender sources.
- Receive bounded MIME messages through the Edge Worker, process content quietly, and store HTML in R2 with synchronous publication and duplicate suppression.
- Add authenticated Feed read APIs. Newsletter uses REST in the initial rollout; remove its PowerSync stream and client subscription while retaining RSS-only legacy APIs and sync projections.
- Always display Feed in Web, including setup and disabled states, address provisioning, merged reading, and existing RSS management. With Newsletter enabled, read the whole unified Feed through REST for one ordered cursor; RSS-only sessions retain existing local-first PowerSync behavior.
- Use dev feed+account@newsletterreader.slax.dev and production feed+account@newsletterreader.slax.com, one literal feed route plus Subaddressing per environment, and dev-first operational acceptance with production domains preconfigured. Preserve existing root-domain mail services and business forwarding.

## Capabilities

### New Capabilities

- `newsletter-feed`: Stable Newsletter addresses, bounded incoming email processing, unified Feed reads, independent feature gates and dev rollout.

### Modified Capabilities

- `rss-labs`: Always-visible Web Feed destination and kind isolation for RSS APIs, polling, quotas, retention and synchronization.

## Impact

API Workers, PostgreSQL schema and migration, R2 objects, shared TypeScript contracts, PowerSync rules and Web local schema/UI. Introduces pinned postal-mime. Mobile, CLI and Extension continue using unchanged RSS contracts. The user explicitly deferred Newsletter PowerSync on 2026-10-27 to simplify initial debugging. The user superseded the root-domain pilot on 2026-10-27 and explicitly selected the fixed feed+ prefix and newsletterreader subdomains. Production activation still requires the compatibility release on all Workers sharing the database, a verified production Worker target, and preservation of existing business forwarding. Only newsletterreader.slax.com receives production mail; root slax.com Feishu MX and slax.app forwarding remain outside this change.

## Approved review revision

The user approved the 2026-10-27 plan revision and implementation in the existing worktree. Replace the dedicated address registry at runtime with immutable Newsletter platform bindings; provision through user setting enable and retain read-only address GET. Expand RSS sources into physical `sr_feed` with a transactionally installed old-to-new write mirror and ID-preserving backfill. Remove `NEWSLETTER_ENABLED`; domain configuration follows the latest approved environment policy below. New receives await publication, preserve attachment metadata and existing external links, filter explicit tracking pixels and use quiet shared extraction. Real EML is supplied later. Current sanitized-content recovery remains until hosted SMTP retry behavior is proven; no previous Newsletter implementation is supported.

## First-release simplification (2026-10-28)

The user confirmed that Newsletter has not merged or shipped and explicitly rejected compatibility with earlier versions of this PR. Consolidate its unshipped migrations into the initial feature migration, never create a separate address registry, use a direct BIGINT receipt id with a required platform binding and payload key, and remove legacy UUID/address/raw-mail paths and projections. Preserve the existing RSS compatibility mirror because RSS already ships. Development databases with old trial migration history require separate explicit local repair/reset; do not alter them automatically. Newsletter Save to Inbox remains out of scope; this revision only investigates the current RSS storage behavior.

## Production-domain preconfiguration (2026-10-28)

The user explicitly requested setting the production receiving domain in the existing private configuration PR now, avoiding a later configuration-only PR. Keep dev at newsletterreader.slax.dev and set beta, prod and the legacy main copy to newsletterreader.slax.com. This supersedes the earlier empty-domain pilot gate. A valid domain permits user-Lab provisioning once matching code is deployed; real receiving still requires Cloudflare DNS/Subaddressing and the literal feed route. Operational acceptance starts in dev; do not change remote routing or deploy as part of this configuration update.
