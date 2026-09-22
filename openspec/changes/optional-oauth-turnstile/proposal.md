# Proposal

## Why

The Web app currently treats Google OAuth, Apple OAuth, and Turnstile as equally required declarations even though they serve different purposes. A missing Apple or Turnstile value can leave a visible login or verification control that cannot complete, while Google login cannot construct a valid authorization URL without its client ID. The configuration contract should make the required Google path explicit and let self-hosted or local deployments omit optional providers cleanly.

## What Changes

- Make `GOOGLE_OAUTH_CLIENT_ID` a non-empty required Web configuration value, mark it as blocking in `preflight`, and document how to create a Google OAuth Web client ID.
- Treat `APPLE_OAUTH_CLIENT_ID` as an optional provider: when it is absent or empty, hide Apple login buttons and avoid exposing an unusable Apple login path.
- Treat `TURNSTILE_SITE_KEY` as an optional protection feature: when it is absent or empty, do not render Turnstile widgets and continue the existing invitation, promotion, and payment flows without waiting for a Turnstile token.
- Update the Web environment schema, example comments, preflight output, component tests, and contributor documentation to describe the three distinct configuration states.

## Capabilities

### New Capabilities

- `web-auth-and-antibot-configuration`: Define required Google OAuth configuration and the runtime behavior of optional Apple OAuth and Turnstile features.

### Modified Capabilities

None.

## Impact

- Affected Web environment schema and `tooling/preflight.mjs` checks.
- Affected Web login, invitation, promotion, and Stripe payment components.
- No new dependencies and no backend code changes. Requests that currently carry a Turnstile token will continue using the existing request shape; when the feature is disabled the token is empty and the client does not block the flow.
