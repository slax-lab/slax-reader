# Proposal

## Why

The old Kotlin-to-Expo upgrade currently prioritizes lossless local database adoption over availability. A rejected legacy database can block startup, leave sign-out cleanup pending, and reject a subsequent successful login. The owner explicitly chooses a simpler policy: recognize an old-app installation, discard its local data once, and download cloud data again rather than preserve or migrate the old database.

## What Changes

- **BREAKING:** Android and iOS SHALL reset recognized Kotlin-origin local data once, including already-adopted or failed/partially migrated installations. This intentionally discards unsynchronized legacy operations, offline content and local reading positions; there is no attempt to preserve, replay or adopt those records. Server data is never deleted.
- Remove legacy database adoption profiles, exact-table/version/checksum gates, preservation snapshots and adoption recovery journals from runtime startup. Do not replace them with additional migration compatibility paths.
- Keep only minimal best-effort authentication/environment import to avoid unnecessary sign-in. Missing or corrupt legacy preferences lead to ordinary login, not a permanent migration barrier. Explicit pending sign-out is completed, never resurrected.
- Reset through app-owned native file operations without opening the old database. Use one durable one-time completion state, resume an interrupted reset before services start, and rebuild a normal PowerSync database.
- Repair historical adoption/installation/cleanup markers together so old migration failure cannot block logout or a new login. Keep normal account isolation, exclusive ownership and filesystem containment.
- Leave new Expo installations, ordinary Expo upgrades and their new offline edits untouched. Network failures, expired credentials and temporary locks are not reset triggers. Existing synchronization and cache scheduling download cloud data again.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mobile-upgrade-compatibility`: replace lossless Kotlin database/cache migration with one-time legacy reset; reduce preference import to session continuity and guarantee recovery from stale sign-out state on both platforms.

## Impact

- Shared Mobile startup, session, preferences, database initialization and related tests; Android/iOS `slax-legacy` native storage adapters; shared-extension coordination where reset touches its state. No new dependency or API contract.
- Update `docs/mobile/data-compatibility.md`, affected architecture guidance sources and generated rules through their generators. Retire migration-only tests/fixtures that mandate preservation; retain useful native old-app fixtures for reset acceptance.
- The current capability explicitly prohibits discarding pending legacy operations. This proposal intentionally supersedes that policy, not ordinary post-reset offline operation retention.
- Sequence this change after the already-merged `android-storage-path-alias` capability delta; it must not race that delta at archive time. Its canonical-path safety remains, but its adopted-database preservation requirement is replaced for the one-time Kotlin reset. Classify its outstanding tasks and archive predecessors through the separate human-reviewed process.
- On 2026-11-09 the owner approved implementation with fixed old-path detection, then explicitly authorized simulator-only validation and a PR after successful verification. Physical phones are excluded, including read-only access.
- The owner subsequently approved retaining version 1.0.29 and increasing buildNumber to 804 (previousBuildNumber 803); native metadata is regenerated through Expo. No store publication or deployment is authorized.
- This is exceptional local-database upgrade/recovery handling, not a UI redesign: normal layout, styling and navigation are unchanged. The obsolete migration-verification screen branch is removed with its retired admission mechanism.
- Human hands-on acceptance is complete: on 2026-11-09 the requesting owner confirmed that they had inspected the running simulator app, found the interface normal and accepted the implementation. No visual adjustment was requested. Automated Android/iOS fault-flow and synthetic external identity-provider boundaries are documented separately in validation.md.
