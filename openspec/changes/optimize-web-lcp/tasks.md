# Tasks

Execution details and file ownership are in [the implementation plan](../../../docs/superpowers/plans/2026-10-19-optimize-web-lcp.md). Checked tasks record completed work; outstanding field/release tasks remain separate from the bounded follow-up.

## 1. Baseline and feasibility

- [ ] 1.1 Record deployed/source revisions, report filters, pre-change build identity, route/device/network/cache conditions, and traces in `docs/web/performance/lcp-baseline.md`; separate measurements from historical hypotheses.
- [x] 1.2 Create synthetic article fixtures for icons before heroes, SSR-isolated/social classes, responsive sources, malformed browser repairs, duplicate attributes, and custom media; verify fixtures contain no production credentials or private article text.
- [x] 1.3 Probe the actual article-route dependency closure and parser runtime before full integration; verify at most 50 KiB incremental gzip and below-10-ms median on the fixed fixture, record slow-device effects, and stop/revise the article milestone if infeasible.
- [x] 1.4 Ship both switches enabled by default in every profile (`true`), with no environment gating; confirm the emitted app config in both the `production` and `preview` builds.

## 2. Article loading policy and lifecycle

- [x] 2.1 Implement and test the shared HTML5/source-location policy; verify early-content limits, class-prefix exclusions, responsive-substantive-image stop boundaries, attribute uniqueness, unchanged non-policy bytes, and no browser-repair candidate switch.
- [x] 2.2 Correct image processor completion ordering and repeat safety; test load before/after setup, prefailed images, later reload, repeated processing, source normalization, preserved preview eligibility, and current WeChat frames/icons.
- [x] 2.3 Integrate `BookmarkArticle.vue` and the two app-config switches; verify actual SSR processing, browser body restoration, `/s/**`, client refresh, and PDF/PhotoSwipe behavior with real-browser hydration coverage.
- [ ] 2.4 Verify image preview, selection/highlights, visual themes, request identity, layout shifts, and parser/route-byte gates after integration and after release (the switches ship enabled); retain evidence and disable the switch in `apps/web/app/app.config.ts` if any gate fails.

## 3. Anonymous public startup

- [x] 3.1 Implement exact route/three-state-token/top-level predicates and tests; verify disabled, token-read failure, authenticated, iframe, bridge, and query lookalike cases never enter the bypass incorrectly.
- [x] 3.2 Add an early guard to the existing statically imported PowerSync plugin without runtime extraction; name it `slax:powersync` for explicit restore-plugin ordering. Real-plugin tests must prove zero constructor/init/migrate/connect/clear calls, no ownership claim, preserved old-account storage, and normal/fallback providers otherwise.
- [ ] 3.3 Add the public-exit middleware after auth plus `powersync-public-restore.client.ts` explicitly depending on `slax:powersync`. Share its app-scoped navigation guard with the middleware. On persisted BFCache restore, `absent` keeps local queries unavailable; `present` or `error` causes one full navigation to the current fullPath. Verify pagehide/reset and leave/back/leave cycles, concurrent exits, failure recovery, listener cleanup/HMR, normal/non-persisted events remaining inert, and no database reinitialization or destination local-query mount in the bypass document.
- [ ] 3.4 Run recovery/worker/bridge/auth/onboarding tests and login/guide/account-switch flows; compare normal-session startup to the pre-change build and prove no new serial runtime download.

## 4. Integration, release, and review evidence

- [ ] 4.1 Compare pre-change plus off/off, on/off, off/on, and on/on builds; verify image/public mechanisms separately, normal app-mount/local-query timing, LCP/CLS, and interactions against the design's numeric gates. Since both switches now ship `true` without gating (decision of 2026-11-02), the off/off, on/off and off/on builds can only be produced by editing `apps/web/app/app.config.ts`; record each build's identity.
- [ ] 4.2 Run the beta/test rollback drill (now a post-release verification rather than a pre-enablement gate, per the 2026-11-02 decision); verify warmed owner/visitor and fresh share responses, effective build/attributes, old hashed-asset availability, and measured purge/expiry convergence. Rollback is a source change to `apps/web/app/app.config.ts` plus a deployment.
- [x] 4.3 Run Web typecheck, tests, build, and strict OpenSpec validation; document results and resolve Important findings through all local `REVIEW.md` passes before pushing behavior changes.
- [ ] 4.4 Record per-switch enablement and rollback decisions and prepare the `dev` PR with `OpenSpec: optimize-web-lcp`; distinguish flag rollback from implementation/deployment rollback and obtain later deployment authorization.
- [ ] 4.5 After authorized release, verify effective builds before collecting matched 7-day cohorts and 30-day trends; keep mixed-build, small, or shifted samples inconclusive and retain the outcome record.

## 5. Approved bounded follow-up (2026-11-02)

- [x] 5.1 Add failing banner/hero and author-read regressions, then implement bounded two-image loading and author-profile reuse without changing permissions or SQL.
- [x] 5.2 Validate raw/SSR/restored markup, reviewed article samples, promotion breakpoints, source identity, and parser overhead in running fixtures; record limitations.
- [x] 5.3 Run Web/API tests, type checks, Web build, backend generators, strict spec validation, and independent Bugs/Security/Compliance review; resolve Important findings and update PR #449.

## 6. Archive

- [ ] 6.1 After the task pull request merges, archive this change through a docs pull request.
