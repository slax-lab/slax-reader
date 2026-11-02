# Design

## Context

The crawl workflow calls `resolveShortLink` before `classifyPodcastUrl`.
The resolver only fetches listed short-link domains. That list currently excludes `pca.st`.
The classifier correctly rejects opaque short codes because they can identify episodes or shows.

On 2026-11-02, `https://pca.st/6rpkp8cj` returned one HTTP 302 redirect to a canonical episode URL.
The destination contains episode ID `d5287eb5-5416-4c58-9b7c-d1ba6d7f8fc8`.

## Goals / Non-Goals

Resolve the reported share format through existing capture machinery.
Keep the classifier strict and preserve the current stored bookmark URL.
Do not introduce a redirect service, new parser, provider, migration, or dependency.

## Decisions

### Extend the existing resolver

Add `pca.st` to `CrawlService.shortLinkDomains`.
The existing `SlaxFetch.head` uses a public GET request, cancels its body, and returns one validated redirect destination.
Its public-fetch helper validates redirect targets and resolves relative locations.
The workflow validates the resolved URL again before routing.

Do not classify every `pca.st` path as an episode. Show share links must remain normal pages.
Do not change all short-link domains to follow arbitrary redirect chains. The reported link needs one redirect.

### Test the real resolution boundary

Exercise the resolver with the reported short URL and a mocked public redirect response.
Assert that its result passes episode classification.
Exercise workflow routing with the real resolver behavior, so a mocked resolved URL cannot conceal the original omission.
Cover show destinations, missing redirects, failed resolution, unsafe targets, Labs disabled, and annotated recapture.
Reuse existing parser and episode-identity tests.

### Preserve recovery and presentation

Use existing owner recapture behavior. Do not rewrite stored bookmarks during deployment.
Keep the current player, notes, transcript generation, and annotation checks.
Record capture, playback, and transcript generation separately in runtime evidence.

## Risks / Trade-offs

- Multiple redirects: the existing resolver handles one redirect. Record any additional hop observed during live verification before expanding scope.
- Provider refusal: resolving the link does not establish that the rendered page provider succeeds. Verify capture separately.
- Stored content: old bookmarks require explicit recapture. Annotated bodies remain protected.
- Verification limits: report unavailable credentials or runtime services without treating fixture tests as production evidence.

## Migration Plan

Deploy through a merged API task PR targeting `dev`.
Recapture the reported bookmark through its owner flow with podcast Labs enabled.
Verify player output and record the transcript state.
Revert the task commit to remove the resolver change; no database rollback is needed.

Archive after the merged Pocket Casts change and its existing archive dependencies.
