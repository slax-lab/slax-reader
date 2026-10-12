# Design

## Context

See `proposal.md` for the motivation and scope. The Web application currently mixes curated SVG inner markup, inline SVG elements, CSS masks, raster images, and icon strings rendered through `v-html`. The repository design contract in `DESIGN.md` requires explicit runtime categories, provenance, accessibility metadata, and build-time SVG validation while keeping the design-prototype snapshot non-normative.

## Goals / Non-Goals

**Goals:**

- Establish one typed Web registry that can describe the four runtime icon kinds without forcing them through one renderer.
- Validate curated SVG files before runtime use and make unsafe or ambiguous assets fail during development/build checks.
- Provide a small renderer API that preserves currentColor behavior, documented brand colors, default sizes, and accessible naming.
- Migrate the existing Web sidebar and empty-state icons as the first compatibility slice.

**Non-Goals:**

- Re-theming the Extension or sharing Web token values with it.
- Migrating every existing inline SVG or snapshot toolbar in the first change.
- Treating `docs/design/reference/` as a production asset directory.
- Replacing article-content SVG processing or user-provided HTML sanitization.

## Decisions

### Application-owned source and generated registry

Curated source files will live under `apps/web/app/assets/icons/`. A hand-authored manifest at `apps/web/app/icons/registry.json` will contain stable keys, kind-specific metadata, accessibility mode, and provenance. `tooling/icon-registry.mjs` will validate the manifest and source assets, extract only the inner geometry needed by inline entries, and generate `apps/web/app/icons/registry.generated.ts`. Runtime code will import only the generated registry; no component may import raw SVG text directly. The generated file is checked in and freshness-checked so local typecheck, CI, and review all inspect the same runtime payload.

Registry metadata and typed keys will be exposed from `apps/web/app/icons/registry.ts`, while the renderer will live in an application-owned component such as `apps/web/app/components/AppIcon.vue`. This keeps runtime assets separate from the non-normative reference snapshot and avoids prematurely creating a cross-application package.

The registry entry shape will include at least:

- `kind`: `inline | mask | brand | raster`;
- `source` and source commit/provenance;
- `viewBox` for inline and mask geometry, or intrinsic width/height for image entries;
- `defaultSize` from the supported reference sizes (12, 14, 16, 18, 20, 24, or 32; 10 only when explicitly marked compact);
- `paint`: `currentColor`, `fixed`, or mask-specific behavior;
- accessibility mode: `decorative`, `control-labelled`, or `standalone`, with a label where required.

### Kind-specific rendering

The renderer will branch on `kind`:

- `inline` uses an application-owned SVG element with generated, validated inner geometry;
- `mask` uses a CSS mask surface with a validated view box and inherits the consuming semantic color;
- `brand` uses approved fixed-color artwork and does not silently recolor it;
- `raster` uses image content with intrinsic dimensions and explicit decorative/meaningful handling.

This is preferred over one generic `v-html` path because it keeps fixed-color brand artwork and bitmap assets outside the inline SVG trust boundary. The validator parses every registry-owned SVG, checks the root and all descendants, rejects reusable `<use>` references to keep IDs scoped to each rendered instance, carries a whitelist of validated root presentation attributes alongside generated inner geometry, and records the source hash in generated output. Non-inline assets are emitted as static Vite URL imports in the generated registry. Inline markup is only accepted from that generated registry, never from user input, a raw component prop, or a remote URL.

### Build-time validation

Add `tooling/icon-registry.mjs` with explicit `--check` and `--write` modes. The root package will expose `pnpm icons:check`, which validates registry-owned SVG files, verifies generated output freshness, and fails on DOCTYPE/entity declarations, scripts, `<style>`, event handlers, `foreignObject`, CSS `url(...)`, any non-fragment `href` or `xlink:href`, missing required view boxes for inline or mask geometry, or a paint policy mismatch. Frontend CI will run `pnpm icons:check` before Web typecheck and tests. Tests will cover both rejection and acceptance fixtures so future registry entries cannot bypass the boundary by convention.

### Migration matrix and compatibility boundary

The auditable migration matrix lives at `openspec/changes/runtime-icon-registry/migration-matrix.md`. It records every selected BookmarkList consumer, its registry key, rendering kind, accessibility mode, source provenance, and the adjacent SVG paths intentionally left for a later change.

The selected surface includes the sidebar's built-in tabs, RSS tab, trash icon, configured bookmark empty states, the default `BookmarksEmptyView` fallback, SearchHeader's no-results icon, TagsHeader's empty-tags icon, and the bookmarks page feed-closed lock. The TagsHeader add/back/untagged control icons and the standalone `RssIcon.vue` component used by the RSS panel remain deferred because they are separate control surfaces with their own migration and accessibility review.

`TabsSidebar.vue` must expose an explicit `aria-label` on every tab button, including the collapsed desktop presentation where the visible `<span>` is hidden. The icon itself remains `control-labelled` and hidden from the accessibility tree. Layered or fork-specific `BookmarkTabTypes` entries must resolve through an explicit registry key or a registered semantic fallback entry; an empty raw-SVG fallback is not permitted.

### Migration order

The first migration will cover the complete selected set: `apps/web/app/components/BookmarkList/TabsSidebar.vue` including its RSS and trash icons, `apps/web/app/composables/useBookmarkRelative.ts` for collection/tab icon definitions, `apps/web/app/constants/bookmarkEmptyConfig.ts`, `apps/web/app/components/BookmarkList/BookmarksEmptyState.vue`, `apps/web/app/components/BookmarkList/BookmarksEmptyView.vue`, `apps/web/app/components/BookmarkList/SearchHeader.vue`, `apps/web/app/components/BookmarkList/TagsHeader.vue`'s empty-state slot, and the feed-closed lock in `apps/web/app/pages/bookmarks/index.vue`. `apps/web/app/constants/designIcons.ts` becomes a migration source and must not remain the runtime source for migrated entries. Snapshot toolbar strings, page action strings, ThemeSwitcher icons, article-content SVG processing, the standalone RSS panel icons, TagsHeader control icons, and Extension assets remain separate follow-up changes because they have different state and profile risks. Existing layout and interaction contracts will be verified at the current Web theme modes and supported icon sizes before any cleanup beyond the selected surfaces.

## Risks / Trade-offs

- **[Risk]** SVG import tooling differs between Nuxt/Vite contexts. → Keep source parsing and generation independent of runtime bundling, expose it through `pnpm icons:check`, and run that command in Frontend CI before Web typecheck/tests.
- **[Risk]** Moving from inline markup to curated files can change optical alignment or stroke inheritance. → Preserve source view boxes and paint metadata, add focused render assertions, and visually review the migrated surfaces.
- **[Risk]** Accessibility metadata can conflict with a surrounding button label. → Make decorative versus meaningful behavior explicit in each registry entry and test labelled-control scenarios.
- **[Risk]** A registry can become a dumping ground for one-off component geometry. → Require stable semantic meaning, provenance, and reuse justification before adding entries; keep local one-off geometry local until a migration is approved.

## Migration Plan

1. Add the validator, registry types, first curated assets, renderer, and focused tests.
2. Migrate sidebar and empty-state consumers behind the same renderer and verify light, dark, and e-ink behavior.
3. Run Web tests, lint, design checks, and the repository review checks.
4. Roll back by reverting the selected consumer changes; the reference snapshot and existing non-migrated icon paths remain available during the staged migration.
