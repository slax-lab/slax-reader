# Design

## Context

See `proposal.md` for the reported failure and evidence limits. `SlaxLegacyModule.kt` currently canonicalizes `context.dataDir` but compares that with `databaseDirectory.absoluteFile` in both ownership entry points. The ordinary entry acquires its existing file lock first and releases it on directory failure. `InstallationDatabase.kt` subsequently verifies canonical database slots, owners, and established bindings; these checks must remain intact.

The existing Kotlin host runner compiles the production installation helper but not the module's directory guard. Its fixture starts with an already canonical root and covers database-file links, not an aliased application-root ancestor. This change therefore needs a short design to distinguish permitted root normalization from application-child redirection.

## Goals / Non-Goals

**Goals:**
- Make directory admission independent of equivalent OS-provided root spellings.
- Keep one small filesystem-only resolver shared by both Android ownership entry points and directly executable by the existing Kotlin fixture.
- Preserve current recovery and storage-ownership semantics, including existing binding identity and legacy database selection.

**Non-Goals:**
- No database copying, schema changes, installation-record rewriting, data resets, new lease lifecycle, dependency changes, or iOS changes.
- No removal of root-containment or child-link checks; no generalized storage framework, speculative race hardening, or new diagnostics subsystem.
- No changes to the recovery presentation, account lifecycle, or production-to-development fallback behavior.

## Decisions

### Normalize the trusted root, then validate fixed child slots

Add a small `DatabaseDirectory.kt` helper beside `InstallationDatabase.kt`. Canonicalize the OS-provided application root first. Construct the expected lexical `files` slot under that canonical root, verify the supplied files directory resolves to exactly that slot, and require that fixed child slot itself is not redirected. Construct `slax-react-native` beneath the validated slot and require its canonical path to equal that expected child path within the root. Return the canonical-root-based directory even when that directory has not yet been created. Existing directory creation remains in the caller after validation.

This accepts an alias in the OS-provided root's ancestors while retaining the existing rejection of a linked `files` or `slax-react-native` child. It avoids hardcoding `/data/user/0` or replacing string prefixes, so secondary Android users use the same rule. Both callers keep their existing error and lease behavior and use the returned directory for subsequent inventory and identity calculations.

Alternatives rejected:
- Reverting only to `databaseDirectory.canonicalFile` would also follow a redirected database child and weaken the existing guard.
- Retaining equality between the original absolute and canonical path preserves the reported failure.
- Accepting any path with a matching textual prefix or hardcoding Android aliases is less precise than validating the fixed slot from the trusted canonical root.

### Keep installation identity validation unchanged

Pass the consistently resolved root/directory into the existing `installationDatabase` call. Do not relax its checks or rewrite stored paths to mask disagreement. Existing valid canonical native/adopted records must resolve to the same file. A remaining identity failure is a distinct issue to report and investigate, not permission to substitute a database or clear metadata.

### Exercise production resolution in the existing harness

Extend `installation-native-host.mjs` to compile the small production helper and extend `installation-native-host.kt` to call it. Use temporary synthetic files only. Reproduce the old false rejection with a symlink in an ancestor of the fixture application root, then assert the new resolver accepts that alias and produces the same slot as the canonical root. Cover both missing and existing native directories, valid native/adopted bindings, and a second fixture root representing another Android user. Retain invalid record, missing established file, and database-file symlink checks; add files-directory and database-directory redirections both within and outside the root.

The fixture must demonstrate that the old production condition rejects the accepted alias and that the new production helper resolves it. Do not treat a copy of the proposed algorithm or source-text assertions as execution evidence.

### Verify a rebuilt native application

Run the documented mobile check, bundle, native-resource, and Android build commands, plus the Kotlin host runner with installed public compiler/JSON dependencies. Exercise actual normal startup on an Android app-process namespace, not only shell path resolution or development-fresh mode. Use controlled synthetic data for first-open, initialized relaunch, legacy adoption, and pending-write preservation.

The phone's installed signing certificate differs from the configured local release certificate. After that mismatch was disclosed, the user explicitly authorized uninstalling the old application and installing the repaired local package. Verify the new package before uninstalling. Record this as fresh-install startup evidence only; it cannot establish preservation or recovery of the former on-device database. The production fix still must not erase data automatically. Never log preferences, tokens, or document contents.

## Risks / Trade-offs

- The exact canonical path pair inside the failing app has not been observed -> retain the confirmed exception as baseline and verify the rebuilt application in its own process namespace.
- Normalizing too much could accept a redirected child -> normalize only the trusted root and verify exact designated child slots with negative fixtures.
- The existing standalone Kotlin runner needs installed compiler and public `org.json` artifacts -> report missing prerequisites explicitly rather than replacing native tests with text matching.
- Fixing the first guard might expose a separate invalid binding -> preserve fail-closed identity checks and diagnose any subsequent failure separately.
- The authorized reinstall removes local data and pending unsynchronized content -> disclose the effect, record the authorization, wait for a verified APK before uninstalling, and do not claim upgrade-preservation evidence from a clean installation.

## Migration Plan

1. Review this proposal and authorize implementation on `fix/android-storage-path-alias`; keep only the main worktree.
2. Implement the small resolver and both call sites, run regression/native checks, and record actual results and limitations in this change's `validation.md`.
3. Ask for the Mobile version decision before implementation handoff, commit, or push. No version change is assumed by this planning artifact.
4. Build and verify the native Android binary, then perform the explicitly authorized uninstall and fresh installation on the affected phone. No JavaScript-only over-the-air delivery or data-preserving upgrade is claimed.
5. Record human hands-on acceptance before any pull request. Run the three local review passes, target `dev`, and archive through a separate docs pull request only after the task pull request merges.

The production fix requires no data migration. Reverting its source leaves on-disk data and metadata untouched; it also restores the original path bug. The user-authorized test reinstall is a separate destructive operator action, not application recovery behavior or a release rollback strategy.
