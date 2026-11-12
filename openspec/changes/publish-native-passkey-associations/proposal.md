# Publish native Passkey association documents

## Why

Native iOS and Android Passkey testing needs public website-to-application associations before the feature can be accepted. The existing well-known URLs currently serve the Web HTML fallback, so the requester authorized a separate supporting Draft PR on 2026-11-12 to publish these documents ahead of the phase-two feature PR.

## What Changes

- Serve Apple AASA and Android Digital Asset Links documents from the existing Web public-assets directory.
- Set JSON content types for the two exact well-known paths through existing Nitro route rules.
- Use confirmed Apple identifier `8G3A932HJG.app.slax.reader` and Android package `com.slax.reader` with its verified Google Play signing-certificate fingerprint.
- Use the same documents on development `r.slax.dev`, beta `r-beta.slax.com` and production `r.slax.com` when the existing Web deployment reaches each environment.

## Capabilities

### New Capabilities

- `native-passkey-association`: Public website-to-native-application credential association documents.

### Modified Capabilities

None.

## Impact

Two static JSON assets and two response-header rules in Web. No native binaries, API endpoints, login/session policy, private configuration, user data or UI rollout changes. This support change is separate from `add-passkey-auth`; their delta capabilities do not overlap. Publication follows the existing human-merged environment workflow.

## Authorization

The requester supplied Apple Team ID, authorized reading the Play Console application-signing information, confirmed all three domains and explicitly selected a separate association-only Draft PR before continuing native acceptance. The Play fingerprint was also checked against the installed Android application's public signing certificate. There is no interactive UI change, so no material-UX demo or UI hands-on checkpoint is introduced by this support PR.
