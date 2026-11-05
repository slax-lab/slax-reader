# Validation evidence

This file records the evidence for making `lcp.articleImagePriority` and
`lcp.anonymousPublicStartup` default to `true` in every profile with no
build-environment gating (task 1.4). All
commands were run on branch `fix/web-ui-switch-toolbar-lcp` locally with
synthetic environment values (`https://example.test`,
`https://api.example.test`); no real credentials or production data were
used.

Two unrelated bug fixes (a `SwitchToggle` loading-state regression and a
production CSS minifier dropping `backdrop-filter`) were found and fixed in
the same working session while reviewing these switches. They do not change
any `optimize-web-lcp` capability and are tracked on their own change,
`fix-web-ui-render-defects` (see that change's `proposal.md` and
`validation.md`), not here.

## Automated checks

- `pnpm exec openspec validate --all --strict` — 90 passed, 0 failed.
- `pnpm --filter @apps/slax-reader-dweb typecheck` (with `SLAX_ENV=preview`
  and synthetic required env vars) — passed.
- `pnpm web -- test` (with `SLAX_ENV=preview` and synthetic required env vars)
  — 224 test files passed, 1 skipped (one test file skipped entirely); 2559
  tests passed, 3 skipped. One test in
  `tests/integration/components/Article/BookmarkArticle.spec.ts` needed a fix:
  it asserted the disabled-switch fallback markup (`loading="lazy"`) but had no
  `useAppConfig` mock, so it silently inherited whatever `__SLAX_LCP_*` default
  the build profile set. Added an explicit mock pinning both switches to
  `false` for that file, matching its actual intent (verifying the fallback
  path, not the enabled path).
- `npx eslint` on the changed files (`app.config.ts`, `nuxt.config.ts`,
  `BookmarkArticle.spec.ts`) — clean.

## Switch defaults (task 1.4) — build-profile verification

Both switches are plain `true` in `apps/web/app/app.config.ts`. There is no
environment gating: on 2026-11-02 the human decided the switches ship enabled
in every profile and that a restriction gets added later only if one turns out
to be needed.

Verified on real builds of both profiles that the emitted app config carries
`true`, in the client bundle and in the server (SSR) bundle that renders the
SSR routes (`/dashboard`, `/b/**`, `/c/**`):

```bash
SLAX_ENV=production PUBLIC_BASE_URL=https://example.test AUTH_BASE_URL=https://example.test \
  SHARE_BASE_URL=https://example.test DWEB_API_BASE_URL=https://api.example.test \
  COOKIE_DOMAIN=example.test COOKIE_TOKEN_NAME=token GOOGLE_OAUTH_CLIENT_ID=example-client \
  NUXT_TELEMETRY_DISABLED=1 pnpm --filter @apps/slax-reader-dweb build
```

- `SLAX_ENV=production`, client bundle: `articleImagePriority:!0`,
  `anonymousPublicStartup:!0`; server bundle
  (`dist/_worker.js/chunks/virtual/entry.mjs`): same.
- `SLAX_ENV=preview`: client bundle `articleImagePriority: true`,
  `anonymousPublicStartup: true` (unminified); server bundle `!0`/`!0`.
- No `__SLAX_LCP_*` placeholder text exists anywhere in `dist/`.

Both builds were deleted after inspection (`dist/` is gitignored and was never
committed).

Note for the production-enablement decision: the switches are now active on
`r.slax.com` as soon as this merges to `main`, while the measurement gates in
`tasks.md` 2.4, 3.3, 4.1 and 4.2 remain open.

## Outstanding

- A `preview`-environment smoke pass confirming both LCP switches behave as
  intended with the switches actually on (article image priority, anonymous
  public startup bypass), per the design's existing measurement-gate
  language. Not required for `DESIGN.md` §10.2 — this change introduces no
  new UI, only a build-time default for two switches that already shipped
  behind app-config booleans.


## Approved bounded follow-up (2026-11-02)

The user approved this supplement on existing PR #449, branch `fix/web-ui-switch-toolbar-lcp`, based on `ee0e9709d73c6c964c97c9195b4a63a8d49005b5`. It adds the bounded banner/hero policy and internal author-profile reuse; the promotion change is tracked by `bookmarks-promo-eager`. No SQL, schema, cache validation, pool, production diagnostics, dependency, or shipped application version changes are included. Web/API are outside the CLI/Extension/Mobile version-bump requirement.

### Automated verification

- Before implementation, the new image tests failed in five banner/hero cases; the real access-resolver + UserService metadata tests failed in three cases because visitor author reads were doubled. The implementation made these regressions pass.
- Independent review reproduced five additional unsupported min/max-size cases. The added regressions failed before the fix; unsupported constraints now retain the conservative first-image choice.
- `pnpm web -- test`: **224 files passed, 1 skipped; 2,585 tests passed, 3 skipped**. The suite emitted a non-fatal happy-dom fetch-abort teardown diagnostic; the runner reported no failed tests.
- `SLAX_API_SKIP_DOTENV=1 pnpm api -- test`: **198 files passed, 14 skipped; 2,702 tests passed, 114 skipped**. Coverage includes shared read-access paths, owner/visitor metadata, disabled/global sharing, moderation, deleted bookmarks, and hidden profile/collection identity.
- Web and API typechecks passed. Production Web build passed after the review fix. Web commands used `SLAX_ENV=preview` for tests/types and `production` for build, with synthetic example.test configuration and telemetry disabled; no secret configuration was read.
- Changed Web runtime/test files pass ESLint. Changed API runtime files have zero errors and three existing unused destructuring warnings in the metadata projection (the fields are removed from the response).
- `pnpm api -- gen:all` passed with dotenv disabled, the checked-in `api.toml.example`, and synthetic database URL values; no database connection or migration was performed. Generated files produced no tracked diff.
- `pnpm exec openspec validate --all --strict`: **91 passed, zero failed**. `git diff --check` passed.

### Running-browser verification

The checked-in browser harness ran the production SSR processors through Miniflare's HTMLRewriter, the actual restore plugin, and Vue hydration in Chromium 156. It now re-applies the policy to the browser-restored body before hydration, matching BookmarkArticle's computed body, then separately transforms a raw client refresh.

All **17 fixtures** passed: same eager set and high candidate after restoration/hydration/refresh, unchanged image sources and DOM node identity, at most two eager / one high, and no hydration warnings. The three new banner/hero fixtures also passed at **390, 768, and 1440 CSS pixels**, checked from the document's actual width. This verifies loading policy and hydration; synthetic images are not a production LCP benchmark.

The promotion fixture was rebuilt from this PR's actual template, CSS, and VueUse expression. Chromium iframe cases passed at 390px Chinese and 920px English (hidden, lazy/auto), 921px Chinese and 1280px English (visible, eager/auto), and 1280px ineligible (no image). Locale sources and eligibility guards were preserved.

### Reviewed article samples and overhead

Replayed the six public article bodies retained from the earlier dashboard investigation. Indices below are zero-based. Every sample preserved all image sources and the non-policy DOM, and reapplication was idempotent.

| Article ID | Eager indices | High index |
| --- | --- | --- |
| 11860623-fece-409b-babd-171e9d2291a5 | 0, 1 | 1 |
| 69c8decc-fc4b-4bdc-93c4-543abcd5743d | 0, 1 | 1 |
| b40a8cd1-d9c1-4de5-93b9-ffdec5ae1a98 | 0, 1 | 1 |
| aa181615-53fb-4f6b-a08f-d477537e230b | 0 | 0 |
| b487fe5f-bce4-4d3c-8497-f7265e81ee78 | 0 | 0 |
| 3ab33018-d7ef-40f8-8f49-9e679646d35f | 0 | 0 |

The fixed 100,000-byte / 100-image benchmark (Node 24.15.0, macOS arm64, five warm-ups plus 100 runs) had **4.95ms median**, below the existing 10ms median gate; p95 was 16.81ms while other verification work was running. The isolated minified helper plus parse5 grew from 44,446 to 44,841 gzip bytes (**+395 bytes**). This is the helper delta, not a new measurement of the entire article route closure; the earlier route budget evidence remains separate.

Evidence is retained outside Git in this task's `lcp-investigation/followup-browser-results.json`, `followup-responsive-results.json`, `followup-sample-replay.json`, `followup-helper-budget.json`, and `promo-preview/followup-browser-results.json`. No public article text, production credentials, or screenshots were added to the repository.

### Review and limits

Independent Bugs/Security/Compliance review found one Important issue: relative min/max constraints could overestimate a thumbnail and move high priority away from the first image. It was fixed with conservative unknown-size handling and five regressions. The review also improved the harness's restored-body reapplication coverage. The independent follow-up review reproduced the corrected behavior and checked the raw browser results and command logs: **no remaining Important findings or Nits** across Bugs, Security, and Compliance. The declared integration/field gaps remain explicit.

- No production deployment or matched post-release LCP/TTFB measurement was performed. This removes one author lookup for visitors inside metadata generation; it does not remove the broader metadata/cache/SSR wait chain or guarantee a multi-second TTFB reduction.
- The API change was exercised with the real access resolver and UserService over repository doubles; no full Worker + live PostgreSQL deployment was exercised because this task has no configured local database runtime and secret configuration must remain private.
- The full authenticated promotion/API flow, image preview/highlight interactions, all visual themes, and low-end-device performance were not re-exercised. This supplement changes loading attributes and internal data reuse, not UI design, content, styling, sources, accessibility labels, or click handling. Existing PR switch/toolbar hands-on acceptance remains recorded under `fix-web-ui-render-defects` and is not claimed as acceptance of this supplement.
- Unknown geometry, unsupported constraints, text-heavy openings, and responsive images retain the existing conservative behavior. Saved geometry remains a heuristic; the selected image is not guaranteed to be the LCP element on every viewport or visit.
- Broader release/cohort/rollback tasks in this change remain open and are not represented as completed by these local checks.
