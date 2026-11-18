# Proposal

## Why

Signed App email-link testing needs website URL associations published before the separate third-phase feature can complete native acceptance. The change requester approved an association-only support Draft PR on 2026-11-18 after reviewing the two-file patch and the distinction between Passkey credential sharing and App Link routing.

## What Changes

- Extend the existing Apple association document with `applinks` for `8G3A932HJG.app.slax.reader`, limited to `/email-login`, preserving `webcredentials`.
- Add Android `delegate_permission/common.handle_all_urls` alongside existing credential sharing for the same package and SHA-256 fingerprint.
- Clarify the older unarchived Passkey delta's no-URL-handling scenario as its credential-only baseline and use the confirmed preview environment name. This prevents contradictory requirements without creating a duplicate delta for that capability.

## Capabilities

### New Capabilities

- `native-email-link-association`: public website-to-App URL association for the email-login entry.

### Modified Capabilities

None in the main spec inventory. `native-passkey-association` still belongs to the already-merged, unarchived `publish-native-passkey-associations` change; its historical scenario is scoped in place rather than copied into this change.

## Impact

Only two Web public JSON assets and necessary OpenSpec records. Existing JSON content-type rules and environment deployment workflows are reused. API, Web interactive pages, native binaries, package versions, signing trust, and private configuration are unchanged. The feature implementation remains on `feat/add-email-link-auth` at `298b19a8`; it is not part of this support PR. This support change has no interactive UI checkpoint.
