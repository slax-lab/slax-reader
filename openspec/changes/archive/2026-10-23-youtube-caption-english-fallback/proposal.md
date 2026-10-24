# Proposal

## Why

A saved YouTube video can show its captions in the wrong language. Video `en0GuyhieQk` is in English, but the reader shows Arabic captions. TikHub lists 21 uploaded caption tracks for this video, sorted by language name, with no ASR track. Without an ASR track the system does not know the original language. When the user's language has no track, the system takes the first track, which is `ar`.

## What Changes

- When no ASR track exists and the user's language has no manual track, select the English manual track before the first track.
- The ASR rule and the user-language rule do not change.

## Capabilities

### New Capabilities

- `youtube-captions`: caption track selection for saved YouTube videos.

### Modified Capabilities

None.

## Impact

- `apps/api/src/infra/external/socialMedia.ts`: `pickYoutubeCaptionTrack`.
- `apps/api/test/infra/youtubeCaptionTrack.test.ts`: new cases.
- Bookmarks saved before the fix keep their stored captions. A user must save the video again to get the new track.
- Known limit: a non-English video with uploaded translations, no ASR track and no track in the user's language gets English captions. The upgrade path is to read the default audio language from the video metadata.
