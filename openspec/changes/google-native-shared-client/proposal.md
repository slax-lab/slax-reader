# Proposal

## Why

Native Google sign-in fails with `GOOGLE_SSO_AUD_ERROR` on every environment running the monorepo API (currently beta), while production, still on the legacy backend, works. The iOS and Android apps request ID tokens for the shared Slax server client (`GIDServerClientID` / `setServerClientId`), which is also the Web OAuth client. Native tokens therefore carry the server client as `aud` and the app's own Google client as `azp`. The migrated API compares `aud` with the per-platform client variable, and it also forbids that variable from equalling the Web client. So no configuration can accept the shipped apps. Promoting the API to production unchanged would break native Google sign-in for all users.

## What Changes

- **BREAKING (configuration)**: `GOOGLE_IOS_CLIENT_ID_TEXT` and `GOOGLE_ANDROID_CLIENT_ID_TEXT` now hold the platform's Google *app* client IDs (comma-separated; Android has one per signing certificate) instead of the expected token audience.
- Native tokens must have `aud` equal to `GOOGLE_CLIENT_ID_TEXT` (the shared server client) and `azp` in the platform's app client list.
- A native platform with no app client ID, or whose list includes the server client, is rejected as a configuration error before verification. This replaces the old "must differ from the Web client" guard, which checked the wrong claim.
- Signature, issuer, expiry, required claims, verified email and the Web-only `azp` check are unchanged.

## Capabilities

### New Capabilities

- `google-sign-in`: How the API validates Google sign-in requests per platform, including native audience/presenter rules.

### Modified Capabilities

None.

## Impact

- `apps/api/src/utils/authLogin/authGoogle.ts`, `apps/api/test/utils/googleNativeAudience.test.ts`.
- Worker configuration for every environment running this API: set `GOOGLE_IOS_CLIENT_ID_TEXT` to the iOS app client and `GOOGLE_ANDROID_CLIENT_ID_TEXT` to the Android app clients before or with the deployment. Production keeps its legacy backend values until the API is promoted, and must be updated at that point.
- No contract or client changes.
