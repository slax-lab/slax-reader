# Proposal

## Why

Reader currently stores each user's normal captures privately, but it has no way to copy a readable `/b/<user-bookmark-uuid>` snapshot into another user's library. Mobile visitors also lack a convenient way to save another Reader user's article. This change adds a private snapshot-copy flow while preserving per-user isolation and making same-user same-URL writes consistently use the newest successful data.

## What Changes

- Add a private Fork API that copies readable Reader snapshots without fetching the original web page.
- Add lineage metadata so a destination can show its current `Fork:` source while retaining source-display privacy rules.
- Make same full URL plus same positive `private_user` a single current destination: a newer direct capture or Fork overwrites the older content and metadata while preserving the destination Reader UUID.
- Copy HTML, text, and supported PDF sidecars to destination-owned/versioned R2 objects with publish-safe failure recovery.
- Recognize strict Reader `/b/<uuid>` URLs before ordinary URL policy/crawl processing and route them to Fork.
- Add a responsive Web Fork action and Source/Fork attribution metadata.
- Preserve historical `private_user = 0` rows and their compatibility behavior; they are never overwrite targets for new private writes.

## Capabilities

### New Capabilities

- `bookmark-fork`: Private Reader snapshot copying, lineage, same-URL overwrite semantics, and access/privacy behavior.

### Modified Capabilities

- None. Existing repository behavior is covered by implementation tests; no existing OpenSpec capability currently describes bookmark capture semantics.

## Impact

- API: bookmark controller, bookmark service/repositories, contracts, URL parsing, generated router/DI artifacts.
- Storage: PostgreSQL schema/migration for current lineage and write/version state; R2 versioned content objects and cleanup metadata.
- Processing: crawl workflow write-version checks and content publication/read-path alignment.
- Web: `/b/[id]` metadata, top-bar Fork action, attribution rendering, localization, and REST path contracts.
- Validation: API domain/controller tests, concurrency/overwrite/R2 failure tests, Web component/page tests, OpenSpec validation, typecheck and lint.
