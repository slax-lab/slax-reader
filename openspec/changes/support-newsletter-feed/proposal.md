# Proposal

## Why

Users need a dedicated Newsletter receiving address and one Feed destination for RSS and email reading. The legacy mail collector only extracts a URL, has no Worker email entry point, and cannot satisfy this requirement.

## What Changes

- Add an independently gated Newsletter feature with an account-derived, permanent receiving address and user-isolated sender sources.
- Receive bounded MIME messages through the Edge Worker, sanitize the body, and store it in R2 with durable receipt recovery and duplicate suppression.
- Add authenticated Feed read APIs. Newsletter uses REST in the initial rollout; remove its PowerSync stream and client subscription while retaining RSS-only legacy APIs and sync projections.
- Always display Feed in Web, including setup and disabled states, address provisioning, merged reading, and existing RSS management. With Newsletter enabled, read the whole unified Feed through REST for one ordered cursor; RSS-only sessions retain existing local-first PowerSync behavior.
- Use dev feed+account@newsletterreader.slax.dev and production feed+account@newsletterreader.slax.com, one literal feed route plus Subaddressing per environment, and dev-first admission. Preserve existing root-domain mail services and business forwarding.

## Capabilities

### New Capabilities

- `newsletter-feed`: Stable Newsletter addresses, bounded incoming email processing, unified Feed reads, independent feature gates and dev rollout.

### Modified Capabilities

- `rss-labs`: Always-visible Web Feed destination and kind isolation for RSS APIs, polling, quotas, retention and synchronization.

## Impact

API Workers, PostgreSQL schema and migration, R2 objects, shared TypeScript contracts, PowerSync rules and Web local schema/UI. Introduces pinned postal-mime. Mobile, CLI and Extension continue using unchanged RSS contracts. The user explicitly deferred Newsletter PowerSync on 2026-10-27 to simplify initial debugging. The user superseded the root-domain pilot on 2026-10-27 and explicitly selected the fixed feed+ prefix and newsletterreader subdomains. Production activation still requires the compatibility release on all Workers sharing the database, a verified production Worker target, and preservation of existing business forwarding. Only newsletterreader.slax.com receives production mail; root slax.com Feishu MX and slax.app forwarding remain outside this change.
