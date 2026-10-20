# Validation

OpenSpec: rss-local-first

## Rebase onto Expo 58 (2026-10-20)

The human requested rebasing PR #298 onto `origin/dev`. The base is `9b472335` (Expo 58). The only conflict was `RssFeed.tsx`'s `ListEmptyComponent`: the resolution retains the upstream `undefined` empty-component value and `ViewInstance` ref typing while preserving the RSS `state.ready` guard and pending first-sync progress. No new visual behavior, API contract or migration is introduced by this resolution. The rebase initially inherited Mobile `1.0.25`, build `775`, previous `774`. Before pushing, the human explicitly requested a one-build increment for re-release: the final source keeps `1.0.25` and uses build `776`, previous `775`.

`git range-diff` confirmed that the rebased application patch differs only in the upstream React Native empty-component compatibility context. Other RSS controller, Web, test and specification changes replayed without conflicts. Frozen-lockfile dependency installation with scripts disabled completed successfully without changing the lockfile; post-rebase checks use the Expo 58 dependency set.

## Existing running-environment evidence

Before this rebase, the agent exercised the authenticated local Web RSS page: reload made one Labs request and zero RSS list requests; source selection and a settled 65-second window made zero RSS list requests. The deployed test service was also exercised through an actual RSS-only PowerSync stream: after the operator's one-time equal-value source UPDATE, a completed checkpoint delivered one subscription, one feed and ten article rows without errors. Details and the separate unsuccessful isolated-service reproduction are in [verification.md](verification.md).

Earlier single-iOS-simulator local synchronization, ownership, history exclusion, offline relaunch and reconnect evidence is in [real-sync-verification.md](real-sync-verification.md). Those native results used the earlier Expo 57 baseline and are not claimed as Expo 58 native acceptance. No simulator, Android runtime or native build is repeated for this rebase; only host regressions, typechecking and iOS JavaScript export are checked. The upstream SDK upgrade's device behavior is outside this conflict resolution's verification.

The original follow-up PR passed seven Web suites (110 tests), Web typecheck and the official Mobile check (1,330 host tests), followed by the final cache-probe regressions (36 tests), Mobile typecheck and an iOS-only JavaScript export. These are historical pre-rebase checks; post-rebase results are recorded separately below.

## Post-rebase results

The existing `gpt-6-luna high` agent completed these checks on the rebased tree with Expo `58.0.16` installed:

- `pnpm install --frozen-lockfile --ignore-scripts`: exit 0, lockfile unchanged.
- Mobile typecheck: exit 0.
- `node --experimental-strip-types --test tests/rss/controller.test.mjs`: 36/36 tests passed.
- `pnpm --filter @apps/slax-reader-mobile exec expo export --platform ios --output-dir <new-task-owned-temporary-directory>`: exit 0, one iOS bundle, 1,887 modules and about 14 MB; no Android bundle.

The agent removed the new export directory, temporary log and generated PDF bundle that was absent at baseline. Existing Mobile `dist`, `.expo`, Web `.nuxt`, dependencies and shared services were preserved. No simulator or native build was run.

## Latest release metadata decision

The human explicitly requested build +1 before pushing because this change needs a new release. This replaces the previous no-additional-bump decision. Mobile keeps `version=1.0.25`, uses `buildNumber=776` and `previousBuildNumber=775`, with no additional CLI or Extension version change. The existing Expo prebuild generator regenerated native metadata; the generated diff is limited to version fields in Android Gradle/manifest, main iOS Info.plist, Share Info.plist and the Share Xcode build configurations. Android execution, native compilation, signing and uploads were not performed.

Read-only pre-push review confirmed the RSS conflict resolution and all generated platform version values, with no remaining Bugs or Security Important findings. The validation record is included in the PR and linked from its Test plan to satisfy the updated documentation requirement.

The `gpt-6-luna high` agent ran `SLAX_MOBILE_NO_LOCAL_CONFIG=1 EXPO_NO_DOTENV=1 pnpm mobile -- prebuild` successfully; its existing script uses `--no-install --no-clean`, so no CocoaPods/Gradle/Xcode build was started. The existing build-version/share-plugin suites passed 11/11 tests, direct main/share/Android metadata assertions passed, and `BEFORE=9b472335 node tooling/mobile-eas-release.mjs` exited 0 with `changed=true`, version `1.0.25`, build `776`. This last command is a local static eligibility check, not an EAS invocation. No new generated bundle needed cleanup; existing local build directories and the Web development server were preserved.

Before final push, `dev` advanced to `07d1436d` with documentation/governance-only PR #299. Both task commits rebased onto that tip without conflicts. The extra base commit changes no application, dependency or version input, so the Expo 58 and build-776 check results above remain applicable; those checks were not repeated.
