# Design

## Context

See [proposal.md](proposal.md) for motivation. Web `/login` renders `LoginView`; `auth.vue` completes Google/Apple login; `auth.global.ts` currently redirects authenticated visitors away from login/auth routes. Desktop intent must survive all three owners. Google/Apple verification is already centralized in API `SlaxAuth` and is covered by provider tests; desktop handoff does not add a new OAuth audience or provider-token parser.

API tokens are signed by `Auth` with audience `reader`, issuer/algorithm/expiry from operator configuration. Protected Core routes and Edge identity propagation consume `id`, `email`, and `lang`; refresh currently reissues through `UserService`. The current middleware allowlist has no desktop exchange route and the rate limiter covers only bookmark-add routes. PostgreSQL and Prisma already own account records and migrations. These observations require an additive API/auth/routing change, not only a new Web page.

## Goals / Non-Goals

**Goals:** Bind explicit browser consent to an installed client's S256 verifier; consume authorization at most once under concurrent requests; keep desktop bearer credentials out of browser/deep-link/WebView state; preserve existing provider/login behavior.

**Non-Goals:** Replacing Web OAuth, changing Google native audience rules, issuing provider refresh tokens to desktop, a general OAuth server, a new bearer-token audience incompatible with Reader APIs, or deploying migrations to remote environments during implementation checks.

## Decisions

### 1. Fixed, validated handoff protocol

Rust creates 32-byte random state and verifier using an OS CSPRNG, encodes base64url without padding, derives `BASE64URL(SHA256(verifier))`, and persists the pending state/verifier, canonical API/Web origins, creation time and 10-minute deadline through its credential port. Restarting login retires the old attempt. Only the public challenge and state enter the browser URL. Never transmit the verifier to Web.

Accept only `client=mac`, a single S256 challenge (43 base64url characters), and a bounded opaque state of the chosen format. Reject duplicate, malformed, unknown-client and unsupported challenge-method parameters before consent. Use a structured, versioned desktop intent associated with the existing provider nonce/state; never overwrite or reuse the provider's own CSRF state as desktop state. Reject missing, stale or mismatched provider callbacks using existing verification. Keep raw desktop intent out of external redirect fields.

Web allows a valid desktop intent to reach the consent route even with a browser session. Signed-out users use the existing Google/Apple login, return to the retained same-origin consent intent, then choose an account authorization action. Signed-in users see account identity, consent, cancel and switch-account actions. Provider success alone does not issue a code. Copy changes use en/zh and existing Web tokens; no desktop material/theme values enter Web.

### 2. Public request/response shapes

Add typed REST contracts and path constants:

| Route | Request | Response |
| --- | --- | --- |
| `POST /v1/auth/desktop/code` | `{code_challenge, state}` with authenticated active browser account | `{code, expires_at}` in the standard success envelope |
| `POST /v1/auth/desktop/exchange` | `{code, code_verifier, state}` with no bearer prerequisite | `{token, expires_at, user}` in the standard success envelope |

Issuance returns a 32-byte opaque random code encoded base64url; codes expire after 120 seconds. Web selects the fixed callback scheme from its trusted `slaxEnv` build configuration: development/local uses `slaxreader-mac-local`, preview uses `slaxreader-mac-preview`, beta uses `slaxreader-mac-beta`, and production/main retains `slaxreader-mac`. Web constructs only that scheme's fixed `://auth` URL with encoded `code` and `state`. Browser history cleanup and no-store/no-referrer responses limit accidental persistence. No caller-specified callback, raw bearer token, provider token, verifier, email or account ID appears in the callback URL. Show an “Open Slax Reader” button using the same still-valid code; an expired/consumed code requires a new explicit authorization attempt.

Bound JSON bodies and reject unknown malformed fields, empty strings, noncanonical encodings and unreasonable verifier lengths (PKCE 43–128 allowed unreserved characters). Errors use a stable generic invalid/expired authorization code class without disclosing the account or whether a guessed code exists. Authentication failures remain 401; rate limits 429; storage/signing failures 5xx. Failure responses and diagnostics contain no tokens/codes/verifiers/challenges or complete callback URLs; successful issuance/exchange responses contain only their intended code/session data.

### 3. PostgreSQL atomic consumption

Use a dedicated table with `code_hash` unique, `user_id` account relation, `challenge`, `state_hash`, server-owned deployment/environment binding, `created_at`, `expires_at`, and nullable `consumed_at`. Follow the repository's Prisma `relationMode = "prisma"`: issuance and conditional consumption join an active account rather than adding a physical foreign key. Store a SHA-256 code hash, not a redeemable code; use the server clock. An expiration index permits bounded cleanup. Use a targeted repository rather than scattered raw SQL or an eventually consistent KV record. Durable Objects are a valid alternative but would add a new binding/storage owner without a benefit over existing PostgreSQL.

Exchange computes the submitted code hash, state hash and S256 challenge, then atomically deletes the matching same-deployment code in a single DELETE/RETURNING CTE, checking verifier/state/expiry and the active account before returning a session candidate. A failed same-deployment attempt also consumes its code, as explicitly requested by the user. Cross-deployment requests cannot delete another deployment's record; select-then-delete or read-then-update without conditional ownership is forbidden. Concurrent redemptions across Worker instances must yield exactly one consumed row and at most one token response. Check active/deleted-user eligibility before issuing a code and again when redeeming/refreshing. Failure after consumption fails closed and starts a new login; do not make replay idempotent by storing a bearer token next to a code.

Bind the deployment from trusted server configuration/routing rather than client Origin headers. Desktop stores the originating API/Web pair and sends redemption only there. Keep dev/beta/production codes and sessions from crossing environments. Purge expired and legacy-consumed rows in bounded maintenance on issuance/exchange, with no additional retention window. Successful and failed same-deployment attempts leave no code row.

### 4. Compatible desktop-marked sessions

Use the existing `reader` audience and normal session expiry, adding a validated signed `client: "macos"` marker. A token unique to the desktop authorization and stored only by Rust meets the client requirement without breaking every protected API with a new audience. If session tracking exists when implementing, also bind its device/session identifier through the existing mechanism; do not invent an unchecked client-supplied ID.

Propagate the signed marker through Core authentication, trusted Edge identity DTOs and refresh signing. Legacy tokens with no marker retain behavior. Never copy an untrusted request header into a signed marker. Refresh of a desktop session must not silently become a generic Web session, bypass deleted-account checks or alter iOS/Android/CLI validation. Test `me`, sync token acquisition, a representative protected mutation and refresh with the new token, including Edge forwarding. Bearer session revocation semantics remain those of the existing API; this change does not claim a new server-side refresh-token/session-revocation system.

### 5. Auth and rate-limit routing

Whitelist only the exact public exchange path in Core and Edge dispatch/auth ownership; issuance always requires a verified active account. Add a dedicated `DESKTOP_AUTH_RATE_LIMITER` deployment binding and native runtime types/template documentation; derive keys from trusted platform client IP plus a digest of the submitted code where appropriate, and use account keys for issuance. Never log raw keys derived from codes. The limiter must apply to public requests before expensive parsing/DB/crypto work and must not be skipped by trusted Edge forwarding without equivalent Edge enforcement. Missing required limiter configuration fails closed in deployed environments; a deterministic local fake supports tests. Rate-limit denied requests return 429 without consuming a code.

Preserve existing same-origin browser auth protections; state-changing issuance is never GET or a cross-origin redirect. Browser consent explicitly triggers the authenticated request. Untrusted website origins cannot turn a valid browser session into an authorization grant merely by navigating to a crafted URL.

### 6. Rust consumer integration boundary

The companion desktop change implements deep-link delivery in an installed app. Rust checks the exact scheme assigned to its compiled local/preview/beta/main environment, authority `auth`, allowed path, no credentials/fragment/port, single expected query keys, code/state bounds, pending attempt/environment/deadline and state match. Coalesce duplicate launch/on-open deliveries; atomically take the matching pending attempt before starting a bounded exchange. Wrong state does not erase a valid pending attempt; expired matching state is cleared. Exchange failure presents a restart action, never retries a consumed code as a new login. Only accept a token response for the still-current attempt/account generation and expected server, validate shape/expiry, store in credential storage, then publish sanitized authentication state.

Custom scheme registration alone does not prove app identity and another local app may register the scheme. PKCE prevents code theft from producing a desktop session without the verifier. Never send verifier or bearer token back through the URL. macOS deep links must be tested against a bundled app installed in `/Applications`; `tauri dev` and a mocked event do not establish acceptance.

## Risks / Trade-offs

- [Existing middleware drops desktop intent for authenticated users] → focused route/provider tests covering direct login, already-signed-in login, switch-account, cancellation, malformed intent and a normal non-desktop login.
- [Concurrent replay on separate Workers] → a real PostgreSQL integration test with two independent requests; a mocked repository alone is insufficient.
- [Code consumed before signer/network failure] → fail closed, surface restart, keep codes short-lived and do not cache bearer responses.
- [New public route bypasses auth or rate limiting through Edge] → exact-path dispatch tests and full Edge-to-Core exchange tests, with negative neighboring-path tests.
- [Secrets leak through diagnostics] → redacted stable error classes, no-store/no-referrer handling, and assertions against logs/URLs/JS events.
- [Claim marker lost on refresh] → shared auth payload typing and regression tests for legacy and desktop tokens; retain current reader audience.

## Migration Plan

1. Land additive Prisma schema/migration, typed contracts and API implementation behind an off-by-default desktop handoff entry/feature flag. Apply local test migrations only to explicit test databases.
2. Verify concurrent code consumption, rate limiter and Core/Edge routing, then add the Web branch and en/zh consent UI with existing design profile.
3. Enable only in a development environment through separately authorized deploy commands documented as `pnpm api -- <command>`; confirm actual code/claim compatibility with the installed desktop client. PR checks must not deploy.
4. Roll out API before Web entry and desktop distribution. Missing required configuration disables issuance/exchange visibly; never mint generic unrestricted fallback sessions.
5. Roll back the entry/flag and Web branch first. Leave additive storage/API support while issued codes expire and installed clients need refresh. No destructive rollback migration or change to unrelated client sessions.
6. Before pushing run local pre-push review per `REVIEW.md` and strict OpenSpec validation; archive only after merge. Keep this change's capability distinct from desktop client and existing in-flight Google/Mobile work.

## Open Questions

Canonical local/preview/beta/main Web/API origin pairs live in Desktop public environment profiles; trusted deployment identifiers remain non-secret operator configuration. Desktop defaults to the normal local browser flow. Local loopback Web/API development requires no additional native enable switch; remote API/Web entry remains deployment controlled. This does not change the fixed scheme/path or PKCE contract. Credentials and private signing material remain outside source and are never read by an agent.
