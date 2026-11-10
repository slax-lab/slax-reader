# Design

## Context

`UserService.authenticateUser` looks up Google and Apple subject bindings before falling back to the profile email. It currently writes provider profile fields on successful OAuth login. `sr_platform_bind` allows one row per user and platform. Its secondary index on platform and platform ID is a lookup index. The existing `email` platform is owned by mail collection. Account cleanup currently deletes every binding. Web already shares a login surface across the page and modal. Mobile already has a session acceptance path.

## Goals / Non-Goals

Separate credential verification, account resolution, and session completion so later Passkey and email-link work can add verification methods. This phase includes OTP and explicit identity linking. It does not include Passkeys, email-link callbacks, password login, address replacement, unbinding, account merging, or new CLI authentication.

## Decisions

### Identity and transactions

Use a `mail` binding with normalized address as `platform_id` and the verified delivery address, with local-part case preserved, as `user_name`. Trim and lowercase the lookup key without collapsing dots or plus aliases. For an existing binding, send to its stored delivery address. At consumption, confirm that the proved recipient matches the current binding. Only add a binding after proof. For new users, insert the user and the verified binding in one transaction and use the verified delivery address as the profile email. Existing profile emails, including synthetic Apple addresses, retain their current semantics.

Resolve all matching ownership candidates before creating a user or attaching a new identity. The approved sign-in path uses only verified `mail` bindings. Historical profile email and verifiable historical provider email can prevent duplicate registration but do not authorize email sign-in. Report ownership collisions after proof. Keep Google/Apple subject lookup first. Preserve a verified Apple subject's deterministic legacy placeholder path and audit unbound historical provider records. Reject the unbound provider fallback into an email-enabled account and preserve that account's profile email on provider sign-in.

Coordinate normal OAuth registration and the explicit link paths using shared transaction locks for normalized addresses and provider subjects. Check live and frozen ownership within the write transaction. Use a consistent lock order. Avoid the generic upsert's replacement semantics for sign-in identities. Repeating the same verified attachment is idempotent. Soft-deleted users lose access immediately. Cleanup keeps the `mail` row through the 30-day freeze. Transactional reclamation releases the old reservation, never the old account. Keep the existing profile-email freeze behavior. The new mailbox is available through authenticated account settings, not general platform synchronization.

### Short-lived proof and delivery

Reuse the Upstash Redis client. Key challenges by environment, purpose, and keyed normalized address. Store the request generation, intended recipient, keyed code digest, attempt count, and binding owner/flow when applicable. Use a 300-second Redis TTL, a separate 60-second resend cooldown, and bounded sends per address/IP and per environment. Atomically replace the challenge after rate-limit admission. Verification and terminal consumption use one Redis script so verification races cannot succeed twice. A wrong attempt preserves the original TTL and exhausts the challenge at five. Explicit send rejection conditionally removes only the failed generation. An ambiguous timeout leaves that challenge redeemable. A downstream write failure after consumption requires a fresh code.

Use one server-side Resend HTTP integration with scoped credentials, a verified From domain, and the challenge generation as its request idempotency key. The app owns templates and proof. Credentials and raw mail content do not go into application logs. Add rate limits at the anonymous send boundary since the existing logged-in limits do not cover that route. Use the same configured limits for Mobile and Web. Preserve a test seam for local email capture without real recipients.

### Account and client completion

Keep explicit binding and anonymous login separate at the API boundary. A provider link uses a one-time, short-lived state scoped to the current account, provider and initiating flow, plus the server-side provider token checks. Web binds through the callback without switching sessions. Mobile binds through authenticated account settings using supported provider authorization. Android uses Web for Apple linking. The login success path reuses the existing token contract, account checks and analytics, including invitation and continuation context where supported. Web reuses its cookie and redirect lifecycle, Extension its Web bridge, and Mobile its session guard and `sessions.accept` path.

## Risks / Trade-offs

- Duplicate historic ownership or ambiguous legacy OAuth paths can prevent automatic linking. Fail safely and audit before rollout.
- Beta and production share PostgreSQL. Provision the email credentials for these environments after the compatible OAuth writers and deletion workers are deployed in both.
- Resend acceptance confirms queuing, not inbox placement. Verify real delivery to controlled accounts before production activation.
- Redis or Resend outages can interrupt email login. Users with a linked provider can still sign in with it. Email-only users must wait for service recovery.

## Migration Plan

Deploy compatible identity lookup, writes and cleanup before provisioning credentials in environments that share a database. Validate Redis, Resend domain authentication, sender, delivery budgets, and owner-only sync behavior. Deploy the PowerSync rule that excludes `platform=mail` from the platform-binding stream before provisioning credentials in a hosted environment. Existing verified rows are durable data and do not require a schema migration.

Email login and linking become available when the Core Worker has `RESEND_API_KEY` and a random `EMAIL_AUTH_HMAC_SECRET` of at least 32 characters. Before deploying, add `RESEND_API_KEY` as a Cloudflare Worker Secret on the Core Worker for that environment. For dev, select `reader-core` in the dev Cloudflare account. Subsequent API deployments preserve the binding. Keep the Resend key out of the private environment TOML and set `EMAIL_AUTH_HMAC_SECRET` in its `[vars]` table. `EMAIL_AUTH_FROM` defaults to `Slax Reader <noreply@reader.slax.com>`.

Web provider linking is available on the registered callback origin, which shares the initiating tab's session storage. When the registered Web OAuth callback differs from `FRONT_END_URL/auth`, set `EMAIL_AUTH_WEB_CALLBACK` to the exact registered URL.

For the initial rollout, the identities response advertises mailbox binding only when `RUN_TYPE` is `dev` and the email credentials are configured. Web and Mobile use this capability to show the binding action. The API applies the same rule to issuing and verifying binding codes. Email registration, email sign-in, provider linking, and the display of an already bound mailbox retain their existing availability rules.
