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

## Transcript readability correction — 2026-10-27

Luca rejected the earlier transcript screenshots because each short cue remained a separate visible paragraph.
The earlier 925-entry check proved content presence. It did not prove a usable reading layout.

The Web processor now marks reading paragraph boundaries without moving or replacing cue nodes.
The stylesheet flows adjacent cue text continuously. Paragraphs break at sentence endings, speaker changes, long pauses, or bounded unpunctuated runs.
One quiet timestamp appears at the right of each paragraph. Its touch target remains at least 44 by 44 pixels.
Intermediate timestamps leave the visual layout and keyboard focus order. The detailed transcript data remains unchanged.

The reported input produced 78 reading paragraphs from all 925 original cues.
No words were removed or rewritten. This is transcript formatting, not AI editing or invented chapter headings.
Existing generated article bodies use separate markup and remain unchanged.

### Checks

- Initial regression: one failed and five passed before implementation.
- `pnpm web -- test tests/unit/components/Article/processors/youtube.processor.spec.ts tests/unit/components/Snapshot/YoutubeArticleBar.spec.ts tests/unit/components/Snapshot/YoutubeAiArticle.spec.ts`: 45 passed.
- The processor tests verify sentence boundaries, explicit speaker changes, long pauses, bounded runs, unchanged text nodes, and unchanged highlight selectors.
- Web type check and focused ESLint passed.
- Strict OpenSpec validation: 79 passed. `git diff --check` passed.
- `node apps/web/tests/fixtures/media-recovery/20261027-readable-transcript-check.mjs`: passed against the local Nuxt application.

The browser used real public production content, status, and mark-list responses through a local test proxy.
The proxy supplied transport CORS headers for the local origin. No sample transcript or simulated article status was used.
The public content response identified the reader as `visitor`. No login, generation request, or production write occurred.

The browser compared every rendered cue with the public saved body: all 925 matched.
All nine light/dark/E-ink and 375/768/1,200-pixel combinations passed layout and touch-target checks.
No horizontal overflow or uncaught page errors occurred. Enter and Space dispatched the original paragraph seek time.
Screenshots show the real saved transcript in the changed local application. They do not show a production deployment.

### Local review

- Bugs: cue nodes, text offsets, and selector paths remain stable; formatting affects only raw YouTube transcripts.
- Security: no new request, dependency, HTML insertion, or access-rule change exists in product code.
- Compliance: the readability correction follows Luca's explicit request and the revised transcript scenarios.

The screenshots now support visual review of paragraph formatting. Human acceptance remains pending; PR #405 stays draft.
Production deployment and generated-article publication remain outside this verification result.


## Edited article expansion — 2026-10-27

Luca approved the Papears-based plan and requested implementation followed by screenshots.
The scope now includes source editing, translation, a complete-article introduction, and the reading page.
Podcast presentation remains outside this expansion. The existing draft PR carries the same YouTube capability.

### Implementation and regression findings

- New generation uses prompt version `v2`. Existing `v1` articles remain readable without automatic replacement.
- Source editing precedes translation. The application retains source references and speaker fields during translation.
- Every source cue must appear exactly once in each edited chunk. Final assembly also checks coverage.
- Source editing rejects length ratios below 0.72 or above 1.15 before translation. This is a structural guard, not semantic proof.
- The introduction receives every final section. The page separates it from the spoken content.
- Saved and separate article views provide contents links, section headings, paragraphs, timestamps, and method notes.
- Ready legacy content remains readable with Labs disabled. Generation still requires the existing authorization and limits.
- A failed body write returns `publication_pending` while retaining canonical content.

The initial new regression run failed two checks: omitted cue coverage and ready reads with Labs disabled.
The real model run then exposed changed translation references and excessive source shortening.
Translation now returns text only. The application preserves references and checks paragraph counts.
A later browser run exposed the article shell's font specificity. The final reading rules explicitly select 18 px sans-serif text.

### Evidence boundaries

The local exercise uses the actual 941-cue capture of video `Jv5B5CEaPJI` and real Vertex model responses.
The publication exercise uses the real `MediaBodyService`, `BookmarkForkRepo`, local PostgreSQL, and local R2.
It checks the saved HTML through a separate read. The model and article text are not fixtures.
The test creates a local bookmark and relation. It does not modify the reported production bookmark.
Search indexing, global daily spend recording, and managed snapshot settlement use test callbacks.
The test step adapter retries callbacks but does not reproduce Cloudflare Workflow scheduling or timeout enforcement.

The browser uses the actual Nuxt app. It reads real public metadata and the article saved in local R2.
The route adapter substitutes that locally saved body into the public bookmark response for preview.
Production status responses remain real. No simulated ready status or sample article establishes success.
These screenshots establish local presentation and saved-body reading, not production deployment or owner recovery.

Human acceptance, deployment, and recovery of the original production bookmark remain pending.
No packaged CLI, Extension, or Mobile code, contract, dependency, or asset changes in this expansion.
Web and API changes do not require package-version increments.


### Final local verification

The final generation completed five chunks and published the saved article through `MediaBodyService`.
The article contains 14 sections and 65 paragraphs. All 941 source references match the captured cue order exactly.
The quality result has no failed checks. Numeric coverage is 0.941; language coverage is 1.0.
Source references and length checks do not prove semantic fidelity. Manual inspection covered the introduction, opening, middle examples, and ending.

An earlier attempt returned `MAX_TOKENS` in the third source chunk. Another response omitted a question and failed the length check.
Neither attempt replaced the saved body. The final attempt reused two validated chunks and completed the remaining three.
The prompt now explicitly preserves questions and original sentences. Gemini 3 uses `thinkingLevel: LOW` instead of the older budget setting.
The supported setting follows [Google's thinking documentation](https://ai.google.dev/gemini-api/docs/generate-content/thinking.md).
The failed provider responses do not establish whether reasoning alone caused truncation. Truncation remains a checked failure, not success.
The final local resume used one callback attempt per step; it did not rely on automatic retry to pass.

| Check | Result |
| --- | --- |
| `pnpm --dir apps/api exec vitest run` | 193 files passed; 2,525 tests passed; 112 integration/environment tests skipped |
| Focused Web regression run | 12 files passed; 99 tests passed |
| API `tsc --noEmit`; Web `typecheck` | Passed |
| ESLint on changed TypeScript and Vue files | Passed |
| `pnpm api -- gen:all` | Passed; no generated changes |
| `pnpm exec openspec validate --all --strict` | 79 passed; zero failures |
| `node apps/web/tests/fixtures/media-recovery/20261027-edited-youtube-check.mjs` | Passed; 12 theme/width combinations |
| `git diff --check` | Passed |

The browser checked light, dark, and e-ink at 320, 375, 768, and 1,200 pixels.
All 65 rendered paragraphs matched the saved article. A new visitor page read the same saved body.
Contents navigation and Enter/Space seeking passed. Touch targets measured at least 44 pixels.
The page had no horizontal overflow or uncaught errors. The body used 18 px sans-serif text.
Screenshots show the actual locally generated text. They are attached to PR #405, not committed as repository assets.

### Final local review

- Bugs: regression checks cover incomplete or reordered references, excessive shortening, translation structure, old versions, Labs reads, and failed publication.
- Security: model text remains escaped or text-bound. Access and moderation checks remain. No new dependency or secret is introduced.
- Compliance: the change follows `restore-media-article-recovery` and Luca's approved expansion. Local verification has the limits stated above.
- Human acceptance remains pending. Luca authorized the draft PR before acceptance; this does not mark acceptance complete.

## Review follow-up — 2026-10-29

Fixes for the open review threads on PR #405 at `f50703b3`. Each behavior fix started from a failing test.

- API: `ensureLanguageRow` takes an explicit prompt version that defaults to the current one. A language row created beside legacy `v1` rows now runs the `v2` pipeline instead of copying `v1` from the fallback base row.
- API: `getContent` reads one `listForSource` call; the repository already appends the legacy rows.
- API: the chunk band `[0.72, 1.15]` is one exported constant. The article check of a same-language edit uses the same band, so a chunk that passed cannot fail `length_ratio` at assembly.
- API: `editingContext` keeps the trailing paragraphs of the last section within 6,000 characters and serializes that array. The model no longer receives a JSON fragment cut mid-key.
- API: an owner whose preferred language has no captured variant receives the ready article in the language the capture has, with its language reported. A variant that exists keeps its own state. The delta spec scenario gained this outcome.
- API: the saved-body contents `nav` uses the same label as the Web locale (`Contents` / `本文目录`). A unit test now compares every YouTube saved-body label with `component.youtube_article.*` in both Web locale files.
- Web: `loadFailed` clears only when a status response lands. The failure line and its Retry button stay on screen while the retried request is in flight.
- Web: a cue without a readable `data-yt-seek` keeps the last known time, so the 12-second paragraph break still works for the following cues.
- Web: the saved body opens the contents block at `min-width: 769px`, the same boundary as `isH5` (`width <= 768`) in the expanded view. `DESIGN.md` names 768 px as the primary transition but defines no token for it.
- Web: the four scripts in `apps/web/tests/fixtures/media-recovery/` stay in the tree and are documented in `docs/web/development.md` with their commands and prerequisites. No package script runs them: each needs a running dev server, a local Chrome, and in two cases real public content. This keeps the evidence reproducible with the least surface. Their import order now passes the Web lint.
- Verified at HEAD without change: the recognized-reason guard in `YoutubeArticleStatus.vue` and the `source_missing` gating on an empty capture in `youtubeArticle.ts`.

| Check | Result |
| --- | --- |
| Failing tests before the fixes | API: 3 new tests failed (`legacy v1 rows`, `same-language edit inside the chunk band` ending in `quality:length_ratio`, `editingContext` budget and constant), plus 2 updated tests (`preferred language` ready outcome, saved-body `nav` label). Web: 4 new tests failed (retry in flight in both views, stamp-less cue before a pause, 769 px boundary) |
| `pnpm exec vitest run test/domain/youtubeArticleService.test.ts test/domain/youtubeArticleRunner.test.ts test/utils/youtubeEditing.test.ts test/utils/podcastArticle.test.ts test/utils/youtubeArticle.test.ts` from `apps/api` | 5 files, 177 tests passed |
| `pnpm --dir apps/api run test` | 194 files passed, 14 skipped; 2,533 tests passed, 113 skipped |
| `pnpm --dir apps/api run typecheck` | Passed |
| `pnpm --dir apps/api run lint` | 0 errors; 344 pre-existing warnings |
| `pnpm exec vitest run tests/unit/components/Article/processors/youtube.processor.spec.ts tests/unit/components/Snapshot/YoutubeArticleBar.spec.ts tests/unit/components/Snapshot/YoutubeAiArticle.spec.ts` from `apps/web` | 3 files, 49 tests passed |
| `pnpm --dir apps/web run typecheck` | Passed with the seven public runtime values set in the shell. Without a local `deploy/local/.env.web*` profile the generated runtime-config types are `unknown` and `app/pages/x/ext-bridge.vue` reports three pre-existing errors; that file is not in this diff |
| `pnpm --dir apps/web run lint` | 102 `simple-import-sort/imports` errors, all in files outside this change. The changed files and the four fixture scripts pass |
| `pnpm exec openspec validate --all --strict` | 79 passed, 0 failed |
| `git diff --check` | Passed |
| `node apps/web/tests/fixtures/media-recovery/20261027-browser-check.mjs` against `pnpm web -- dev --port 3210` | Compact and expanded views: retry and nine theme/width checks passed |
| `20261027-readable-transcript-check.mjs` and `20261027-public-transcript-check.mjs` | Not run to completion: `https://r.slax.com/api/content/7bfac4d4-b662-4194-a6f9-1fb29d018d9a` and the public page return HTTP 404 on 2026-10-29, so the real public source is no longer available. This is a declared gap, not a result of this diff |
| `20261027-edited-youtube-check.mjs` | Not run: it needs the local publication server on port 8797 from the earlier generation run |

The integration test `youtubeArticleRepo.integration.test.ts` gained a case for the legacy base row. It runs only with `RUN_PG_INTEGRATION_TESTS=1` and a local PostgreSQL, which this run did not have.

Human hands-on acceptance under `DESIGN.md` section 10.2 remains pending for the repository owner. Task 3.2 stays open. No production change, merge, or deployment occurred.
