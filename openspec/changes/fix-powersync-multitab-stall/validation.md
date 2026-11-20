# Validation

Branch `fix/powersync-multitab-stall` from `origin/dev` `cabedb45`, uncommitted working tree at the time of recording. All data is synthetic; no real account, token, or production service was used.

## Automated checks

| Check | Result |
| --- | --- |
| `pnpm web -- typecheck` | pass |
| ESLint on changed Web sources and tests | pass |
| `pnpm web -- test` | 3171 passed, 3 skipped, 1 failed: `useSlaxRoutes.spec.ts > Nuxt 自动导入覆盖` timed out under full-suite load; it passes 6/6 alone and is unrelated |
| Gate unit spec (`powersync-visibility-gate.spec.ts`) | 6/6; the plugin spec asserting installation fails when the plugin change is removed |
| `node --test tooling/powersync-assets.test.mjs tooling/powersync-retention.test.mjs` | 28 pass, 0 fail |
| `pnpm web -- build` (beta profile) | pass; emits `_nuxt/worker-v5.js` with `no-cache, max-age=0, must-revalidate` |
| `node apps/web/tests/fixtures/powersync-release/browser-check.mjs` | passed (9 scenarios, including retained historical runtimes, shared-tab writes, freeze/resume, pending CRUD across close/reopen) |
| `pnpm exec openspec validate --all --strict` | 161 passed |

## Reproduction and comparison in real Chrome

Chrome 158 started without automation flags and driven over CDP; background tabs were confirmed `hidden`. Local acceptance environments ran production builds against the same synthetic backend: `dev` `cabedb45` (SDK 2.4.0, worker v4) on 4340 and this branch on 4330. Each run opens 8 owner `/bookmarks` tabs, keeps one in front, and then opens 3 new `/bookmarks` tabs; "local" means the new tab started its local database, "REST" means it timed out at 8 s and fell back.

| Scenario | `dev` (4340) | This branch (4330) |
| --- | --- | --- |
| Synchronization changes one of 3,000 bookmarks per second (3 runs, 9 new tabs) | 8 local in 0.8–5.3 s, 1 REST at 8.3 s | 9 local in 214–331 ms |
| Same, no extra bookmarks (1 run) | 3 local, 0.20–0.28 s | 3 local, 0.28–0.30 s |
| Idle background tabs, no synchronization changes | 2 runs local, 250–266 ms | 2 runs local, 275–320 ms |

Intermediate builds of this branch, kept as evidence for the design: gating only change re-runs and initial runs left `resolveTables` ungated; instrumented hidden tabs then held the connection 32–88 s and new tabs used REST in 3 of 3 idle runs. Gating `resolveTables` without the visibility settling interval left 1 REST fallback per churn run, traced to a hidden tab briefly shown while an adjacent tab closed (released reads held the connection 9–13 s).

Bare-SDK fixtures (no app code, 2.4.0 and 2.7.0) did not stall with 8 idle hidden tabs (11–27 ms), and frozen, closed, or crashed tabs, a syncing tab closed mid-apply, and a closed syncing tab with a remaining idle tab did not reproduce a stall.

## Behavior checks on this branch

- A bookmark renamed in the foreground tab is not shown in a hidden `/bookmarks` tab while hidden and appears within 10 s after the tab is activated, without a reload.
- Mixed release window (bare-SDK fixture): a 2.4.0 page on its v4 worker and a 2.7.0 page on its v5 worker initialized, read, and wrote the same database file without errors, before and after each other's writes; new pages of either version then started normally.
- Owner regression on the 4330 build (`selfcheck.mjs`, 8/8): highlight, archive, and star from `/b/e2e-snap` are uploaded through local synchronization and persist after reload; a visitor sees the owner's highlights without owner actions; anonymous HTML contains the article body; no page errors or 5xx responses.
- Production build log: `database ready {mode: shared, dbFilename: slax-reader-v3.db}`; the database filename is unchanged.

## Human acceptance

On 2026-11-20 the change requester was given the acceptance environments (`http://127.0.0.1:4330/__accept` for this branch, `http://127.0.0.1:4340` for `dev`) with step-by-step scenarios for multi-tab startup, background-tab refresh, owner writes, and visitor/anonymous views, and approved proceeding to the pull request. No adjustments were requested.

## Local review

Bugs, Security, and Compliance passes per `REVIEW.md`: no Important findings. Checked that hidden-tab writes still upload (uploads are triggered by the SDK's `crudUpdate` adapter listener, which is not gated), that held change notifications coalesce to at most one pending run per query, that a page starting visible is not delayed, and that the dependency changes are limited to the PowerSync packages and their bundled wa-sqlite.

## Not verified

- Safari, Firefox, and Android: the gate also runs in dedicated-worker mode, where hidden tabs do not share a connection; these browsers were not exercised.
