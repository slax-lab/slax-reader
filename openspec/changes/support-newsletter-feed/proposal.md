# Proposal

## Why

Users need a dedicated Newsletter receiving address and one Feed destination for RSS and email reading. The legacy mail collector only extracts a URL, has no Worker email entry point, and cannot satisfy this requirement.

## What Changes

- Add an independently gated Newsletter feature with an account-derived, permanent receiving address and user-isolated sender sources.
- Receive bounded MIME messages through the Edge Worker, sanitize the body, and store it in R2 with durable receipt recovery and duplicate suppression.
- Add authenticated Feed read APIs and a Newsletter PowerSync stream while retaining RSS-only legacy APIs and sync projections.
- Always display Feed in Web, including setup and disabled states, address provisioning, merged reading, and existing RSS management.
- Start with exact routing rules on slax.dev pointing to reader-backend. Admission remains off by default everywhere.

## Capabilities

### New Capabilities

- `newsletter-feed`: Stable Newsletter addresses, bounded incoming email processing, unified Feed reads, independent feature gates and dev rollout.

### Modified Capabilities

- `rss-labs`: Always-visible Web Feed destination and kind isolation for RSS APIs, polling, quotas, retention and synchronization.

## Impact

API Workers, PostgreSQL schema and migration, R2 objects, shared TypeScript contracts, PowerSync rules and Web local schema/UI. Introduces pinned postal-mime. Mobile, CLI and Extension continue using unchanged RSS contracts. Production activation requires a separate verified domain decision and the compatibility release on all Workers sharing the database.
