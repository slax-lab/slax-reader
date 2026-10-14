# Validation

Verified on 2026-10-13 in the isolated `complete-extension-locale` worktree with Node 24.15.0 and pnpm 11.25.0. The existing `feat/sync-extension-locale` PR branch includes current `dev` at `b086da9`; the original working checkout was not edited.

## Provenance and adaptations

- Ported legacy frontend PR #1615, commits `b553ecb5` and `c1677360`, from the range `7a4bb109..c1677360`.
- Mapped Web, Extension, and frontend package paths to v2. Preserved v2's shared API contracts, component icons, build configuration, and Extension version 1.16.2.
- Reused `ApiResponse` through a type-only workspace development dependency. The lockfile adds only that workspace link; no external package version changed.
- Updated the browser fixture to validate the current package version and reject worktrees containing local environment files. All runs used synthetic localhost configuration and disposable accounts, without reading or copying secret files.

## Automated checks

| Check | Result |
| --- | --- |
| Pre-port Web user-store baseline | 55 tests passed |
| Pre-port Extension baseline | 18 tests passed |
| Final Web suite: `pnpm --filter @apps/slax-reader-dweb test` | 1,996 passed, 1 existing skipped test; 189 files passed, 1 skipped |
| Extension suite: `pnpm --filter @apps/slax-reader-extensions test` | 63 tests passed across 18 files |
| Web typecheck | Passed |
| Extension compile/typecheck | Passed |
| Frontend types and API contracts typechecks | Passed |
| ESLint on changed Web source and tests | 0 errors, 16 warnings |
| ESLint on changed Extension source and tests | 0 errors, 12 warnings |
| Frontend locale types lint | Passed |
| Chrome MV3 build | Passed |
| Firefox MV2 build | Passed |
| `openspec validate --all --strict` | 35 passed, 0 failed |
| `git diff --check` | Passed |

The skipped Web test is the existing login-navigation smoke test in `tests/app.nuxt.spec.ts`. Nuxt reported optional Turnstile/SEO configuration warnings under synthetic localhost settings. No failing tests or typecheck errors remain.

Regression checks were observed failing before the relevant fixes: same-option language retry, stale concurrent profile reads and offline fallback, expired-cookie cleanup, malformed or unrelated refreshed tokens, and startup refresh/read races. They pass with the implementation.

## Real browser integration

`pnpm --filter @apps/slax-reader-extensions test:locale:e2e` passed in Chrome 155.0.8059.40 using the built Extension, actual content scripts and MV3 worker, a local HTTP/SSE fixture, and a disposable browser profile.

- Chinese account language overrides an English browser on startup.
- A trusted Web invalidation updated two already-mounted collection interfaces in approximately 111 ms in the measured run, without remounting them.
- Collection completed normally after the switch. Share selections, an unsent comment, and input focus were retained.
- An active AI tool status changed language while preserving its query; failure cleared its loading state and the generated answer remained unchanged.
- Unsupported protocol versions were ignored.
- Same-account cookie rotation and API failure retained confirmed language; recovery, account switch, cache-generation reset, browser/worker restart with an unavailable API, and logout fallback all passed.

The browser fixture supplies the Web signal and account responses locally. Actual Web save ordering, notification timing, response envelopes, Pinia fallback, and session cleanup are covered by the Web tests. Production API connectivity, frozen/background-tab latency, a full 15-minute wall-clock alarm cycle, and Firefox runtime UI were not exercised; alarm restoration is unit-tested and Firefox is build-checked. The 111 ms observation is a local measurement, not a latency guarantee.

## Pre-push review

Completed Bugs, Security, and Compliance passes under `REVIEW.md`; matching change: `sync-extension-locale`. Independent review identified and verified fixes for:

- Older profile reads and offline fallback overwriting newer results.
- Expired current cookies bypassing session cleanup, including expiry during an in-flight refresh.
- Malformed, expired, or another-account refreshed tokens replacing the current cookie.
- Startup token rotation discarding the only profile load; recovery now retries once and remains bounded.

Re-review found no remaining Important findings. These fixes remain within the approved stale-request and account-isolation requirements. Archive is deferred until after PR merge.
