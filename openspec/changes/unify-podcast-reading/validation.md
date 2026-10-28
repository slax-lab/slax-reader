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

## Chinese episode and transcription blocker

The reported Pocket Casts episode resolves from the previously captured public page to its full Xiaoyuzhou audio URL.
Its title is “Vol.238 宏观漫谈112｜全球资本市场，集体‘缺钱’？”. The page reports 5,160 seconds.
The local runner stopped with **`ASSEMBLYAI_API_KEY is not set`**. No paid job started, and no transcript or article was produced.
Configure the existing runtime binding before repeating this check. Do not mark Chinese generation or paid transcription as verified.

## Platform limits

| Input | Evidence | Remaining verification |
| --- | --- | --- |
| RSS and direct audio | Existing parser tests; real RSS transcript generation | Successful live playback for the selected source |
| Apple Podcasts | Lookup tests, exact feed matching, page fallback | Live old-episode recovery |
| Xiaoyuzhou | Existing hydration parser tests | Fresh capture and real Chinese transcription |
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
- Security: retained public-URL checks, bounded transcript fetching, HTML escaping, text-only translation rendering, private access, and moderation gates.
- Compliance: **Important — human hands-on acceptance is pending.** Keep the PR in draft.
- Completion: the live source and platform gaps above remain open. They do not count as completed tasks.

## Next verification

1. Configure the existing transcription binding and process the Chinese episode.
2. Verify live playback with an accessible complete episode.
3. Verify each additional platform through a real episode, including its unavailable state.
4. Test translated articles and deployed visitor reads.
5. Obtain human hands-on acceptance, resolve review findings, and remove draft status.
6. Merge dependency PRs #405 and #406 before this follow-up. Archive only after merge and capability sequencing.
