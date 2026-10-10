# Design

## Context

See `proposal.md` for motivation and scope. This is a port of an existing cross-application implementation, with security-sensitive session boundaries, rather than a new locale design.

The local source range is `7a4bb109..c1677360` in `unnoo/slax_reader_frontend`, containing feature commit `b553ecb5` and API envelope fix `c1677360`. It changes 70 files including legacy design and validation notes. Those historical notes describe validation in the old repository and are not evidence that v2 passes.

Current v2 has the pre-feature Web user-store actions, a Pinia offline profile fallback, and an Extension `$t` wrapper around native WXT i18n. v2's backend `apps/api/src/utils/responseUtils.ts` and `packages/contracts/src/http.ts` confirm that successful JSON uses `code`, not `status`.

The task worktree is `.worktrees/sync-extension-account-locale`, branch `feat/sync-extension-locale`, based on `origin/dev` `8682a73`. GitHub CLI verification on 2026-10-10 confirmed that this is still the remote `dev` tip and that PR #1615 has head `c1677360`. The original checkout contains unrelated ongoing work and must remain untouched.

## Goals / Non-Goals

**Goals:** Preserve the source PR's locale behavior and regression coverage while adapting it to v2 package ownership, runtime paths, and tooling. Keep synchronization independent of bookmark readiness and preserve session isolation.

**Non-Goals:** Rework shared HTTP contracts, replace existing i18n frameworks, import legacy build configuration, broaden UI design changes, or publish a release. The root `DESIGN.md` remains the UI authority; this file describes only this change's implementation.

## Decisions

### 1. Apply a path-aware port and review conflicts against v2

Map source application paths to `apps/web` and `apps/extension`; map frontend implementation packages to `packages/frontend-types` and `packages/frontend-utils`. Add the pure locale message/snapshot types as `@commons/frontend-types/locale`. Continue importing HTTP constants and `UserInfo` through `@slax-reader/contracts`.

Use the source diff as a checklist rather than replacing entire files. Preserve v2's semantic icons, theme handling, package versions, environment wrappers, tests, and build hooks. Copy only the needed test script entry from the legacy Extension manifest; an extension release version change is outside this port. No new production dependency is expected.

Direct cherry-picking would target obsolete directories and the old shared package structure. Reimplementing from scratch would discard existing race-condition fixes and regressions; neither is appropriate.

### 2. Keep the backend authoritative and the Extension background the only snapshot writer

Preserve the source pipeline: successful Web setting save → versioned invalidation message → content-script relay → background account read → account-bound storage snapshot → reactive clients and menu updates.

Port `localeService`, `localeApi`, `localeAlarm`, `localeSessionExpiry`, `localeClient`, `localeRelay`, and `localeCore` with their tests. Use generation/revision checks, session epochs, captured tokens, bounded reads, and refresh coalescing to prevent stale updates. Cache fallback must verify account identity before use. Session expiry must recheck the expected token before destructive session actions.

Accept notifications only from the configured top-level Web origin, and never receive credentials or an authoritative locale through the page message. Do not add `externally_connectable`, host permissions, or a dependency on offscreen/PowerSync readiness. Restore missing calibration alarms using the existing interval and browser support level.

### 3. Port Web save ordering and display coordination together

Port `userLocaleTasks`, `accountLocaleRequest`, and `extensionLocale`, then integrate the user store, Pinia fallback, layout refresh, settings selector, and `OptionsBar` reselect behavior as one coherent change. Capture Nuxt handles before entering asynchronous queues.

Use a session epoch to invalidate previous-account work, read the latest token when a queued save begins, and track confirmed language separately from local display fallback. Protect both API results and the real Pinia offline fallback; changing only the store would leave a stale-language write path.

Emit a successful-save invalidation immediately after server confirmation. Coordinate lazy translation application so older loads cannot win. Keep auxiliary token refresh bounded and invalidate late writes; its failure must not undo a saved preference. Permit a local display retry without treating an unconfirmed browser fallback as an already saved value.

### 4. Retain current dictionaries and make local status text derived

Keep WXT-generated manifest dictionaries and key types. Bundle existing English and simplified-Chinese JSON for a reactive runtime that preserves `$1` substitutions, literal dollar signs, and fallback behavior. Replace one-time translated state with keys or structured status data.

Review every changed component against current v2. Preserve menu selection, draft input, focus, collection progress, and chat operations. Port structured AI status with operation type, status, and subject, including error handling. Existing raw server errors and generated content remain raw text. Only Extension-owned containers may receive a language attribute.

### 5. Validate the real response shape and local tooling

Port the second source commit as part of the baseline feature. Use existing `ApiResponse` ownership when adapting frontend response typing; do not duplicate or weaken the backend contract. Cover successful profile/save/refresh responses, HTTP and envelope 401, other business errors, missing data, and invalid identities/tokens.

Adapt the locale browser fixture to v2 paths and test-build conventions. Do not read, copy, or load secret environment files; use explicit synthetic non-secret test configuration where needed. Source tests are evidence to reproduce, not a substitute for running them here.

## Risks / Trade-offs

- [Stale 401 clears a newer account] → Preserve token checks in both request handling and session cleanup, with deferred-response tests.
- [An old translation load or offline profile wins] → Preserve the display coordinator and confirmed-language checks in both store and Pinia integration.
- [Legacy file replacement loses v2 changes] → Apply hunks selectively and review every touched file against current `dev`.
- [Frozen pages, offline APIs, or stale installed content scripts delay updates] → Keep cached fallback and lifecycle recovery; report the two-second target only under normal active conditions and refresh old injected scripts after extension upgrades.
- [Source fixtures hide the same API bug] → Ground envelope fixtures in v2's existing response serializer and cover malformed and failure responses.
- [Source or target refs advance after proposal publication] → Recheck `origin/dev` and PR head before implementation/push and adapt any intervening changes.

## Migration Plan

1. Human approval and remote source/target verification were completed on 2026-10-10. Publish these planning artifacts as a Draft PR before implementation, as requested.
2. Apply and validate the mapped changes in the isolated task branch. Keep all implementation tasks unchecked until verified.
3. Run the required Bugs, Security, and Compliance review from `REVIEW.md`, resolving Important findings.
4. Push the implementation to the same Draft PR targeting `dev`, keeping `OpenSpec: sync-extension-locale`, updating source provenance and v2 validation results, and marking it ready after validation.
5. Release Web and Extension through their existing processes after merge. Older versions tolerate the new signal; newer Extensions retain periodic and lifecycle refresh with older Web clients. A rollback can restore previous application code without an API or database migration.
