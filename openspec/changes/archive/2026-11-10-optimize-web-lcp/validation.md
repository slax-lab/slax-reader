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

## Anonymous root follow-up (2026-11-10)

Branch `fix/optimize-web-lcp` starts at `origin/dev` commit `6016ee48`.
Only an initial top-level `/` document with a confirmed absent token can
newly bypass PowerSync. Root remains a private destination after sign-in.
The existing auth middleware takes precedence over the document-exit guard
for a bypassed anonymous root, including a root whose query or fragment
resembles an auth route.

### Browser comparison

Compared matched production-profile builds on the same loopback origin, with
synthetic configuration, fresh Chromium contexts, service-worker bypass,
and 105 ms of added delay for served non-HTML resources. Each pair alternated
baseline and changed run order. The baseline Web sources, shared packages,
tooling, and lockfile match `6016ee48`. Timings are measured from initial
navigation to `/`. The LCP values below are local browser samples.

| Metric | Baseline median | Changed median | Difference of medians |
| --- | ---: | ---: | ---: |
| Login LCP | 2,532 ms | 2,020 ms | 512 ms earlier |
| Google Login button visible | 2,410 ms | 1,799 ms | 611 ms earlier |
| PowerSync database worker requested before login | 5/5 | 0/5 | 5 fewer runs |

All five changed navigations reached login in the original document, with no
Inbox view request. The emitted fetch/image preload hints in `/` and
`/login` matched the baseline. The SDK imports are still eager.

Built-browser checks also passed for an existing session opening the root
(Worker initialized and Inbox mounted), direct anonymous login and guide
entry (no Worker), and anonymous `/bookmarks` (existing startup and redirect).
A root query containing both `/login` and `/auth` reached login without a
reload and retained its query and fragment. A simulated Google OAuth return
entered the real `/auth` page, persisted a fixture session through the
session endpoint, and opened a fresh authenticated root document with its
original path, query, and fragment. A cookie appearing inside an already
bypassed document also required a fresh document when navigating to the root.
Both return cases initialized the Worker and mounted Inbox. External OAuth,
session and sync services used fixture responses.

### Automated checks and review

- Four auth middleware regressions reproduced the query, anchor and
  newly-present-session edge cases before the fix. The policy regression also
  reproduced anonymous root taking the old startup path.
- Focused Vitest passed across 18 files: 270 tests passed and 2 skipped.
  Coverage includes local database startup and recovery, extension bridge,
  BFCache restoration, login, session, attribution, onboarding, and Inbox.
- Web production build, Web typecheck, changed-file ESLint, and strict
  OpenSpec validation passed.
- Local Bugs, Security and Compliance review found the existing auth
  query/anchor shortcuts could let a bypassed root reach the exit guard and
  reload repeatedly. The fix is scoped to a bypassed root and reuses the
  original login continuation. Review found no remaining Important issues.
  The bypass does not grant access to local data, and session cookies that
  are present or throw on read still take normal initialization.
- The browser fixture exercised the Web callback and Inbox startup with a
  synthetic session. Real Google authorization, live PowerSync replication,
  installed-extension integration, and deployed field LCP remain unmeasured.
  Extension and restore behavior were covered by focused automated checks.

### Same-URL fragment reload regression

An edge-case review reproduced a late session cookie on a bypassed root
with a fragment. Chromium treated the existing external navigation to
that exact URL as same-document navigation, so the Inbox did not mount.
The guard now explicitly reloads the current document when the validated
destination is its exact URL and it has a fragment.

On the rebuilt production profile, headless Chromium 157 used a test-only
cookie write immediately after the startup predicate chose bypass. It
recorded one initial document and one reload, with the Worker requested
only after the reload. Inbox mounted with the original query and fragment.
Plain anonymous root and anonymous root with an auth-like query and a
fragment each reached login in one document without a Worker. Root with
an existing session mounted Inbox in one document. A simulated OAuth
callback and a signed-in transition from the bypassed login document each
entered a fresh Inbox document with the original query and fragment.
All six runs completed without browser exceptions. OAuth and sync services
used fixture responses.

The navigation regression failed before the fix and passed afterward.
The focused suite passed 271 tests with 2 skipped. Production build,
Web typecheck and ESLint for both files touched by this fix passed.
