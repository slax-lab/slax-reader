# Design

## Context

Web's `BookmarkArticle.vue` renders ordinary prose separately from its PDF branch. Public Web articles can use an isolated document; styling only the parent page is not enough. Mobile's `ReaderWebView.tsx` hosts HTML alongside native header/footer views, with different scroll owners on iOS and Android. Mobile already has a local `PreferenceStore` in `apps/mobile/src/data/preferences.ts`. The design contract requires Web light/dark/e-ink and an unchanged light Mobile default.

## Goals / Non-Goals

Make local adjustments reversible and keep the current passage usable while changing them. Do not mutate cached HTML, publish preferences with a share, add remote font downloads, or introduce a synchronization service. Do not change controls or typography outside the reader.

## Decisions

1. Use one Reading appearance entry in the existing reader actions, reachable at desktop and narrow widths, and in the Mobile More panel. Open a panel with four labeled groups and Restore defaults; apply valid choices immediately. Use native back/dismiss on Mobile, keyboard navigation and focus return on Web. Avoid a new top-level settings route that removes the reader from the passage.
2. Persist stable identifiers for paper (default, light, warm, dark), ink (auto plus named dark and light inks), size (smaller, default, larger) and face (default, serif, sans-serif). Resolve identifiers to platform-owned semantic values; use local font fallback stacks including Chinese, not a named font assumed installed. Use the existing browser-local preference pattern and Mobile PreferenceStore; reset only these keys. No saved preference means no overrides.
3. Define compatible paper/ink combinations in the palette. Automatic ink resolves against the active paper. If an explicit combination is unavailable, show why and leave both selections intact; switching ink to Auto permits every paper. For default paper under a changing Web theme, use a theme-aware ink role or auto fallback while preserving the stored choice. Keep links, selections, annotations and code legible; avoid blanket descendant overrides.
4. Scope appearance to reader paper and prose selectors. Apply matching paper to contiguous article surfaces, including Mobile native article backgrounds, but leave action sheets and app chrome alone. Propagate resolved tokens into owned isolated article documents; do not target third-party frames or use a global theme switch. Keep public server output on its current default and apply local preferences on the client without rebuilding the article.
5. Update styles in place, without changing WebView source or rerunning content processors. When typography reflows a page, preserve the visible paragraph relative to the actual scroll owner; this is an explicit user adjustment, not a second initial restore. Leave annotation node paths, content IDs and stored text untouched.

## Risks / Trade-offs

- Native overlays or public reader isolation can leave white strips or unreadable text → exercise real surfaces with a dark paper selection, not just a preview swatch.
- A generic serif may differ across devices, particularly for Chinese → verify mixed Chinese/English prose on iOS and Android and do not promise identical glyphs.
- Palette presets give less freedom than arbitrary colors → every selectable combination can be checked for legibility, including highlights and links.

## Migration Plan

No content or backend migration. Ship controls and consumer styles together; older clients ignore the new local choices. Reset removes the overrides, and reverting the client feature leaves existing articles unchanged.
