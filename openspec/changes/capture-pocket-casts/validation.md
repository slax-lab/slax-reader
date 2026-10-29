# Validation — 2026-10-27

## Change log

Pocket Casts episode links now enter podcast capture when podcast Labs is enabled. The parser extracts safe audio, title, show, duration, notes, and supported transcript links. The existing source identity and save flow remain in use. Recapture refuses to replace a body with existing highlights or comments.

Branch: `fix/capture-pocket-casts`. Base: `origin/dev` at `f217f465`. This change needs the response-header fix before production browser verification.

## Automated checks

| Check | Result |
| --- | --- |
| Initial parser regression run | 10 failed, 54 passed before the fix |
| Initial capture regression run | 2 failed, 17 passed before the fix |
| `pnpm api -- test` | 192 files passed; 14 skipped. 2,518 tests passed; 112 skipped |
| `pnpm api -- test test/utils/podcastSource.test.ts test/flow/addUrl/15-podcastSave.test.ts` | 83 tests passed after restricting untyped transcript links |
| `pnpm api -- typecheck` | Passed after the final parser change |
| `pnpm api -- lint` | No errors; 344 warnings |
| `pnpm api -- gen:all` | Passed with example configuration and local placeholder database URLs |
| `pnpm exec openspec validate --all --strict` | 79 items passed |
| `git diff --check` | Passed |

The dependency generator added the `MarkRepo` constructor argument. No generated file was edited by hand.

## Running environment

Opened the reported short link in the browser:
`https://pca.st/episode/f7269801-ce3f-48fc-9e57-3783fdbbe7d2`.

It resolved to the canonical Pocket Casts episode page. The new parser read a captured rendered DOM from that live page.

- Title: `Vol.238 宏观漫谈112｜全球资本市场，集体“缺钱”？`
- Show: `高能量`
- Audio host: `dts-api.xiaoyuzhoufm.com`
- Page duration: 5,160 seconds, from the rounded `1h 26m` display.
- Publisher transcript references: zero. The HTML transcript viewer was excluded.
- Language: unset. The site's English interface does not determine the audio language.

The actual `HtmlBuilder.buildPodcast` generated the player body. The running Nuxt application rendered that body through its existing media processor. Playwright clicked Play. The audio reached `readyState: 4`, advanced its position, and reported an exact duration of 5,206.4 seconds. The browser reported no page errors. Desktop and 320-pixel screenshots showed the player and notes.

Local evidence: `/tmp/pocket-live-result.json`, `/tmp/pocket-body.html`, `/tmp/pocket-browser-results.json`, and `/tmp/pocket-player-desktop.png`. Screenshots remain outside Git.

## Local review

- Bugs: verified short and canonical episode recognition, show-page exclusion, missing audio, shared source identity, and existing bookmark identity. Capture tests verified annotation refusal before writes.
- Security: audio, cover, and transcript URLs use the existing outbound URL screen. Credential-bearing, private, and non-HTTP media URLs are rejected. The parser does not execute source scripts.
- Compliance: this diff implements `capture-pocket-casts`. Review found that untyped transcript links could be mistaken for VTT. The parser now requires a supported type, except native caption tracks. The regression test passes.
- No unresolved Important code findings. Luca confirmed human hands-on acceptance on 2026-10-28, as recorded below.

## Verification limits

Direct HTTP fetching returned a target 403. The browser rendered the source page. The existing provider fallback remains unchanged; a production Zyte or ScrapingBot fetch was not verified.

The live check parsed rendered source data and played real audio. It did not run a production crawl workflow, write production rows, start paid transcription, or produce the final cleaned article. Status responses in the local Web preview were fixtures. Production owner Labs settings remain unverified.

Annotation refusal uses the existing pre-write mark check. It does not add a transaction that prevents a simultaneous new annotation. This concurrency limit also applies to the existing publication flow.

After deployment, enable podcast Labs and save the original source link again. The existing save flow retains the bookmark identity. A bookmark with annotations must keep its current body.

Final production transcription remains a separate verification gap. Human UI acceptance does not establish production transcription success.

Archive after the task PR merges. Sequence archive after the already-merged bookmark-fork delta for `podcast-article`.

## Review handoff — 2026-10-27

Luca explicitly requested PR creation and colleague review with the test results. This instruction overrode the usual pre-PR acceptance order for this task. That instruction alone did not establish hands-on acceptance or authorize merge or deployment. Acceptance was pending at that time.

## Human UI acceptance — 2026-10-28

- Reviewer: Luca (wulujia).
- Confirmation date: 2026-10-28.
- Result: Luca confirmed that human hands-on acceptance was complete.
- Scope: the user-visible Pocket Casts capture result, with the existing player and episode notes presentation.
- Adjustments: no UI changes were required. Luca confirmed that there were no UI changes.
- Evidence source: Luca's confirmation in the task conversation, followed by his clarification about UI changes.

This record supersedes the earlier pending status. Acceptance was confirmed after PR creation; the earlier handoff remains historical context.
The production crawl, paid transcription, and final cleaned article retain the verification limits stated above.

## Evidence correction — 2026-10-28

The PR description recorded acceptance before this file and task 2.3 were updated. This documentation correction aligns all three records.
This correction changes no application code or package output. It is exempt from runtime verification and application version changes.
Verification: `pnpm exec openspec validate --all --strict` passed all 79 items; `git diff --check` passed.

## Review fixes — 2026-10-29

Three review threads on PR #406 were resolved in code. The fourth (acceptance order) is a record for the repository owner and stays as documented above.

### Changes

- Annotated recapture. The marks check moved out of `parseAndSavePodcast` into `CrawlService.keepsAnnotatedBody`, which the crawl workflow calls before `fetchPodcastData`. It returns true only when the bookmark already has a body and a reader left a mark on it; a first capture never consults marks. On a kept body the fetch step returns the existing title and text as a `shortCircuit`, the existing `release-cached-capture` step sets the bookmark back to `success`, no page is fetched, no alert fires, and the bookmark never becomes `failed`. The delta spec scenario and `design.md` state this outcome.
- Audio candidates. `parsePocketCastsPage` screens `og:audio`, then `audio[src]`, then each `a[download][href]` in turn. A download anchor counts only when its path matches `AUDIO_EXT_RE`. A rejected candidate falls through instead of ending the capture.
- Fixture and logging. `test/fixtures/podcast/20261027-pocket-casts-rendered.html` is a trimmed excerpt of the rendered Pocket Casts DOM captured on 2026-10-27 (episode block only; scripts, navigation, share-tracking query strings, and the publisher's contact details removed). The parser test reads it. `readPodcastEpisode` now logs a warning when a Pocket Casts page gives no episode, and states whether the resolved URL failed the episode-link check or the page had no safe audio.

### Resolved canonical shape

`curl -sI https://pca.st/episode/f7269801-ce3f-48fc-9e57-3783fdbbe7d2` answered `302` to
`https://pocketcasts.com/podcast/<show-slug>/642bf450-e9fa-013a-da18-0acc26574db2/<episode-slug>/f7269801-ce3f-48fc-9e57-3783fdbbe7d2`
(slugs percent-encoded). The episode regex accepts this shape. The direct follow-up request answered `403`, as recorded in the verification limits above.

### Automated checks

| Check | Result |
| --- | --- |
| Touched tests before the fix | 5 failed, 157 passed (162) |
| `pnpm exec vitest run test/utils/podcastSource.test.ts test/flow/addUrl/15-podcastSave.test.ts test/flow/addUrl/10-crawlWorkflowRun.test.ts` | 162 passed |
| `pnpm api -- typecheck` | Passed |
| `pnpm api -- lint` | 0 errors; 344 warnings (unchanged) |
| `pnpm api -- test` | 192 files passed; 14 skipped. 2,525 tests passed; 112 skipped |
| `pnpm exec openspec validate --all --strict` | 79 passed |
| `git diff --check` | Passed |

### Verification limits

The kept-body path was exercised through the workflow unit harness with mocked services, not against a running Cloudflare workflow or PostgreSQL. The audio-candidate screen was exercised with fixtures only. No production crawl ran.
