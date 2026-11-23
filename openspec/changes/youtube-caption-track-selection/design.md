# Design

## Context

`CrawlService.fetchYoutubeData` passes the capture request language to `SocialMediaApi.fetchYoutubeCaption`. TikHub can return a track list or an asynchronous job that eventually returns subtitle content. The current selector uses the first track marked `asr` to infer the original language. The content parser accepts a valid JSON3 structure and derives its saved language from the selected track.

The reported video `y1-9yeYLJUo` exposes both Arabic and English automatic captions on YouTube, which identifies its English (US) audio as original. The saved Slax transcript is Arabic. The recorded production event gives the source hash and cue count. The incident's provider track order and content-response language are unknown.

## Goals / Non-Goals

Apply the [caption policy](specs/youtube-captions/spec.md) in the existing TikHub adapter. Continue passing the resulting timed cues and caption document through the same compatibility, snapshot, and article acquisition paths. Keep video saves usable when subtitle acquisition degrades.

## Decisions

### Use the capture request language for selection

The crawl workflow passes its `userLang` payload to `ContextManager.setUserInfo`. Reuse the existing call to `ctx.getlang()` in `CrawlService.fetchYoutubeData`. It takes the first two characters of the stored string and returns `en` when the result is empty. Match the resulting code case-insensitively, so `zh-Hant` becomes `zh` and `en-US` becomes `en`. English is the fallback for other capture locales when multiple automatic languages are present. When there are no automatic tracks, retain matching of a manual track to the existing capture language, including other locales. Reader AI language settings continue to govern article generation.

Classify an automatic track from `kind: asr` or a case-insensitive `a.` prefix. Normalize tags for matching and counting, and retain the original provider track code for the request and source attribution. Rank only eligible candidates. Prefer manual tracks within a language and use a stable provider-code tie-break among equivalent candidates. This makes source language independent of response order. The one-automatic-language rule retains the existing original-language heuristic. Multiple automatic languages remove the evidence for that heuristic.

### Validate content on both provider response paths

Use a shared JSON3 validation path for explicit and list-job results. Compare a returned video ID and language to the request when those fields are present. Direct content from an unscoped list job needs a reported language in the allowed Chinese or English set for that capture. Record when a list job supplies content only, since track preference depends on which alternatives were exposed.

Advance to the next ranked candidate after unusable content, with at most one additional content request and under the existing 90-second caption acquisition budget. A successful ordinary save still uses the list request and one content request. Route provider failures through the existing degraded capture handling. Use the existing player-only outcome when there is no eligible candidate. Record a compact outcome with video ID, branch, selected and returned language codes when available, and reason. Keep subtitle text and provider URLs out of diagnostics.

## Risks / Trade-offs

- Some videos expose only ambiguous foreign-language tracks. They will have a player without a transcript. A list that yields a single eligible language can still retain those subtitles under the single-language rules.
- A list job can return only English content for a Chinese capture. English is an allowed fallback in that response shape, and there is no list to establish whether a Chinese track existed.
- A provider can omit a usable English track or label the wrong text as English. The request checks catch explicit metadata conflicts. They do not establish the spoken language from audio or independently verify the script of a mislabeled payload.
- English fallback means an existing English caption track, including a translated or dubbed track that TikHub lists. TikHub documents retrieval of existing captions. YouTube's translated caption download requires permission to edit the video. Universal English coverage would require a separate, supported translation path for existing timed source cues and an audio transcription path for videos without cues. [TikHub captions API](https://docs.tikhub.io/431829301e0) · [YouTube caption download API](https://developers.google.com/youtube/data/reference/rest/v3/captions/download)

## Migration Plan

Deploy with the API release. New caption acquisitions use the new policy and continue to derive source identity from the saved caption document. There is no data migration. To verify this incident, capture the original video in a running non-production environment with the new backend. Existing bookmarks require separate reacquisition to adopt another caption source. Any later repair of persisted captures must account for annotations and snapshot identity.
