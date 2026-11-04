# Tasks

## Acceptance revision

On 2026-11-04 the owner explicitly confirmed this changes network/recovery logic, not UI presentation, and authorized commit, push, and a dev PR after relevant unit tests pass. Relevant automated API/native-language host tests, typecheck, and iOS/Android bundle validation replace the original native-build/device/manual gates. The earlier expanded attempts and limitations are retained in `validation.md`, not silently counted as passes. The tasks below reflect this approved acceptance revision.

## 1. Owner-scoped read-only save confirmation

- [x] 1.1 Add active-user, nontrashed save predicates in `dbBookmark.ts` and `dbBookmarkFork.ts` without processing-status filtering or writes; verify private/public ownership, missing/foreign/trashed relations and pending states in repository/domain tests.
- [x] 1.2 Reuse creation normalization and read-only Reader/PDF destination identity; verify original-key short links, WeChat, X/Twitter parameters and unchanged legacy `/exists` semantics in the focused API suites.
- [x] 1.3 Add only the existing Twitter pre-save alias fallback with optional cancellation and a two-second external-read budget, retaining normal caller defaults; verify canonical/original hits, no broad short-link resolving, and stalled header/success/error-body cancellation.
- [x] 1.4 Add authenticated bodyless `POST /v1/bookmark/save_receipt` (204/404, private/no-store), preserve error/auth and legacy contracts, and generate registration through `pnpm api -- gen:all`; verify controller tests, generated diff, and unchanged CLI API-key permissions.

## 2. Native acknowledgement and bounded recovery

- [x] 2.1 Enforce a five-second total iOS create deadline and finish on delivered 200/204 headers without consuming success bodies; verify the real Swift host tests cover stalled bodies, partial traffic, explicit rejection and cancellation. Older-runtime device behavior is disclosed rather than claimed verified.
- [x] 2.2 Add one three-second status-only iOS receipt using the same URL/auth/origin; verify positive/negative/rejected/stalled receipt, beta selection, counts, timing and cancellation in the final Swift host suite.
- [x] 2.3 Add matching Android total deadlines and receipt flow with activity-owned cancellation; retain pre-send route fallback with a one-shot create body and disable receipt retries; verify the final executable Kotlin/OkHttp 27-scenario host suite.
- [x] 2.4 Preserve original create error/metrics and one redacted terminal diagnostic on recovered success or dismissal; verify the final Swift/Kotlin diagnostic suites and existing export checks.
- [x] 2.5 Preserve source/generator ownership and register any extracted native helper through existing discovery; verify plugin tests, generated Swift copy parity and host compilation without manual generated edits.

## 3. Approved version and native generation

- [x] 3.1 Set Mobile version `1.0.28`, buildNumber `800`, previousBuildNumber `799`; update only the current source-version release record and verify the manifest parser/version tests.
- [x] 3.2 Generate both native targets through existing Expo/config plugins, remove unrelated local configuration churn, and verify matching iOS main/share, Android and runtime metadata plus source-copy parity. No native compile is required by the revised acceptance scope.

## 4. Final automated checks and PR delivery

- [x] 4.1 Run the final affected API unit suites and typecheck; verify 124 tests pass and shared/API typechecks pass. Preserve earlier lint, real database evidence and full-run runner timeout in `validation.md` without claiming the interrupted full API build passed.
- [x] 4.2 Run the final Swift/Kotlin/plugin/version host suites and verify 53 tests pass with zero skips/failures; retain the passing dual-platform bundle and earlier Mobile check/resource results with their correct chronology.
- [x] 4.3 Verify the conditional failure through deterministic tests: hold creation acknowledgement, return saved receipt, stall success body, and assert exactly one create plus at most one receipt and correct time bounds. Full API-to-native end-to-end and native device runs are excluded by the owner, with gaps disclosed.
- [x] 4.4 Verify no-save/rejected/stalled receipt, invalid authentication, normalized URLs, pending Reader destinations, trash and phase cancellation through the retained API/host suites; record final counts and actual coverage in `validation.md`.
- [x] 4.5 Record the owner's explicit no-UI-change and automated-only acceptance decision in proposal/design/validation. Do not claim manual native acceptance, screenshots, publisher signing, or runtime coverage that was not performed.
- [x] 4.6 Complete Bugs/Security/Compliance review, `pnpm exec openspec validate --all --strict`, and `git diff --check`; then commit, push, and open the user-authorized PR targeting dev with evidence and API-before-client rollout/version implications. Delivered as PR #509; no merge, deployment, signing, upload, or publication performed.
