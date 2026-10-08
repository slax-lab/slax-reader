# Proposal

## Why

Slax Reader currently renders icons through several incompatible paths: curated SVG fragments in `designIcons.ts`, inline SVG elements, CSS masks, raster files, and ad hoc `v-html` strings in toolbar and page components. This makes provenance, theme behavior, SVG safety, sizing, and accessible naming difficult to review consistently. The design contract already defines the required runtime categories and import boundary, so the Web application needs a concrete registry and renderer before more prototype assets are adopted.

## What Changes

- Introduce a Web-owned runtime icon registry with typed metadata for inline, mask, brand, and raster assets.
- Add a checked-in source manifest and generated runtime registry; the Web checks must validate the source assets and verify that the generated geometry is current.
- Add build-time validation for imported SVGs, including active-content rejection, reference restrictions, `viewBox` requirements, and paint-policy checks.
- Add one application-owned icon renderer that applies registry metadata, default sizing, paint behavior, and accessibility rules without routing every asset through `v-html`.
- Curate the first runtime assets from the existing Web icon sources and migrate the complete selected sidebar and empty-state surface set: `TabsSidebar.vue` (including its RSS icon), `useBookmarkRelative.ts` (including collection/tab icon definitions), `bookmarkEmptyConfig.ts`, `BookmarksEmptyState.vue`, and `BookmarksEmptyView.vue`.
- Wire the icon validator and generated-registry freshness check into the root Web validation command and Frontend CI.
- Preserve the design-prototype snapshot as non-normative provenance; do not make it a runtime asset directory.
- Leave the Extension profile and its icon implementation for a separate reviewed change.

## Capabilities

### New Capabilities

- `runtime-icon-registry`: A safe, typed, accessible Web runtime icon registry and renderer for curated application-owned assets.

### Modified Capabilities

- None.

## Impact

- Affected Web assets, icon constants, Vue components, build-time validation, and focused icon tests under `apps/web` and `tooling/`.
- No API or persisted-data changes.
- The first migration changes rendered markup and accessible icon behavior on Web sidebar and empty-state surfaces, so implementation requires OpenSpec review and visual/accessibility verification.
- Existing snapshot toolbar and Extension icon paths remain out of scope for the first migration and will be handled separately.
- The first migration explicitly defers Snapshot toolbar/page actions, ThemeSwitcher, article-content SVG processing, and all Extension icon paths.
