# Design

## Scope and integration

Use the current `mail` identity, `/login`, `/setting`, `UserService.completeLogin`, account identity transactions, and client session ownership/cancellation. Registration requires an active session and a verified mailbox. Passkey login authenticates an existing account and never registers or merges a user. The user handle derives from the existing account UUID; do not add a user column or duplicate persistent handle.

## Boundaries

Controllers parse HTTP inputs once and expose `handle*Request` methods. `PasskeyService` owns protocol orchestration and identity/credential decisions. `PasskeyRepo` (`infra/repository/dbPasskey.ts`) owns Prisma access and transaction mechanics through typed operations. `PasskeyChallengeRepo` (`infra/repository/redisPasskeyChallenge.ts`) alone accesses Redis. Pure protocol helpers/settings live in `utils/passkey.ts` and `const/passkey.ts`. Existing service composition receives the verified owner and completes the existing login/session path. Do not introduce a separate session endpoint, an auth framework, direct domain Redis, complex Lua, or `FOR UPDATE`.

## HTTP contract

Add only `POST /v1/user/passkey/challenge` (typed registration/login purposes) and authenticated `GET /v1/user/passkey` (credential management metadata). Reuse `/login` with `type=passkey` for assertion completion and `/setting` for `bind_login_identity` with `type=passkey` and `delete_passkey` with credential UUID. Register every route in `RESTMethodPath`; preserve existing DTO alternatives. Challenges have a five-minute TTL, are scoped by environment, purpose, RP and mailbox (and authenticated owner for registration), and are consumed once. Public login challenges always return the same discoverable-credential options with an empty `allowCredentials`, without looking up or exposing whether the mailbox/account has credentials. After the system chooser returns a proof, `/login` resolves that mailbox and verifies its active owner and credential inside the account transaction; choosing a different mailbox's Passkey fails. This follows the existing required-resident-key registration contract and does not add another login mode or UI step. See [SimpleWebAuthn's discoverable-credential guidance](https://simplewebauthn.dev/docs/advanced/passkeys/#generateauthenticationoptions).

## Persistence

Add `sr_user_passkey` with `id`, `uuid`, `user_id`, `rp_id`, `credential_id`, `public_key`, `counter`, `transports`, `name`, `created_at`, and `last_used_at`. Credentials never enter a client schema or PowerSync query. A `passkey` platform binding contains only a stable account UUID as its identifier, never credential material. Register/delete the credential and maintain this summary in one account-locked transaction. Remove the summary only when the account has no remaining credentials. Account deletion rejects login immediately and its existing cleanup also removes credential rows. Existing Google/Apple/mail bindings are retained. Use additive migration only.

Existing local replication publishes all tables. Omitting credentials from local-first schemas/queries prevents client delivery; the operator must separately review publication/capture scope if exclusion from the PowerSync service itself is required. This phase does not rewrite existing sync rules or publications.

## WebAuthn and configuration

Use maintained SimpleWebAuthn server/browser packages and exercise the verifier in Workers before claiming compatibility. Require user verification, use discoverable credentials, and verify challenge, RP ID, origin, signature, credential ownership and active-account status. Keep the library signature-counter semantics, including legitimate zero counters. RP ID is the hostname of the existing `FRONT_END_URL`; Web/iOS use its origin. Optional `PASSKEY_ANDROID_ORIGINS` contains explicit configured Android signing-certificate origins; an empty setting enables no Android origin, and malformed/non-Android entries fail configuration validation instead of widening the origin set. No extra feature switch or secret is added. Store credential metadata and update the counter after authentication using the existing account lock/transaction pattern. A duplicate credential is a domain verification failure, not a successful attachment or an unhandled database error.

## Client presentation and lifecycle

Add Passkey actions within the approved email-login form and existing sign-in methods section. Reuse the latest Web icon registry, semantic tokens, row hierarchy and compact layout; support Chinese/English, light/dark/e-ink and 320/768/1280px. Reuse account-scoped request ownership and cancellation; stale or dismissed operations cannot adopt a session or attach to a replacement account. Mobile screens compose small feature hooks and adapters. iOS uses AuthenticationServices; Android extends the already shipped Credential Manager adapter. Preserve original provider order, agreement gating and session completion. Web shows the new UI in development/preview, Mobile in development, and beta/production remain hidden.

## Native association and delivery

Derive native RP configuration from the existing public Web URL. Add iOS webcredentials entitlement through app configuration. Provide fill-in AASA/assetlinks examples using known bundle/package identifiers, with explicit Team ID and SHA-256 placeholders. Do not deploy placeholder identities. Native signed-device/domain verification waits for operator identifiers and association deployment; compile/host/bundle checks and Web virtual-authenticator verification proceed independently. Retain Mobile version 1.0.29 (804). Final boundary and regression reviews run only after the entire implementation, then findings are verified and fixed within this scope.

## Implementation findings

The existing DI generator reserves a method named `register` for infrastructure registries. The Passkey service therefore exposes `linkCredential`, preserving the generator and normal service DI. A real ES256 assertion reproduced SimpleWebAuthn's documented ASN.1 schema-store mismatch when its direct dependency reused 2.6.0 while its EC dependency resolved 2.11.1. A server-scoped pnpm override aligns only that dependency to 2.11.1; existing X.509 dependency versions are retained. See [upstream issue 808](https://github.com/MasterKale/SimpleWebAuthn/issues/808).

## Confirmed association rollout

Use `r.slax.dev`, `r-beta.slax.com` and `r.slax.com` for development, beta and production. The existing Web public-assets directory serves AASA and Digital Asset Links JSON with an explicit JSON content type; no new service, redirects or login gate are introduced. Both native platforms declare these three domains. API RP IDs remain environment-specific through the existing `FRONT_END_URL`; the confirmed Play signing origin is configured per environment. Association assets do not enable hidden Beta/production UI. Physical-device checks require those files to be publicly deployed and a matching signed binary with the new native module methods; replacement or local-data clearing requires explicit authorization for the named test devices. The requester subsequently confirmed both connected phones are test devices and authorized clearing their local state.

The requester authorized a separate `publish-native-passkey-associations` supporting Draft PR on 2026-11-12 so public association files can deploy before native acceptance. Its delta capability is `native-passkey-association`, separate from this change's `passkey-authentication`; do not carry duplicate association delta requirements in this change.
