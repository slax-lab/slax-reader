# Proposal

## Why

A cold Web start with an expired or rejected login session can fail before the first page renders: PowerSync invokes authentication cleanup, the user store calls component-only `useI18n()` during initialization, and Pinia retains an incomplete store after that call throws. The layout then reports `userStore.changeLocalLocale is not a function`; refreshing can appear to recover because cleanup already removed the login cookie.

## What Changes

- Make Web user-store locale initialization safe when the first consumer is an authentication callback outside component setup.
- Preserve the active application language for a fresh store and existing persisted-language precedence.
- Add regressions for cold starts with a locally expired login token and a login token rejected by the sync-credentials endpoint, using a fresh real Pinia store and the real locale API.
- Verify cleanup, subsequent layout use of the store, and login recovery complete on the first visit without requiring a reload.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `account-locale-sync`: Web locale state must initialize independently of component setup so rejected-session cleanup cannot leave the user store unusable during startup.

## Impact

- `apps/web/app/stores/user.ts`: replace the component-scoped locale lookup with the application composer already provided by Nuxt.
- Web store/authentication regression tests, exercising the real `useAuth().clearAuth()` and credential-expiry/401 paths rather than mocking the user store or `useI18n()`.
- Running-browser verification and evidence in this change's `validation.md`, followed by human hands-on acceptance before a UI-visible task PR opens.
- Web only: no API contract, dependency, schema, worker-generation, cookie-scope, or package-version changes.

## Non-goals

- Changing session lifetime, accepting invalid credentials, or adding token refresh/retry behavior.
- Redesigning PowerSync initialization, database clearing, worker reconnection, or the error/login interfaces.
- Catching or suppressing missing store methods instead of preventing the initialization failure.
- Changing snapshot-session recovery, Extension locale behavior, or existing account-locale save semantics.

## Review and delivery

The user approved the proposal, design, and regression scope in this chat on 2026-11-12 with "ok确认". Implementation uses a dedicated `fix/fix-expired-session-cold-start` branch from `origin/dev`, isolated from the current checkout's unrelated changes. Archive evaluation follows the merged task PR through the repository's human-reviewed docs PR flow.
