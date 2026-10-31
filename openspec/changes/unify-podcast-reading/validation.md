# Validation — 2026-10-28

## Status

Draft implementation. Do not merge yet.
Luca approved implementation, screenshots, and PR submission on 2026-10-28.
Human hands-on acceptance remains pending. Screenshots do not establish acceptance.

## Change log

- Share the YouTube reading layout with Podcast original and translated articles.
- Add a separate introduction, contents, topic headings, readable paragraphs, and source notes.
- Require complete, ordered cue references and a per-chunk length ratio of 0.72–1.15.
- Generate the introduction after all source sections. Include publisher metadata for name correction.
- Use prompt version v2. Preserve existing v1 article reads.
- Keep ready articles readable when acquisition Labs is disabled.
- Report publication failures as `publication_pending`. Check the stored body before reporting `body_ready`.
- Preserve annotated legacy bodies during publication and capture.
- Check explicitly linked YouTube captions before audio transcription. Video timestamps open YouTube instead of seeking unrelated audio.
- Recognize additional platform episode URLs and parse public episode metadata.
- Match feed items by exact audio URL or title, date, and duration. Reject title-only matches.
- Decode RSS URL entities once. The previous Apple test hid a mismatch through title-only selection.
- 2026-10-31: Rebase onto `dev` after #405 and #406 merged. Keep the accepted `fix-youtube-style` YouTube processor and styles. Scope the shared reading styles and contents links to Podcast articles.
- 2026-10-31: Accept a cue that repeats directly after itself, when its text is split across adjacent paragraphs. A missing, reordered, later repeated, or invented cue still fails. The Podcast runner uses the shared length band.
- 2026-10-31: An annotated body that keeps the show notes reports `body_mode: 'transcript'` and `article_version`. The status bar gives the reason. The original article shows below the body, and the translation switch stays available.

## Automated evidence

Commands ran in `/tmp/slax-podcast-reading`.

- API checks: Podcast runner, service, source parser, page parser, transcript parser, renderer, capture flow, public fetch, media body, snapshots, and YouTube runner.
- Web checks: Podcast translation, status bar, player, Podcast processor, and YouTube processor. **38 tests passed.**
- API typecheck passed, including the shared contracts.
- Web typecheck passed with local public URL configuration. Missing configuration initially produced unrelated `ext-bridge.vue` errors.
- `pnpm api -- gen:all` passed after initializing local API configuration. Generated tracked files did not change.
- Changed-file lint passed with no errors. Existing and parser `any` warnings remain.
- `openspec validate --all --strict`: **81 items passed, zero failed.**
- `git diff --check` passed.

Final API result: **249 tests passed across 12 files.** The RSS entity and exact-match regressions pass.

## Real generation and storage

Source: [A Brief Introduction](https://www.buzzsprout.com/1004689/episodes/19218532-a-brief-introduction), Tech Won't Save Us.
The public RSS feed supplies a publisher transcript and a 218-second episode.

The local diagnostic Worker called the real Podcast runner, Gemini model, moderation client, PostgreSQL repositories, R2 storage, and `MediaBodyService`.
The first attempt failed `chunk_incomplete_coverage`. It was not accepted as success.
The prompt now requires every non-overlap cue, including removed filler references.

The final run produced three sections and eight paragraphs. The source-length ratio was **0.997**.
The model cost estimate for that article was **$0.005426**. This excludes the earlier diagnostic attempt.
The introduction includes the closing schedule and guest topics. Publisher metadata corrects “Paris Marks” to “Paris Marx”.
The stored body matched the rendered article after `MediaBodyService.writeBody` and a separate `readBody` call.

A diagnostic bookmark uniqueness error caused `publication_pending` during one publication attempt.
The diagnostic used a second bookmark for the same URL. It now reuses the existing local bookmark.
The next run published the ready article without another model call. Final outcome: **ready**.
This diagnostic repair did not change production data.

Local evidence: `/tmp/slax-podcast-live-20261028/`, `/tmp/podcast-live-result-4.json`.
Search indexing, hosted Workflow retry behavior, daily aggregate spend, and managed snapshot settlement were not exercised by this diagnostic.

## Browser evidence and playback failure

The local Web build ran at `http://localhost:3211`.
A separate temporary Chrome session rendered the actual saved body as a visitor page.
The harness supplied local content and status responses. It did not exercise production authorization or the deployed content endpoint.

Screenshots cover light, dark, and e-ink at 320, 375, 768, and 1,200 pixels.
All twelve checks reported no horizontal overflow. A separate mobile screenshot shows the reading paragraphs.
The mobile introduction now uses start alignment instead of stretched word spacing.

**Playback did not pass for this English source.**
The public audio host returned HTTP 403 and HTML instead of audio.
Chrome reported `MEDIA_ELEMENT_ERROR: Format error`; playback remained at zero.
The screenshot preserves the visible playback failure. It is not evidence of a working player.
Player controls and timestamp behavior passed automated component tests, but those tests do not replace live playback.

Cindy browser status did not return. Screenshots used an isolated Chrome session without the user's profile.

## Chinese episode and local transcription

The reported Pocket Casts episode resolves from the previously captured public page to its full Xiaoyuzhou audio URL.
Its title is “Vol.238 宏观漫谈112｜全球资本市场，集体‘缺钱’？”. The page reports 5,160 seconds.
The initial local runner stopped with **`ASSEMBLYAI_API_KEY is not set`**. That result did not describe Cloudflare configuration.
On 2026-10-28, Luca supplied a key for local testing. The key stayed in a mode-0600 temporary file outside the repository.

The real Worker exposed an AssemblyAI client defect: calling `this.fetcher(...)` bound native `fetch` to the client instance.
Cloudflare rejected that context with `Illegal invocation`. The client now calls a detached function.
A regression test failed before the fix and passed afterward. Existing arrow-function mocks did not detect this runtime constraint.

The corrected client submitted one real transcription job. Polling completed with Chinese text and speaker labels.
The saved transcript contains 413 cues and 29,805 text characters. The provider reported 5,207 seconds.
The estimated transcription cost is USD 0.2459. This estimate is not the provider invoice.
The next two article attempts reused the saved transcript. They did not submit another transcription job.

**Chinese article generation still fails.** Three editing attempts failed `chunk_incomplete_coverage` before body publication.
Captured responses split individual cues across paragraphs and repeated their references. They did not omit cue IDs.
A prompt clarification did not resolve the failure and was removed. The exact ordered-coverage check remains unchanged.
The article row is failed after three attempts. Its recorded model cost is USD 0.0441075.
No Chinese article screenshot or completed publication claim is justified by this test.

The current Web build separately verified real Chinese audio play, pause, and keyboard seeking.
The audio reached 2.22 seconds, paused, and sought to 3 seconds. No page error occurred.
That playback check used the episode notes, not a completed article.

Follow-up checks: 63 tests passed across AssemblyAI, Podcast runner, and Podcast article suites; API typecheck passed.
Strict OpenSpec validation passed 81 items. Changed-client lint reported no errors.
Local evidence: `/tmp/podcast-chinese-transcript.json`, `/tmp/podcast-chinese-key-test-4.json`, and `/tmp/podcast-asr-tests-final.log`.
The key value is absent from this record, the tests, and the code. The complete PR diff passed the exact-key check.
The local test Worker stopped, and its temporary key file was removed.

Follow-up review: Bugs and Security have no new Important findings for the detached-fetch fix.
Compliance retains the existing Important finding for missing human hands-on acceptance. The PR remains a draft.
This API-only fix changes no packaged application output and needs no application version increment.

## Platform limits

| Input | Evidence | Remaining verification |
| --- | --- | --- |
| RSS and direct audio | Existing parser tests; real RSS transcript generation | Successful live playback for the selected source |
| Apple Podcasts | Lookup tests, exact feed matching, page fallback | Live old-episode recovery |
| Xiaoyuzhou | Existing hydration parser tests | Fresh capture; Chinese article editing remains incomplete |
| Pocket Casts | Parent PR capture evidence; recorded source parsed again | Compact-link live resolution and final Chinese article |
| Spotify | Public audio, embed-only, preview exclusion, and linked-caption fixtures | A live episode with a usable public transcript source |
| Overcast | URL recognition and common public metadata path | Live episode source resolution |
| Castbox | Show page fetched; episode response lacked usable metadata | Browser-rendered episode resolution |
| Amazon Music | Public page fetch lacked usable episode metadata | Browser-rendered episode resolution |
| Ximalaya | URL recognition and common public metadata path | Live public episode and restricted-content checks |

Platform recognition does not prove transcript availability. Do not describe this draft as universal platform support.
Real linked-YouTube fallback, translated live articles, and production visitor reads remain unverified.

## Version decision

Luca approved patch increments for affected packaged applications.
The optional `PodcastTranslation.transcript_source_url` field has no CLI, Extension, or Mobile consumer.
No packaged application source, runtime dependency, or build configuration changed. No application version increment is required for this diff.
Web and API do not use package-version increments under `docs/release/VERSIONING.md`.

## Local review

- Bugs: corrected false publication success, Labs read gating, annotated body replacement, caption timing, preview selection, and RSS entity decoding.
- Review round 2: an annotated podcast recapture now keeps the body as a cached capture instead of failing the crawl; `application/json+oembed` links are no longer taken as publisher transcripts; with Labs off, a transcript that is not ready reports `unavailable` with no retry. Covered by `podcastPage.test.ts`, `podcastService.test.ts`, `15-podcastSave.test.ts`, and `10-crawlWorkflowRun.test.ts`.
- Security: retained public-URL checks, bounded transcript fetching, HTML escaping, text-only translation rendering, private access, and moderation gates.
- Compliance: **Important — human hands-on acceptance is pending.** Keep the PR in draft.
- Completion: the live source and platform gaps above remain open. They do not count as completed tasks.

## Review round 3 — 2026-10-31

The `/review` gate on `6144089` reported three Important findings.

- Annotated body never shows the article: fixed. `podcastService.test.ts` covers owner and visitor status and the original-article read. `PodcastBar.spec.ts` covers the reason line, the article below, the switch, and the end of polling.
- Chinese editing fails exact coverage: the check is fixed and covered by `mediaEditing.test.ts`. A real Chinese episode is not run again yet, so Chinese publication stays unverified.
- Human hands-on acceptance: still pending. The YouTube body now keeps the design accepted on 2026-10-29 in `fix-youtube-style`. The Podcast article keeps its earlier look. They now differ in heading and paragraph timestamps; hands-on acceptance must decide the Podcast look.

Commands after the rebase: API `tsc --noEmit`, `vitest run` (200 files passed, 14 skipped), and `eslint src`. Web `vue-tsc` and `vitest run` (224 files passed, 1 skipped) with the CI placeholder environment. `openspec validate --all --strict` passed.

## Next verification

1. Run a real Chinese episode again with the corrected coverage check; reuse the saved transcript.
2. Verify live playback with an accessible complete episode.
3. Verify each additional platform through a real episode, including its unavailable state.
4. Test translated articles and deployed visitor reads.
5. Obtain human hands-on acceptance, resolve review findings, and remove draft status.
6. Merge dependency PRs #405 and #406 before this follow-up. Archive only after merge and capability sequencing.
