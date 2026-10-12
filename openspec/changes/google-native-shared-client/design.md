# Design

## Context

Slax uses one Google OAuth client (`561250096193-gr0t…`) both for Web authorization-code sign-in and as the server client for native sign-in: the iOS app sets it as `GIDServerClientID`, and Android passes it to `GetGoogleIdOption.setServerClientId`. Native ID tokens therefore carry that client as `aud`, with the app's own client as `azp`. The legacy backend compared `aud` with the platform's configured client only. The migrated `GoogleAuth` constructor added a guard that throws `GoogleSSOAudError` when a native platform's client equals `GOOGLE_CLIENT_ID_TEXT`, which rejects the only configuration matching the shipped apps.

## Goals / Non-Goals

**Goals:**
- Accept the shipped native token audience without weakening token verification.

**Non-Goals:**
- Splitting Web and native onto separate Google clients, or changing app sign-in code.
- Changing the Web `azp` check or Apple sign-in.

## Decisions

- Drop the "native client must differ from the Web client" condition and keep the empty-client check. The guard adds no security: `aud` must still equal a client Slax owns, and the token is still verified by Google's signature, issuer, and expiry. Alternative considered: requiring a dedicated native server client. That needs new Google Cloud clients plus new app builds and breaks every installed app, so it is rejected.
- Keep the rejection log line but drop `usesWebClientId`, which no longer causes a rejection.

## Risks / Trade-offs

- [A Web-audience token could be presented as a native sign-in] → Same outcome: the same Google account signs in to the same Slax account. The legacy production backend already behaves this way.
