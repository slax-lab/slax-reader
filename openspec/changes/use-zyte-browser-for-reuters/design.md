# Reuters provider selection

## Context

The regular crawler passes one host-policy decision to both Zyte and ScrapingRobot. Adding Reuters to the shared host list would also change the fallback's rendering mode. The Zyte adapter already supports JavaScript-enabled browser HTML and reads the rendered document from the response.

## Decisions

Select the Reuters exception at the point where the primary provider's mode is chosen. Match the parsed hostname against the apex and www hosts. Keep the submitted URL and query intact. The existing general browser policy still applies to its current hosts. Reuse the previous Reuters notice regression cases at the bookmark save boundary and exercise the actual outgoing Zyte payload.

## Verification limits

A browser-rendered response can still contain a publisher access notice. A live check needs a configured Zyte credential and must examine the extracted body. A successful request or a stubbed response alone cannot establish that the reported article is available.

## Browser retry for a short JavaScript notice

Inspect the selected article text before snapshot publication in the regular remote URL workflow. Collapse whitespace and require an explicit JavaScript enablement notice within 120 characters. Preserve illustrated articles and the existing handling of inline and imported content. A checkpoint carries the URL and notice length to a separate step with zero automatic retries. The step uses the existing Zyte browser transport. Record bounded structured events with the hostname, text length and outcome.

## Source markup in CAC and X Article snapshots

Run the CAC filter in the shared host preprocessor so both regular parser candidates see the same body. Resolve iframe sources relative to the page and match the origin and the two reported paths.

The observed FxTwitter preview includes the author in its heading and the article title in the cover description. Identify the provider's surrounding thread links and closing profile card before changing the article. Preserve authored HTML and its media. Keep a usable titled embed on the existing first-provider path. If a recognized preview lacks a title, the existing status-ID fallback may supply it. A preview with only provider markup and a cover cannot qualify as an article body.
