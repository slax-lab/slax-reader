# Design

## Context

`UserService.authenticateUser` looks up Google and Apple subject bindings before falling back to the profile email. It currently writes provider profile fields on successful OAuth login. `sr_platform_bind` allows one row per user and platform. Its secondary index on platform and platform ID is a lookup index. The existing `email` platform is owned by mail collection. Account cleanup currently deletes every binding. Web already shares a login surface across the page and modal. Mobile already has a session acceptance path.

## Goals / Non-Goals

Separate credential verification, account resolution, and session completion so later Passkey and email-link work can add verification methods. This phase includes OTP and explicit identity linking. It does not include Passkeys, email-link callbacks, password login, address replacement, unbinding, account merging, or new CLI authentication.

## Decisions

### Identity and transactions

Use a `mail` binding with normalized address as `platform_id` and the verified delivery address, with local-part case preserved, as `user_name`. Trim and lowercase the lookup key without collapsing dots or plus aliases. For an existing binding, send to its stored delivery address. At consumption, confirm that the proved recipient matches the current binding. Only add a binding after proof. For new users, insert the user and the verified binding in one transaction and use the verified delivery address as the profile email. Existing profile emails, including synthetic Apple addresses, retain their current semantics.

Resolve all matching ownership candidates before creating a user or attaching a new identity. The approved sign-in path uses only verified `mail` bindings. Historical profile email and verifiable historical provider email can prevent duplicate registration but do not authorize email sign-in. Report ownership collisions after proof. Keep Google/Apple subject lookup first. Preserve a verified Apple subject's deterministic legacy placeholder path and audit unbound historical provider records. Reject the unbound provider fallback into an email-enabled account and preserve that account's profile email on provider sign-in.

Coordinate account writes with PostgreSQL transaction-scoped advisory locks. Take normalized identity locks before the account lock and check live and frozen ownership within the write transaction. Account deletion uses the same account lock. Account authentication queries do not use `FOR UPDATE`. Repeating the same verified attachment is idempotent and never replaces another credential. The account identity service makes ownership and attachment decisions, and the repository executes storage operations. Account cleanup removes every platform binding, including `mail`. A distinct bound mailbox can be reused after cleanup. The existing profile-email freeze still applies. PowerSync uses its existing platform-binding rules. Future Passkey credentials belong outside local-first synchronization.

### Short-lived proof and delivery

Keep Redis calls in the infrastructure repository and the challenge policy in the domain. Key challenges by environment, purpose, and the hash of the normalized address. Store the request generation, intended recipient, SHA-256 digest of the request generation and code, and binding owner when applicable. Use a 300-second challenge TTL, a 60-second resend cooldown, and independent send limits for IP address, email address, device ID, and environment. Read the device ID from the existing request identity. The domain checks the quotas and verifies the proof. Redis uses native cooldown and expiry operations plus single-key atomic operations for counters and compare-and-delete. The latter prevents a concurrent submission or old send response from removing a different challenge. Five failed attempts exhaust a challenge without extending its TTL. An ambiguous send timeout leaves the challenge redeemable.

Use one server-side Resend HTTP integration with scoped credentials, a verified From domain, and the challenge generation as its request idempotency key. The app owns templates and proof. Credentials and raw mail content do not go into application logs. Add rate limits at the anonymous send boundary since the existing logged-in limits do not cover that route. Use the same configured limits for Mobile and Web. Preserve a test seam for local email capture without real recipients.

### Account and client completion

- `POST /v1/user/email/send` sends a login or binding code. Binding requests require the current user.
- `POST /v1/user/login` accepts an email proof with `type: email` alongside the existing Google and Apple inputs. After proof verification it uses the same account, token, and analytics flow.
- `GET /v1/user/userinfo` returns all current platform bindings, including `mail`, in its existing `platform` list. Account settings derive linked methods from that list.
- `POST /v1/user/bind_link` starts Google or Apple linking using a short-lived state scoped to the current account and client. The challenge identifies the provider. Its existing Telegram and Twitter responses are preserved.
- `POST /v1/user/setting` accepts a `bind_login_identity` operation. It verifies the email code or provider proof and attaches the identity to the authenticated account. Other setting operations keep their existing response. Web keeps its current session through the callback. Android uses Web for Apple linking.

Web reuses its cookie and redirect lifecycle, Extension its Web bridge, and Mobile its session guard and `sessions.accept` path. In the later email-link phase, the OS link opens the app first. The app parses the proof parameters and submits them to the existing login endpoint. Opening the link itself does not establish an API session.

## Risks / Trade-offs

- Duplicate historic ownership or ambiguous legacy OAuth paths can prevent automatic linking. Fail safely and audit before rollout.
- Beta and production share PostgreSQL. Provision the email credentials for these environments after the compatible OAuth writers and deletion workers are deployed in both.
- Resend acceptance confirms queuing, not inbox placement. Verify real delivery to controlled accounts before production activation.
- Redis or Resend outages can interrupt email login. Users with a linked provider can still sign in with it. Email-only users must wait for service recovery.
- The code digest prevents plaintext storage. Anyone who can read a live Redis challenge can still enumerate the six-digit code offline.

## Migration Plan

Deploy compatible identity lookup and writes before provisioning credentials in environments that share a database. Validate Redis, Resend domain authentication, sender, and delivery budgets. Existing verified rows are durable data and do not require a schema migration.

Email-code delivery becomes available when the Core Worker has `RESEND_API_KEY`. Add it as a Cloudflare Worker Secret on the Core Worker for that environment. For dev, select `reader-core` in the dev Cloudflare account. Subsequent API deployments preserve the binding. `EMAIL_AUTH_FROM` defaults to `Slax Reader <noreply@reader.slax.com>`. The private dev configuration sets it to `Slax Reader <noreply@reader.slax.dev>`.

Web provider linking is available on the registered callback origin, which shares the initiating tab's session storage. When the registered Web OAuth callback differs from `FRONT_END_URL/auth`, set `EMAIL_AUTH_WEB_CALLBACK` to the exact registered URL.

For the initial rollout, Web renders email authentication only when `public.slaxEnv` is `development`; Mobile uses its existing `config.development` value. This includes email login-page and modal entries, code forms, and the entire new account sign-in methods section: its heading, mailbox/provider linking actions, and linked identity status. Beta, production, and other non-development Web profiles omit the complete section even when an account already has a `mail` binding or the API has email credentials. Existing Google and Apple sign-in and profile email remain unchanged. Issuing and verifying login or binding codes use the usual session and email credential checks in every API environment, without a backend rollout gate. The development login UI learns about unavailable email credentials from the send response.
