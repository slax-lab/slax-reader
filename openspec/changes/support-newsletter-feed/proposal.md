# Proposal

## Why

Users need a dedicated Newsletter receiving address and one Feed destination for RSS and email reading. The legacy mail collector only extracts a URL, has no Worker email entry point, and cannot satisfy this requirement.

## What Changes

- Add an independently gated Newsletter feature with an account-derived, permanent receiving address and user-isolated sender sources.
- Receive bounded MIME messages through the Edge Worker, sanitize the body, and store it in R2 with durable receipt recovery and duplicate suppression.
- Add authenticated Feed read APIs and a Newsletter PowerSync stream while retaining RSS-only legacy APIs and sync projections.
- Always display Feed in Web, including setup and disabled states, address provisioning, merged reading, and existing RSS management.
- Use `<account>@slax.dev` for dev and `<account>@slax.app` for production, with one root-domain Catch-all per installation. Start on dev through reader-backend; keep beta/production admission disabled until their separate compatibility and routing acceptance.
- Reserve `daguang@slax.app` for its existing business forwarding rule. Reject Newsletter provisioning and delivery for this address without blocking the same account on slax.dev or changing an already issued different address.

## Capabilities

### New Capabilities

- `newsletter-feed`: Stable Newsletter addresses, bounded incoming email processing, unified Feed reads, independent feature gates and dev rollout.

### Modified Capabilities

- `rss-labs`: Always-visible Web Feed destination and kind isolation for RSS APIs, polling, quotas, retention and synchronization.

## Impact

API Workers, PostgreSQL schema and migration, R2 objects, shared TypeScript contracts, PowerSync rules and Web local schema/UI. Introduces pinned postal-mime. Mobile, CLI and Extension continue using unchanged RSS contracts. The user confirmed the root-domain decision and business reservation on 2026-10-27. Production activation still requires the compatibility release on all Workers sharing the database, a verified production Worker target, and preservation of the existing business forwarding rule. The slax.com Feishu mail service is outside this change.
