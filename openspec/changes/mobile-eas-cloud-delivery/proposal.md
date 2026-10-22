# Proposal

## Why

Mobile has no automated native cloud build. Native builds remain explicit local/operator work, and a version bump merged to dev does not produce a reviewable EAS artifact. Running the native toolchain on a GitHub runner would consume macOS runner minutes and duplicate EAS Build capabilities.

## What Changes

- Add a dev-only post-merge workflow that triggers `eas build --platform all --profile production --non-interactive --no-wait --auto-submit` for iOS and Android.
- Require a committed `apps/mobile/package.json` build-number increase, a valid non-decreasing version and a lower `previousBuildNumber`, Mobile CI success, the production EAS profile, the Android platform, the `SlaxShare` app extensions target, and `.easignore` rules that keep mobile fixtures.
- Keep `EXPO_TOKEN` as the only GitHub secret. EAS owns environment/file secrets and signing credentials.
- Submit each finished build automatically with the `production` submit profile: iOS to TestFlight, Android to the Play internal track. The user explicitly requested `--auto-submit`. App Store review and Play promotion beyond the internal track remain manual.
- Record the separate delivery intent that amends the earlier "routine Mobile CI never builds native apps" statement for this trigger.

## Capabilities

### New Capabilities

- `mobile-eas-cloud-delivery`: preflight-gated, dev-only EAS cloud builds for iOS and Android that exit after the trigger and are automatically submitted to TestFlight and the Play internal track.

### Modified Capabilities

None. `expo-mobile-migration` continues to own the routine check/bundle CI; this change adds a separate release trigger and does not reuse its native-job requirements.

## Impact

- `.github/workflows/mobile-eas-build.yml`, `tooling/mobile-eas-release.mjs`, workflow contract tests, `docs/CI.md`, and `docs/mobile/release.md`.
- Requires the repository `EXPO_TOKEN` secret, the existing EAS production file secrets and signing credentials, and EAS submission credentials (App Store Connect API key, Google Play service account key).
- No product runtime, public API, or signing ownership change.
