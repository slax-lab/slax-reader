# Reuters provider selection

## Context

The regular crawler passes one host-policy decision to both Zyte and ScrapingRobot. Adding Reuters to the shared host list would also change the fallback's rendering mode. The Zyte adapter already supports JavaScript-enabled browser HTML and reads the rendered document from the response.

## Decisions

Select the Reuters exception at the point where the primary provider's mode is chosen. Match the parsed hostname against the apex and www hosts. Keep the submitted URL and query intact. The existing general browser policy still applies to its current hosts. Reuse the previous Reuters notice regression cases at the bookmark save boundary and exercise the actual outgoing Zyte payload.

## Verification limits

A browser-rendered response can still contain a publisher access notice. A live check needs a configured Zyte credential and must examine the extracted body. A successful request or a stubbed response alone cannot establish that the reported article is available.
