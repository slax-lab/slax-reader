# Proposal

## Why

Mobile has no automated native cloud build. Native builds remain explicit local/operator work, and a version bump merged to dev does not produce a reviewable EAS artifact. Running the native toolchain on a GitHub runner would consume macOS runner minutes and duplicate EAS Build capabilities.

## What Changes

- Add a dev-only post-merge workflow that triggers `eas build --platform all --profile production --non-interactive --no-wait` for iOS and Android.
- Require a committed `apps/mobile/package.json` build-number increase, a valid non-decreasing version and a lower `previousBuildNumber`, Mobile CI success, the production EAS profile, the Android platform, the `SlaxShare` app extensions target, and `.easignore` rules that keep mobile fixtures.
- Keep `EXPO_TOKEN` as the only GitHub secret. EAS owns environment/file secrets and signing credentials.
- Do not submit to TestFlight or Play. Store publication remains separately authorized.
- Record the separate delivery intent that amends the earlier "routine Mobile CI never builds native apps" statement for this trigger.

## Capabilities

### New Capabilities

- `mobile-eas-cloud-delivery`: preflight-gated, dev-only EAS cloud builds for iOS and Android that exit after submission.

### Modified Capabilities

None. `expo-mobile-migration` continues to own the routine check/bundle CI; this change adds a separate release trigger and does not reuse its native-job requirements.

## Impact

- `.github/workflows/mobile-eas-build.yml`, `tooling/mobile-eas-release.mjs`, workflow contract tests, `docs/CI.md`, and `docs/mobile/release.md`.
- Requires the repository `EXPO_TOKEN` secret and the existing EAS production file secrets and credentials.
- No product runtime, public API, store submission, or signing ownership change.
