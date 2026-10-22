# Tasks

## 1. Preserve published surfaces across transient readiness

- [x] 1.1 Split the persisted discovery/donation preference from publication readiness in `runtime.tsx`; pass `surfacesReady` separately to `SystemSurfacesController.reconcile`.
- [x] 1.2 Stop deriving publication/revocation from `credentialState.status` in the adapter owner identity; keep credential readiness as a publish gate only.
- [x] 1.3 Revoke only on explicit opt-out, sign-out, owner/origin change, or ineligible content. Keep catalog, donation IDs and pending receipts when not ready.
- [x] 1.4 Preserve pending donations across a readiness pause; they remain retryable under the same owner.
- [x] 1.5 Keep the entry router alive across readiness changes so a pending Spotlight open survives credential/native transitions; dispose it only on account/API-origin replacement or unmount.

## 2. Fix native registration and open intent

- [x] 2.1 Move `registerIndexed` and `AppIntentDonationRegistry.register` out of the asynchronous `Task`; keep shortcut refresh asynchronous.
- [x] 2.2 Make `OpenBookmarkIntent` conform to `OpenIntent` while preserving its parameter, title, dispatch and foreground behavior.

## 3. Regression coverage

- [x] 3.1 Add controller tests for background/not-ready preservation, readiness resumption, explicit opt-out, sign-out and owner replacement.
- [x] 3.2 Cover successful manual and catalog-open donation behavior; native registration is confirmed by the generated provider and extracted metadata.
- [x] 3.3 Run `pnpm mobile -- check`, targeted system-action tests, `openspec validate --all --strict`, and `git diff --check`; record results in `validation.md`.
- [x] 3.4 Cover a pending entry invocation across repeated readiness context changes and verify it navigates only after readiness becomes true.

## 4. Simulator and delivery

- [x] 4.1 Build and install the iOS 27.1 Duo simulator app against the local test API and verify catalog publication and background persistence with the authorized test account; record the Shortcuts UI and hands-on donation receipt as not exercised headlessly.
- [x] 4.2 Bump `apps/mobile/package.json` to build `777` with previous `776`, regenerate native metadata, and run the release checks. Adapt the Firebase release admission to the scene-based AppDelegate template so the authorized archive can be created.
- [x] 4.3 Archive/export/upload the TestFlight build after the fix is verified; record the upload receipt and any unavailable processing checks.
- [x] 4.4 Push `feat/fix-spotlight-index` and open pull request #310 against `dev` with the required `OpenSpec:` line and validation evidence.
