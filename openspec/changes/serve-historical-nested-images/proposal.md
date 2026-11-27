# Serve historical nested image URLs

## Why

Older X bookmarks contain two signed image proxy layers. When the outer endpoint fetches the inner endpoint with the X article Referer, the inner endpoint rejects it and the reader receives a placeholder. Capture now avoids adding layers and Web repairs its rendered markup, but installed readers still request the stored URL.

## What Changes

- Serve the verified inner request inside the original Worker request for exactly one extra configured, same-mode layer. Preserve both signatures, incoming Referer checks and the inner request’s ordinary or RSS policies.
- Leave other URL shapes on their current path. Do not migrate R2 bodies, change capture, ship client changes, or alter remote cache settings.
- On November 27, 2026, the change requester approved the endpoint-level fix in conversation and requested background implementation and a separate PR. The design serves the verified inner request within the original request, without a redirect to the inner proxy.

## Capabilities

### New Capabilities
- `nested-image-proxy-delivery`: responses to historical signed requests at the image endpoint. The unarchived `optimize-public-article-lcp` change owns `image-proxy-reuse` for generation and Web projection; this change does not amend that contract.

### Modified Capabilities
None.

## Impact

API image handling and existing API tests only. The network request from clients and the stored HTML remain unchanged. An operator may need targeted invalidation of previously cached failure redirects; no purge is part of this change.
