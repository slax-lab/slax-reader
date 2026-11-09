# Design

## Context

The owner approved implementation on 2026-11-09 and explicitly simplified detection to the existing old database location. Previous lossless adoption could block startup and leave sign-out pending, causing subsequent session acceptance to fail. See proposal.md for the accepted data-loss policy.

## Goals / Non-Goals

Reset the fixed old local storage directly and initialize normal Expo storage on Android and iOS. No schema profiles, checksums, full-directory discovery, old SQLite opening, queued-write replay, backup service or multi-signal installation classifier remains. Do not delete server data or clear ordinary new storage on a network/authentication failure.

## Decisions

### Fixed paths decide whether cleanup runs

Android checks `databases/powersync.db` and its WAL/SHM/journal family beneath the native app data root. iOS checks `Library/Application Support/databases/powersync.db` and the same family. Existing adopted databases still occupy that old slot, so no migration-record classifier is necessary. New storage always uses `slax-react-native/powersync.db` beneath Android files or iOS Application Support. Old preferences alone do not select reset.

### A temporary marker only resumes interrupted deletion

First validate containment of every cleanup target, the legacy preference source, the marker path and descendants of owned cleanup directories without modifying anything. An unsafe target rejects the attempt before a marker or deletion is created, preserving all old/new database, cache and preference files. Only after that preflight passes, create `.slax-legacy-reset` beside shared preferences and delete the fixed old database family, the selected reset's new database directory and owned content/cache directories. The marker resumes real interrupted cleanup. After minimal preference handling, remove the legacy preference source and marker before opening the new database. Once the old files and marker are absent, later starts do not reset again. No permanent profile or version marker is required.

Native file/owner locks and canonical root containment remain. The reset never follows stored historical absolute paths or symlinks into other data. Share preference readers return no credentials while the marker is present. Real local I/O failure is retryable, not falsely reported as a completed reset.

### Preserve only a usable identity

Before publishing the local route, best-effort import token, user ID, refresh time, environment, language and analytics identity when no current identity exists. Other legacy values are discarded. Unreadable legacy preferences lead to normal login. A corrupt current preference JSON during selected reset is treated as pending sign-out so stale legacy authentication cannot return. Current identity wins over imported identity.

When reset is selected, replace preference values with that minimal identity and retire old migration/binding/cleanup state. Pending sign-out removes the bearer and completes cleanup, allowing a new login. Then initialize PowerSync at the new slot and reuse normal credential readiness, sync and cache scheduling. No new download engine is introduced.

### Remove old implementation and preservation tests

Remove shared adoption/profile/installation/upgrade modules, Android installation binding checks, iOS schema inspection/identity/checksum helpers and obsolete native acceptance consumers. Retain old SDK producers and immutable historical reports for provenance, and replace executable acceptance with reset tests. Shared lifecycle, account isolation and current offline-write tests remain.

## Risks / Trade-offs

- Old unsynchronized writes, downloaded content and local reading state are intentionally lost, including in previously adopted old slots. Cloud state is not deleted or replayed.
- Reset interruption is covered by the small marker; after it is removed, new writes must survive every restart.
- File I/O, insufficient disk space and network failures still need normal error handling; none authorize arbitrary deletion.
- Native app changes require new packages. The owner approved build 804 with marketing version 1.0.29 and previous build 803. Store publication, deployment and merge remain separate authorization.

## Verification and rollout

Run production Kotlin/Swift reset helpers, shared runtime/preference tests, standard mobile check/bundle/native builds, and synthetic same-signature emulator replacement. Verify old unreadable data is discarded, failed-logout markers no longer prevent login, and reset does not repeat. Keep Play-signed provider/network acceptance and iOS device execution distinct from host/synthetic evidence. This changes exceptional storage recovery, not normal visual design. Human hands-on acceptance is complete: on 2026-11-09 the requesting owner confirmed that they had inspected and accepted the running simulator app, that the interface was normal, and that no visual adjustment was needed. Automated fault-injection and external-provider test boundaries remain documented separately.

Sequence capability archival after the already-merged android-storage-path-alias delta, never concurrently. Historical preservation evidence is not rewritten. Discarded local data has no rollback; a forward fix must keep the new storage.
