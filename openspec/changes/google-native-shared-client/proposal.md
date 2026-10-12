# Proposal

## Why

Native Google sign-in fails on every environment that runs the monorepo API (currently beta) with `GOOGLE_SSO_AUD_ERROR`, while production, still on the legacy backend, works. The iOS and Android apps request ID tokens for the shared Slax server client (`GIDServerClientID` / `setServerClientId`), which is also the Web OAuth client, so their token audience equals `GOOGLE_CLIENT_ID_TEXT`. The migrated API rejects any native platform whose configured client equals the Web client before verifying the token, so the only configuration that matches the shipped apps can never succeed. Promoting the API to production unchanged would break native Google sign-in for all users.

## What Changes

- Native (`ios`, `android`) Google sign-in accepts a configured client ID that is the same as the Web client ID; only a missing native client ID is rejected as a configuration error.
- ID token checks stay unchanged: Google signature, issuer, expiry, required claims, verified email, and `aud` equal to the platform's configured client. The Web-only `azp` check stays.
- Unit tests cover the production topology where Web, iOS, and Android share one client ID.

## Capabilities

### New Capabilities

- `google-sign-in`: How the API validates Google sign-in requests per platform, including the native shared-server-client audience.

### Modified Capabilities

None.

## Impact

- `apps/api/src/utils/authLogin/authGoogle.ts` client-ID configuration guard.
- `apps/api/test/utils/googleNativeAudience.test.ts`.
- No contract, client, or configuration changes. Beta accepts native Google sign-in once this reaches the beta deployment.
