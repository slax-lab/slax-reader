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

## Corrected outcome evidence — 2026-10-27

The earlier task completion claim exceeded the evidence. Fixture error and retry checks did not prove successful article generation.
The original request included readable generated articles. Luca later requested visitor transcript access as the immediate minimum, without owner login.
This check does not remove the generated-article requirement or establish full task completion.

| Outcome | Environment and role | Real dependencies | Substitutions | Result |
| --- | --- | --- | --- | --- |
| Read the reported transcript | Production public page, anonymous visitor | Reader, public content API, saved body, browser rendering | None | Verified: 925 entries rendered with matching text and timestamps |
| Compare the saved transcript with current source captions | Local Worker and production saved body | TikHub caption provider, application caption parser | Local R2 storage | Verified: all 925 compatible entries match exactly |
| Generate an article from the reported video | Local Worker and disposable PostgreSQL | TikHub captions, Vertex AI, article runner, repository, R2 object writes | Local R2, direct step execution, no-op site cost recorder and bookmark publication callbacks | Partial: canonical article saved and read separately; bookmark publication unverified |
| Read the generated article from the live bookmark | Production visitor | Reader status API | None | Unverified: status remains unavailable and the page contains the transcript |
| Recover a failed status request | Local Nuxt application | Web components and polling code | Bookmark and status response fixtures | Verified only for request recovery; not generation |

Public bookmark: `7bfac4d4-b662-4194-a6f9-1fb29d018d9a`.
Source video: `Jv5B5CEaPJI`, “Robot-Use Agents: Why General-Purpose Models May Win in Robotics”.

Reproducible public check:

```sh
node apps/web/tests/fixtures/media-recovery/20261027-public-transcript-check.mjs
```

The check starts a fresh browser context without authentication or response interception.
HTTP status was 200 and the returned role was `visitor`.
All 925 saved entries appeared in order with matching text and timestamps, from 0:00 through 29:38.
The page had no uncaught JavaScript errors. Screenshots at 375 and 1,200 pixels showed the transcript without horizontal overflow.
This check does not verify playback, article generation, or caption accuracy against the spoken audio.

The current provider returned 941 caption cues. The existing compatibility converter merges cues within each whole second into 925 entries.
Every merged entry matched the saved entry exactly. The count difference did not indicate missing text.

The isolated generation run used `gemini-3-flash-preview` and five chunks.
The repository reached `ready`. A separate R2 read returned a Chinese article with 14 sections and 47 paragraphs.
The built-in quality checks passed. Recorded model cost was USD 0.0567.
Durable workflow scheduling, production configuration, global cost recording, and bookmark publication were not exercised by that isolated run.
It does not prove that the production bookmark has a published article.

No owner session, production write, merge, or deployment occurred.
PR #405 remains a draft while full article publication and human hands-on acceptance remain unresolved.

## Review corrections — 2026-10-27

A missing preferred language no longer produces `source_missing` when another saved variant exists.
Unknown server reasons no longer render raw translation keys.

- API regression: one failure before the correction; all 67 service tests passed afterward.
- Web regression: one failure before the correction; all 38 tests across both YouTube views passed afterward.
- API and Web type checks passed. API generation completed with no generated diff.
- Focused lint passed with no errors; the API test path has an existing ignore warning.
- The local fixture browser check passed both views and all nine theme/width combinations per view.
- The same browser check exercised an unknown reason after polling and found no raw translation key or page error.
- Strict OpenSpec validation passed all 79 items. `git diff --check` passed.

Bugs review confirmed that source guidance now distinguishes a missing language from an empty capture.
Security review confirmed that owner-only reasons, access checks, and generation gates remain unchanged.
Compliance review confirmed both corrections match the added recovery scenarios.
The Important human-acceptance finding remains open. Luca authorized review before acceptance; this does not establish acceptance or authorize merge.
