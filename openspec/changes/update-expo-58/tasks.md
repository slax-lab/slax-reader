# Tasks

Current tracking: OpenSpec `update-expo-58`, branch `feat/update-expo-58`. The original setup/approval used `mobile-sdk58-native-experiences`; its historical evidence remains unchanged.

Board scope: **1–9 and 12**. Board item **10 is removed/deferred by the human on 2026-10-20; item 11 and `expo-insights` are excluded**, as confirmed by the latest human continuation instruction. All implementation stays in the independent worktree and this branch, based on `feat/mobile-perf@960ccb5`; other mobile branches are not dependencies. Native feature packages and targets must wait for all base build checks in section 4. Read `design.md` for defaults and the capability specs for acceptance contracts. On 2026-10-20, the human directed that remaining interactive simulator validation prioritize the iOS Duo prototype; do not run new Android builds or physical-device acceptance. Preserve historical Android base-gate evidence already recorded, while leaving unperformed Android feature acceptance explicitly open. User-requested manual Siri/login/IAP acceptance is a delivery checklist, not a prerequisite to the currently prioritized Duo simulator validation.

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

## 7. Native and offline regression acceptance — board item 7

- [ ] 7.1 Exercise iOS scene cold/warm launch, foreground/background transitions, Google and Apple callbacks and configured Firebase initialization; record actual native/live coverage separately from fixture results.
- [ ] 7.2 Exercise Safari incoming sharing and Android ACTION_SEND with correct URL/title/account, cancellation and signed-out cases; verify Share identity and its Firebase-free iOS target. Android device/build portions remain unperformed under the 2026-10-20 no-new-Android-validation instruction.
- [ ] 7.3 Exercise sandbox IAP purchase/cancel/restore on a suitable target; record successful behavior or retain this task incomplete with the exact platform/account limitation.
- [ ] 7.4 Exercise Android minified Release startup, reflective modules, predictive back/canceled back and Reader scrolling; record native outcomes without treating Debug as R8 acceptance. No additional Android Release build/device run is authorized by the 2026-10-20 validation-priority instruction; retain this item open.
- [ ] 7.5 Exercise HTML/PDF cold open, selection/highlights/comments, scroll restoration and offline process relaunch on both platforms; verify cached content and pending writes survive.
- [ ] 7.6 Exercise sync reconnect, account/origin replacement, image cache/gallery/save/share and cancellation; run `pnpm mobile -- test:native-resources` and record host versus native coverage separately.
- [ ] 7.7 Verify the baseline hidden-Library suspension, stable Reader header and exact resting feed offsets still hold; use Release measurements for any performance claim.

## 8. App Intents save spike — board item 8

- [x] 8.1 After the base gate and package consent, install/pin `expo-app-intents` and create one app-target Swift save-URL intent/shortcut; verify native metadata extraction and regenerated app builds. Android Debug `arm64-v8a` and iOS Debug/unsigned Release arm64 simulator builds pass; both iOS products extract `SaveLinkIntent` and its shortcut metadata and embed `SlaxShare` (details in `docs/mobile/sdk58-upgrade.md`).
- [x] 8.2 Add the single runtime handler and typed queue/save/routing boundaries; test invalid URLs, readiness ordering, cold pending delivery, duplicate invocation and handoff-versus-save outcomes. Focused JS controller and mounted-host tests pass; native invocation acceptance remains 8.3.
- [ ] 8.3 Run one Siri/Shortcuts URL save from a terminated application through the existing authenticated API path; verify the saved bookmark and record actual native invocation/queue completion.

## 9. App Intents MVP — board item 9

- [x] 9.1 Implement owned durable invocation receipts, explicit ownership claiming where needed, cancellation and retry/discard; test offline replay, API-success-before-ack interruption and account/origin replacement. Focused JS controller and mounted-host tests pass.
- [ ] 9.2 Add independently disableable system-discovery settings and bounded eligible catalog publication; test the human-approved 2026-10-20 default-on behavior for unset/new preferences, persisted explicit opt-outs, preference/admission readiness, 100-item limit, metadata exclusions and stale publisher fencing. The catalog source now filters `status = 'success'` before its 100-row limit and the projection rechecks that status. The earlier focused tests did not cover unsuccessful rows and were not rerun after this fix under the iOS Duo-only validation instruction; keep this task open until the permitted validation establishes the updated path.
- [x] 9.3 Implement Spotlight opening through current account/data/navigation admission; test cold start, deleted identifiers, private/ineligible items and cross-account results. Focused router tests pass with owner-scoped opaque IDs.
- [ ] 9.4 Implement successful-action donations and catalog/donation revocation on deletion, opt-out and sign-out; test duplicate suppression and retryable OS failures. Earlier focused controller tests passed before the final review correction. The correction persists donation admission before native dispatch, suppresses ambiguous/legacy replay and preserves explicit native-rejection retries; new crash/storage/runtime-generation regressions are authored but remain unexecuted under the current validation restriction.
- [ ] 9.5 Verify save, search/open and donation behavior on a supported native iOS target, including offline recovery; record alpha package/runtime limitations without claiming unavailable background completion.

## 10. Widgets and Live Activity — removed/deferred by human decision

On 2026-10-20 the human removed this entire board item from current delivery. The earlier staged implementation, fixture, settings, data queries, native bridges/providers/targets and `expo-widgets` dependency are removed; its capability delta is withdrawn. `@expo/ui` remains required by App Intents. This is an explicit scope change, not completed widget acceptance. Existing native generation must retire stale owned artifacts while preserving Share and its App Group.

## 12. Adaptive Duo and PDF.js prototype — board item 12

- [ ] 12.1 Install the approved `expo-hinge` integration and add a development-only prototype switch with explicit platform/availability guards; verify disabled and earlier-OS paths retain ordinary Reader behavior. The human approved this PDF.js implementation adjustment on 2026-10-20; `@expo/ui` remains required by App Intents, not PDF presentation.
- [ ] 12.2 Add measured scene/safe-area layout policy inside the existing PDF.js single-WebView presentation and apply current all-edge scene bounds to Inbox/header, drawer, Reader and popovers; test narrow/wide/resize transitions, reachable short-height drawer/menu actions and ensure hinge angle alone does not choose layout. `expo-hinge` may drive pose effects only.
- [ ] 12.3 Extend existing PDF.js canvas/layout virtualization to bounded adjacent-page spreads under the same single WebView/document/resource owner; verify odd final pages, offline bytes, integrity checks and document replacement cancellation.
- [ ] 12.4 Preserve page/normalized progress across spreads, single-page transitions and cold restoration; test per-page highlight/comment geometry, hit testing, selection and accessibility order.
- [ ] 12.5 Exercise the prototype first on the available iOS Duo simulator; record resize/fold, interruption and reduced-motion outcomes. Do not require physical-device acceptance or new Android validation for this task. The full OS/geometry and single-page fallback contract remains mandatory.

## 13. Integrated verification and delivery

- [ ] 13.1 Run `pnpm mobile -- check`, `pnpm mobile -- bundle` and affected native resource/build checks on the integrated deliverable; record actual results and unresolved native/live limitations.
- [ ] 13.2 Update English mobile development/integration documentation with the runtime, root commands, approved packages, system-surface defaults and prototype limits; verify links/commands and no obsolete acceptance claims are introduced.
- [ ] 13.3 Recheck canonical specs on the intended merge base and reconcile the SDK runtime pin within this change if necessary; run `pnpm exec openspec validate --all --strict` and verify no competing active capability delta is introduced.
- [ ] 13.4 Run the `REVIEW.md` Bugs, Security and Compliance local review for `update-expo-58`. The read-only reviewer completed all three passes and statically rechecked the donation-admission correction; no Important findings remained at that checkpoint. Recheck the subsequent widget removal, per-capability minimum OS and harness changes before push. This review does not establish runtime acceptance of the new regression cases.
- [x] 13.5 Ask the human for Mobile version/build metadata after validation and wait for an explicit decision. The human approved `1.0.25 (774)` with previous bound `773`; 773 is the source prior-build bound from the latest `origin/dev`, not independently verified store publication history. This authorizes metadata regeneration only, not signing, upload or publication.
- [x] 13.6 Apply approved `1.0.25 (774)` / previous source bound `773` through existing generators. Earlier metadata-only passes verified 774. The current scope removes the widget target; canonical regeneration now preserves Android/main/Share metadata and retires its widget artifacts. Main-target PBX template placeholders remain unchanged because its explicit Info.plist owns the actual version. The latest inherited CI workflow becomes eligible after an increased source build reaches `dev` and Mobile CI passes; with configured credentials it builds and auto-submits to TestFlight/Play internal without waiting. This draft PR performs no merge or submission. The final metadata and review corrections have not been rebuilt or runtime-tested.
- [ ] 13.7 Verify `git diff --check`, final OpenSpec validation and a task-only diff relative to the temporary base; create one draft `dev` PR with `OpenSpec: update-expo-58`, and retain native acceptance gaps explicitly. The historical `mobile-perf@960ccb5` starting point is already included in the refreshed `origin/dev`; no unmerged baseline commits need to be carried into this PR. Draft PR [#292](https://github.com/slax-lab/slax-reader/pull/292) now targets `dev` with the required OpenSpec line. The `dev@a3fb949` integration was pushed as `e3f186e4`. The later human-authorized widget removal/minimum-OS and CI-harness corrections require a fresh narrow review and validation before updating the draft. The English body remains under ignored `.local/update-expo-58/PR.md`.
- [x] 13.8 Record and hand off verification results before the human-authorized scoped cleanup; preserve source/operator files and defer OpenSpec archival until after merge. The task Duo simulator, Metro and DerivedData have been removed, while the retained screenshot, native build log and validation record remain under ignored `.local/evidence/mobile-sdk58-native/`. Repository-local task-output cleanup is scoped and preserves generated source and operator files. Remote draft PR delivery remains tracked in 13.7, separately from the completed evidence-preservation/cleanup work.
