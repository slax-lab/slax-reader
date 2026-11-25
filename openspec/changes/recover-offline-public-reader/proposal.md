# Read previously opened public articles in full while offline

**Approved on November 25, 2026.** The change requester approved the proposed scope and behavior.

## Why

Reopening a previously read public share offline led to Chrome's network-error page. The change requester chose full-text offline rereading.

## What Changes

- Keep the last successfully viewed public article title and its complete readable text on this browser or WebView. Make the same URL readable across a fully offline reload and distinguish the saved copy from live content.
- When a reader navigates offline to an unvisited URL or an article previously accessible only as its owner, an unavailable message appears and no private body, session information or account annotations are exposed.

## Capabilities

### New Capabilities

- `web-public-reader-offline` — Read previously opened public articles in full while offline.

### Modified Capabilities

None.

## Impact

apps/web/app/service-worker/sw_prod.ts, Nuxt production precaching and public HTML reader routes /b/[id] and /s/[id] when eligible.

Covers public HTML articles and surviving browser/WebView storage. Browser eviction or clearing site data ends offline availability. Preserve HTTP failure distinctions on reconnection.

[sw_prod.ts](../../../apps/web/app/service-worker/sw_prod.ts) · [nuxt.config.ts](../../../apps/web/nuxt.config.ts)
