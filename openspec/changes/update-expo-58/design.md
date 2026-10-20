# Design

## Context

See `proposal.md` for scope. All work belongs to this task's independent worktree, based exactly on `feat/mobile-perf@960ccb5`. Current tracking is OpenSpec `update-expo-58` on `feat/update-expo-58`, renamed from the originally approved `mobile-sdk58-native-experiences` task. The main checkout and other task branches are not implementation locations or merge prerequisites.

Observed baseline:

| Area | Current implementation | Upgrade implication |
| --- | --- | --- |
| Runtime | Expo `57.0.27`, RN `0.86.3`, React/React DOM `19.2.3`, React types `^19.2.0` | Resolve SDK-58-compatible versions together, preserving other workspace applications |
| Native defaults | `plugins/with-native-compatibility.cjs` pins min/compile/target Android SDK 26/36/36 and iOS 16.4 | Raise compile SDK to 37; preserve target 36 and platform floors unless a verified dependency constraint requires a reviewed change |
| Signing | Plugin and `tooling/native-build.mjs` recognize only `signingConfig = signingConfigs.debug` | Both Groovy assignment forms must be rejected for Release; preserve unrelated Release configuration |
| Firebase | `with-firebase-bootstrap.cjs` only delegates to RNFirebase plugins | Verify/inject supported startup initialization on the scene template; retain main-only Firebase and configured/unconfigured behavior |
| Navigation | React Navigation native stack and `navigationRef`; no general system-entry router | Add a narrow owned routing adapter that waits for local session, admitted data, and navigation readiness |
| Save | `MobileApi.addBookmarkUrl` uses `/v1/bookmark/add_url`; standalone Share has its own native client | Intents use the existing authenticated API port; no competing transport or token store |
| Tests | Node test discovery, TypeScript/esbuild/VM hosts, React DOM mounting; installed Animated internals in `tests/reader/installed-animated-host.mjs` | Port the harness to the installed RN layout and preserve real implementation assertions |
| Identity | `com.slax.reader`, `app.slax.reader`, `app.slax.reader.share`, App Group `group.app.slax.reader` | Preserve all identities and Share behavior across generation |
| Metadata/toolchain | `1.0.25`, build 772, previous 771; selected Xcode 26.6 | No version decision yet; iOS 27/27.1 acceptance needs a suitable installed toolchain/runtime |

The old counts (55 type errors / 185 test failures) describe an earlier upgrade investigation and are not current measurements. The active migration's SDK-57 pin is a known historical spec conflict, explicitly superseded for this task by proposal approval. Do not edit another change's delta. If mobile runtime requirements become canonical before merge, read that version and add the precise runtime delta here, preserving its other obligations.

At delivery, the human approved marketing version `1.0.25`, build `774`, and previous build bound `773`. The previous bound comes from the latest `origin/dev` source metadata; it is not evidence of a published store build. Apply the values through the canonical manifest and existing native generators, preserving historical build evidence and all incomplete acceptance tasks.

## Goals / Non-Goals

**Goals:** isolate upgrade regressions before feature adoption; retain recoverable offline data and account ownership; keep entry points behind typed controllers; use system surfaces without starting a second application runtime or database owner.

**Non-Goals:** audio/TTS, new backend endpoints, navigation migration, replacing the PDF engine, enabling experimental module/SPM pipelines, remote activity pushes, or changing ordinary Reader defaults. Widget/Live Activity and Duo work remain prototypes with explicit native acceptance.

## Decisions

### 1. Use sequential native gates in one task branch

The board's lanes describe independent work, not permission to merge other branches or create more task branches. Use the existing feature branch for this entire task, with checkpoints for (A) dependency/plugin fixes, (B) generated projects and both native builds, (C) strict types/tests/regression acceptance, then (D) system features. No optional feature dependency enters A or B. Independent verification may overlap only after B passes; do not run destructive generation against active builds.

Resolve installed versions using Expo's SDK-58 compatibility metadata and dependency checks; align React DOM exactly with React and choose matching React types. Preserve CocoaPods, existing DSL native modules, and current React Navigation. Prefer strict RN instance/ref types over introducing the temporary legacy condition. A legacy fallback requires a later explicit decision and a bounded removal task, not a hidden opt-out.

Alternative considered: install the feature packages with the runtime upgrade. Rejected because a failure would not identify whether the template, native dependency, or feature caused it.

### 2. Make owned generators the native source of truth

Update `with-native-compatibility.cjs`, `with-firebase-bootstrap.cjs`, share/native-back plugins where the template requires it, and build guards. Test SDK-57 and SDK-58 Gradle snippets, both signing spellings, multiple build types, repeated generation, and unexpected templates. A marker alone must not bypass detection of debug signing. Unsupported insertion structure must stop generation rather than silently produce a broken project.

Configured iOS main apps receive exactly one supported Firebase bootstrap before consumers initialize; an existing upstream bootstrap is reused. Fixtures and unconfigured builds remain unconfigured. Share has no Firebase resources, linkage, bootstrap, or telemetry. Android retains supported Firebase plugin/provider initialization. Scene URL callbacks must reach Google login and normal linking once, through app-owned adapters using supported Expo lifecycle hooks.

Perform clean generation in this worktree, then verify regeneration idempotence, `SlaxShare` target embedding and App Group/source membership, manifests, callback schemes, Firebase boundaries, and native resource packaging. Exercise Android Debug and unsigned minified Release with R8 enabled, and iOS Debug and unsigned simulator Release. Add narrow keep rules only for demonstrated reflective failures. Keep signing checks active; unsigned artifacts are validation outputs. Do not patch installed dependencies or manually repair generated projects as the implementation.

### 3. Mount one system-action controller at the runtime boundary

After the upgrade gate, install the approved `expo-app-intents` version and declare one plain Swift save-URL intent and its shortcut phrases in the app target. It opens the app and dispatches an invocation; Swift acknowledges handoff, never reports a completed save before JavaScript/API completion. Background JS execution is not assumed.

Mount one handler near `MobileProvider`, behind typed queue, session, save, and routing ports. Validate absolute HTTP(S) URLs without credentials/control characters. The package delivers at least once, so serialize processing and persist invocation receipts before acknowledgement; recover completion after interrupted acknowledgement. Drain only under a stable authenticated account/origin/runtime generation with valid credentials. If invocation metadata cannot prove its original owner, require an explicit in-app claim instead of binding it to whichever account happens to start next. Sign-out/account/origin replacement cancels dispatch and invalidates unclaimed work. Offline/retryable failures remain pending; permanent failures are surfaced with discard/retry actions, not retried forever. Do not claim server-side exactly-once semantics: use existing add-URL identity behavior and a local journal; verify retry behavior across a crash after API success.

Use a single system-entry adapter for intent/Spotlight/widget navigation. Wait for navigation and admitted account data; recheck bookmark visibility and current owner on open. Stale identifiers show ordinary unavailable content UI. Existing native Share remains independent and keeps its current authentication behavior.

Alternative considered: a new direct Swift authenticated save service or headless JS task. Rejected for MVP because it duplicates credential ownership and assumes unavailable background completion semantics.

### 4. Publish a compact, opt-in system catalog

Spotlight indexing and donations default off until enabled in app settings. First MVP indexes at most 100 recent, unarchived, non-deleted bookmarks belonging to the active account. Export only opaque stable identifiers, display title, and source host; omit article body, comments, highlights, full sensitive URLs, and content without explicit system-surface eligibility. The baseline has no private-article flag, so do not invent one or infer privacy from text; the user's explicit opt-in governs eligible metadata, and future privacy classifications must exclude items by default.

Deletion, opt-out, sign-out and owner replacement revoke catalog and donations before a new owner publishes. Publish from admitted local snapshots with generation fencing and bounded/coalesced work. Donate only successfully completed user actions; replayed invocations do not create repeated donations. OS deletion failures remain visible/retryable; explain that published metadata is managed by the OS and is not a fresh authorization source.

The OS donation API does not accept a caller-generated idempotency key. Persist an account-scoped admission marker before dispatch; a recovered admitted attempt or legacy receipt with an unknown dispatch outcome must not call the OS again. This can lose an optional donation if interruption occurs between admission and native dispatch. A documented native rejection can clear admission for retry, while a later journal failure retains it. Record confirmed success only after the native result is journaled, and fence work to the captured account/runtime generation. This is conservative at-most-once admission, not a claim of exactly-once OS completion.

### 5. Widgets consume snapshots; activities model a finite reading session

Install approved `expo-widgets` and `@expo/ui` only after the base gate. Use one account-scoped, versioned, atomic snapshot publisher. Extensions consume compact display data and route identifiers, never bearer tokens or direct access to the primary database. Widget code does not mount React providers, refresh credentials or connect PowerSync. Revoke snapshots on sign-out/owner replacement and ignore late publications.

Prototype defaults: unread count means active account bookmarks with `isRead = 0` and `archiveStatus = 0`, excluding deleted records. “Today” is a suggested reading queue of the three most recently saved eligible unread items, not a new calendar/due-date feature. Reflect changes after admitted local updates and foreground refresh, requesting platform reloads without promising exact background refresh timing. Show signed-out/empty states and an update timestamp for retained data. Titles require system-surface opt-in; otherwise show only an explicitly enabled count or a neutral prompt. Taps pass through the common entry adapter. Build iOS small/medium and Android home widgets; physical launcher behavior is separate acceptance.

Live Activity is a user-started reading session with read/goal counts, local updates, explicit stop, stale state and expiry. End it on sign-out, owner change, completion or cancellation. It does not run indefinitely as an unread badge and does not request push entitlements or frequent-update permissions. Gate unavailable OS/device support. New target identity/provisioning remains explicit; Share is preserved and does not gain widget or Firebase responsibilities.

### 6. Adapt PDF.js geometry without duplicating document ownership

On 2026-10-20, the human approved implementing the opt-in prototype inside the existing PDF.js renderer while retaining its single WebView and document owner. Use measured scene/window width, safe areas and native layout to decide whether two pages fit; a fixed angle threshold must not drive layout. `expo-hinge` may supply pose effects but does not choose the page layout. `@expo/ui` remains approved for Widgets and Live Activity and is not required for PDF presentation. Below the required OS or usable width, render the established single-page Reader explicitly.

Keep one Reader document/session, one WebView, and one PDF resource/security owner. Present adjacent pages within the existing PDF.js canvas/layout virtualization path, retaining bounded acquisition and rendering rather than adding a second WebView or native PDF renderer. The first visible page identifies reading progress; converting between single/spread layouts restores that document page and its normalized position. Annotation/selection coordinates remain per PDF page, transformed through each pane's measured bounds. Preserve the approved behavior contract: one owner, bounded work, offline cached bytes, progress, marks, accessibility order, reduced motion, opt-in and explicit earlier-OS/narrow-window fallback. Test odd final pages, fast resize/fold transitions, interrupted selection and restored progress. Keep ordinary Android/iPhone reading unchanged when the prototype is disabled.

Apply native safe areas on every edge throughout the Inbox, drawer, Reader and anchored menus. The Duo Open scene can report zero top inset and a nonzero right inset for its system region; reserve that measured lateral space rather than inventing a top status-bar padding. Reader content is inset once at its native container, so PDF fit/spread policy uses that container's already-safe measured width. Menus measure their own modal safe area and frame, and menu/drawer content scrolls when the current scene is too short. Bounds update in place across posture changes without recreating the document owner.

Alternative considered: replace the PDF engine or add a second full Reader. Rejected because either changes annotation, caching and scroll ownership beyond the requested prototype.

## Risks / Trade-offs

- SDK-58 native template/RNFirebase mismatch → exact insertion/idempotence checks plus configured and unconfigured native validation.
- R8 removes reflective native paths → minified Release smoke and narrowly justified keep rules, without disabling R8 globally.
- App Intents alpha API/queue limits and crash windows → pin the package, bound work, test duplicate/overflow/recovery behavior, and show queued versus completed states honestly.
- OS system surfaces retain sensitive metadata → opt-in minimal catalogs, account fencing, deletion retries, and no credentials in extension snapshots.
- New surfaces revive hidden Library work → publish from dedicated bounded snapshots rather than keeping the Library screen's full watchers active; rerun baseline performance regressions.
- Xcode 26.6 cannot establish iOS-27.1/Duo acceptance → require an appropriate available Xcode/runtime before claiming the relevant native checks; retain independent Android/static work if unavailable.
- Prototype targets alter signing/package output → regenerate targets from plugins, preserve Share, and request version metadata separately after validation.

## Migration Plan

1. Review this proposal, including the four optional package groups. No application code has been changed during planning.
2. Capture current SDK-57 check/bundle results and task-owned build output locations, then upgrade only dependencies and owned generators.
3. Generate and build both platforms; stop additional feature work on a red native build. Record toolchain, runtime, configuration, and passed/blocked checks without copying credentials.
4. Clear strict types/harness failures and exercise login, Share, IAP, HTML/PDF, cold/offline relaunch, synchronization and images. Sandbox purchases and provider callbacks need actual supported native targets; mocks do not certify them.
5. Implement the save spike, then MVP, widgets/activity, and adaptive prototype in that order, validating native targets after each dependency/target addition.
6. Run integrated checks and the three `REVIEW.md` passes. Obtain the human's Mobile version/build decision, regenerate metadata if approved, and recheck affected output. Reconcile canonical runtime specs if present, validate OpenSpec, and prepare one PR targeting `dev` after accounting for the temporary base's inherited diff.
7. Keep task work recoverable. Roll back an unshipped failing stage by reverting its owned dependency/plugin/source commits and regenerating; do not remove offline data or overwrite operator inputs. Archive only after merge. Publication and remote deployment require their own authorization.

## Source References

Checked 2026-10-19. Release-specific details must be rechecked when selecting exact package versions.

- [Expo SDK 58 release notes](https://expo.dev/changelog/sdk-58): runtime/template migration, scene callbacks, strict types and R8.
- [Expo App Intents](https://docs.expo.dev/versions/v58.0.0/sdk/app-intents/): alpha status, compiled declarations, one-way handoff, pending invocations, catalog and donation APIs.
- [Expo Widgets](https://docs.expo.dev/versions/v58.0.0/sdk/widgets/): isolated layouts, generated targets, timelines and local Live Activities.
- [Expo Hinge](https://docs.expo.dev/versions/v58.0.0/sdk/hinge/): platform-gated hinge observations.
