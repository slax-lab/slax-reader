# Design

## Context

`classifyPodcastUrl` has no Pocket Casts branch. The reported short link resolves to a rendered episode page with a download anchor. Direct HTTP fetching returned 403 on 2026-10-27.

## Goals / Non-Goals

Use the existing source parser, browser-fetch fallback, episode identity, and transcription process. Do not add a Pocket Casts API dependency or parse executable page scripts.

## Decisions

- Recognize exact Pocket Casts hosts and episode path shapes. Show paths do not qualify.
- Reuse the rendered page fetch used for Xiaoyuzhou. Parse a download anchor, metadata, show title, duration, and episode notes through the installed DOM parser.
- Screen extracted media URLs through the existing outbound URL policy. Only typed timed transcript links enter the transcript list.
- Reuse the existing owner URL-save request for recovery. This preserves the bookmark identity and existing admission controls.
- Check annotations before fetching a Pocket Casts page. An annotated recapture keeps the current body and ends as success, rather than invalidating annotation anchors or marking the bookmark failed.
- Keep source identity based on the audio URL, so short and canonical links share transcription work.

## Risks / Trade-offs

- Pocket Casts can change its page markup. Fixture tests and a live-page parser probe cover the observed markup.
- An HTML transcript viewer does not provide a supported timed transcript file. The existing ASR fallback remains necessary.
- The new source remains behind Labs. No migration changes user preferences.

## Migration Plan

Deploy the shared media-response fix before releasing Pocket Casts capture. Enable podcast Labs explicitly, then save the old source URL again. No database migration is required. Revert the task commit to remove source support.
