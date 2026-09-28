# Proposal

## Why

Clicking a numbered anchor in the Outline panel breaks table layout in the article body. `flashRange` in `apps/web/app/components/Snapshot/SnapshotAIPanel.vue` wraps every text node intersecting the matched Range with `<mark class="anchor-flash">`, including whitespace-only text nodes and text nodes whose parent is a table-structure element (`TABLE`/`THEAD`/`TBODY`/`TFOOT`/`TR`/`COLGROUP`). Inserting a non-table element into a table row makes the browser generate anonymous table cells, recomputing column widths and visibly breaking the table. Confirmed in production: clicking an anchor whose match lands in a table row pushes cell content aside under a row-wide highlight band.

Reproduction screenshot (broken table after clicking an anchor): [`assets/outline-anchor-table-broken.png`](assets/outline-anchor-table-broken.png).

A secondary defect amplifies this: `handleAnchorClick` searches within `document.querySelector('.bookmark-detail .detail') || document.body`, but the snapshot detail layout has no `.detail` element, so the search domain silently falls back to `document.body` — widening the fuzzy-match candidate pool (and potentially matching sidebar text) instead of scoping to the article body.

## What Changes

- `flashRange` skips whitespace-only text nodes when wrapping matches with `<mark class="anchor-flash">`.
- `flashRange` skips text nodes whose position is inside table structure but outside any cell content (i.e., whitespace/structure-level text under `TABLE`/`THEAD`/`TFOOT`/`TBODY`/`TR`/`COLGROUP`), so a match spanning a table highlights only the text inside cells and never inserts elements between table-structure siblings.
- `handleAnchorClick` scopes its search domain to the real article body container instead of falling back to `document.body`.

## Capabilities

### New Capabilities

- `outline-anchor-navigation`: Clicking a numbered anchor in the Outline panel scrolls the article to the matching passage and flashes it, without mutating article DOM in ways that alter layout (notably tables).

### Modified Capabilities

(none)

## Impact

- `apps/web/app/components/Snapshot/SnapshotAIPanel.vue`: `flashRange` node filtering; `handleAnchorClick` search-domain selector.
- No API, contract, or dependency changes. Extension-side anchor navigation (`AISummaries.vue`) uses `Selection.addRange` and does not mutate DOM — unaffected.
