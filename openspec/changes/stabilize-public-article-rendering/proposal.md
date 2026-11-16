# Stabilize public article rendering

## Why

The November 13 production investigation confirmed that Vue hydration rewrites `BookmarkArticle`'s unchanged `v-html`, replacing already painted text and image nodes. Podcast and Mole pages also retain slow document/image paths. The short WeChat article provides a third regression control. This follow-up implements the four-item plan approved in conversation on November 13, 2026, after the earlier proxy/projection/player PR #564 merged.

## What Changes

- Adopt unchanged SSR article nodes with a component-local HTML directive, while retaining complete SSR output, real content updates and the existing processor/annotation/media order.
- Extend existing non-production request timings to attribute access, metadata and warm HTML delivery without changing queries, access decisions or caching policy.
- Populate the existing edge image cache on eligible R2 image hits.
- Retain validated intrinsic dimensions for the exactly identified, unsized FxEmbed article cover during new captures.

## Impact

Affected owners are the Web article component and share cache, API access/content orchestration, image proxy and X article capture. No dependency, schema, public startup route, global directive, production configuration, canonical snapshot migration or direct-origin image delivery is introduced. Existing R2 snapshots are not rewritten: any later repair needs a separate bounded revision-aware dry run.

This work is sequenced after the merged implementation of `optimize-public-article-lcp`; it does not edit that change's deltas or claim its unresolved field outcome. The target remains LCP Good at least 70% separately for podcast and Mole families under the existing outcome contract. Offline mechanism checks are not a field-success claim.

Archive sequencing is separate from code sequencing: archive `optimize-public-article-lcp` before this change, classifying every unchecked task under the existing archive procedure first. The shared `public-article-delivery` and `image-proxy-reuse` deltas must not be archived in parallel. This follow-up does not mark the earlier change's multi-condition verification or field tasks complete.

## Approval

The user approved the revised four-item plan in conversation and requested a fresh branch/worktree and implementation, with particular attention to highlights, image preview and podcast play/seek/resume. No layout or interaction redesign is proposed.
