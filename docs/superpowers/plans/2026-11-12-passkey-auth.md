# Passkey Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add explicit Passkey enrollment, mailbox-based login and credential management to existing accounts.

**Architecture:** HTTP controllers receive typed proof once; PasskeyService owns verification and identity policy, typed Prisma/Redis repositories own persistence. Existing UserService and clients retain session completion.

**Tech Stack:** TypeScript, Prisma/PostgreSQL, Upstash Redis, SimpleWebAuthn, Vue/Nuxt and existing Swift/Kotlin Expo modules.

**Spec:** openspec/changes/add-passkey-auth/design.md and specs/passkey-authentication/spec.md.

## Global Constraints

- Add only the Passkey credential table and challenge/list routes; login/setting/session endpoints are reused.
- Keep Redis in infra, Lua to simple atomic operations, SQL free of FOR UPDATE, credential records outside client local-first models.
- Preserve naming, DI generation, account/advisory transaction locks, existing auth and new Web design polish.
- Keep Mobile 1.0.29 (804). New PR is Draft and requires hands-on acceptance.

## Review Focus

- A credential for another mailbox or RP cannot establish a session.
- A canceled browser/native prompt or changed account cannot commit a late result.
- Registration/deletion preserve the existing mailbox and provider identities.
- Synced Passkeys with zero counters remain usable while a replayed challenge is rejected.
- Incomplete native association configuration cannot silently broaden allowed origins.

### Task 1: Contracts and server proof/persistence

**Files:** contracts/src/passkey.ts and const.ts; API const/passkey.ts, utils/passkey.ts, infra/repository/dbPasskey.ts, redisPasskeyChallenge.ts, domain/passkey.ts; prisma/pgsql.prisma.
**Interfaces:** PasskeyChallengeRequest discriminates register/login; PasskeyService.challenge, linkCredential, authenticate, list, remove; PasskeyRepo typed transaction port; PasskeyChallengeRepo.save/consume.

- [ ] Write and run failing tests for registration ownership, one-use proof, RP/origin, multiple credentials, deletion and zero counters.
- [ ] Add minimal contracts, additive model/migration and repositories; generate clients with project commands.
- [ ] Implement protocol orchestration and pass tests using actual signed synthetic WebAuthn responses and disposable storage.

### Task 2: Existing API integration

**Files:** user.ts, loginIdentityLinkService.ts, userController.ts, auth middleware, userDeletion.ts, generated registrations, handler/runtime tests.
**Interfaces:** existing /login accepts PasskeyLoginRequest and uses completeLogin; /setting adds register/delete proof handling; challenge/list routes are RESTMethodPath constants.

- [ ] Add failing handler/session regression tests; implement scoped composition without changing provider/OTP paths.
- [ ] Regenerate all backend artifacts and verify type/layer checks plus local HTTP/storage flow.

### Task 3: Web clients

**Files:** Login/EmailLoginForm.vue, UserSignInMethodsSection.vue, focused Passkey child components/composable/utils, useAuth.ts, locales and component tests.
**Interfaces:** challenge DTO -> browser adapter -> existing login/setting, account-scoped requests and abort ownership.

- [ ] Write failing mounted tests for visibility, cancellation and existing identity continuity.
- [ ] Add focused Passkey actions within approved compact UI and existing Web profile.
- [ ] Run focused tests/type/lint and Chromium virtual-authenticator flows at required themes/widths.

### Task 4: Native Mobile

**Files:** data/api.ts, auth/passkey adapter and hook/dialog, settings Passkey controller/view, existing native modules and app.config.ts; public association examples.
**Interfaces:** native registration/assertion return protocol JSON; existing sessions.accept handles verified login; active account owns mutations.

- [ ] Write failing host tests for native response/cancellation, account/origin replacement and settings management.
- [ ] Reuse Credential Manager and AuthenticationServices, existing UI/session composition and deployment configuration.
- [ ] Verify host/type/bundles/native builds; record live association gap with operator-fill templates.

### Task 5: Final review and delivery

- [ ] Complete all implementation and relevant checks, then run a Claude Code subagent with claude-opus-5.5 for layer/scope/boundary review.
- [ ] Run a fresh Codex subagent for regressions and concrete optimization opportunities; reproduce findings before fixes.
- [ ] Record evidence, obtain hands-on acceptance, commit/push and create Draft PR to dev.
