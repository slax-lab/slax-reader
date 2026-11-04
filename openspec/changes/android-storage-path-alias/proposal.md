# Proposal

## Why

The connected Pixel 9 Pro Fold running Android 17 and Slax Reader 1.0.26 (797) displays `SlaxLegacy.beginDataOwnership` rejected with `Database directory requires recovery`, blocking saved-data admission before SQLite opens. The directory guard introduced in `d033836a` compares a canonical application root with an absolute child path and rejects legitimate Android application-storage ancestor aliases; retrying cannot change those path identities.

## What Changes

- Resolve the Android application data root and its expected `files/slax-react-native` database slot consistently through the trusted application root, allowing Android's equivalent ancestor path spellings.
- Reuse the same narrow directory resolution in ordinary and development-fresh ownership entry points, without changing their different lease policies.
- Preserve rejection of redirected application child directories, paths outside the application root, invalid established database identities, and missing established databases. Never clear or replace saved data to recover from this error.
- Extend the existing Kotlin host regression harness to exercise the production directory resolver with a legitimate ancestor alias and retain negative path/identity tests; verify the actual native startup flow on Android.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mobile-upgrade-compatibility`: Require Android database admission to tolerate equivalent application-root aliases without relaxing ownership, identity, or data-preservation guarantees.

## Impact

- Android `apps/mobile/modules/slax-legacy/android/src/main/java/com/slax/reader/legacy/SlaxLegacyModule.kt` and a small directory-resolution helper beside the existing installation helper.
- Existing `apps/mobile/tests/data/installation-native-host.kt` and its `.mjs` runner, plus any narrowly necessary existing-suite integration.
- No API, database schema, dependency, iOS, or UI-layout changes. A native Android rebuild is required; JavaScript-only updates cannot repair the Kotlin guard.
- The device error and failing guard are confirmed. The exact app-process path pair has not been dumped; the alias mechanism is supported by the code and existing Android fixture evidence in `apps/mobile/tests/data/adoption-fixtures/README.md:84`. Native verification must confirm the repair rather than assume it.
- Implementation and phone test installation were explicitly authorized after the proposal was presented; see the review record below. Package version choice, human hands-on acceptance, and any release remain separate decisions. Secret-file inspection is not authorized.

## Review and Authorization

On 2026-11-02, after this proposal and its minimal path-normalization approach were presented, the user explicitly instructed the agent to make local source modifications without committing, build the repaired native Android application, and install it on the connected phone for human testing. Initially the agent pursued a same-signature, data-preserving update.

After the installed and configured local signing certificates were found to differ, the user explicitly instructed the agent to uninstall the old application and install the local repaired package. The agent disclosed that uninstalling clears local data and unsynchronized content, and will only uninstall after a valid repaired package is available. This changes the operator installation authorization, not the production resolver's preservation requirements. A fresh installation cannot establish upgrade preservation or recovery of the previous on-device data.

The repaired local build 1.0.26 (797) was installed successfully after the authorized uninstall and cold-launched on the phone. On 2026-11-02, the user confirmed the test was satisfactory and explicitly requested a build increment and pull request. This authorizes build 798 with previousBuildNumber 797, committing the scoped change, pushing its task branch, and opening a pull request targeting dev. The marketing version remains 1.0.26. The acceptance covers the reported Android startup issue on the fresh installation, not an unperformed data-preserving upgrade. Store publication, merging, and secret-file inspection remain unauthorized.
