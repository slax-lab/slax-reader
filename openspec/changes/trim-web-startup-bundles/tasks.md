# Tasks

## 1. Remove custom infrastructure

- [x] 1.1 Delete the bespoke index generator, resource preflight, pending-loader cache, wrapper components and dedicated tests; verify no product imports or compile-time defines reference them.
- [x] 1.2 Replace resource classification/graph traversal with the documented build:manifest configuration and preserve upstream login preload collection; verify required preloads/imports are not removed.

## 2. Official asynchronous interfaces

- [x] 2.1 Use defineAsyncComponent, conditional rendering, KeepAlive and NuxtErrorBoundary for AI/chat panels; verify types and initial-visible chat mounting.
- [x] 2.2 Use direct dynamic imports and existing mounting/error feedback for modals; verify props and callback regression tests.
- [x] 2.3 Retain only quote-readiness/account-scope business handling; verify first delivery, loading-placeholder refs, exactly-once behavior and account changes with tests.
- [x] 2.4 Replace same-page recovery claims with explicit user reload and unsaved-draft warning; verify no automatic reload or storage reset code is added.

## 3. Verification and PR update

- [x] 3.1 Run complete Web tests, typecheck and production build; inspect absence of custom index artifacts, compare static closure with the saved integrated build and validate Worker index.
- [x] 3.2 Exercise real production article/modal first-use, cached draft state, first quote, error containment and explicit reload in the built-in browser; record evidence and remote-service gaps.
- [x] 3.3 Update validation and PR #560, run strict OpenSpec/diff checks and local Bugs/Security/Compliance review, then commit/push without changing Extension 1.16.3.
- [ ] 3.4 Record human hands-on acceptance before marking the draft ready; do not infer acceptance, merge or deployment authorization.

The user explicitly requested deleting the bespoke system and using official mechanisms on 2026-11-11. Previous checkpoints and byte measurements remain historical evidence, not acceptance of this revision.
