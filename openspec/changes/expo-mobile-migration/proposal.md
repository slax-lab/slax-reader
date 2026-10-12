# Proposal

## Why

Move the existing Slax Reader Android and iOS application into the monorepo as an Expo application so mobile development shares TypeScript contracts and repository tooling. Replace the complete current mobile experience, preserving its features and visual design rather than delivering a reduced reading client.

## What Changes

- Add `apps/mobile` using Expo SDK 57, React Native, TypeScript, and native development builds; keep mobile implementation, assets, native modules, and tests application-owned.
- Migrate all current mobile routes and flows: login, inbox/starred/archive, collections, RSS/Labs and reader, bookmark reading, highlights/comments, AI overview/outlines/transcripts, settings, account deletion, subscription, feedback, About, and diagnostic tools.
- Reproduce current Android and iOS UI, assets, spacing, typography, states, and interactions one-to-one. Use platform-native back controls and navigation behavior as the explicitly requested visual exception.
- Preserve HTML reading and unrestricted text selection through the approved WebView integration; provide local Swift/Kotlin implementations wherever JavaScript and approved plugins cannot reproduce behavior.
- Migrate PowerSync/SQLite and legacy preferences without losing pending offline writes, saved content, reading positions, account isolation, or shared-extension authentication.
- Preserve the standalone iOS share extension, Android incoming shares, existing login capabilities, iOS StoreKit subscriptions, and platform diagnostics. Do not invent Android purchasing or push flows absent from the source.
- Require explicit user approval for every additional optional plugin before adopting it. Navigation, WebView, and PowerSync/SQLite packages have been approved; other plugins remain separate decisions. Existing platform integrations may be ported as project-owned native code.
- Add mobile commands, native CI, upgrade tests, visual evidence, and migration documentation. Preserve existing API release rules: mobile source-only changes stay outside API paths; root manifest/lockfile changes remain eligible for API release under the current contract.
- Deliver the user-authorized iOS TestFlight preview `1.0.25 (760)` following uploaded build `759`, while keeping unfinished native parity, physical-device performance and Firebase acceptance explicit. The user requested preview delivery before full acceptance; this does not change the complete migration finish line. Android remains part of migration verification; no Android release package is required for this delivery.
- **BREAKING**: The user approved Expo SDK 57 and a minimum supported iOS version of 16.4, replacing the source's mixed iOS 14.1 framework and 15.1 application targets. Preserve the current Android API 26 floor.

## Capabilities

### New Capabilities

- `mobile-expo-runtime`: Expo application placement, package approval, native builds, development commands, and repository integration.
- `mobile-app-parity`: Complete existing route and feature coverage, platform differences, and operational integrations.
- `mobile-reader-parity`: HTML/RSS reading, text selection, persistent marks, media, AI panels, and reading-position behavior.
- `mobile-native-navigation`: Platform-native back controls, gestures, dismissal ordering, existing provider callbacks, and lifecycle handling.
- `mobile-visual-parity`: Source-based Mobile profile and verified one-to-one Android/iOS visual and interaction parity.
- `mobile-upgrade-compatibility`: Legacy identity, preferences, shared authentication, local database/cache migration, and reliable offline synchronization.

### Modified Capabilities

None. Existing Web, Extension, API, and release requirements remain in force; mobile-specific orchestration must preserve them.

## Impact

Target: `apps/mobile`, focused root tooling/CI, `DESIGN.md`, and `docs/mobile`. Existing `packages/contracts` remains the platform-independent API boundary. Use `../slax-reader-client` as read-only migration evidence at commit `9951904405159f49f24effd4d42815f77ff33442` **plus its current dirty and untracked working-tree overlay**, including RSS; a committed-HEAD-only import is incomplete. Baseline checksums and runtime screenshots must pin the actual source state before porting. Approved dependencies are React Navigation native/native-stack, screens, safe-area-context, WebView, PowerSync React Native, and OP-SQLite. No source-repository removal or production backend data/deployment operations are authorized. The user subsequently authorized iOS-only TestFlight previews before full migration acceptance, including build `759`, and requested Slax-owned generated-output/cache/simulator cleanup after TestFlight and Git delivery. Source and operator configuration remain preserved; public App Store publication is outside this delivery.
