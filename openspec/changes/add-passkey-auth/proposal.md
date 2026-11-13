# Passkey authentication

## Why

Phase one provides verified login mailboxes and explicit identity linking. Add Passkey access to the same accounts without changing their existing login/session lifecycle.

## What Changes

- Let authenticated users with a verified `mail` binding register, list, and delete multiple Passkeys.
- Let users enter that mailbox and authenticate with a registered Passkey through the existing `/v1/user/login`.
- Store credentials in a new server-only `sr_user_passkey` table with an autoincrement primary key, unique UUID, and unique credential ID. Keep one `passkey` summary binding per account.
- Store short-lived challenges in existing Upstash Redis; keep Redis calls in infra and reuse native atomic consumption.
- Extend existing Web and native Mobile login/account surfaces, existing account/session guards, and existing rollout profiles.
- Configure native domain associations with confirmed public Apple/Play identities; supporting association PRs own the public files and signed-device publication checks.

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

On 2026-11-13 the requester authorized syncing the latest dev into the isolated phase-two branch, preserving #597's provider-first interaction, remembered email and environment-independent email login/binding. They requested building and evaluating an operator-signed local Release test package with test service inputs on the connected Android test phone, and confirmed retaining the new dev baseline Mobile 1.0.30 (805). The earlier 1.0.29 (804) decision is superseded for this synchronized build. Web preview serves `r.slax.dev`; local Web development is a different profile. Passkey UI remains available only in the existing development/test-domain context, including a Release package explicitly configured for `https://r.slax.dev`; email/provider rollout follows the updated dev behavior. Existing authorization to clear the named test phones remains in effect.

The pre-sync Web acceptance is historical. Repeat Web hands-on acceptance on the synchronized build before opening the feature Draft PR; Android native acceptance also remains pending.

On 2026-11-13, after the actual upload-signer mismatch was explained, the requester chose to defer Android physical-device Passkey testing until Beta instead of updating test-domain trust. Do not replace #592's temporary debug certificate with the upload certificate or publish additional trust for this attempt. Beta testing will require a matching installed package signer, published Beta association and API configuration; no successful Android acceptance is inferred from this deferral. This decision does not enable Beta Passkey controls or authorize merging/promotion.

On 2026-11-13 the requester accepted the synchronized Web authentication flow, then requested a visual correction to the Send code and Sign in with Passkey hover borders. Reuse the existing Web soft-accent hover treatment rather than foreground-colored borders; retain primary/secondary button roles and keyboard focus. This narrow correction does not restructure the approved flow. Human visual acceptance of the corrected hover state is required before the Draft PR.

After requesting the hover correction, the requester explicitly authorized creating the feature PR once it is fixed and closing the preview-certificate supporting PR #592. Retain Draft status and target dev. Android native testing remains deferred until Beta.

Final base integration inherits dev `0d01fb26` (#603), whose only change is Mobile 1.0.31 (806). No additional version bump is introduced. The prior 1.0.30 (805) choice and signed test APK describe the earlier baseline; do not downgrade the subsequently merged dev version or claim that the old binary is an 806 native test.
