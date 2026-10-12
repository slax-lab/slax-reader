# Design

## Context

Slax registers one Google Web OAuth client (`561250096193-gr0t…`). Web uses it for authorization-code sign-in, and the native apps use it as their server client. Each native app also has its own Google client: iOS `561250096193-7hjc…` (`GIDClientID`), and Android `561250096193-9jv3…`, `-h5gb…`, `-lk00…`, one per signing certificate in `google-services.json`. A native ID token is issued with `aud` = server client and `azp` = the app client that obtained it. The legacy backend only compared `aud` with a per-platform variable set to the server client, so it never checked which app presented the token. The migrated API intended to separate app clients from the server client, but it applied that to `aud`, which can never hold an app client in this flow.

## Goals / Non-Goals

**Goals:**
- Accept the shipped native tokens and bind them to Slax's own app clients.

**Non-Goals:**
- Changing app sign-in code or Google Cloud client registration.
- Changing Apple sign-in.

## Decisions

- Verify `aud` against `GOOGLE_CLIENT_ID_TEXT` for every platform, and verify native `azp` against the platform's app client list. Native tokens without `azp` are rejected. Alternative considered: only dropping the guard and comparing `aud` with the per-platform variable, as the legacy backend did. It works, but any client that can obtain a token for the server client, including the Web flow, could sign in as "ios" or "android". Rejected as weaker than intended.
- Reuse the existing `GOOGLE_IOS_CLIENT_ID_TEXT` / `GOOGLE_ANDROID_CLIENT_ID_TEXT` variables as comma-separated app client lists instead of adding new ones. The names already describe the platform client, and no generated type or contract changes.
- Keep a constructor guard that rejects an empty list, or a list containing the server client. That configuration silently accepts the wrong presenter, and it is exactly the mistake the old guard tried to catch.

## Risks / Trade-offs

- [Deploying the code before updating the variables breaks native sign-in on that environment] → Update the Worker variables in the same rollout. The rejection log lists the configured app clients, and a presenter rejection logs the received `azp`.
- [An unlisted Android signing certificate (new upload key, internal builds) is rejected] → Add its client ID to the list. The `azp` rejection log shows the value to add.
- [Unverified on a real device] → Beta sign-in is verified after deployment.
