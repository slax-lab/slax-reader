# Proposal

## Why

A YouTube video can have automatic captions for both its original audio and dubbed audio. Slax currently treats the first TikHub automatic track as the original language, which can save Arabic subtitles for an English video even when an English track is available.

## What Changes

- When automatic tracks span multiple languages, prefer the capture user's Chinese or English language using the first two characters of the capture locale. Use an available English track as the fallback, including English captions for a dubbed track.
- Keep the existing single-language behavior for unambiguous track lists. When a multi-language list offers neither an eligible preferred track nor an English track, save the video with the existing player-only fallback.
- Apply the language policy to asynchronous caption responses and reject content whose reported video or language conflicts with the request. Record the selection and failure reason without logging caption text.

## Non-goals

- Machine-translating subtitles into English or transcribing video audio.
- Rewriting existing saved subtitles or generated articles.
- Changing the language or publication policy for AI-generated articles.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `youtube-captions` — controls caption selection and safe degradation when a video has ambiguous or unusable tracks.

## Impact

YouTube captures will use the new selection when acquiring captions through TikHub. The existing bookmark player, cue format, and source hashing carry the chosen caption track through the rest of the pipeline.
