# Proposal

## Why

The existing Web Google/Apple flow yields a browser session and has no secure, explicit authorization handoff to a macOS client. Add a short-lived, single-use PKCE exchange so the installed client can obtain its own session without exposing desktop credentials to WebView JavaScript or placing a browser bearer token in a deep link.

## What Changes

- Add a validated `/login?client=mac&code_challenge=…&state=…` branch that survives the existing Google/Apple round trip. Signed-in browsers show an explicit account authorization action instead of automatically redirecting to bookmarks or authorizing an app.
- Add authenticated `POST /v1/auth/desktop/code` and rate-limited public `POST /v1/auth/desktop/exchange`, with shared request/response contracts. Store only a hash of each opaque code and its PKCE/account/environment binding in PostgreSQL; consume it atomically once.
- Issue a 120-second code only after user confirmation and return the fixed environment-specific code/state-only handoff (main retains `slaxreader-mac://auth?code=…&state=…`) plus an explicit retry/open-app control. Do not accept caller-provided callback destinations.
- Exchange a valid code and S256 verifier for a desktop-marked session compatible with protected Reader APIs and refresh, preserving existing account eligibility/deletion checks. Never return the desktop session to the browser or place it in a URL.
- Specify the Rust consumer contract: 10-minute, single-use pending state/verifier in credential storage; strict deep-link validation; Rust-only exchange and credential persistence. Its implementation belongs to `add-macos-desktop`.
- Add API concurrency/replay/expiry/PKCE/rate-limit tests and Web middleware/provider/consent regression tests. Record installed-app acceptance separately from unit coverage.

## Capabilities

### New Capabilities

- `desktop-auth-handoff`: Explicit browser consent, expiring PKCE authorization codes, atomic redemption, and desktop session handoff.

### Modified Capabilities

None. Preserve current Google/Apple verification and existing Web, iOS, Android, CLI, and Extension login behavior.

## Impact

`apps/web/app/pages/login.vue`, `auth.vue`, auth middleware/composables, login components and translations; `apps/api` controllers/domain/repositories, Prisma migration, auth/rate-limit/Edge routing and tests; `packages/contracts`. PostgreSQL is the chosen strong-consistency store; no KV storage, new OAuth provider, custom redirect registry, or secret-bearing WebView capability is introduced.

This is a separate behavior change and implementation PR, targeting `dev` from `feat/desktop-login-handoff`. The current desktop worktree holds both proposals for joint review; implementation commits must keep their scopes separate. Local migration checks do not authorize production migration or deployment. Section 9 decisions and the standalone `/v1/sync/changes` status fix are excluded.
