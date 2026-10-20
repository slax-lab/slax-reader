# Verification

OpenSpec: `update-expo-58`; branch: `feat/update-expo-58`; source checkpoint: `fb73f83`. Historical evidence retains its original task/worktree names and scope. The detailed record is [the SDK 58 status](../../../docs/mobile/sdk58-upgrade.md).

## Current evidence — 2026-10-20

- [Mobile CI at fb73f83](https://github.com/slax-lab/slax-reader/actions/runs/39388157751) passes: **1,313 passed, 0 failed, 15 skipped**, with successful Android and iOS JavaScript bundle exports. The 15 skips remain reported; they are not passes. The default/opt-out/capability policies, donation crash/storage/runtime-generation regressions and retirement-generator tests are included in the automated suite. No additional local host/browser run is claimed.
- Canonical dependency lock/install, prebuild and Pods reconciliation succeeded after widget retirement. The no-widget exact-Duo iOS 27.1 Debug arm64 build succeeded and was installed. Its effective deployment minimum is 16.4, it embeds only `SlaxShare.appex`, preserves the original App Group and contains no Live Activity key. Extracted metadata includes Save Link, Open Bookmark and Donation. Compilation against the 16.4 floor is not hands-on execution on that older OS.
- Source review covers independent minimums: generic intents/donation/deletion at effective 16.4, EnumerableEntityQuery 17, Spotlight IndexedEntity/registerIndexed 18, optional reindex callbacks 27. `@expo/ui` remains required by App Intents/ExpoUI; `expo-widgets` and all widget/activity delivery are removed.
- Earlier three-pass source review and focused rechecks passed. The current documentation-only policy revision also passes its narrow Bugs/Security/Compliance three-pass review, OpenSpec strict validation (65/65) and diff checks. No product code changed in this revision; its preparation does not imply the latest documentation is already pushed or the PR merged.
- Actual Duo observations covered Closed Reader and Open Inbox/drawer/list selector/Add Link safe bounds. The latest synthetic PDF fixture switched single-page to pages 1–2, fell back when folded and restored the spread when reopened. More opened inside safe content bounds and dismissed with Escape when folded. Later interaction stopped when Device Hub returned `noWindowsAvailable`.

The prior CI at `e3f186e4` reported 1,268 pass, 59 fail and 15 skip; retirement and the two-file test-harness follow-up corrected those failures. Historical SDK-58 base verification passed 1,291 tests, both exports and the Android/iOS base Debug/unsigned Release builds. These checkpoints remain historical, not substitute results for the current tree.

## Verification ownership

On 2026-10-20 the human assigned hands-on device, authenticated-provider, configured-service, sandbox-purchase and older-OS exploration to themselves outside this PR's merge gates. Those scenarios are removed from the agent delivery checklist rather than marked passed. Lack of a user-run result is not a missing-test Compliance or Important blocker under this policy. Runtime behavior, authentication/admission, account isolation, metadata privacy, revocation and OS guards remain unchanged.

Siri/Shortcuts and Spotlight UI depend on the selected simulator runtime's available system applications. The prior Duo attempt reached Login, but searching for Shortcuts entered web search; no invocation was established. A system search, app launch or compiled intent record must not be presented as a successful save. Optional usage instructions live in `docs/mobile/integrations.md`; they are not merge conditions. Every new save invocation requires explicit Claim and save, including a warm signed-in invocation.

## Actual unresolved simulator issue

The PDF tail/spread continuity issue is not waived. A prior valid On→Off transition while final page 13 was visible exposed page-11 text, and Off→On returned to page 13. The first visible page/normalized anchor must still be established before and after confirmed switch-state changes, including preceding-row visibility at an odd final spread. The passing CI, safe-area screenshots and pages 1–2 fold fallback do not prove this deep-position continuity contract. Tasks 12.2–12.5 retain the remaining simulator scenarios. The explicit unsuccessful-row/pre-limit catalog regression remains a code-coverage follow-up in 9.2, independently of user-run system discovery.

## State and recovery semantics

Discovery and donation default on for unset/new preferences, preserve explicit false and wait for loaded preferences, admitted current ownership and valid credentials. Catalog publication is bounded to eligible successful bookmarks and title/host/opaque-ID metadata. System entries are revalidated against the admitted current account.

Donation admission is journaled before native dispatch. Recovery consumes ambiguous/legacy attempts without re-donating; interruption before dispatch can lose an optional donation. Explicit native rejection is retryable. Unknown save-server outcomes retain at-least-once URL/relation upsert and can refresh Inbox save time; durable completed receipts retry acknowledgement only.

The human-approved source metadata remains `1.0.25 (774)`, previous source bound `773`, without an independently verified store-history claim. Earlier widget metadata/build records describe a superseded implementation: the widget-inclusive build was interrupted, and its fixture was generated but not exercised in the OS. Local evidence remains under ignored `.local/evidence/mobile-sdk58-native/`. Renewed task-owned build/fixture outputs were cleaned after preservation, while the recreated Duo remains because another active task uses it. No store submission, publication, PR merge or OpenSpec archival is implied.
