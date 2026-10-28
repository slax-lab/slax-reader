# Design

## Context

PR #406 adds Pocket Casts parsing and recapture. Its evidence covers playback, not real transcription or saved article publication.
On 2026-10-28, its CI gates pass. Automated review reports one Important compliance finding: missing human hands-on acceptance.
The review reports no Important bug or security finding. Submission authorization does not establish acceptance.
PR #405 adds the desired reading layout and stronger YouTube generation checks.
Papears already separates source editing, introduction, and translation. Its introduction uses only the opening text; Reader must use the complete article.

Observed code gaps:

- `podcastSource.ts` recognizes Apple, Xiaoyuzhou, direct audio, RSS, and Spotify. PR #406 adds Pocket Casts.
- Pocket Casts recognition accepts UUID episode paths but rejects compact `pca.st/<code>` share links.
- Apple lookup examines at most 300 episodes. An older episode can become a normal page without a transcript.
- Spotify creates an embed with empty audio. It therefore creates no transcription input.
- Other platform episode pages have no dedicated resolution path.
- Podcast editing already precedes translation, but the introduction uses only the first chunk.
- Podcast quality checks do not enable the new complete-reference check.
- Legacy ready reads still depend on Labs. The generation gate must not hide an authorized saved article.

## Goals / Non-Goals

Reuse shared presentation and pure content checks. Preserve the existing player, transcription provider, costs, leases, and private snapshot rules.
Do not merge the YouTube and Podcast workflow runners. They have different input and retry stages.
Do not infer speaker identities, silently replace annotated content, or treat notes as a transcript.

## Decisions

### One reading presentation

Extract the scoped YouTube reading mixin into a media reading mixin.
Extend the existing shared article renderer for introduction, contents, headings, source notes, and scoped anchors.
Apply the same styles to Podcast translation and saved-body views. Keep text escaped and preserve highlight targets.
Keep the audio player before the article and its existing sticky behavior. Paragraph timestamps seek the same audio.
Use the accepted YouTube layout. A separate mockup remains optional, rather than a prerequisite.

### One resolved episode input

Platform adapters return the existing episode information shape. All successful adapters use the same transcript, editing, translation, and publication flow.
Resolve share redirects with bounded requests and the existing public URL checks at every hop.
Read public audio, structured episode metadata, publisher links, and RSS enclosures. Never use a preview as the full episode.
Resolve an exact feed item from publisher identifiers or corroborating episode metadata. A title match alone is insufficient.
A show page stays a show page. Explicit RSS saves retain their existing newest-episode behavior.

| Platform | Current implementation | Planned handling |
| --- | --- | --- |
| Apple Podcasts | Episode lookup and feed enrichment | Preserve episode ID; add exact-item recovery outside the lookup window |
| Xiaoyuzhou | Rendered page audio and metadata | Verify live episode and shared URL variants; use the common article flow |
| Pocket Casts | UUID and canonical episode paths in #406 | Resolve compact share links and verify their final episode identity |
| Spotify | Embed only | Use explicitly discoverable publisher audio/feed for the exact episode; otherwise preserve embed with unavailable transcript |
| Overcast | Normal page | Resolve public episode page to audio or publisher feed |
| Castbox | Normal page | Resolve public episode metadata and audio/feed |
| Amazon Music | Normal page | Resolve public episode metadata and publisher audio/feed; retain a clear limitation when unavailable |
| Ximalaya | Normal page | Resolve public full-episode audio; identify restricted or preview-only episodes explicitly |
| RSS and direct audio | Existing support | Preserve behavior and pass through the same reading flow |

A platform adapter is complete only with a live public example and negative-case checks.
A recognized link is not proof that a complete transcript is available.
Do not add title-search guessing, new provider accounts, or a general crawling framework.

### Preserve speech before translation

Reuse ordered coverage and source-length checks from YouTube through a small shared helper.
Keep Podcast speaker evidence and source-specific context. Validate each non-overlap chunk before caching it.
Generate the introduction after full source assembly, then translate the introduction and article through the existing stable-unit translation system.
Keep original references and timestamps application-owned. Reject truncated model replies and changed translation structure.
Use the Gemini 3 thinking setting already verified in #405.
Version the changed prompt and preserve previous ready article reads. Do not regenerate existing articles without an owner action.

### Completion means saved readable content

Retain canonical article output when publication fails. Report publication as incomplete and make retries reuse that output.
Verify the body through a separate stored read. A canonical row marked ready alone does not establish publication success.
Read access still follows snapshot permissions and moderation. Labs controls new generation, not an already readable article.
Preserve annotation guards during owner recapture. Visitors never trigger paid work or gain access to private bookmarks.

## Risks / Trade-offs

- Platform markup changes: retain captured fixtures and a dated live probe per adapter.
- No public full audio: show the source or embed and a specific unavailable state; never invent text or report generation success.
- Long episodes exceed cost limits: retain the existing three-hour and spending limits; record the outcome separately from capture success.
- Source-length checks miss semantic loss: inspect opening, middle, and ending passages against the source in addition to automated checks.
- Shared CSS affects YouTube: rerun YouTube layout, timestamp, navigation, and highlight regression checks.
- New API fields affect packaged clients: prefer existing response fields; review version requirements if a contract change becomes necessary.

## Migration Plan

Sequence implementation after reviewed #405 and #406 commits. Do not merge either PR as part of this task.
Refresh this delta after the earlier podcast capability deltas are archived, before this change merges or archives.
Retain old prompt versions, article bodies, source identities, and bookmark IDs. No automatic production backfill is included.
Release through the normal review process after human acceptance. Roll back code while retaining prior stored versions.

## Source evidence

- Local Papears: `src/papears/pipeline.py`, `prompts/polish_en.md`, `sources/apple.py`, and `sources/__init__.py`.
- [Apple RSS requirements](https://podcasters.apple.com/support/823-podcast-requirements): public episode enclosures identify hosted audio.
- [Pocket Casts sharing](https://support.pocketcasts.com/knowledge-base/sharing-podcasts-and-episodes/): shared links use `pca.st`.
- [Spotify embeds](https://developer.spotify.com/documentation/embeds/tutorials/creating-an-embed): episode embeds are supported; this does not establish an audio download source.
- [Overcast](https://overcast.fm/): public RSS feeds supply episodes.
- [Castbox](https://castbox.fm/): the service accepts RSS and iTunes links; adapter extraction still requires live verification.

The source survey establishes resolution approaches. It does not prove capture, transcription, or playback for each proposed adapter.


## Approved transcript-source refinement — 2026-10-28

Inspect publisher transcripts first, then captions from an explicitly linked YouTube version of the same episode.
Use the existing YouTube caption client. Do not search by title or choose an unrelated upload.
Retain the caption source URL and its timeline in stored article metadata.
Video timestamps open the source video unless matching Podcast timing is established. Audio playback remains independent.
If no usable text exists, use the existing audio transcription path. Automatic captions retain their source label.
This extends Papears; Papears itself does not automatically search YouTube for a Spotify episode.
