# Validation — 2026-10-27

## Change log

The response helper now merges custom headers with its defaults. Media responses retain JSON, CORS, and private cache headers. Both YouTube views expose exhausted request retries. Owners receive guidance for disabled Labs or missing source data. Stable slot containers prevent the compact-to-expanded transition from detaching Vue fragment anchors.

Branch: `fix/restore-media-article-recovery`. Base: `origin/dev` at `f217f465`.

## Automated checks

| Check | Result |
| --- | --- |
| Initial API regression run | 9 failed, 66 passed before the fix |
| Initial Web regression run | 6 failed, 31 passed before the fix |
| `pnpm api -- test` | 192 files passed; 14 skipped. 2,515 tests passed; 112 skipped |
| `pnpm api -- typecheck` | Passed |
| `pnpm api -- gen:all` | Passed; no generated diff |
| `pnpm api -- lint` | No errors; 344 warnings |
| `pnpm web -- typecheck` | Passed after the slot-container fix |
| `pnpm web -- test tests/unit/components/Snapshot tests/unit/utils/youtubeBody.spec.ts` | 11 files and 90 tests passed after the slot-container fix |
| `pnpm exec eslint 'app/pages/b/[id].vue' app/components/Snapshot/YoutubeArticleBar.vue app/components/Snapshot/YoutubeAiArticle.vue app/components/Snapshot/YoutubeArticleStatus.vue` from `apps/web` | Passed |
| `pnpm exec openspec validate --all --strict` | 79 items passed |
| `node apps/web/tests/fixtures/media-recovery/20261027-browser-check.mjs` | Both views passed retry and nine theme/width checks; no page errors |
| `git diff --check` | Passed |

## Running environment

Started the actual Nuxt application with `pnpm web -- dev --port 3210`. Playwright used local bookmark and status response fixtures. It did not modify production bookmarks or start generation.

- Both views showed the request error after three failed status requests. Retry restored the preparing state.
- Both views passed light, dark, and E-ink checks at 320, 768, and 1,200 pixels. The status stayed within the viewport. The retry button accepted focus.
- Owner guidance rendered for both unavailable reasons. Unit tests verified visitor exclusion, moderation checks, and ready private snapshots with Labs disabled.
- The expanded transition initially failed with `Cannot read properties of null (reading 'insertBefore')`. Stable elements inside the two media slots removed the error. The repeated browser check reported no page errors.
- A temporary HTTP server used the actual `Successed` helper on port 3211. A browser request from port 3210 succeeded across origins. It returned HTTP 200, `application/json`, and `private, no-store`.
- The reported Pocket Casts body also rendered in this application after the slot change. Its actual audio played. No page errors occurred.

Local browser scripts: `/tmp/media-browser-check.mjs`, `/tmp/media-expanded-check.mjs`, and `/tmp/pocket-browser-check.mjs`. Results: `/tmp/media-browser-results.json`, `/tmp/media-expanded-results.json`, and `/tmp/pocket-browser-results.json`. Screenshots remain outside Git under `/tmp/media-*` and `/tmp/pocket-player-*`.

## Local review

- Bugs: checked header overrides, HTML responses, initial failures, retry, and both presentation modes. Fixed the detached-fragment issue found during browser verification.
- Security: owner reasons follow access and moderation checks. Visitors receive no owner reason. No new dependency, credential access, or generation bypass exists.
- Compliance: this diff implements `restore-media-article-recovery`. The proposal approval covers the recovery behavior. The stable containers correct a failure within that behavior.
- No unresolved Important code findings. Human hands-on acceptance remains pending. Luca authorized PR creation for colleague review on 2026-10-27.

## Limits and remaining acceptance

The browser status responses were fixtures. Production owner settings, source rows, paid generation, deployment, and the final generated article were not verified. No production change was made. This change restores access and recovery; it does not reproduce the reference site's complete design.

The API and Web change. The optional contract field has no CLI, Extension, or Mobile consumer. No native package or version changes are included.

Human hands-on acceptance is pending under `DESIGN.md` section 10.2. Two local preview tabs exist in a dedicated Chrome preview window on M2-MBP: `YouTube retry preview` and `Pocket Casts player preview`. Status responses are fixtures; podcast audio is real. Reviewers must exercise Retry and podcast playback. Record the reviewer, date, and requested adjustments here.

Archive after the task PR merges. Sequence archive after the already-merged bookmark-fork delta for `youtube-ai-article`.

## Review handoff — 2026-10-27

Luca explicitly requested PR creation and colleague review with the test results. This instruction overrides the usual pre-PR acceptance order for this task. It does not establish hands-on acceptance or authorize merge or deployment. The PR records the pending checks for reviewers.
