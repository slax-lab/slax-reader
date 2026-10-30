# Validation evidence

This file records the evidence for the branch-environment gating added to
`lcp.articleImagePriority` and `lcp.anonymousPublicStartup` (task 1.4). All
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

- `pnpm exec openspec validate --all --strict` — 87 passed, 0 failed.
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
  `index.d.ts`, `BookmarkArticle.spec.ts`) — clean.

## Switch gating (task 1.4) — build-profile verification

Built the Web app twice with `apps/web`'s real `nuxt.config.ts`/`app.config.ts`
and synthetic required env vars, then inspected the emitted bundles directly
(not just the source):

```bash
SLAX_ENV=production PUBLIC_BASE_URL=https://example.test AUTH_BASE_URL=https://example.test \
  SHARE_BASE_URL=https://example.test DWEB_API_BASE_URL=https://api.example.test \
  COOKIE_DOMAIN=example.test COOKIE_TOKEN_NAME=token GOOGLE_OAUTH_CLIENT_ID=example-client \
  NUXT_TELEMETRY_DISABLED=1 pnpm --filter @apps/slax-reader-dweb build
```

- Client bundle (`dist/_nuxt/*.js`): `articleImagePriority:!1`,
  `anonymousPublicStartup:!1` (both `false`), no leftover `__SLAX_LCP_*`
  placeholder text anywhere in `dist/`.
- **Server bundle** (`dist/_worker.js/chunks/virtual/entry.mjs`, which actually
  renders the SSR routes `/dashboard`, `/b/**`, `/c/**`): also
  `articleImagePriority:!1`, `anonymousPublicStartup:!1`. This matters because
  `vite.define` is a build-time replacement applied per Vite "environment"
  (client and server are separate environments in Vite 8); checking only the
  client bundle would not have proven the SSR-rendered routes see the same
  value. No leftover placeholder in the server bundle either.

Repeated with `SLAX_ENV=preview` and the same synthetic env vars:

- Client bundle: `articleImagePriority:!0`, `anonymousPublicStartup:!0` (both
  `true`).
- Server bundle (`dist/_worker.js/chunks/virtual/entry.mjs`): same, `!0`/`!0`.

Both builds were deleted after inspection (`dist/` is gitignored and was never
committed).

## Outstanding

- A `preview`-environment smoke pass confirming both LCP switches behave as
  intended with the switches actually on (article image priority, anonymous
  public startup bypass), per the design's existing measurement-gate
  language. Not required for `DESIGN.md` §10.2 — this change introduces no
  new UI, only a build-time default for two switches that already shipped
  behind app-config booleans.
