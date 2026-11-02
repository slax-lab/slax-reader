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
