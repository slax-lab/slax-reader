# Expo mobile migration baseline

OpenSpec: `expo-mobile-migration`

This baseline preserves the current Android/iOS `slax-reader-client` source without modifying its checkout. The source commit is `9951904405159f49f24effd4d42815f77ff33442`, plus the working-tree overlay captured in `source-manifest.json`. The included scope contains 356 source/resource/license files, of which 35 were modified or untracked when captured. RSS UI, API/state code, localization, and vectors are included. Checking out the commit alone does not reproduce this baseline.

The manifest uses a closed path/extension whitelist of Kotlin application and test source, the audited native Swift/share source, mobile artwork, scoped reader HTML/CSS/JavaScript, and the source license. It excludes secrets, credentials, signing material, Google service configuration, Gradle/Xcode/operator/deployment configuration, logs, local databases, build output, and unrelated documentation screenshots. Excluded files were neither read nor hashed by the baseline capture. Runtime identity/configuration migration is a separate reviewed task; this manifest does not claim to archive that excluded configuration.

Each manifest entry has its current SHA-256, byte count, and scoped Git status. Two spaces mean unchanged tracked content, ` M` means a working-tree modification, and `??` means an untracked included source. Status is scoped to the whitelist. Hashes were rechecked after capture to establish that the baseline operation did not change source files. A later mismatch indicates source drift and requires a deliberate baseline review; it must not be silently overwritten.

## Visual inputs

The original mobile app has no central token file and ships no font binaries. `apps/mobile/src/theme/index.ts` extracts repeated source roles and measurements while preserving the Mobile profile separately from Web/Extension. Typography intentionally does not name a new UI font. Source values are implementation inputs, not rendered parity evidence.

The shell and HTML document use the source light treatment, including under a dark system appearance. Source native operating-system surfaces have their own behavior; the iOS share panel uses native system background/label colors. Safe-area and keyboard insets remain runtime measurements. Android uses an outer reader scroll container; iOS uses a WKWebView scroll view with a translated header. Stored positions and selection coordinates need platform adapters rather than a common raw offset.

`apps/mobile/assets/provenance.json` records 89 copied or converted assets: 85 unchanged PNG sources and four required source XML vectors converted to 96×96 PNG. `mobileAssets` exposes 88 assets as static `ImageSourcePropType`s. The copied old back arrow is provenance-only and is excluded from that registry. Source brand paint and the Apache-2.0 license copy are retained. Display measurements come from source components rather than raster dimensions; login art, for example, retains the source `375 / 314` layout ratio.

Four vector conversions preserve the original path geometry and use the existing bundled sharp/librsvg renderer, with versions and output hashes recorded. The original XMLs and generated SVGs remain available for inspection and regeneration. No optional runtime renderer was adopted for this work.

## Localization and usable APIs

`apps/mobile/src/i18n/messages.ts` exports all **217 active keys** in both English and Chinese. The source has three additional commented example entries; those are not runtime keys. Literal text, newlines, punctuation, and placeholders are preserved. Native/source hardcoded strings outside this map are not invented translations and remain part of their source flow's coverage.

Four separately approved migration-protection keys live in `appMessages.ts`. They explain startup/data-opening failures and the upgrade compatibility gate. They are labelled as new app UI, do not overwrite source keys, and are checked separately from the pinned 217-key source catalogue.

```ts
// Import paths shown from an application-root module; adjust for the consumer.
import { mobileTheme, mobileTypography } from './src/theme';
import { createTranslator, normalizeLocale, translate } from './src/i18n';
import { mobileAssets } from './assets';

const locale = normalizeLocale('zh-Hans');
const t = createTranslator(locale);
t('login_welcome_title');
translate('en', 'collection_closed_message', ['Example']);
translate('zh', 'feedback_allow_follow_up', { email: 'example@example.test' });
```

`translate` retains the source English fallback and unknown-key behavior. No/empty arguments leave the template unchanged; supplied positional or named arguments remove unresolved placeholders as the source formatter does. Persistence and reactive locale ownership belong to the application domain, so this module does not create a competing global preference store. The Mobile theme exports `mobileColors`, `mobileTypography`, `mobileLayout`, `mobileMotion`, and the combined `mobileTheme`.

## Coverage and evidence

`coverage.json` contains 338 state/interaction cases across all nine routes and active collection/RSS flows, plus account/upgrade/platform transitions. Each case has source locations, required platforms/locales, fixture identity, and separate implementation/source-render/target-render/function/visual statuses. Overall acceptance remains `unverified`. Partial Android source/target Library captures and source Reader captures are recorded in the [native capture evidence](evidence/2026-10-10-source-android/README.md); the inspected Library comparison still has unresolved presentation differences. A capture of one configuration does not verify all required platform, language, appearance, and font-scale combinations. Empty or preparation-only evidence cannot establish completion.

Twenty-nine synthetic data scenarios and eight documents are prepared in `apps/mobile/fixtures/`, including local login agreements and synthetic provider outcomes. The Expo fixture runtime invokes production routes/screens with a scoped real PowerSync database, memory preferences, controlled API/sync/network, and prepared local artwork. Mounted screen callbacks and the real reader document bridge support reproducible state preparation; preparation alone is explicitly recorded as unverified native interaction. A separate native Expo fixture project has passed both-platform prebuild identity/configuration checks and its Android development build has rendered the Library on the controlled emulator. The source Android capture overlay and sanitized build template preserve the 356-file source whitelist; both its application and dedicated instrumentation APK have built and executed. The source Reader adapter uses the actual DetailScreen/AppWebView and prepared cache/API/SSE inputs. Source iOS rendering, remaining native event drivers, and the complete state matrix remain pending. Per-case overall acceptance remains unverified, and OpenSpec task 1.4 remains incomplete. See `apps/mobile/fixtures/README.md` and `docs/mobile/fixture-acceptance.md`; neither existing user databases nor the source checkout were modified.

Acceptance requires actual old/new native renders on matched device model, OS version, viewport/safe areas, deterministic data, language, system appearance, and font scale. It also requires motion, keyboard, selection, scrolling, ownership, offline, and lifecycle checks. Review text wrapping, colors, dimensions, optical asset placement, touch targets, and native back arbitration. Compare Android and iOS separately. The only pre-agreed appearance difference is the genuine native back control and its necessary native treatment; record its exact region and continue checking adjacent content. Dynamic system content exclusions must also be narrow. Entire headers, missing screens, or unavailable platform renders cannot be masked or counted complete.

The existing Android instrumentation tests provide semantics/interaction evidence and stable identifiers, but no screenshot-golden framework or native screenshot baseline was found. `apps/mobile/src/theme/testIds.ts` preserves those identifiers for migrated controls. Browser previews and successful JavaScript bundling do not satisfy the native render/build requirements.

At the initial read-only tooling inventory, Android SDK emulator/adb binaries existed and `codex-api34` was listed, with no connected device. `xcrun`/`xcodebuild` existed, but CoreSimulatorService failed device/runtime discovery. This is historical inventory evidence. The approved CLI path has since created and booted a controlled Android API 34 emulator and a controlled iOS 26.5 simulator. Android source/target UI launches and partial captures have executed. The main iOS development application has launched for synthetic legacy-data adoption and fault recovery; this does not establish normal UI launch or visual parity. Source iOS UI launch and the matched iOS matrix remain pending.

## Focused checks

The asset baseline verifier checks copied/converted hashes, static registry references, locale exports and formatter behavior, coverage/source-reference consistency, and source hashes when an explicit source checkout is supplied. These checks validate capture integrity; they do not change any coverage case to native-verified. Native appearance and interaction acceptance remain separate.

Run `node apps/mobile/assets/verify-baseline.mjs` from the repository root. Add `--source /path/to/slax-reader-client` to verify the captured source bytes against an explicit checkout. This optional source read is guarded by an independent closed whitelist before files are opened.

The initial implementation passed the source-inclusive verifier (356 files, 88 runtime assets, 217 keys, 27 stable identifiers, 338 coverage cases), strict TypeScript checking of the asset/theme/localization modules, and `openspec validate --all --strict` (28 items). Repeating vector generation produced byte-identical SVGs, PNGs, and conversion metadata across all nine outputs. These results establish deterministic capture and usable modules. The [main development build report](evidence/2026-10-10-builds/README.md) records later whole-application build and JavaScript checks separately from the partial native capture evidence; complete native acceptance remains pending.

Source UI calibration also restores the Debug cache categories and focused 2.7g/one-second shake entry, and the library avatar/drawer sync-state priority, badges, and beta marker. Circular arcs use application-owned Android Canvas and iOS CAShapeLayer views with the pinned source cache-ring geometry and Material3 progress timing. Both main development native builds include these views. Matched images and motion recordings must still verify raster edges, clipping and animation. Compilation alone does not advance native presentation or interaction evidence statuses.
