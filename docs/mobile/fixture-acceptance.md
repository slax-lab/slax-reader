# Native fixture capture and acceptance

OpenSpec: `expo-mobile-migration`

The prepared bundle at `apps/mobile/fixtures/scenarios.json` provides 29 synthetic scenarios and eight pinned HTML documents, including local login agreements and synthetic success/cancel/error provider outcomes. Input generation/integrity, API route specificity/error overrides/offline/abort/origin checks, and fixture scope/memory preference/action isolation checks have passed. The Expo runtime adapter invokes production routes/screens against an isolated real PowerSync database, synthetic in-memory preferences, controlled sync/network, strict API transport, and prewritten local artwork. It has a development-only action port and controlled host URLs with explicit unsupported-action errors. The separate Expo native fixture project has been prebuilt on both platforms and verified for unique identities, disabled automatic Firebase collection, and absent production share/App Group access. None of these host/configuration checks verifies native rendering.

The source Android instrumentation overlay invokes the existing Compose library/settings/feedback/about/login screens through real DAOs/view models and controlled source API contracts. Its Reader adapter invokes the actual source DetailScreen and AppWebView with pinned HTML, source image-cache paths, marks/comments/cached AI, and an application-owned Ktor core engine for prepared API/SSE responses. The source preparer copied 356 checksum-verified whitelist source/resource/license files without production build configuration. Its sanitized Gradle 8.13/Java 17 application and instrumentation build passed on October 10, 2026. Subsequent bounded cached instrumentation builds also passed; exact immutable driver revisions and hashes are archived under `docs/mobile/evidence/2026-10-10-source-android/`. The [canonical error-envelope revision](evidence/2026-10-11-fixture-canonical503/report.json) changes only the uncached Reader503 response data to the original nullable-text contract. Its active fixture digest is `aaf4fdd7fd8b205ed6f2e297686f20bb3f523b680d35fc62effcdc8a2a4afe2f`; historical native captures retain `5b8ee1cbf4a48e13c64a83dda9161bbae308e451e47ac96fecbb1d9bf49e23b4`. The changed error case requires fresh source and target execution.

The controlled API 34 emulator rendered both the original and migrated populated Library under matched Android English/light conditions: 1080×2400, pixel ratio 2.625, displayed 9:41, and measured top/bottom insets of 136/63 physical pixels. Later default/enlarged-font comparisons retain 37/38 corner-edge color differences; independent inspection found matching glyphs, fills and geometry, and the human explicitly accepted only these two anti-aliasing differences on 2026-10-11. This acceptance does not extend to other pages or configurations. Historical failed comparisons remain unchanged, and Library's full profile matrix is unverified. Original Reader document readiness and callback-driven scripted preparation also executed: its rich body, explicit cross-paragraph selection, comment thread, cached overview and isolated outline were visible. Scripted selection is not native gesture evidence. Direct Reader fixtures warm the same real user/subscription DAO flows that the preceding Library normally collects; isolated action captures avoid retained sheets and Pro gates. A gallery candidate still contained a progress indicator and cannot establish settled artwork output. RSS native artwork loading, player events and the remaining native profile/state matrix are pending. OpenSpec task 1.4 remains incomplete.

Use one scenario JSON and its pinned manifest for both implementations. A source adapter must run from an isolated copied checkout or a dedicated test target, consuming the existing injectable view models/API/WebView hosts. An Expo adapter must use an isolated data directory, generated fixture database, synthetic preference store, controlled network/sync status, image/document interception, player events, and fake purchase/login providers. The source checkout is read-only. The normal migrated app must retain its compatibility gate and must not gain a production fixture-seeding shortcut.

The concrete preparation/launch instructions and supported action boundary live in `apps/mobile/fixtures/README.md` and `apps/mobile/fixtures/source-android/README.md`. Use the current pinned bundle for both copied builds; reject an older fixture digest. The Expo adapter records accepted programmatic actions with `nativeInteractionVerified: false`. Such actions can prepare a repeatable frame but cannot satisfy native touch, selection, keyboard, lifecycle, motion, or navigation acceptance. The live YouTube iframe is blocked until a deterministic local player provider exists. Source Reader artwork staging and final visible image output still require their own inspected captures; RSS artwork still lacks a prepared native loader. A blocked or missing image is not a passing success-image comparison.

Match device model, OS/runtime version, viewport, pixel ratio, safe areas, locale, system appearance, font scale, clock, fixture hash, and each transition before comparing. Start with English/Chinese and light/dark system appearance on both platforms; include default and enlarged accessibility font sizes. Verify actual font family/weight/fallback and line wrapping from native output rather than assigning a new font to make a preview match.

The primary capture groups are the library's empty/loading/populated and four download states; sort/swipe/context-menu/edit/add/continue-reading states; drawer/profile/sync states; active/closed/expired collections and owner restrictions; RSS Labs/source/list/history/error/saved/truncated states; reader skeleton/rich/long/offline/error states; annotations/comments/tags/overview/outline/gallery/video/transcript; and settings/feedback/deletion states. The mixed article includes own/other overlapping marks, approximate quotes, image marks, and retained deleted ancestors. The video fixture requires locally supplied player events rather than live YouTube. The pending-upgrade payload requires a database made by the corresponding SDK adapter; its JSON CRUD records are not a fabricated compatibility-ready SQLite file.

The [October 11 route-family batch](evidence/2026-10-11-android-route-batches/report.json) preserves 29 actual target initial candidates and 24 original initial candidates from the first run. A later original run also rendered the RSS truncated/save-error readers and deletion notice; the uncached error reader still failed before producing its native document, with readonly rejection diagnostics preserved. The target isolated-action batch produced 40 candidate frames from 51 declared actions; nine actions require separate native/player/stream drivers, and two historical deletion preparations failed before the notice-origin correction. The same pinned notice subsequently passed actual native swipes, confirmation, denied response and error dismissal. Actual native Settings cache/image/language changes were checked against committed preferences, and Feedback keyboard entry, system Back, failure submission and dismissal were recorded. These scoped actions do not certify matching source visual states or the full matrix. Settings/Feedback body placement improved after the source toolbar/bottom-inset correction; inspected default title glyphs now match their source size, with remaining position/rounding differences. Reader/title/summary wrapping and blocked video-provider surfaces still differ. The later [aw3 Android Reader observation](evidence/2026-10-11-reader-full-window-android-aw3/report.json) preserves a native callback reporting `240.0000057220459` physical pixels for the prepared `240` request, with a full `914.2857055664062` point viewport and container top `0`. The [complete staged-input verification](evidence/2026-10-11-reader-full-window-android-aw3/full-stage-hash-verification.json) and [independent callback review](evidence/2026-10-11-reader-full-window-android-aw3/root-native-callback-review-r1.json) bind the actual command response, native trace, screenshot, 371 staged input hashes, compiled native inputs and APK. This scoped restoration check does not certify source visual parity or the native navigation matrix; earlier clipped and prematurely consumed frames remain historical failures. Each initial frame and command-prepared frame remains a candidate until its actual state and matched conditions are inspected.

The [native Android back regression](evidence/2026-10-11-android-route-batches/native-back-runtime-aj.json) records actual API 34/targetSdk 36 input and 13 guarded states. The earlier binary exited from Settings despite an intact stack and `canGoBack=true`. The application-owned Android 13–15 compatibility callback now preserves language-dialog dismissal, Settings/About/Reader stack pops and root fallback to the controlled launcher. The historical development-client link resumes into a newly prepared runtime; it proves reentry only. A separate [actual MAIN-launcher resume](evidence/2026-10-11-android-route-batches/native-launcher-resume-ak.json) preserves the exact fixture scope and complete observed navigation stack after root Back. MP4, exact selectors/bounds, before/after stacks, APK/input hashes and failed earlier frames are retained. These scoped passes do not certify other Android versions, predictive gestures, iOS back gestures, Reader detach/flush completion or visual parity.

Capture source and target native images plus motion/interaction evidence for each required case. Place evidence in a new run directory under `docs/mobile/evidence/<run-id>/<platform>/<locale>/`, with a machine-readable context record containing the matched settings and fixture digest. Record implementation locations, fixture/action driver version, source render, target render, functional result, comparison result, and evidence paths independently in `coverage.json`. Do not advance a case because an unrelated fixture, browser DOM test, type check, or bundle succeeds.

Check dimensions, spacing, colors, text wrapping, optical artwork placement, touch targets, keyboard insets, scroll/outline position, selection coordinates, ownership/offline/error behavior, and lifecycle flush/cancellation. Pixel differences require inspection and a documented explanation. Do not declare a numeric comparison threshold before obtaining real native baselines. System-generated dynamic content may be narrowly masked with its exact region and reason. The approved native-back exception also needs an exact region; adjacent titles/content remain subject to comparison. Entire headers, missing states, or unavailable platform runs cannot be excluded.

Exercise native header back, Android hardware/system/predictive back, committed and cancelled iOS interactive pop, and back while selection/gallery/sheet/drawer/dialog or unsaved comment state is active. Verify that transient state closes first and progress flushes before a committed exit, with no route loss on a cancelled pop. Native share and purchase/login dialogs need their own platform/provider fixtures and recordings; the prepared data bundle cannot substitute for these surfaces.

The CLI device path created a fresh controlled iOS simulator and Android emulator `emulator-5560`. Genuine Android and iOS same-identity legacy-to-Expo data adoption passed in separate synthetic sandboxes, recorded in `apps/mobile/tests/data/adoption-fixtures/reports/`. Those data runs do not establish UI parity. The isolated Expo UI application compiled and genuinely launched on both platforms with unique fixture identities, initialized its own real PowerSync/SQLite database, and displayed Library and native Reader body content. The scoped launch report and preserved artifact hashes are in `docs/mobile/evidence/2026-10-10-source-android/target-native-foundation/report.json`. The first iOS Reader body was blank and rejected; the subsequent controlled in-memory document origin fix rendered the body. Later actual runs verified the readonly WebKit bridge initialization and corrected native reading-position restoration. The [q observation](evidence/2026-10-10-source-android/target-native-foundation/reader-bridge-observation-q.json) records requested and observed `240` physical pixels, a ready bridge, one completed document load, and zero rejected messages. Its native scroll trace, raw metadata, driver revision, and screenshot are preserved separately from the earlier failed runs. These scoped checks do not establish complete Reader interaction or iOS visual parity. Host memory/disk pressure requires serialized bounded native builds. A successful build remains separate from an inspected native state, and incomplete profiles/interactions cannot advance full acceptance.

Original source iOS Library and Reader now have clean, inspected native initial frames in the [source launch record](evidence/2026-10-10-source-ios/source-native-launch.json). The [framework provenance supplement](evidence/2026-10-10-source-ios/j-framework-provenance/source-j-framework-provenance.json) binds the actual `j` Kotlin/Native `linkDebugFrameworkIosSimulatorArm64` build, its 74-second successful log, original Compose screen symbols and UIKit/Compose call path. Its raw framework and signed package have all 33 file-backed Mach-O sections in common; the signed framework hash exactly matches the historical `l` package used for those captures. The [independent recheck](evidence/2026-10-10-source-ios/j-framework-provenance/root-framework-provenance-review-r1.json) verifies these bytes and the current 356 pinned original plus 55 overlay inputs. The historical `l` comparison of 279 compiled input files remains its original record; the removed stage has not been reconstructed or equated with the current copied-file count. Swift supplies the launcher and readonly WK geometry observation, while the linked original Kotlin Compose Library and Reader supply the UI. Only those two English/light initial states and the recorded native system-alert Cancel input are inspected. Original Reader measured position zero despite the requested saved 240 pixels; the restored target frame therefore is not a matched visual comparison. Full profile, interaction and visual matrix acceptance remains pending.

The Android collection labels, row titles, footer and continue-reading title use a narrow application-owned native single-line text view. The source Compose renderer retains fractional pixel `TextPaint` sizes, while the installed React Native renderer rounds those sizes up; that difference changes middle ellipsis and glyph width in the matched Library frame. The view uses native text shaping, locale, accessibility text/role and measured natural line height. Its font-scale conversion matches the pinned Compose 1.11.2 nonlinear curves, including the pre-Android-14 path; the [compiled converter check](evidence/2026-10-10-source-android/native-text-scaling/report.json) preserves 196 passing comparisons against the actual installed source converter and the passed native build inputs. The JavaScript wrapper requests this view only on Android, while iOS retains its existing text renderer.

Actual default-font English/light Android comparisons progressively resolved label, row and footer raster differences. The [scoped revision `u` report](evidence/2026-10-10-source-android/scoped-native-library-raster-u/report.json) records identical original RGBA pixels for all listed text regions and the entire collection band, including avatars, selection rings and new-item dots. It preserves full original screenshots, raw native measurements and driver hashes; no alignment, resampling or color adjustment was applied. Android avatar sizes and Canvas border/background drawing now follow the source's individual physical-pixel rounding and native RoundRect clipping. The [enlarged-font revision `w` report](evidence/2026-10-10-source-android/scoped-native-library-fontscale-1_5-w/report.json) records the same exact collection band, all six row titles, footer and continue-reading title at measured fontScale 1.5. The source clips enlarged collection labels inside its padded LazyRow viewport; the target preserves the original layout while retaining the text view’s full measured natural height. Android icons retain independently pixel-rounded source sizes; intrinsic header text and its padding use the same source measurement and rounding. The final inspected [default-font `ae` comparison](evidence/2026-10-10-source-android/android/en/library-populated/comparison-ae-default.json) differs at 37 original RGBA pixels, and the [enlarged-font `ae` comparison](evidence/2026-10-10-source-android/android/en/library-populated/comparison-ae-enlarged.json) differs at 38. Both match every measured text region, header, collection band and divider. Sparse body corner and continue-banner edge raster differences remain. The subsequent Canvas clip experiment was reported to worsen the default difference to 271 pixels and was reverted to the preserved `z` native implementation. Its historical report path, `evidence/2026-10-10-source-android/android/en/library-populated/rejected-shape-experiment-af/report.json`, is absent from this checkout; this statement cannot be independently verified from that report in the published tree. The human explicitly accepted only these default/enlarged Android English/light corner-edge anti-aliasing differences on 2026-10-11 (RGB differences of 1–2 out of 255). Historical failed reports remain unchanged. This scoped acceptance does not establish the full Library profile matrix; other language/appearance captures and native gestures remain pending.

## Evidence records and status validation

Archived inputs retain their original bytes and relative-link base. In particular, `evidence/2026-10-11-reader-native-source-bridge/cross-paragraph-native-preparation-r1/inputs/reader-native-ios-README.md` was copied from `apps/mobile/fixtures/reader-native-ios/README.md`; resolve its four relative links from that original location, not its archive directory. Their targets are included, and the archived README is not rewritten.

Two limited historical provenance gaps remain: `evidence/2026-10-11-reader-native-source-bridge/fresh-alpha-cross-executor-r1/failed-first/receipt.json` records digests that no longer match its two referenced `inputs/runtime-guards.test.py` and `inputs/run-fresh-alpha-cross.py` files. The original prepared `README.md` bytes bound by `evidence/2026-10-11-source-ios-share/preparation.json`, its `build-report.json`, and `evidence/2026-10-11-source-ios-share-success/original-swift-build-report.json` could not be recovered from the public input set; adjacent evidence READMEs are not substitutes. These receipts and hashes remain unchanged. The failed-first attempt and unrecoverable prepared-input bindings are historical nonacceptance records, not fresh proof of execution or parity; these specific gaps do not invalidate unrelated evidence with intact provenance. Raw archives, compiled artifacts, execution logs, and unreviewed motion recordings remain local-only even where reports retain their paths and digests, as described in the [publication boundary](README.md).

`node apps/mobile/assets/verify-baseline.mjs` validates native evidence through `assets/native-evidence.mjs`. Each case's `evidence` entry is a `{path, sha256}` reference to a JSON record under `docs/mobile/evidence/<run>/`. Artifact paths are repository-relative, cannot traverse or follow symlinks, and cannot refer to sensitive filenames. Source/fixture digests must match the current pinned source manifest and `scenarios.json`. Partial captures can be added while all case statuses remain `unverified`.

A `native-ui-capture` record uses `schemaVersion: 1`, the exact ledger `caseId`, `implementation: source | target`, platform/locale, source/fixture hashes, a prepared `fixtureScenario`, a nonempty `stateAssertion` describing the frame actually inspected, and `actionDriverSha256` identifying the copied/compiled action-driver inputs. `captureMethod` is `android-ui-automation`, `adb-screencap`, or `simctl-screenshot`. Its `image`, original `rawMetadata`, and immutable `actionDriverInputs` are hashed artifact references. Raw device conditions and input identity must agree with the normalized capture record. Source Android records also require a passed immutable source build report and the archived overlay manifest/files, whose hashes and compiled-driver digest are rechecked. Target driver manifests must contain the current shared fixture digest. The verifier checks PNG chunk integrity, compressed raster, and physical dimensions; host previews and browser frames are rejected.

The capture's `conditions` contain measured `deviceModel`, `osVersion`, displayed `clock`, `widthPixels`, `heightPixels`, `pixelRatio`, system `appearance`, native `fontScale`, `fontScaleProfile` (`default` or `accessibility-enlarged`), and `safeArea` top/bottom/left/right in native logical points/dp. A default font scale is 1; the enlarged profile must measure above 1. Record capture time separately from conditions. Raw fixture metadata contains a system-time sample; it does not establish the status bar's displayed clock. Confirm that clock from the native frame or the controlled device override before writing an accepted capture record. Do not infer safe areas, device scale or font scale from a mock viewport. Normalize measured logical inset values to six decimal places to reconcile native Float and Double serialization while retaining raw metadata; this does not adjust physical geometry. Required conditions are then compared exactly between source and target.

`nativeInteractionVerified: false` is mandatory for purely programmatic preparation. Setting it to true requires `interactionRecording` as a hashed native MP4/MOV artifact and `nativeInputLog` as a hashed JSON record with `kind: native-input-log`, matching `caseId`/platform and actual native input events (`native: true`, nonempty `action`). Capture `checks.implementation` and `checks.functionalVerification` may declare `passed` or `failed` after inspection; a functional decision also requires those native input artifacts. Code/bundle/API tests alone cannot provide this evidence.

A `native-ui-comparison` record references both hashed capture records through `sourceCapture`/`targetCapture`, includes the same case/platform/locale/source/fixture identity, and declares `result: passed | failed`, `reviewedBy: agent | human`, a nonempty inspected-frame `rationale`, and an `exclusions` array. Each exclusion uses an allowed ledger ID, an exact integer pixel rectangle, a reason, and `wholeHeaderExcluded: false`; entire headers/frames are rejected. There is no automatic numeric parity threshold. The verifier checks integrity and declared conditions; the reviewer must still confirm the correct native state and inspect pixel differences, wrapping and interaction behavior.

A `verified` status requires evidence for every required platform × locale × appearance × font-scale profile. Source/target render statuses need their respective native frames; implementation needs target frames with its passed check and target file locations; function needs passed native input checks; visual comparison needs inspected passed source/target comparisons. `failed` needs a state-indexed failed implementation/function/comparison record. A missing build, missing state or unavailable platform stays `unverified`. Protocol tests use temporary test artifacts and never insert them into the project ledger.

Historical captures keep their original bundle identity. `coverage.historicalFixtureInputs` can reference exact archived scenario JSON bytes under the evidence directory; the verifier checks their SHA-256, then deeply compares every global field and the declared scenario against the current bundle. A changed scenario, origin, document mapping, artwork, clock or other global configuration requires fresh native evidence. Its dependency manifest must itself be bound to the captured driver. Archived HTML and generated document/resource exports are compared with current actual file bytes; the archived artwork export also binds the current actual public logo PNG. Missing, changed or unbound dependencies are rejected. Raw metadata and compiled driver/build records remain bound to the original capture hash, and comparison records must retain the same actual bundle/scenario on both sides. Historical provenance does not accept a visual difference or advance matrix coverage.

## PDF fixture verification

PDF scenarios extend the approved Mobile feature; they do not replace or certify
the historical source HTML/RSS captures above. The implementation uses the same
native Reader route, an application-owned PDF.js document with its locally
bundled real worker/resources, and the existing foreground cache queue. See
[the PDF architecture](reader-compatibility.md#approved-pdf-extension) for the API,
256 KiB range blocks, versioned manifests, account/owner file boundaries, mark
geometry, extraction states and native upload boundary.

From the repository root, regenerate synthetic inputs when intentionally changing
the fixture bundle, verify their integrity, and run the standard application
checks:

```sh
python3 apps/mobile/fixtures/generate-fixtures.py
node apps/mobile/fixtures/verify-fixtures.mjs
pnpm mobile -- typecheck
pnpm mobile -- test
pnpm mobile -- bundle
```

Generation updates the current fixture inputs; it must not rewrite archived
source evidence or assign their old hashes to new bytes. Review the resulting
fixture/manifest changes and retain each native run's actual input digest.
`typecheck` and `bundle` also prepare the matching local PDF.js assets through the
application scripts. Passing these commands is not native feature acceptance.

The current 34-scenario bundle includes these PDF cases:

- `reader-pdf`: eight selectable pages, including a rotated third page, for
  native selection, page controls, annotations and range/cache transitions.
- `reader-pdf-long`: thirty pages for bounded canvas/text-layer residency,
  later-page navigation, range demand and position restoration.
- `reader-pdf-offline`: a PDF filled through the production queue before the
  fixture network becomes unavailable, for verified full-cache offline reading.
- `reader-pdf-import`: the native-picker fixture with synthetic input, locally
  simulated upload and delayed bookmark publication. Scoped iOS/Android real
  picker/copy/UI checks passed as recorded below; live backend upload and
  production PowerSync synchronization remain unverified.
- `reader-pdf-native-storage`: production `PdfFileStorage` with native path guards
  and delayed synthetic ranges. Actions are **0 diagnostic, 1 fill, 2 snapshot,
  3 offline, 4 online**. Start fill in Library, background with actual native
  input during the delayed range, then foreground and inspect partial/completed
  receipts; do not delete blocks or edit manifests to manufacture a partial file.

Create a new isolated project using one case; repeat with the other cases or
select them through the existing controlled fixture route:

```sh
pnpm mobile -- fixture:project --scenario reader-pdf --locale en --platform all
pnpm mobile -- fixture:project --project /absolute/generated/project --commands
```

`reader-pdf-long` and `reader-pdf-offline` are valid replacements for `reader-pdf`;
use `--locale zh` for the other supported locale. Follow the generated project's
build, install and Metro commands with an explicitly allocated
`SLAX_FIXTURE_DEVICE` or `SLAX_FIXTURE_SIMULATOR`. Do not seed production storage
or reuse an unrelated user's device. Native input changes require a fresh native
build and recorded driver/artifact hashes.

The PDF scenario action lists expose `pdf-cache-status`, `pdf-fill-cache`,
`pdf-network-offline`, `background-flush` and `pdf-network-online` as applicable.
Use the current scenario's action indices rather than copying indices from a
different case. These commands prepare network/cache state, not native input.
Inspect both cached bytes and the completion flag: partial 256 KiB blocks must
never be labelled available offline. Verify missing ranges resume in foreground,
reading promotes/deduplicates queued bytes, a changed document ID rejects old
blocks, and Reader exit leaves an independently retained manual download intact.
Backgrounding must pause/abort network work, not start an OS background service.

### Separate host, browser and native evidence

`tests/reader/pdf-screen.test.mjs` mounts the real Reader screen behind explicit
native/data boundaries. It covers repository type gating, filename/source,
document-bound page positions, AI extraction gates, bounded polling, exact and
stale selections, notes, measured viewport placement, draft/discard rules,
authorization denial and retained manual-download ownership. These tests do not
execute native PDF selection handles or a platform document picker.

`tests/reader/pdf-browser.test.mjs` uses the installed browser and a real local
PDF.js worker to exercise rendering, text layers, selection/quads, local
resources, page eviction and isolated range transport. Inspect test output for
skipped cases when the browser dependency is unavailable. Browser tests and
programmatically created DOM ranges cannot establish WKWebView/Android WebView
native gestures or suppression of the system edit menu.

Native acceptance must independently exercise both platforms and retain inspected
screenshots, accessibility trees, native input logs and recordings:

1. Long-press and drag selection handles across lines/pages; use the ordinary
   Copy/Highlight/Comment targets without an overlapping system menu. Check
   selection placement after header changes, zoom, rotation and scrolling.
2. Submit a native comment with the keyboard, reply, remove only its stroke,
   reopen through Notes and verify the correct passage/thread survives page
   eviction and reopening. Check collection visibility and creation permissions.
3. Preserve a draft through background/resume, interrupted ranges and cancelled
   back gestures; verify confirmed discard and committed exit separately.
   Account/access revocation must clear inaccessible content and private drafts.
4. Verify full/partial offline files, foreground resume/restart, changed identity,
   owner/environment isolation, long/scanned/corrupt/password PDFs, page-relative
   restoration and pending/empty/failed extraction messages. Cached output must
   not imply new AI generation succeeded.
5. Exercise the real Labs-gated document picker and raw upload, including cancel,
   oversized/invalid files, offline/retry, background cancellation and account
   replacement. Wait for the real synchronized bookmark before claiming live
   upload-to-Reader completion. The dedicated native-import fixture proves its
   recorded picker/copy/UI path, not remote upload acceptance or PowerSync.

### Scoped PDF results and remaining gates

The updated native host passed the following scoped checks. Their task-local
artifacts are not a declaration that every coverage-ledger profile is verified.
Historical exposed-edge diagnostics and failed attempts remain unchanged.

- **iOS strict selection and annotations:** `strict14.xcresult` and
  `strict14.log:180` under `.local/pdf-native/selection-control/` record a passing
  actual-input test on iOS 26.5 simulator
  `0C58121F-EE70-4388-BD09-6049EAC223D9`, isolated
  `app.slax.reader.uifixture`, English `reader-pdf`. A 1.2-second long press
  produced native handles and unobstructed Slax Copy/Highlight/Comment controls;
  ordinary center-target taps, exact quote `text`, native keyboard submission and
  Notes reopening of the highlight/comment passed. System-menu assertions were
  not weakened. `strict14-attachments/` contains screenshots, accessibility trees
  and its manifest.
- **iOS page/zoom/lifecycle:** `lifecycle13.xcresult` and `lifecycle13.log:210` in
  the same directory record successful native pages 2–4, 125% zoom, Fit to width
  at 100%, and background/foreground retention of page 4/125%. Native Back to
  Library and reopening restored page 4 at 100% fit width; zoom is not persisted.
  Notes returned to page 1 with the exact quote/highlight. Screenshots and trees
  are in `lifecycle13-attachments/`. This does not prove process-kill recovery or
  cross-page handle dragging.
- **Android physical selection and annotations:** on allocated device
  `4A141FDKD000AK`, actual `adb input` long-press/taps showed only Slax actions,
  created a highlight, exposed its removal on reselection, submitted comment
  `abc`, and reopened the passage/thread through Notes. Task-local evidence
  includes `.local/pdf-native/android-host-selection.png`,
  `android-host-highlight.xml`, `android-comment-posted.xml`, `android-notes.xml`,
  `android-note-thread.png`/`.xml` and `android-final-menu.png`/`.xml`.
- **Android demonstrated retention/OOM path repaired:** heap inspection found
  detached navigation wrappers retaining approximately 15 MB of PDF HTML per
  reset and destroyed WebViews through transition lists. Native detach now clears
  those references, ends the child transition and rejects late operations/events.
  After the fixture APK rebuild, 15 resets kept exactly one WebView; ten physical
  Library/PDF/Back cycles returned to zero WebViews after every Back. Allocated
  Java heap stayed around 28–29 MB reading and 13.7–13.9 MB in Library, with zero
  OOMs in the post-fix process log. Measurement used no Fast Refresh or process
  restarts. Lightweight detached wrappers can still be retained upstream; this
  is bounded endurance evidence, not an unlimited soak result. Under
  `.local/pdf-native/`, `heap-paths.txt`, `after-heap-webviews.txt`,
  `before-reset-*.txt`, `final-reset-*.txt`, `final-cycle-*.txt`,
  `android-endurance-build.log` and `final-endurance-logcat.txt` retain the
  diagnosis/build/measurements. Historical `android-host-errors.log` remains the
  pre-fix failure. The updated temporary Android snapshot's original source-digest
  marker was not rewritten and must not be represented as matching changed bytes.
- **iOS real native import:** `import3.xcresult`, `import3.log:193`,
  `import3-verification.json` and `import3-attachments/` under
  `.local/pdf-native/selection-control/` record real Documents picker cancel,
  selection, native copy, Expo File, upload-client invocation, pending-sync UI and
  automatic eight-page Reader opening. Read-only SQLite confirmed the type-2
  bookmark; temporary import copies were removed after success.
- **Android real native import:** the physical picker cancel/select flow,
  copied-file readiness, pending then published UI and automatic Reader opening
  passed on `4A141FDKD000AK`, followed by native highlight/reselection. Evidence
  under `.local/pdf-native/` includes `android-picker-cancel*.xml`,
  `android-picker-chosen.xml`, `android-import-pending.png`/`.json`,
  `android-import-published.json`, `android-import-reader.xml`,
  `android-import-menu.png` and `android-import-remove.xml`. Both platforms used
  the independently checked 285,847-byte seed with SHA-256
  `a56de0349a579a18f02b6f3dcd0d3b47341c9dd4d770f7a11decc961ac4c3cc5`;
  receipts showed one accepted and zero rejected uploads. The native picker/copy
  and application UI/client paths were real, but upload acceptance and delayed
  SQLite publication were simulated locally, not live backend or PowerSync.
  Fixture receipts retain `nativeInteractionVerified:false`; separate native
  input evidence supplies the UI proof without rewriting those receipts.
- **iOS full-cache offline reading:** `cache1.xcresult`, `cache2.xcresult`,
  `cache2.log:344` and `cache2-verification.json` under
  `.local/pdf-native/selection-control/` record the real production
  `BackgroundArticleCache`/`PdfBlockCache` path with 1,071,078 bytes in five native
  disk blocks: four of 262,144 bytes and one of 22,502 bytes. Independent ordered
  block SHA-256 matched
  `e28e3c0b6a27a3aa7c565326748bf93c34986946cc58d0638aee687c3473b0c0`.
  After disabling fixture transport, native page-1-to-30 traversal,
  background/foreground and Library/reopen restored page 30. Bytes served stayed
  1,071,078 and range requests stayed five despite rejected offline attempts.
  `cache-initial-native-read.json`, `cache-offline-before.json`,
  `cache-offline-after.json`, `cache-offline-transport.json` and
  `cache2-attachments/` preserve the observations. The disabled Available offline
  control was inspected, not tapped; no manual-download initiation is claimed.

- **Android full-cache offline reading:** the allocated physical device completed
  the native Download for offline reading action and displayed Available offline.
  All five disk blocks independently matched the same 1,071,078-byte document
  SHA-256 above. After the fixture transport went offline, native Library/Reader
  reopening, entering page 30 and Home/foreground retention passed. Served bytes
  remained 1,071,078 and successful range requests remained five. Evidence includes
  `.local/pdf-native/android-long-block-hash.json`, `android-long-resume.png` and
  its matching XML, transport diagnostics and verified reopen memory snapshots.
  A separate verified-complete reopen retained zero WebViews in Library and one
  in Reader. An early offline switch on a supplemental fresh fixture correctly
  produced the missing-part error; reconnecting and completing the cache allowed
  offline reopening. This is not a measured in-flight pause/resume interval.

Those earlier disk proofs used **`FixturePdfStorage` backed by actual native Expo
file I/O, not production `PdfFileStorage`**, and retain that scope. The file had
already completed before inspection, so they did not establish in-flight pause.
New production-adapter runs below close those two specific gaps without
manufacturing partial blocks or rewriting the historical results.

- **iOS production storage and mid-flight resume:**
  `.local/pdf-native/selection-control/production-cache4.xcresult`,
  `production-cache4.log:308` and `production-cache4-verification.json` record a
  passing 81.877-second native XCTest. `PdfFileStorage` used
  `SlaxCachePaths.pdfCacheFileUri` under native Application Support; write/read,
  replacement, size, list and remove diagnostics all passed. Home was pressed
  approximately two seconds after fill dispatch. The real first 262,144-byte
  block remained committed with `complete:false`; the delayed second range was
  aborted and then retried to completion after foreground. The first block was
  requested exactly once. The five completed disk blocks independently hashed to
  the 1,071,078-byte document identity above, and download state advanced from 1
  to 2. Native offline traversal to page 30 served no additional PDF bytes or
  ranges. `production-cache4-receipts/` contains `pdf-production-storage.json`,
  `pdf-cache-empty.json`, `pdf-cache-partial.json`, `pdf-cache-complete.json` and
  `pdf-transport.json`; generated `nativeInteractionVerified:false` fields are
  unaltered.
- **Android production storage and mid-flight resume:** the same real adapter
  diagnostics passed on `4A141FDKD000AK`. Its supplied ownership root must equal
  canonical `context.dataDir`, while physical files now live under canonical
  `context.filesDir/pdf` for Expo access. Canonical comparison accepts the normal
  `/data/user/0` to `/data/data` alias without weakening non-app-root, traversal
  or symlink rejection. Native Home during fill retained **262,144/1,071,078
  bytes, incomplete**; the second range was aborted and retried, while the first
  block was requested once. Actual completed files matched the same SHA-256,
  `complete:true` and download state 2. Synthetic-offline Reader input reached
  page 30 with no additional successful ranges/served PDF bytes and one WebView.
  Evidence under `.local/pdf-native/` includes
  `android-filesdir-final-diagnostic.json`, `android-filesdir-final-partial.json`,
  `android-filesdir-final-partial-transport.json`,
  `android-filesdir-final-complete.json`, `android-filesdir-final-transport.json`,
  `android-filesdir-final-hash.json`, `android-filesdir-offline-final.json`,
  `android-filesdir-context.json`, `android-filesdir-page30.png`/`.xml` and
  `android-filesdir-memory.txt`. The transport retains both observed second-range
  aborts; the temporary snapshot digest marker was not rewritten.

Both runs exercise real production storage, queue/cache and native lifecycle
against delayed closed synthetic transport. They do not prove live HTTP outage
recovery, airplane-mode behavior or backend/PowerSync synchronization. Native
concurrent reader/prefetch priority arbitration, missing-block offline rendering
failure/recovery with production storage, process-kill/restart and the broad
cross-page/profile matrix remain unverified. Host tests separately cover queue
priority promotion/deduplication, scope isolation and persisted manual restart;
that distinction is retained when assessing overall acceptance.

`tests/reader/pdf-cross-interop.test.mjs` verifies both directions using real Web
selection geometry, shared `MarkManager`, `InlinePdfViewer`, the actual Web
`drawPage` implementation, production mobile repository writes in in-memory
SQLite and mobile mark restoration. It covers a 90° rotated page at Web 125%,
mobile 150% and restored Web 75%, exact document/page/text/quads, projected SVG
geometry, grouped annotations, deleted ancestors with live replies and keyboard
activation. The combined `pdf-source`/cross-interop group passed **10 tests,
0 failures, 0 skips**. The local HTTP adapter is test wiring: this is persisted
format/browser-renderer interoperability, not live PowerSync, backend sync,
native parity or the complete Nuxt/Vue shell.

The final integrated run after the Android storage-path correction passed
**860 mobile tests, 0 failed, 0 skipped**, TypeScript, both platform production
bundles, API type checking, **32 strict OpenSpec checks** and the diff check.
The correction also passed **17 focused storage/runtime tests**, Kotlin/Swift
native-resource host checks, its Android build and the native flow above.
Earlier API verification recorded **1,921 tests passed/46 skipped** and a
successful offline build; the API implementation has not changed since that run.
Skipped API cases and unverified live-service/native scenarios are not converted
into passes.

OpenSpec 18.2, 18.3 and 18.5 are complete for their implemented cache/reader/import
capabilities and scoped functional verification: host priority/scope/protocol
coverage, both production native storage/lifecycle runs, real-worker/rendering
checks, bounded native teardown/controls/restoration, and native synthetic import
flows. Task 18.4 remains partial for live cross-Web/backend/PowerSync exchange;
18.6 retains the final integrated checks/review and broader native/end-to-end
gaps; 18.7 remains release-blocked. These statuses do not claim completed
cross-page handle, process-kill, concurrent-native or full-profile acceptance.

`apps/mobile/tests/reader/native/PdfSelectionControl.swift` requires
`SLAX_PDF_SIMULATOR` in the XCTest runner environment and compares it with the
actual `SIMULATOR_UDID`; absent or mismatched allocation fails before app
activation or capture. The bundle remains fixed to `app.slax.reader.uifixture`.
The driver also checks the prepared English eight-page fixture. Optional runner
values `SLAX_PDF_TEXT` and `SLAX_PDF_SELECTED_TEXT` select the synthetic paragraph
and exact expected quotation (defaults: `Alpha selectable PDF text. Highlight
this sentence.` and `text`). They must describe the fixture, not private input.

The task-local `.local/pdf-native/selection-control/PdfSelectionControl.xcodeproj`
contains an independent empty host and the test source, with no Pods or application
build dependency. Its scheme currently pins the dedicated allocation; set its
`SLAX_PDF_SIMULATOR` environment entry to the allocated device before running.
From the repository root, with that project already prepared:

```sh
set -eu
export SLAX_PDF_SIMULATOR='0C58121F-EE70-4388-BD09-6049EAC223D9'
HARNESS="$PWD/.local/pdf-native/selection-control"
TEST='testNativePdfHighlightAndComment'
RESULT="$HARNESS/strict-$(date +%Y%m%d-%H%M%S).xcresult"
python3 - "$HARNESS/PdfSelectionControl.xcodeproj/xcshareddata/xcschemes/PdfSelectionControl.xcscheme" <<'PY'
import os, sys, xml.etree.ElementTree as ET
path = sys.argv[1]
tree = ET.parse(path)
entry = tree.find(".//EnvironmentVariable[@key='SLAX_PDF_SIMULATOR']")
assert entry is not None
entry.set('value', os.environ['SLAX_PDF_SIMULATOR'])
tree.write(path, encoding='UTF-8', xml_declaration=True)
PY
xcodebuild build-for-testing -project "$HARNESS/PdfSelectionControl.xcodeproj" \
  -scheme PdfSelectionControl -configuration Debug -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=$SLAX_PDF_SIMULATOR" \
  -derivedDataPath "$HARNESS/DerivedData" -jobs 1 ARCHS=arm64 \
  ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO COMPILER_INDEX_STORE_ENABLE=NO
xcrun simctl install "$SLAX_PDF_SIMULATOR" \
  "$HARNESS/DerivedData/Build/Products/Debug-iphonesimulator/PdfSelectionControl-Runner.app"
xcrun simctl openurl "$SLAX_PDF_SIMULATOR" \
  'slaxreader-ui-fixture://control?case=reader-pdf&locale=en'
xcodebuild test-without-building -project "$HARNESS/PdfSelectionControl.xcodeproj" \
  -scheme PdfSelectionControl -configuration Debug \
  -destination "platform=iOS Simulator,id=$SLAX_PDF_SIMULATOR" \
  -derivedDataPath "$HARNESS/DerivedData" -parallel-testing-enabled NO \
  -maximum-concurrent-test-simulator-destinations 1 \
  -only-testing:"PdfSelectionControl/PdfSelectionControl/$TEST" \
  -resultBundlePath "$RESULT"
```

Install only the uniquely identified test runner above, never replace the prepared
fixture or production app through this harness. Explicit runner installation avoids
reusing a stale test executable. Run each case separately after fixture reset:
`testNativePdfHighlightAndComment` retains strict menu-suppression and ordinary
button-target checks; `testNativePdfPageZoomBackgroundAndReopen` adds native page
controls, zoom, Home/foreground, Library/Reader reopening and exact note-text
restoration. Their recorded passes are `strict14` and `lifecycle13` above;
rerun against any changed native host or renderer rather than transferring those
passes to new inputs. `testNativePdfCommentExposedEdgeDiagnostic` remains
diagnostic only and must not substitute for the strict case. Preserve each result
bundle and exported attachments; a prepared test or successful host build is not
a passing native run.

Fixture and local API tests do not deploy services. The user's latest decision
requires the mobile client to match the existing backend, not add or deploy PDF
APIs. Existing `/v1/bookmark/metadata` returns nested `data.pdf`; the observed test
origin serves binary Range 206 without ETag. The mobile contract must accept that
shape and missing header while preserving range/length and full-file SHA-256
integrity checks. No backend deployment is needed for this contract correction,
authorized or performed. Endpoint observations do not establish the corrected
mobile/native path; earlier new-route/ETag fixture results remain historical and
must not be transferred to the revised client. The earlier release
preflight rejected the absent Share `GoogleService-Info.plist`, and the App Store
Connect browser attempt redirected to login without completed authentication.
Those observations are historical, not current release requirements or proof of
remote build history.

The latest user instruction confirms prior build `1.0.25 (762)` and authorizes
immediate TestFlight preview `1.0.25 (763)` without further tests, superseding the
earlier acceptance-first upload condition. The user also confirms that Share
needs no Firebase; its integration and admission requirement are removed while
main Analytics/Crashlytics and both bundles' identity/version/signature/App Group
checks remain required. No independent remote-history query is claimed. The latest
PDF client correction uses already available backend routes and needs no rollout;
any unrelated backend deployment would still require separate authorization. Keep missing-block/concurrent-native
and live-service acceptance gaps incomplete. These instructions do not record a
763 upload; archive/export/upload/processing evidence must be recorded separately.
Do not infer backend rollout, production availability or completed native
acceptance from a bundle, archive or upload.
