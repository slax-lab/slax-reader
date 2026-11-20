# Design

## Context

`BookmarksPage.vue` renders the subscription avatar strip in the header and the shared `ListLayoutSwitcher` above the personal list. The toolbar currently couples its timestamp and controls in one row. `FeedSwitcher.vue` includes the ring in the unread dot's 6px box, and `CollectionFeedList.vue` uses a full-height border for the source field. The personal text-list separator in `BookmarkTags.vue` is 12px tall.

The shared `BookmarkArticle.vue` header places its Source component and the Fork attribution in a vertical stack. The Source components already handle external articles, newsletter content, and uploaded or URL-backed PDFs. The Fork projection already supplies the link and visible name when authorized.

## Goals / Non-Goals

Keep the changes local to the Web inbox, collection feed metadata, and the provenance row in Forked details. Preserve the surrounding header structure, source variants, list-mode state, and current navigation rules.

## Decisions

### Inbox and collection list

- In the personal inbox with subscribed avatars, group the avatar strip and the existing mode controls in one desktop row. Give the timestamp its own row below the avatar strip. Use about 16px between the avatar's lower edge and the timestamp line box, then use the date group's existing 16px top inset as the gap below the timestamp. Keep the source-filter chip and its clear action in the leading region when active.
- Keep the existing 768px tool visibility rules, the existing empty and synchronization guards, and the existing toolbar layout for lists without subscribed avatars. Keep the shared list-mode model and the single visible set of controls. Avoid coupling the new spacing to the RSS consumer of `ListLayoutSwitcher`.
- Keep the unread color and avatar anchor from `FeedSwitcher`. Size the colored interior at 6px and draw the separation ring outside it.
- Use a centered 1 × 12px divider between adjacent rendered metadata fields. Apply one rule to the collection feed's virtualized list and its fallback. The metadata order stays date, highlight count, then source.

### Forked Reader detail

**Recommended composition.** Place the existing Source pill first, followed by a quiet attribution with a 14px branch glyph, muted label, and accent-colored name. Place the items approximately 12px apart and center them vertically above the existing divider. Use the Web tag type scale, semantic colors, and existing icon pipeline. The source pill already defines its boundary. An adjacent unfilled attribution gives the original publication and the copy's provenance different visual weights. Two filled pills would give both metadata items equal emphasis. A combined pill would blur the boundary between the two navigation targets.

- An available attribution uses “收藏自 Alex” / “Saved from Alex”. The entire attribution is one link to the immediate Reader snapshot. Retain the full name in the link's accessible name, mark the icon decorative, underline the name on hover, and show a visible keyboard focus outline.
- An authorized snapshot with hidden identity uses “收藏自 Reader” / “Saved from Reader” and the existing permitted link. An explicitly unavailable snapshot uses “原收藏不可访问” / “Original save unavailable”. A neutral or pending projection uses “来自其他收藏” / “From another save”. The last two states are plain text.
- Activate the horizontal layout only when the detail flag is `has_fork === true`. Reuse the existing Source rendering and gate all layout overrides to this variant. Preserve the label, author, arrow, and target rules for each Source variant. Keep the attribution visible alone when Source is absent and retain the existing PDF descriptor readiness rules.
- Keep both items in one row on narrow screens. Reserve room for each label and glyph, let names and authors ellipsize, and use roughly 45% of the available row as the narrow-screen attribution width cap. Keep the 44px touch target height for actionable items at mobile widths. Full names stay available to assistive technology.

## Risks / Trade-offs

- Source and Fork have different destinations. Keep them as sibling actions with separate keyboard stops and accessible names.
- Source CSS is shared across Reader routes and ordinary articles. Apply sizing and alignment only inside the Fork row and compare ordinary articles with the baseline.
- Permission-dependent attribution can appear after hydration. Keep one stable row with neutral text until the existing detail projection resolves, and retain its account and cache boundaries.

## Web Feed follow-up

- Set explicit, unitless line heights for avatar fallback text and source labels. Keep the existing 44px avatar and one-line ellipsis rules.
- Transition intrinsic height with a grid row and opacity for the Newsletter details and the unconfigured summary. Keep the header, issued address, and copy control outside the disclosure. Inactive panels are inert. Use the Web motion tokens and the existing e-ink suppression, and disable these transitions for reduced motion.
- Clear the personal list tab, tag, collection, and search query on an explicit Feed tab selection. Preserve unrelated parameters and the current path and hash. Use `view=rss` as the only Feed selector. While Feed is active, suspend bookmark filter routing and leave the bookmark filter header unmounted, since the tag header reapplies a deep-link filter on mount. When leaving Feed, use the selected bookmark tab's normal navigation, retaining an existing matching bookmark route where applicable.
