# Validation

## Scope

Base: `origin/dev`, branch `fix/subscription-status-retry`. Web only (`useUserRelative.ts` and its tests); no API, contract, Extension, or Mobile change. Web carries no package version.

## Automated evidence

| Check | Result |
| --- | --- |
| `pnpm web -- test` (full Vitest) | 273 files passed, 1 skipped; 3,349 tests passed, 3 skipped. |
| Web `typecheck` (`nuxt prepare` + `vue-tsc --noEmit`) | Passed. |
| ESLint on changed files | 0 errors. Two existing `no-explicit-any` warnings on line 6 of `useUserRelative.spec.ts`, unchanged by this diff. |
| `openspec validate --all --strict` | 165 passed, 0 failed. |
| New tests that fail on the old code | "checks again after a generation bump left the decision pending" and "reports an error with retry when the check after the bump fails" fail before the fix and pass after it. "does not loop when each failed check invalidates the identity again" fails on the first version of this fix (unbounded requests) and passes on the final one. |

## Running environment

Everything ran locally against a real backend: `pnpm api -- dev` (Core Worker on `localhost:8787`, PostgreSQL and PowerSync in local Docker), and a production-mode Web build served by `wrangler pages dev` with the `BACKEND` service and `OSS` R2 bindings. Chrome ran through DevTools in an isolated profile with a local account signed in through the email-link flow. That account has no subscription, so the expected decision is `inactive`: Chat opens the subscription modal.

A same-account generation bump was forced on `/b/[id]` after the page loaded: an init script made the next `/v1/user/me` fetch reject with a network error, and the page called `refreshServerUserInfo()`, whose failure path runs `invalidateServerUser()`. Chat was then clicked and the panel sampled every 500 ms.

| Build | Account context after the forced failure | Requests to `/v1/user/me` | Chat |
| --- | --- | --- | --- |
| Unfixed `origin/dev` | generation 0 → 1, status `local`, still `local` 36 s later | Initial load and the forced failure only; no further check | "正在确认订阅状态…" (Checking your subscription…) for the whole 36 s observed, no retry offered |
| Fixed | generation 0 → 1, status `local`, then `ready` | Initial load, the forced failure, and one new check started by the watcher | Subscription modal opens on click; the checking text never appears |

### Review finding: a failing service caused a request loop

The local `REVIEW.md` pass ran the same page with every `/v1/user/me` fetch rejected. The first version of this fix looped: each failed check invalidates the server user, which bumps the generation, and the watcher started another check for every bump. The tab's renderer stayed at 100% CPU and stopped answering DevTools until it was killed. The final version records the identity each check ends under and ignores that generation change, and bounds follow-up checks started by identity changes during a check to two, after which the reader sees the error state.

| Final build, every profile read failing | Result |
| --- | --- |
| Requests after the forced failure, sampled each second for 5 s | 2 in total (the forced failure and one follow-up check), unchanged afterwards; generation +2. |
| Chat | "暂时无法确认订阅状态，请重试。" (Unable to check your subscription) with the retry button. |
| Network restored, retry clicked | One more request; status `ready`; subscription modal opens. |

The single-failure scenario from the table above was rerun on the final build with the same result: one follow-up request, status `ready`, modal opens, no checking text.

## Not verified

- The natural cold-start trigger. The earlier test-environment pass saw the stuck state on a slow cold start, but which call bumped the generation there was not isolated; the forced invalidation above reproduces the same state.
- A subscribed account (Chat panel opening for an active subscriber); the local account is unsubscribed. The `active` branch is covered by the unit tests.

## Human acceptance

On 2026-11-23 the change requester reviewed these results and the local build at `http://localhost:3000` (signed in as the local test account), and approved opening the pull request. No adjustments were requested.
