# Design

## Context

See `proposal.md` for the reported failure. The current Web user-store state factory reads `useI18n()?.locale?.value`. Nuxt auto-imports that API from `vue-i18n`, whose installed 11.4.10 release throws error code 26 when no component instance exists. Optional chaining does not intercept that exception.

PowerSync starts connecting in its async Nuxt plugin. Its credential boundary calls `useAuth().clearAuth()` for a locally expired login token or HTTP 401. Cleanup removes cookies before calling `useUserStore().clearUserInfo()`. That can be the first user-store access, before any layout setup. Pinia 4.0.3 registers its partial store before running the state factory, so failure leaves the same instance without getters or actions. The default layout then invokes its missing `changeLocalLocale` action.

A production-mode minimal experiment with the installed dependencies reproduced error 26, a registered store with undefined actions, and the subsequent method TypeError. A separate fresh instance first created within component setup initialized successfully. This confirms the mechanism, not the exact timing or token status of the reported production visit.

Existing store tests mock `useI18n()`, and authentication tests replace `useUserStore()` with a stub. Both bypass the failing boundary. `account-locale-sync` covers existing Web locale precedence and session isolation; this change adds startup behavior there. `legacy-session-logout` and `recover-snapshot-expired-session` remain separate changes; this change does not add deltas for their capabilities.

## Goals / Non-Goals

**Goals:** Keep initial locale selection and persisted-state hydration intact while allowing the real store to be created in an application callback. Demonstrate the original failure in a test before changing runtime code.

**Non-Goals:** See the proposal. No new store factory, cleanup retry, method-existence guard, Pinia-internal repair, or worker lifecycle abstraction is needed.

## Decisions

### Read the application composer rather than the component composable

Initialize the locale from `useNuxtApp().$i18n.locale.value`, using the application composer Nuxt already installs. This preserves the active browser/application language without requiring a current component instance. Keep persisted-state hydration, `currentLocale`, existing locale tasks, and layout display restoration unchanged.

Alternatives considered:
- A constant English or empty initial value removes the component dependency but can override a fresh Chinese application's detected language when the layout restores the store's locale.
- Moving all locale initialization into a new plugin or layout lifecycle adds ordering and state-transfer work that is unnecessary for this defect.
- Checking whether actions exist or catching store-creation failures leaves account cleanup incomplete and conceals the underlying initialization failure.

### Exercise the real startup boundary with controlled external dependencies

Add a focused Web integration regression using a newly created real Pinia instance, real user store, real `useAuth()` cleanup, and real locale API. Do not mock `useI18n()`, store construction, or cleanup. Control the PowerSync database/transport and HTTP responses so credential retrieval runs through the actual plugin connector before mounting the layout or an equivalent harness exercising its real setup. Keep each test independent of store instances initialized by Nuxt test bootstrap.

Cover a locally expired login JWT and an unexpired login JWT whose sync-credentials request returns 401. Both start without cached sync credentials. Assert cookie removal and user-state cleanup complete, the existing login navigation is requested, the same store retains callable actions, and subsequent layout locale initialization renders without a fatal error. The locally expired case must make no sync-token HTTP request.

Also cover initial English and Chinese outside component setup, plus persisted-language hydration and display restoration. Existing mocked tests remain useful for their focused behavior but cannot serve as the only regression proof.

### Keep the delivery scope confined to Web

Use `fix/fix-expired-session-cold-start` from `origin/dev` in an isolated worktree when implementation begins; carry only this change's planning artifacts from the current checkout. Run relevant store, authentication, credential, and startup tests and the required Web checks. Exercise cold startup in a running browser with synthetic invalid sessions and record evidence without exposing real tokens. Since this restores existing login behavior without restructuring a flow, it is not material UX; human hands-on acceptance still precedes the UI-visible task PR.

## Risks / Trade-offs

- Nuxt's locale plugin must be installed before the first store access → exercise the actual startup plugin boundary and a running application, rather than relying solely on an isolated state-factory test.
- A test bootstrap may already have created a valid store or mocked the locale API → use a fresh Pinia per case, verify no user store exists before credential cleanup, and retain the real locale API.
- A hard-coded fallback could regress Chinese startup or persisted preferences → retain the active composer lookup and explicitly test language precedence.
- Login rejection triggers existing local database clearing → use an isolated browser profile and synthetic data for verification; do not change that policy in this fix.

## Migration Plan

No storage migration or version increment is required. Deploy through the existing Web branch/environment pipeline after task-PR acceptance. If rollback is needed, revert this task's runtime change through the normal branch workflow; stored locale and database formats remain compatible. Archive only after the task PR merges, using the required human-reviewed docs PR.
