# Passkey authentication

## Why

Phase one provides verified login mailboxes and explicit identity linking. Add Passkey access to the same accounts without changing their existing login/session lifecycle.

## What Changes

- Let authenticated users with a verified `mail` binding register, list, and delete multiple Passkeys.
- Let users enter that mailbox and authenticate with a registered Passkey through the existing `/v1/user/login`.
- Store credentials in a new server-only `sr_user_passkey` table with an autoincrement primary key, unique UUID, and unique credential ID. Keep one `passkey` summary binding per account.
- Store short-lived challenges in existing Upstash Redis; keep Redis calls in infra and reuse native atomic consumption.
- Extend existing Web and native Mobile login/account surfaces, existing account/session guards, and existing rollout profiles.
- Prepare public domain association templates; operator signing identities may be filled in later for native device verification.

## Capabilities

### New Capabilities

- `passkey-authentication`: Register, authenticate with, list, and delete credentials owned by an existing verified-mailbox account.

### Modified Capabilities

None. Existing email and provider authentication behavior is preserved.

## Impact

API, contracts, Web, Mobile native adapters, one additive PostgreSQL table, and public association/configuration templates. No PowerSync/client credential model, email-link login, password flow, account merging, mailbox replacement, or unrelated refactor.

## Review and authorization

On 2026-11-12 the requester approved phase two after reviewing the flow and storage outline in conversation, requested minimal changes following existing naming/layers/call order, and chose direct implementation instead of a demo. They requested a Claude Code review using `claude-opus-5.5` and an independent Codex regression review after implementation. They authorized placeholder association configuration while public signing identifiers are unavailable and chose to retain Mobile 1.0.29 (804). Human hands-on UI acceptance is required before a Draft PR opens.

On 2026-11-12 the requester confirmed development `r.slax.dev`, beta `r-beta.slax.com` and production `r.slax.com`, authorized completing Apple/Android association configuration for all three environments, and requested continuing physical-device verification. Web hands-on acceptance was already complete; Beta/production UI hiding and Mobile 1.0.29 (804) remain unchanged.
