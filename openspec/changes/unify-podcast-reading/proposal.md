# Proposal

## Why

Podcast links do not consistently produce a player and a readable article. PR #406 verifies Pocket Casts playback, but not final article generation or publication.
Luca requests the Papears reading approach already approved for YouTube, with consistent handling across podcast platforms.

## What Changes

- Show a playable episode above the article. Reuse YouTube typography, introduction, contents, topic headings, paragraphs, source notes, and timestamp controls.
- Preserve source-language speech before translation. Generate the introduction from the complete edited article.
- Reject missing or reordered source references, excessive shortening, truncated output, and incomplete publication.
- Normalize episode links and bounded redirects for Apple Podcasts, Xiaoyuzhou, Pocket Casts, Spotify, Overcast, Castbox, Amazon Music, and Ximalaya.
- Resolve public episode audio or the exact publisher feed item before using the common transcript and article flow.
- Check explicitly linked official YouTube episodes for captions before paid transcription. Preserve caption provenance and do not apply video timestamps to unverified audio timing.
- Preserve existing RSS and direct-audio support. Do not mistake show pages or audio previews for complete episodes.
- Keep an embed or source link when complete public audio is unavailable. State that the transcript is unavailable; never label notes as a completed article.
- Verify playback, real transcript generation, saved-body publication, visitor reading, and mobile screenshots separately.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `podcast-article`: shared reading presentation, complete-article editing, episode link resolution, saved-body completion, and ready-content access.

## Impact

API source parsing, capture, Podcast generation, publication, and Web article views change.
Extract small shared reading helpers from PR #405. Keep media players and job orchestration separate.
Use existing fetch, DOM parsing, URL safety, transcript, storage, and budget helpers. No new dependency or migration is planned.

## Sequencing and review

This follow-up depends on #405 and #406. It does not replace their existing fixes.
Implement against their reviewed commits. Merge and archive their overlapping capability deltas before archiving this change.
Do not modify or reopen the YouTube proposal. Reuse its approved presentation and test it for regressions.
Luca approved implementation, screenshots, and PR submission on 2026-10-28. This includes checking official YouTube transcript sources.
An optional static demo is available. Reusing the accepted YouTube layout makes a separate demo unnecessary unless Luca requests it.

## Non-goals

Do not enable paid generation for all users, remove existing budgets, import complete show libraries, or bypass restricted audio access.
Do not claim universal transcript availability from a recognized platform name. Full public audio, a publisher transcript, or explicitly linked episode captions are required.
Do not merge, deploy, or change production bookmarks during local verification.
