# Design

## Context

See `proposal.md` for the reported failure and scope. The production plugin currently passes only `typeof SharedWorker !== 'undefined'` to `initializePowerSyncWithFallback`, then explicitly sets `enableMultiTabs` from the selected mode. Development uses the existing main-thread path.

The installed `@powersync/web` 2.4.0 computes its default in `src/db/adapters/resolveAndValidateOptions.ts`: SharedWorker must exist, the user agent must not match `/(Android|iPhone|iPod|iPad)/i`, and `window.safari` must be falsy. That resolver is internal and is not re-exported by the package's public entry point. The repository has no existing Web synchronization capability spec.

## Goals / Non-Goals

**Goals:** Apply that eligibility policy before constructing a database, keep the existing mode-to-SDK-options mapping coherent, and verify both classification and the production plugin boundary.

**Non-Goals:** Cancel in-flight initialization, change cleanup or retry timing, migrate VFS/database files, change HTTP synchronization, implement Service Workers, or fix the separate unmeasured latency/CORS issues.

## Decisions

### Evaluate platform eligibility before the first attempt

Introduce a small helper under `apps/web/app/local-first/` that mirrors the installed SDK's eligibility checks, with safe handling of missing browser globals and no dependency on SDK internals. Replace the production plugin's API-existence-only recovery gate with this helper. The existing mode mapping already gives dedicated mode `useWebWorker: true` and `enableMultiTabs: false`.

Match the SDK checks rather than adding a broad `Safari` user-agent test, which would also match Chrome and Edge compatibility tokens. Include Android and iOS browsers because the user authorized using the SDK's policy. Document the SDK version/source beside the helper so future dependency upgrades can compare defaults. Do not add new browser-detection dependencies or additional iPad desktop-mode heuristics in this change; detection retains the current SDK's limits.

Alternatives considered: relying only on API presence keeps the reported problem; importing an internal SDK resolver creates an unsupported dependency; merely removing `enableMultiTabs` would leave the application's reported recovery mode and SDK behavior potentially inconsistent.

### Keep the recovery state machine intact

Use the existing branch that starts with dedicated mode when shared mode is ineligible. Preserve all timeout and disposal guards, the database filename/generation, schema, VFS, authentication, and connection settings.

Starting dedicated mode after a hung shared initialization was rejected for this change: stopping a `Promise.race` wait does not cancel initialization, and adapter cleanup can itself await that initialization. Starting with the intended worker avoids creating the uncertain shared instance in the first place.

### Verify observable selection at the plugin boundary

Add a focused platform matrix covering mobile user agents, Safari's marker, eligible desktop browsers, unavailable SharedWorker, and missing browser globals. Add plugin-level regression coverage that proves the actual recovery input and constructed database options select dedicated mode on Safari and shared mode on eligible desktop browsers. Exercise the worker-enabled production branch explicitly; a test of the development branch cannot detect this regression. Retain coverage of development's main-thread behavior and the existing extension-bridge authentication tests.

Extend the existing recovery tests to cover dedicated-first initialization timeout, cleanup timeout/error, and successful-cleanup fallback. These tests protect the safety behavior while changing entry into the state machine. Check reuse of the same database identity and absence of policy-triggered clearing; existing account-switch clearing remains valid.

## Risks / Trade-offs

- Browser heuristics can miss unusual user agents or absent Safari markers → Match the current upstream policy precisely, test representative environments, and record detection limits.
- Upstream defaults may change → Record the mirrored version/source and review the policy when upgrading the SDK.
- Non-shared mode provides weaker cross-tab notifications → Preserve the SDK's existing behavior; test foreground single-tab synchronization first and report multi-tab observations separately.
- Dedicated Worker can still encounter script-loading, storage, or scheduling failures → Keep recovery guards and use production-mode iPhone validation; do not report the 20-second delay as fixed based only on unit tests.
- Existing tabs can retain the previous code and workers → Reproduce with other reader tabs closed and a fresh page load before evaluating the new selection.

## Migration Plan

No data migration or dependency change is required. After proposal review, implement the helper and plugin wiring, run focused tests and Web checks, and inspect a production-mode build on iPhone Safari and an eligible desktop browser when a device/session is available. Record the first recovery mode and a remote bookmark's appearance with the phone kept in the foreground. Deployment remains a separate action. Rollback reverts the policy change without clearing local data.
