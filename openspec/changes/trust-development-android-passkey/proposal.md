# Development Android Passkey association

## Why

The development phone needs the new native Passkey implementation, but a locally signed APK cannot use the Play signing identity published in PR #590. The requester authorized trusting this test certificate on `r.slax.dev` only after accepting the iPhone native flow.

## What Changes

- Add the actual local Android test certificate to a development-only Digital Asset Links asset.
- Select that asset through existing Web build profiles, retaining Play-only trust for preview, beta and production.
- Preserve the existing Apple document, Android package, credential-sharing permission, UI rollout and authentication routes.

## Capabilities

### New Capabilities

- `development-android-passkey-association`: Select explicit local Android test-certificate trust only for the development Web deployment. This supplements the already merged association publication without repeating its delta requirements.

### Modified Capabilities

None.

## Impact

Web public asset selection and one public development certificate. No private keys, API deployment, account data, UI, Mobile package/version changes, or URL-handling permission. The separate phase-two feature remains pending Android acceptance. On 2026-11-12 the requester explicitly chose development-only debug-certificate association, keeping beta/production unchanged, and authorized clearing both named test devices. The operator merges the supporting Draft PR before physical-device validation continues.
