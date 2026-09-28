# Design

## Context

See proposal.md for motivation and root cause. Key code: `flashRange` / `unflash` / `handleAnchorClick` in `apps/web/app/components/Snapshot/SnapshotAIPanel.vue` (lines 161–228). The article body renders raw HTML via `v-html` into `.html-text` inside `.article-detail` inside `.bookmark-article` (`apps/web/app/components/Article/BookmarkArticle.vue:25-27`). The current search-domain selector `.bookmark-detail .detail` matches nothing in the snapshot reading layout, so matching always falls back to `document.body`.

## Goals / Non-Goals

**Goals:**

- Flash highlight never alters table layout, for any anchor match — including matches that span a table.
- Anchor matching is scoped to the article body, not the whole document.
- No behavior change for prose matches; visual flash effect is unchanged.

**Non-Goals:**

- Replacing the `<mark>`-wrapping flash mechanism with CSS Custom Highlight API or overlay rendering (considered, rejected for this fix — see Decisions).
- Changing the extension-side anchor navigation (it already uses `Selection.addRange`, no DOM mutation).
- Touching the fuzzy text-matching algorithm in `packages/frontend-utils/src/search.ts`.

## Decisions

### 1. Filter nodes in `flashRange` instead of replacing the mechanism

In `flashRange`, before wrapping a text node with `subRange.surroundContents(mark)`, skip the node when:

- its text content is whitespace-only (`textNode.textContent?.trim() === ''`), or
- its parent chain sits inside table structure without an intervening cell: i.e., walking up from the text node hits `TABLE`/`THEAD`/`TFOOT`/`TBODY`/`TR`/`COLGROUP` before any `TD`/`TH`. Text inside a `TD`/`TH` is legitimate cell content and is still highlighted.

Rationale: the bug is caused by inserting `<mark>` where table structure forbids non-table content (anonymous table-cell generation). Filtering the two offending node classes fixes the root cause with a few lines, keeps the existing flash UX, and keeps `unflash` unchanged.

Alternatives considered:

- **CSS Custom Highlight API (`::highlight()`)**: no DOM mutation at all, architecturally cleaner. Rejected for this fix: requires a fallback path for older browsers, changes the highlight styling pipeline, and touches more surface than the bug warrants. A reasonable future refactor.
- **`Selection.addRange` (extension approach)**: selection is not a styled flash and conflicts with the user's own text selection; rejected.

Consequence: when a match spans a table, only the in-cell portions flash; the inter-row/inter-cell whitespace does not. Visually the highlight appears as per-cell segments, which is the correct outcome.

### 2. Scope the search domain to `.bookmark-article .html-text`

In `handleAnchorClick`, replace `document.querySelector('.bookmark-detail .detail') || document.body` with a lookup of the actual article container: `.bookmark-article .html-text` (the `v-html` injection point). If the container is missing, abort instead of falling back to `document.body` — matching against the whole document can hit sidebar/outline text and scroll the user to the wrong place.

## Risks / Trade-offs

- [A legitimately matched whitespace run inside a cell is no longer highlighted] → Whitespace carries no visible glyphs; skipping it does not change the perceived highlight.
- [Selector `.bookmark-article .html-text` could break if the article markup is renamed] → The selector is the same one the article component itself renders; a rename would visibly break other processors that depend on `.article-detail`, so coupling is consistent with the codebase.
- [Other insert-into-DOM features (persistent marks in `packages/selection`) share the table-structure hazard] → Out of scope here; noted for follow-up if table-spanning user highlights misbehave.
