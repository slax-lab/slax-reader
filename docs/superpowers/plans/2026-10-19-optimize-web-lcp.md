# Web LCP Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce avoidable article-image request delay and anonymous login/guide database waits while preserving reading behavior and account isolation.

**Architecture:** Use one shared HTML5 fragment parser and source-preserving attribute edits before rendering. Make the existing image processor handle already-settled resources. Add an early anonymous guard to the current static PowerSync plugin and require a document navigation when leaving bypassed surfaces. Two build-time flags control policy enablement; lifecycle/parser regressions require code/deployment rollback.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Cloudflare Pages/Workers, PowerSync Web, Vitest, `parse5@8.0.1`, controlled real-browser traces.

**Spec:** [Proposal](../../../openspec/changes/optimize-web-lcp/proposal.md), [design](../../../openspec/changes/optimize-web-lcp/design.md), [article contract](../../../openspec/changes/optimize-web-lcp/specs/article-image-loading/spec.md), [public startup contract](../../../openspec/changes/optimize-web-lcp/specs/public-page-startup/spec.md).

## Global Constraints

- At most one eligible article image gets eager/high priority. No stored-body, image signature, source URL, API, database, or visual-design migration.
- Anonymous bypass is exactly top-level `/login` or `/guide`, with optional trailing slash and no token. Keep PowerSync static imports and its normal initializer context.
- Preserve image-preview eligibility, WeChat icons/frames, selection anchors, PDF/custom media, account ownership, recovery, extension bridge, and onboarding readiness.
- Both app-config flags start false. Flags do not necessarily remove parser download cost or revert lifecycle corrections. Compare against pre-change, not just flags off.
- Article-route incremental gzip ceiling: 50 KiB across its initial dependency closure, including shared chunks once. Report Brotli too. Fixed 100 KB/100-image transform median: below 10 ms. Slow-device traces and LCP gates still apply.
- Hold repeatable median LCP, app-mount, or first-local-query regressions greater than both 100 ms and 5%, new layout shifts, new interaction long tasks, or functional regressions.
- Follow `DESIGN.md`, `REVIEW.md`, OpenSpec, and promotion rules. Read no secret files. Durable documentation and commits use English.
- Use pinned pnpm and a supported Node LTS (`^22.22.2 || ^24.15.0 || >=26.0.0`; not Node 25).
- This revision is planning only. Implementation and remote rollout require subsequent authorization.

## Review Focus

- Completion before image-handler registration: Task 3 must preserve preview eligibility, settle loading/error state, and tolerate reruns.
- Class isolation and browser repairs: Tasks 2/4 must compare actual SSR pipeline output, browser-restored DOM, and raw SPA input, not just two calls on the same string.
- Parser transfer cost and source normalization: Tasks 1/2/4 must include the pre-change bundle and responsive-source controls; do not hide a regression by raising a budget during implementation.
- Existing user data and normal startup: Task 5 must open no database on bypass and preserve normal static startup/ownership elsewhere.
- Redirects, BFCache, and cached rollback: Tasks 6/7 must exercise real navigation plus a `pageshow` restore with account transition and warmed owner/visitor responses before production, not rely on mocked navigateTo or purge acceptance alone.

---

## Task 1: Capture the baseline and parser feasibility

**Files:** Create `docs/web/performance/lcp-baseline.md` and synthetic fixtures under `apps/web/tests/fixtures/article-loading/`. Raw traces containing private material stay outside committed files.

**Interfaces:** Produces a build/trace manifest, parser probe, fixtures, and a go/no-go decision for the article milestone. It does not create a telemetry API.

- [ ] Record deployed/source revisions and report filters. Keep historical LCP data distinct from matching source/build measurements.
- [ ] Create ordinary, WeChat, tweet, text-heavy, raw/oc-prefixed avatar, profile/header, hidden/aria-hidden, source-set/picture, malformed table/paragraph, duplicate-attribute, SVG/MathML, and custom-media fixtures using synthetic sources/signatures.
- [ ] Capture at least five interleaved comparable runs per key condition using the design matrix. Include login/guide plus authenticated Inbox, article, share, guide, bridge, and text-heavy controls; record cold/warm browser and edge/SW state separately.
- [ ] Probe parse5 in a representative production article dependency graph before full integration. The earlier standalone probe was 41,998 gzip bytes; it is not the application delta. Check the 50 KiB total incremental ceiling and fixed-fixture timing. If a gate fails, stop the image milestone and revise; continue independent public-startup work only within authorized scope.
- [ ] Record facts, hypotheses, missing evidence, and exact reproduction commands. No production reproduction means no enablement decision.

## Task 2: Implement the shared source-preserving policy

**Files:** Create `apps/web/app/utils/articleImageLoading.ts` and `apps/web/tests/unit/utils/articleImageLoading.spec.ts`; modify `apps/web/package.json` and `pnpm-lock.yaml` for direct `parse5@8.0.1`.

**Interfaces:** `applyArticleImageLoading(html: string, options: { enabled: boolean; excludedPresentation: boolean }): string`. Use explicit div-fragment context, scripting enabled, and source locations on both platforms. The exact 600-code-point and 96px rules are in the design.

- [ ] Add failing tests for one candidate, 599/600 boundaries, hidden ancestry, aria-hidden-only large images, pixel/max-size icon constraints, raw/oc-prefixed and social-header classes, responsive-substantive-image stop boundaries, and absent candidates. A tall/unknown-size responsive first image followed by a plain image must promote neither; an excluded responsive icon must not suppress a later real hero.
- [ ] Add tests for browser-equivalent repaired tree order, duplicate policy attributes, quoted greater-than signs, signed queries, implicit tbody, missing image source spans, and fallback without body loss. Assert unchanged non-policy bytes and repeat idempotence for enabled supported inputs.
- [ ] Implement tree-based evaluation and right-to-left attribute-span patches. Never serialize the whole article, match by source ordinal, trust preexisting high priority, or use the old blanket regex for enabled supported content.
- [ ] Run `pnpm web -- test tests/unit/utils/articleImageLoading.spec.ts` and record the fixed-fixture transform benchmark. Retain the feasibility gate. Commit policy, fixtures, dependency, and tests together.

## Task 3: Make the image processor robust to completion timing

**Files:** Modify `apps/web/app/components/Article/processors/image.processor.ts` and `apps/web/tests/unit/components/Article/processors/image.processor.spec.ts`.

**Interfaces:** Keep the processor/context/callback API unchanged. Introduce a local repeat-safe completion/error path shared by future events and already-settled resources. Preserve the existing medium-image/WeChat/PhotoSwipe preview and sizing decisions.

- [ ] Reproduce load-before-setup versus load-after-setup: both eligible images must clear loading and open one preview. Add already-failed, error-after-registration, error-then-valid-reload, rerun, tiny/medium excluded images, and source-normalization cases.
- [ ] Install handlers and initial loading state before checking settled success. After current source normalization, run the same eligible completion path for an already-loaded resource; distinguish pending replacement from a settled failure. Do not unconditionally bind preview to previously ineligible images or leave permanent per-element success flags across source changes.
- [ ] Run `pnpm web -- test tests/unit/components/Article/processors/image.processor.spec.ts`, preserving all existing WeChat/icon/frame behavior. Verify repeated setup and clicks do not duplicate callbacks or cleanup work. Commit the lifecycle change independently; it remains active even with priority off.

## Task 4: Integrate and verify SSR, hydration, and client refresh

**Files:** Modify `apps/web/app/components/Article/BookmarkArticle.vue`; create `apps/web/app/app.config.ts` and `apps/web/tests/unit/components/Article/article-loading.spec.ts`. Existing class-isolation, SSR runner, strip/restore, and custom-media processors are integration constraints. Capture real-browser hydration evidence in the baseline document using the repository's existing browser/E2E harness.

**Interfaces:** Task 2's shared transform; app-config keys `lcp.articleImagePriority` and `lcp.anonymousPublicStartup`, initially false.

- [ ] Add failing integration cases covering raw API body → actual SSR class/blank-mark processors → initial HTML → real browser innerHTML → restore plugin → hydration, plus `/s/**`, SPA refresh, disabled, PDF, and PhotoSwipe. A string-only or Happy DOM-only test does not prove browser repair/hydration behavior.
- [ ] Integrate the computed transform with existing presentation detection and app config. Preserve the prior loading-attribute path when disabled/excluded.
- [ ] Verify candidate/resource/priority consistency on real browser repair fixtures, no hydration replacement, no source URL rewrite, and no new responsive-source double request. In browser request logs verify the parser itself performs no resource I/O.
- [ ] Run focused integration/processor tests, production bundle comparisons, slow-network/CPU traces, and 390/768/1440-width preview/selection/theme checks. Commit only when correctness gates pass; keep priority disabled until mechanism/overhead gates pass too.

## Task 5: Add anonymous bypass in the existing PowerSync plugin

**Files:** Create `apps/web/app/local-first/public-startup-policy.ts`, `apps/web/tests/unit/local-first/public-startup-policy.spec.ts`, and `apps/web/tests/unit/plugins/powersync-public-startup.spec.ts`; modify `apps/web/app/plugins/powersync.client.ts`. Do not create a powersync-runtime module.

**Interfaces:** Pure functions `isFastPublicPath(pathname: string): boolean`, `shouldBypassPublicDatabase({ enabled, pathname, topLevel, tokenState }): boolean` with `tokenState: 'absent' | 'present' | 'error'`, and `needsPublicDocumentExit(bypassed, destinationPath): boolean`. Existing injection providers stay; add boolean `powersyncPublicBypass` in bypass, normal success, and normal fallback branches.

- [ ] Test exact paths/trailing slash, disabled flag, token, token-read exception, iframe/bridge, `/login-extra`, and query lookalikes. Classify the initial document, not a future router destination. Catch token-read exceptions into `tokenState: 'error'`; only `'absent'` can bypass, and no error is converted to an absent/falsy token.
- [ ] Test the actual plugin with database constructor/init spies that would stall or throw if reached. Anonymous login/guide must resolve without constructor/init/migrate/connect/clear, keep old-account storage unchanged, and leave ownership unset. Module evaluation remains allowed.
- [ ] Insert the guard before connector/database construction, retaining static imports, normal Nuxt plugin context, bridge handshake behavior, ownership/version checks, normal cleanup, and fallback providers. Give the plugin the explicit Nuxt name `slax:powersync` so Task 6 can depend on completion without relying on filename sorting.
- [ ] Run plugin tests and `pnpm web -- test tests/unit/local-first`; verify production worker selection in a production-like build. Compare normal-route startup/request graphs to pre-change and prove no new serial runtime chunk. Commit independently.

## Task 6: Guarantee normal startup before leaving a bypassed document

**Files:** Create `apps/web/app/middleware/powersync-public-exit.global.ts`, `apps/web/app/plugins/powersync-public-restore.client.ts`, `apps/web/tests/unit/middleware/powersync-public-exit.spec.ts`, and `apps/web/tests/unit/plugins/powersync-public-restore.spec.ts`; extend existing auth middleware tests as needed.

**Interfaces:** Task 5's predicates and immutable per-document bypass marker. The restore plugin declares `dependsOn: ['slax:powersync']`, captures router/Nuxt context, and provides an app-scoped `powersyncPublicNavigate` guard used by the client-only exit middleware after auth. The middleware returns its guarded external-navigation result; duplicate requests also abort destination SPA mounting. A removable `pageshow` listener checks only `event.persisted` plus the bypass marker. A `pagehide` listener resets the latch for the next restored activation; navigation failure/cancellation resets it too. Retain listeners during BFCache freezing and clean up on teardown/HMR without installing unload handlers.

- [ ] Test login↔guide and query/hash SPA continuity; exits to root, bookmarks, article, share, and auth preserve fullPath. Normal documents never take this new path. Auth redirects are re-evaluated without loops. Restore a bypassed page through BFCache: absent token keeps local queries unavailable, while present/error causes exactly one full navigation to the current fullPath. Verify explicit plugin ordering, non-persisted events are inert, no in-place database initialization/marker mutation, and no destination local-query mount before normal startup.
- [ ] Verify leave/back/leave cycles reset the navigation latch; concurrent restore/route-exit and duplicate requests cannot mount destination consumers or navigate twice. Verify failure/cancellation recovery and listener cleanup/HMR. Capture real `pageshow.persisted === true` in browser evidence; history navigation without a BFCache hit does not satisfy this gate.
- [ ] Implement the boundary without changing existing redirect validation, query encoding, or campaign values.
- [ ] Run `pnpm web -- test tests/unit/middleware tests/unit/promotion tests/unit/plugins/powersync-public-restore.spec.ts`. Exercise real-browser Google/Apple login, invitation, guide exit, back, account switch, storage denial, and bridge flows. Verify destination local-query consumers cannot mount in the bypass document. Commit with tests.

## Task 7: Validate independent release and rollback

**Files:** Update `docs/web/performance/lcp-baseline.md`, app config only for justified enablement, and this change's task checklist. No new cache API or cache-key migration is included.

**Interfaces:** Pre-change plus `off/off`, `on/off`, `off/on`, `on/on` evidence and independent go/no-go decisions. Reversible behavior is separated from reversible implementation/download cost.

- [ ] Repeat interleaved comparable traces across all switch combinations. Record median/range; use 20+ repeats for small effects. Require earlier image initiation and public-page database independence, plus all normal-startup and interaction gates.
- [ ] Rehearse rollback in the authorized test/beta environment before production enablement. Warm both owner/visitor share variants with synthetic content; inspect fresh and warmed responses after a flag-off or known-good deployment and the existing purge. Record x-bcache/type, build/asset identity, attributes, old-asset availability, and actual convergence. Query params alone do not bypass the share cache.
- [ ] If purge eviction is unproven, allow the configured 600s after the final old-build write, including in-flight request drain, then verify expiry convergence. Do not treat this as a universal ten-minute guarantee for open tabs/SW/browser state. Hold release if convergence or asset compatibility fails; cache changes need a separate reviewed proposal.
- [ ] Run `pnpm web -- typecheck`, `pnpm web -- test`, `pnpm web -- build`, and `pnpm exec openspec validate --all --strict` with documented setup. Never read secret files to build a test environment. Report baseline failures separately.
- [ ] Complete all `REVIEW.md` passes, resolve Important findings, and prepare the `dev` PR with `OpenSpec: optimize-web-lcp`. Follow human-controlled promotion and later deployment authorization.
- [ ] After authorized release, verify effective builds before field comparisons. Record matched 7-day cohorts and 30-day trends; keep small, shifted, or mixed-build samples inconclusive. Record flag rollback versus implementation/deployment rollback as appropriate.

## Deferred Work and Handoff

TTFB, image cache refill, historical beta-host objects, responsive variants, video/guide tails, and any later SDK splitting remain evidence-gated follow-up changes. They do not enlarge the first-release implementation tasks automatically.

Revised effort: **4.5–8 engineering days**, plus at least 7 calendar days of field observation. The extra lifecycle, browser-repair, and rollback checks replace the earlier 3–6-day estimate. All tasks are pending; only the planning artifacts have been revised.
