# Proposal

## Why

Fixing a JavaScript-only production bug currently requires a new native build and store review. The owner wants such fixes delivered quietly over the air through EAS Update, without replacing the whole application, while keeping every update confined to the native build it was made for.

## What Changes

- Add the SDK 58-compatible `expo-updates` native dependency.
- Only EAS Build `production` builds enable updates (the profile sets `SLAX_MOBILE_OTA=1`); they check the EAS `production` channel on every cold start without delaying startup, and a downloaded update applies on the next cold start. Committed native projects and every local build keep updates disabled, so local testing never downloads production bundles.
- Use the `nativeVersion` runtime policy, so an update reaches only installations with the same `version(buildNumber)`.
- Assign the `production` channel in the EAS `production` build profile and in the embedded request header.
- Disable updates for fixture builds and for builds generated with non-production `EXPO_PUBLIC_SLAX_*` origins.
- Add `pnpm mobile -- update:publish` (sets `SLAX_MOBILE_OTA=1`; publishes to `production` with the EAS `production` environment and without local operator configuration) and document eligibility, staged rollout, rollback, quota and store-policy limits.

Non-goals: automatic publishing from CI, in-app update UI or immediate reload, update code signing, and a custom publish guard; the operator decides what to publish following the documented rules.

## Capabilities

### New Capabilities

- `mobile-ota-updates`: production over-the-air JavaScript updates for the mobile application.

### Modified Capabilities

None.

## Impact

- `apps/mobile/package.json`, `pnpm-lock.yaml`, `apps/mobile/app.config.ts`, `apps/mobile/eas.json`, regenerated iOS/Android native projects and `Podfile.lock`; one configuration test.
- `docs/mobile/release.md`, `docs/mobile/integrations.md`, `docs/mobile/observability.md`.
- Builds up to `1.0.25 (793)` cannot receive updates. The human approved `1.0.25 (794)` (previous bound 793) as the first OTA-capable build; it is delivered through the normal EAS build and store flow.
- EAS Update usage becomes a billable EAS quantity; the Free plan covers 1,000 monthly updated users.
- No backend, synchronized schema, application identity, signing or store change.
