# Tasks

## 1. Fix flash highlighting in `SnapshotAIPanel.vue`

- [ ] 1.1 In `flashRange` (`apps/web/app/components/Snapshot/SnapshotAIPanel.vue:161`), skip whitespace-only text nodes (`textContent.trim() === ''`) and text nodes whose ancestor walk reaches `TABLE`/`THEAD`/`TFOOT`/`TBODY`/`TR`/`COLGROUP` before any `TD`/`TH`; verify by opening an article containing a table, clicking an Outline anchor whose match spans the table, and confirming the table layout is unchanged while in-cell text still flashes.
- [ ] 1.2 In `handleAnchorClick` (`SnapshotAIPanel.vue:213`), replace the search-domain lookup `document.querySelector('.bookmark-detail .detail') || document.body` with the article body container `.bookmark-article .html-text`, aborting navigation when the container is absent; verify clicking an anchor whose reference text appears only in the Outline panel does not navigate or flash.

## 2. Validation

- [ ] 2.1 Manually verify on the reported article (`/b/cb0174dd-e99f-4183-beb6-b357315fbb7d`): click anchor 3 (its match spans the metrics table) and confirm the "Star / Fork" row keeps its column widths during and after the flash; click a prose anchor and confirm the flash still works as before.
- [ ] 2.2 Run the web app's existing lint/typecheck and confirm no new errors.
