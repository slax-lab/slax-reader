# Proposal

## Why

The reviewed 30-day Cloudflare report for `r.slax.com` shows LCP P75 near 3.34 seconds and 62% good experiences. Article images have substantial request-start delays, while small login/guide assets also appear late; the current source uniformly lazy-loads article images and awaits PowerSync initialization before client application mounting.

## What Changes

- Establish a reproducible baseline tied to the deployed revision, representative article/login/guide pages, and separate cold/warm navigation conditions.
- Replace blanket article-image lazy loading with a shared HTML5 policy that promotes at most one early substantive image, recognizes SSR-isolated icon classes, and preserves candidate identity through browser parsing. Catch up already-loaded/failed images without changing preview eligibility.
- Give anonymous top-level `/login` and `/guide` documents an early bypass in the existing PowerSync plugin, retaining static imports and avoiding a new serial runtime request. Preserve normal initialization for authenticated sessions, reader routes, and the extension bridge.
- Use a full document navigation when a bypassed public document enters another application surface. A companion BFCache restore listener re-enters normal startup if that document's token has appeared or cannot be read; unchanged anonymous restores keep the bypass. Preserve the current setup-time database injection model and keep local queries unavailable in the bypassed document for its entire lifetime.
- Deliver the article and public-startup policies behind independent build-time switches. Test all four combinations against the pre-change build and rehearse cached-share rollback before production enablement. Parser bytes and lifecycle fixes require implementation/deployment rollback when a flag is insufficient.
- Record an evidence-gated follow-up plan for document TTFB, image-cache tiers, historical beta-host URLs, and responsive media. Those backend/media changes are not implementation scope of this change.

## Capabilities

### New Capabilities

- `article-image-loading`: Bounded early image prioritization with deterministic markup and preserved article content.
- `public-page-startup`: Anonymous login/guide rendering independent of local database initialization, with safe navigation back into normal application startup.

### Modified Capabilities

None. Existing worker selection/recovery, account ownership, onboarding readiness, image sizing, session termination, and release contracts remain constraints. Active changes already own `web-local-sync`, `wechat-image-display-sizing`, and `inbox-onboarding-readiness`; this change does not duplicate their delta specifications.

## Impact

- Web: `BookmarkArticle.vue`, a shared image-policy utility, image processor completion handling, an early PowerSync plugin guard, route middleware, a companion client plugin for BFCache restore/navigation, build-time app configuration, and focused browser/unit tests.
- One proposed direct dependency: browser-compatible `parse5@8.0.1`, already present transitively in the lockfile, used with source locations to make candidate decisions without rebuilding article markup. The standalone probe is about 42 KB gzip; the revised proposal budgets at most 50 KiB incremental article-route gzip, subject to actual-build and slow-network LCP gates. SDK splitting and native-parser/source-mapping alternatives are not in this first release.
- No database schema, stored-body migration, API contract, image signature, source URL, or image-proxy response changes.
- No new visual theme, new monitoring service, or paid Cloudflare image service is required.
- Implementation checklist: [Web LCP implementation plan](../../../docs/superpowers/plans/2026-10-19-optimize-web-lcp.md). Engineering design, evidence, acceptance, sequencing, and deferred work: [design.md](design.md).

## Non-goals

Blanket eager loading; assigning high priority to every image; switching all routes to SSR; removing account/ownership checks; a reactive PowerSync migration across all consumers; video/poster changes; automatic image resizing/transcoding; bulk beta-to-production URL replacement; or deploying during proposal review. Engineering effort is now estimated at 4.5–8 days plus field observation, reflecting lifecycle, hydration, and rollback checks.

## Review boundary

This package is a proposal for human review. It does not establish that the source findings explain all historical slow visits. Implementation begins only after review; deployment and production effectiveness are separate later checkpoints.
