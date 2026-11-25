# Read previously opened public articles in full while offline

## Context

Reopening a previously read public share offline led to Chrome's network-error page. The change requester chose full-text offline rereading.

## Goals / Non-Goals

Keep the last successfully viewed public article title and its complete readable text on this browser or WebView. Make the same URL readable across a fully offline reload and distinguish the saved copy from live content.

## Decisions

Store a public-only sanitized reading representation and a minimal offline renderer with its required assets. Never persist raw authenticated SSR, private notes or a signed-in owner's private body into this public cache. Use existing anonymous/public access as the admission check. Prefer current content online. Evict the local copy when online access is explicitly denied or revoked. Offline users can read their previously obtained copy until the browser learns of revocation. Text is required through its final paragraph. Linked media and interactive controls may require connectivity.

## Risks / Trade-offs

Covers public HTML articles and surviving browser/WebView storage. Browser eviction or clearing site data ends offline availability. Preserve HTTP failure distinctions on reconnection.

## Verification

Run against a locally served production Web build so the installed service worker controls the page. Verify an entire offline reload, not just an already-mounted view.
