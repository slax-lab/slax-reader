# Proposal

## Why

The 2026-11-11 Cloudflare investigation found LCP Good rates of 23% for the reported podcast and 26% for the reported Mole X article, with document TTFB P75 above 3.2 seconds for both. The user confirmed a target of at least 70% Good experiences for these two article families across overall traffic; improving their actual readable first paint requires a bounded follow-up to PR #449.

## What Changes

- Establish separate, frozen podcast and X long-form article cohorts, retain the two reported URLs as canaries, and measure document timing, actual LCP elements, media failures, and interaction regressions before rollout.
- Create a Web response projection that omits the embedded `slax-private-snapshot` manifest while preserving the persisted snapshot, visible article DOM, playback attributes, translations, and fork behavior. A local compression probe reduced the reported podcast HTML from 288,153 to 130,790 gzip bytes; this is a byte result, not a measured LCP gain.
- Prevent another image-proxy wrapper around an existing configured proxy URL. Recover the observed nested signed image sources in Web responses without rewriting saved article bodies or weakening the existing media endpoint checks.
- Reduce measured synchronous work in the `/b` metadata/cache-validation path. Keep current authorization, revocation, moderation, and presentation freshness checks on every response; retain timing candidates only when measured benefit justifies their scope. A true cache miss already fetches metadata once; stale-hit metadata reuse is rejected because it needs a new cross-render transport.
- Preserve the native podcast player's `preload="none"` behavior for episodes with supplied duration, including correct playback and seeking before metadata. Keep existing metadata loading for unknown duration and revalidate saved progress against actual duration.
- Select additional client work only from paired traces: critical Nuxt scripts versus Rocket Loader, article DOM processing, player upgrade geometry, and offscreen layout. Broad PowerSync route changes and body virtualization are excluded from this change.
- Roll out measured mechanisms separately and assess the 70% target for each article family, not a traffic-weighted blend with faster collection/login pages.

## Capabilities

### New Capabilities

- `public-article-delivery`: Authorized, lean Web article delivery; readable SSR content; lazy media enhancement; and cohort-based LCP outcome verification.
- `image-proxy-reuse`: Idempotent proxy URL generation and bounded recovery of the observed nested signed sources in Web presentation.

### Modified Capabilities

None. Existing capture, snapshot authorization, podcast translation/playback, article selection, and PR #449 image-priority requirements remain in force. This change does not carry another delta for the active `article-image-loading` or `public-page-startup` capabilities.

## Impact

- Web: content loading, share-cache lookup, SSR article processing, image source projection, podcast custom player, browser verification fixtures, and performance evidence.
- API: image URL generation and focused metadata orchestration when profiling identifies reducible synchronous work. No database migration or public API contract change is planned.
- Cloudflare: a controlled Rocket Loader comparison may be prepared; production configuration changes require a reviewed release decision. No blanket cache rule is proposed.
- No new runtime dependency or shared-package expansion is planned. API signing/reuse stays in its existing image utility; Web presentation rewriting stays in the Web server layer. Indirect consumer effects remain part of verification.
- On 2026-11-11 the user authorized implementation after regression review and explicitly required existing names, files, call layers and responsibilities, minimal changes, and no incidental refactoring or speculative hardening. UI-visible fixes still require hands-on acceptance before the task PR opens. Implementation starts from current `origin/dev` on `perf/optimize-public-article-lcp`; no deployment or field outcome is claimed here.
