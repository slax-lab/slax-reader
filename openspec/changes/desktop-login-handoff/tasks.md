# Tasks

Implementation belongs on `feat/desktop-login-handoff` after human proposal review. Native credential storage, deep-link receipt and the Rust exchange consumer are owned by `add-macos-desktop`; API/Web changes remain here. All implementation tasks remain unfinished, and no remote migration/deployment is implied by local checks.

## 1. Contracts and durable authorization codes

- [ ] 1.1 Add shared request/response DTOs and REST paths for authenticated code issuance and public exchange; verify contracts typecheck and reject malformed/duplicate/noncanonical challenge, state and verifier input fixtures.
- [ ] 1.2 Add the additive Prisma code table, uniqueness/expiry indexes and migration with code/state hashes and trusted deployment binding; verify schema validation and migration against an explicit local test database without reading secret files.
- [ ] 1.3 Implement the code repository's conditional atomic consumption and bounded cleanup; verify a real PostgreSQL concurrent redemption test returns one winner and expiry/environment/challenge/state mismatches return none.
- [ ] 1.4 Implement active-account issuance, CSPRNG opaque codes and 120-second server-side expiry; verify unauthenticated/deleted accounts cannot issue and persisted records contain no redeemable code or bearer token.

## 2. API exchange authentication and routing

- [ ] 2.1 Implement public bounded PKCE exchange with generic invalid/expired errors and consume-before-sign behavior; verify valid redemption, replay, wrong verifier/state, expiry and signing failure using deterministic clocks/fixtures.
- [ ] 2.2 Add a dedicated desktop-auth limiter binding, generated runtime types and public configuration documentation; verify denied requests return 429 without consuming a code and missing deployed configuration fails closed.
- [ ] 2.3 Route the exact exchange path through Core/Edge authentication and limiter ownership while keeping issuance authenticated; verify neighboring-path, trusted-forwarding and unauthenticated bypass tests.
- [ ] 2.4 Add the signed macOS session marker to existing Reader-compatible token issuance, trusted identity typing and refresh propagation; verify legacy tokens remain valid and desktop tokens call me/protected mutation/credential endpoints and retain their marker after refresh.
- [ ] 2.5 Recheck deletion/eligibility on issuance, redemption and refresh and add no-store/referrer/redacted-diagnostic policy; verify deleted-account transitions fail and response/error/log fixtures do not expose redeemable secrets outside their intended successful response.
- [ ] 2.6 Add an off-by-default desktop entry feature/configuration switch and trusted environment-origin binding; verify disabled or cross-environment issuance/exchange is denied without changing normal login.

## 3. Web consent flow

- [ ] 3.1 Add a validated desktop intent model preserved alongside existing provider nonce/state; verify Google/Apple round-trip tests retain the intent and malformed, duplicate or stale callback state is rejected.
- [ ] 3.2 Update auth middleware so valid desktop intents reach consent for already-signed-in accounts; verify normal login/auth redirects, share/public routes and existing non-desktop tests remain unchanged.
- [ ] 3.3 Implement en/zh account consent, cancel and switch-account UI with existing Web design tokens and accessible focus; verify no code is issued by page mount/navigation/provider completion alone.
- [ ] 3.4 Implement explicit authenticated issuance and the fixed encoded code/state-only callback plus Open Slax Reader retry action; verify arbitrary redirects, token-bearing URLs and expired/consumed retry behavior.
- [ ] 3.5 Add intent/deep-link history cleanup and no-referrer behavior; verify browser state/events do not contain verifier or desktop bearer credentials and cancellation clears the pending Web intent.

## 4. Integrated verification and delivery

- [ ] 4.1 Run API unit/real-Postgres concurrency/Core-to-Edge routing tests and Web auth/provider/consent tests; verify existing Google/Apple native checks, ordinary Web login and non-desktop refresh regressions pass.
- [ ] 4.2 With the desktop consumer installed, execute signed-in/signed-out Google/Apple, cancellation, wrong-state, duplicate/replay, expiry and explicit open-app retry cases; verify the packaged app receives the callback in Rust and JS receives only sanitized auth state, recording build/OS evidence.
- [ ] 4.3 Document additive migration ordering, development environment enablement, required non-secret configuration and rollback using root `pnpm api -- <command>` entries; verify local plans do not migrate or deploy a remote environment.
- [ ] 4.4 Run strict OpenSpec validation, required local pre-push review passes from `REVIEW.md` and affected checks; resolve Important findings, open the PR targeting dev with `OpenSpec: desktop-login-handoff`, attach it to this chat and verify required statuses. Archive only after merge.
