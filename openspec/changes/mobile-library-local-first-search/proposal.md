# Proposal

## Why

Returning Mobile users still experience delayed library content and missing avatars, and cannot search their local library without opening individual sources. The requested correction combines immediate admitted local presentation, a fullscreen local-first search, faster list/PDF acquisition, and exclusive drawer interaction.

## What Changes

- Render an authenticated library from admitted local data before network refresh/sync, preserve useful snapshots across focus changes, and persist avatar resources across process restarts. Keep recovery and account isolation explicit.
- Add a search button beside the Inbox add button and a native fullscreen search route with an input, submit action, horizontally scrollable tag picker, editable tag chips, and Collection/RSS source sections.
- Search local bookmark/collection/RSS metadata while typing. Explicit submit also searches the current user's saved titles and bodies remotely, then merges compatible results without duplicates or stale-query updates.
- Extend `/v1/bookmark/search` with optional tag UUID filtering using intersection semantics. Preserve existing keyword-only consumers and the current title-plus-body search, as confirmed by the human on 2026-10-21.
- Verify PDF extracted text through both URL and upload workflows into fulltext and vector retrieval; repair a reproducible missing-index path if found, without adding OCR or silently rebuilding production indexes.
- Keep the entire selected Library list available without pagination. Reduce the fields returned per row, separate lightweight download-state updates from article metadata, and preserve unchanged row references. Optimize the existing Range/PDF automatic cache scheduler; eligible PDFs begin caching while the library is visible and Reader reuses missing-block work.
- Lock underlying library touch, swipe, long-press, scroll, and accessibility actions from drawer gesture activation through completed dismissal.

## Capabilities

### New Capabilities

- `mobile-library-search`: Fullscreen typed/tagged local search, source navigation, explicit cloud enrichment, result identity, and lifecycle.
- `owned-bookmark-search-filtering`: Backward-compatible account-owned, tag-constrained fulltext/vector search.

### Modified Capabilities

- `mobile-app-parity`: Refine the library requirement for immediate cached presentation, persistent avatar/source presentation, automatic PDF acquisition, and drawer input exclusion while retaining all existing actions.

## Impact

- Mobile navigation, feature controllers, data repositories, image resource/cache adapters, library/drawer/list components, localization, and existing native/unit/host suites.
- API search controller/service/repository and shared request/response contracts; no expansion into other users' bodies or unsaved RSS cloud search.
- Reuse installed Expo Image, Reanimated, Gesture Handler, PowerSync and PDF transport/cache. No new dependency, synchronized schema migration, or list-library replacement is planned.
- Work stays in the user-selected primary worktree on the human-requested renamed branch `feat/expo-experience-ptimization`, preserving the uncommitted baseline from `feat/fix-spotlight-index`. This is an explicit checkout exception to the normal new-branch naming rule; the completed Spotlight artifacts remain unchanged.
- Existing unarchived `mobile-performance-lifecycle`, `pdf-bookmarks`, `rss-labs` and SDK-58 changes retain their capability ownership. This change references their cache/admission/reader contracts without creating competing deltas.
- Implementation was authorized after review; native performance, functional acceptance, human hands-on review, and the Mobile version/build decision remain delivery gates. No publication, deployment, push, or merge is included.

## Delivery follow-up — 2026-10-21

After implementation and the explicit build-only decision, the human authorized signed TestFlight delivery of `1.0.25 (782)`, then a Git commit/push of the current branch. This extends the original planning-only delivery scope; it does not authorize API deployment, production index repair, merging, or opening a pull request before human hands-on acceptance. Pending acceptance and performance tasks remain open.
