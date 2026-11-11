# Tasks

Current tracking: OpenSpec `update-expo-58`, branch `feat/update-expo-58`. The original setup/approval used `mobile-sdk58-native-experiences`; its historical evidence remains unchanged.

Board scope: **1–9 and 12**. Item **10 is removed/deferred; item 11 and `expo-insights` are excluded**. Work stays in the independent `feat/update-expo-58` branch, historically based on `mobile-perf@960ccb5` and now integrated with `dev@a3fb949`.

On 2026-10-20, the human assigned hands-on device, authenticated-provider, configured-service, sandbox-purchase and older-OS exploration to themselves outside this PR's merge gates. Former device/manual delivery checklist items are withdrawn below, not marked passed. Runtime functional/authentication/privacy contracts remain mandatory. Agent verification uses actual CI/build evidence and the authorized Duo simulator; real PDF tail/spread continuity concerns remain open. No additional Android execution is requested.

## 1. Isolated setup and proposal review — board item 1

- [x] 1.1 Create the independent worktree and `feat/mobile-sdk58-native-experiences` branch directly from `feat/mobile-perf`; verify HEAD is `960ccb57bc89796d9063e0a41e83b4a766628161` and the main checkout is back on `dev`. The human subsequently requested renaming this task branch to `feat/update-expo-58` and its OpenSpec change to `update-expo-58`.
- [x] 1.2 Obtain human review of proposal/design/specs, including the named `expo-app-intents`, `expo-widgets`, `@expo/ui` and `expo-hinge` integrations; record the explicit decision before application-code or optional-dependency changes. Approved by the user's "开始实施" instruction on 2026-10-19 after the completed proposal was presented.
- [x] 1.3 Prepare isolated task dependencies and capture SDK-57 check/bundle baselines through root commands; record exact versions, totals/skips and output locations without reading operator secrets.
- [x] 1.4 Confirm available Android SDK/JDK and iOS build/runtime prerequisites; record supported native targets and any missing toolchain needed for SDK-58 or iOS-27.1 verification.

## 2. Runtime dependency upgrade — board item 2

- [x] 2.1 Update Expo/RN and existing Expo/native runtime dependencies to the supported SDK-58 matrix without feature additions; verify dependency/peer resolution and a reproducible workspace lockfile.
- [x] 2.2 Align React DOM exactly to React and choose compatible React types; verify both bundle resolvers and mounted React hosts use compatible React instances.
- [x] 2.3 Run Expo dependency checking and `expo-doctor` with local dotenv discovery disabled; record/fix actionable diagnostics and document any remaining external constraint.

## 3. Owned native configuration repairs — board item 3

- [x] 3.1 Raise Android compile SDK to 37 while retaining min 26 and target 36 unless a reviewed constraint requires otherwise; verify generated Gradle values and focused plugin tests.
- [x] 3.2 Repair plugin Release signing transforms for both `signingConfig signingConfigs.debug` and `signingConfig = signingConfigs.debug`; test repeated generation, other build types, preserved R8 settings and missing-template failure.
- [x] 3.3 Repair `tooling/native-build.mjs` release admission for both spellings even when the owned marker exists; verify negative cases reject debug signing and unsigned validation remains explicit.
- [x] 3.4 Implement guarded configured-main Firebase insertion for the scene-based template while reusing upstream initialization; verify exactly-once bootstrap, insertion failure, unconfigured fixtures and no Share integration.
- [x] 3.5 Adapt owned lifecycle/callback hooks and share/native-back generation to SDK 58 where required; verify generated Google URL schemes, callback ownership, Share membership and plugin idempotence.

## 4. Clean native generation and base build gate — board item 4

- [x] 4.1 Preserve required task outputs outside regenerated directories and ensure no active task build uses them; run clean Android prebuild and verify identity, SDK, signing and manifest/resource output.
- [x] 4.2 Run clean iOS prebuild and supported pod installation without inspecting credentials; verify main/SceneDelegate, `SlaxShare` embedding, source/resource ownership, App Group and Firebase boundaries.
- [x] 4.3 Repeat generation with identical inputs; verify no duplicate targets, callbacks, bootstrap or build phases and no unexplained generated drift.
- [x] 4.4 Run `pnpm mobile -- build:android` for Debug; fix base native failures and record the successful artifact/toolchain.
- [x] 4.5 Run `pnpm mobile -- build:android --release --unsigned` with R8 enabled; repair demonstrated reflective/resource failures using narrow keep rules and record the successful unsigned minified build.
- [x] 4.6 Run `pnpm mobile -- build:ios` for Debug and `pnpm mobile -- build:ios --release --unsigned`; fix base failures and verify the simulator app includes `SlaxShare` and required native dependencies.
- [x] 4.7 Smoke-launch both base builds and record the base gate as passed only after 4.1–4.6 succeed; if red, keep sections 8–10 and 12 blocked while continuing upgrade repairs.

## 5. Strict TypeScript repair — board item 5

- [x] 5.1 Measure upgraded type failures and migrate RN view/input/list/scroll refs to supported instance types; verify the affected feature hooks and components typecheck without broad casts or suppressed errors.
- [x] 5.2 Repair remaining genuine API/prop/type mismatches, including removed native APIs; verify `pnpm mobile -- typecheck` exits successfully with zero errors and no unreviewed legacy opt-out.

## 6. Test harness repair — board item 6

- [x] 6.1 Measure the actual upgraded suite failures and group loader/transform, React-host, installed Animated and application regressions; retain the failing-case inventory for comparison.
- [x] 6.2 Adapt installed-runtime loaders/transforms to RN 0.88 and maintain explicit external boundaries; verify animation cancellation, event attachment, interrupted gestures and real installed implementation assertions.
- [x] 6.3 Repair mounted React DOM/VM and test isolation/ref semantics; verify lifecycle, account replacement, unmount, navigation header and hidden-Library regression suites.
- [x] 6.4 Run the complete `pnpm mobile -- test` suite after repairs; verify zero failures, explain existing skips and confirm no new skip or weakened assertion hides an upgrade regression.

## 7. Regression evidence and ownership — board item 7

Former manual scenarios 7.1–7.7 are outside the agent delivery checklist under the human's 2026-10-20 decision. They are not unperformed PR prerequisites and no pass is claimed for them. Preserve the historical native base-build/resource results, current Mobile CI results and actual Duo observations in `verification.md`. Product behavior for provider callbacks, Share, purchases, offline data, account/origin replacement and performance remains unchanged. The optional usage notes in `docs/mobile/integrations.md` are a user guide, not an acceptance checklist. Simulator PDF/layout follow-up remains in section 12.

## 8. App Intents save spike — board item 8

- [x] 8.1 After the base gate and package consent, install/pin `expo-app-intents` and create one app-target Swift save-URL intent/shortcut; verify native metadata extraction and regenerated app builds. Android Debug `arm64-v8a` and iOS Debug/unsigned Release arm64 simulator builds pass; both iOS products extract `SaveLinkIntent` and its shortcut metadata and embed `SlaxShare` (details in `docs/mobile/sdk58-upgrade.md`).
- [x] 8.2 Add the single runtime handler and typed queue/save/routing boundaries; test invalid URLs, readiness ordering, cold pending delivery, duplicate invocation and handoff-versus-save outcomes. Controller and mounted-host tests are covered by the passing current Mobile CI.

Manual Siri/Shortcuts exploration formerly listed as 8.3 is user-owned outside PR gates. Compiled intent metadata and passing controller tests do not claim an end-to-end Siri save. Every new invocation still requires explicit Claim and save after account admission.

## 9. App Intents MVP — board item 9

- [x] 9.1 Implement owned durable invocation receipts, explicit ownership claiming where needed, cancellation and retry/discard; test offline replay, API-success-before-ack interruption and account/origin replacement. Focused JS controller and mounted-host tests pass.
- [ ] 9.2 Add independently disableable system-discovery settings and bounded eligible catalog publication; test the human-approved 2026-10-20 default-on behavior for unset/new preferences, persisted explicit opt-outs, preference/admission readiness, 100-item limit, metadata exclusions and stale publisher fencing. The catalog source now filters `status = 'success'` before its 100-row limit and the projection rechecks that status. The current CI executes the existing default/opt-out, bounded-projection and owner-fencing tests successfully. An explicit unsuccessful-row/pre-limit regression case is not present; retain this code-coverage follow-up without treating user-run Spotlight exploration as a prerequisite.
- [x] 9.3 Implement Spotlight opening through current account/data/navigation admission; test cold start, deleted identifiers, private/ineligible items and cross-account results. Focused router tests pass with owner-scoped opaque IDs.
- [x] 9.4 Implement successful-action donations and catalog/donation revocation on deletion, opt-out and sign-out; test duplicate suppression and retryable OS failures. Current Mobile CI at `fb73f83` passes the donation crash/storage/runtime-generation, duplicate suppression and retry cases. Admission precedes dispatch; ambiguous/legacy replay is suppressed and explicit native rejection stays retryable. These are automated results, not a claim of OS suggestion display.

Manual system-search/donation exploration formerly listed as 9.5 is user-owned outside PR gates. Record simulator capabilities honestly; queued handoff and compiled metadata do not establish native suggestion display or authenticated save completion.

## 10. Widgets and Live Activity — removed/deferred by human decision

On 2026-10-20 the human removed this entire board item from current delivery. The earlier staged implementation, fixture, settings, data queries, native bridges/providers/targets and `expo-widgets` dependency are removed; its capability delta is withdrawn. `@expo/ui` remains required by App Intents. This is an explicit scope change, not completed widget acceptance. Existing native generation must retire stale owned artifacts while preserving Share and its App Group.

## 12. Adaptive Duo and PDF.js prototype — board item 12

- [x] 12.1 Install the approved `expo-hinge` integration and add a development-only prototype switch with explicit platform/availability guards; verify the explicit disabled/unsupported guards through the existing policy coverage; no older-OS hands-on check is an agent PR gate. The dependency/switch and guards are implemented, and current Mobile CI passes. The human approved this PDF.js implementation adjustment on 2026-10-20; `@expo/ui` remains required by App Intents, not PDF presentation.
- [ ] 12.2 Add measured scene/safe-area layout policy inside the existing PDF.js single-WebView presentation and apply current all-edge scene bounds to Inbox/header, drawer, Reader and popovers; test narrow/wide/resize transitions, reachable short-height drawer/menu actions and ensure hinge angle alone does not choose layout. `expo-hinge` may drive pose effects only.
- [ ] 12.3 Extend existing PDF.js canvas/layout virtualization to bounded adjacent-page spreads under the same single WebView/document/resource owner; verify odd final pages, offline bytes, integrity checks and document replacement cancellation.
- [ ] 12.4 Preserve page/normalized progress across spreads, single-page transitions and cold restoration; test per-page highlight/comment geometry, hit testing, selection and accessibility order.
- [ ] 12.5 Exercise the prototype first on the available iOS Duo simulator; record resize/fold, interruption and reduced-motion outcomes. Do not require physical-device acceptance or new Android validation for this task. The full OS/geometry and single-page fallback contract remains mandatory.

## 13. Integrated verification and delivery

- [x] 13.1 Record the integrated automated/native build results. Mobile CI at `fb73f83` passes with 1,313 tests passed, 0 failed, 15 skipped and both Android/iOS bundle exports. The no-widget Duo Debug arm64 build succeeds with iOS deployment target 16.4, only SlaxShare embedded and the original App Group. This does not convert unperformed user-run checks into passes.
- [x] 13.2 Update English mobile integration/status documentation with the runtime, approved packages, default-on preferences, independent OS capabilities, current CI/build evidence and user-owned manual verification policy. Keep the actual PDF continuity issue explicit.
- [ ] 13.3 Recheck canonical specs on the intended merge base and reconcile the SDK runtime pin within this change if necessary; run `pnpm exec openspec validate --all --strict` and verify no competing active capability delta is introduced.
- [x] 13.4 Complete the `REVIEW.md` Bugs, Security and Compliance review. The earlier source review and focused rechecks passed; the current documentation-only policy revision also completed its narrow three-pass review with no substantive findings. Current-document OpenSpec validation passes 65/65 and diff checks pass. No product code changed in this revision, and no unperformed user-run outcome is asserted.
- [x] 13.5 Ask the human for Mobile version/build metadata after validation and wait for an explicit decision. The human approved `1.0.25 (774)` with previous bound `773`; 773 is the source prior-build bound from the latest `origin/dev`, not independently verified store publication history. This authorizes metadata regeneration only, not signing, upload or publication.
- [x] 13.6 Apply approved `1.0.25 (774)` / previous source bound `773` through existing generators. Earlier metadata-only passes verified 774. The current scope removes the widget target; canonical regeneration now preserves Android/main/Share metadata and retires its widget artifacts. Main-target PBX template placeholders remain unchanged because its explicit Info.plist owns the actual version. The latest inherited CI workflow becomes eligible after an increased source build reaches `dev` and Mobile CI passes; with configured credentials it builds and auto-submits to TestFlight/Play internal without waiting. This draft PR performs no merge or submission. The no-widget exact-Duo Debug build now confirms the generated main/Share metadata and effective deployment floor; hands-on iOS 16.4 behavior is not claimed.
- [x] 13.7 Prepare the reviewed documentation/PR update. Current-document OpenSpec validation passes 65/65, diff checks pass and narrow three-pass review is complete. [PR #292](https://github.com/slax-lab/slax-reader/pull/292) already exists, and its prepared English body at ignored `.local/update-expo-58/PR.md` retains `OpenSpec: update-expo-58`, recorded CI/build evidence and the unresolved simulator PDF issue. This completes preparation, not a claim that the current documentation has already been committed/pushed or that the PR has merged. The historical base is included in dev; user-run manual checks are outside PR gates.
- [x] 13.8 Record and hand off verification results before the human-authorized scoped cleanup; preserve source/operator files and defer OpenSpec archival until after merge. The earlier cleanup removed the then-owned simulator/Metro/DerivedData, while the retained screenshot, native build log and validation record remain under ignored `.local/evidence/mobile-sdk58-native/`. Repository-local task-output cleanup is scoped and preserves generated source and operator files. Renewed task-owned DerivedData and fixture outputs were subsequently cleaned after evidence preservation; the recreated Duo was retained because another active task uses it. The doc-only PR update remains in 13.7.

## 14. Latest dev integration and source build increment

- [x] 14.1 Compare fixed `origin/dev@6caf48343465488a8a3fb111e992533bfbe5b20b` against task HEAD `a9ec6d6faaed4db786d9741e7f0acdd0e502b70a` from merge base `a3fb9492c8c9289318fb0bad8518e7236dc31076`; retain both sides of the mechanical fixture-scheme/inline-module conflict and inspect Mobile/shared integration intent. No conflicting behavior was identified by source comparison; no runtime validation is implied.
- [x] 14.2 Apply the human's authorized one-build increment to the manifest: `1.0.25 (775)`, previous source bound `774`, above dev source 773 and prior task source 774. Preserve historical build-774 evidence and existing feature scope.
- [x] 14.3 Regenerate Android/main/Share metadata through existing tooling and perform permitted generator/strict/diff checks. The small-model lane verified 775 metadata with previous manifest bound 774, passed seven focused native-compatibility tests and two no-clean prebuilds with one stable App Intents group, preserved Share, and passed OpenSpec strict 68/68 plus diff checks against HEAD. Native files were generated, not hand-edited; no new native compilation/runtime acceptance or publication is claimed.
- [ ] 14.4 Complete focused final review and commit/push the integrated revision with the prepared PR body. Generator/check evidence is recorded separately from delivery; prior CI/build evidence is not a new build-775 runtime pass.
