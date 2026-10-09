# Tasks

## 1. Inventory and registry foundation

- [x] 1.1 Create and verify `openspec/changes/runtime-icon-registry/migration-matrix.md` covering `TabsSidebar.vue` (including its RSS and trash icons), `useBookmarkRelative.ts` (including collection/tab icon definitions), `bookmarkEmptyConfig.ts`, `BookmarksEmptyState.vue`, `BookmarksEmptyView.vue`, SearchHeader and TagsHeader empty-state slots, and the bookmarks page feed-closed lock; explicitly record adjacent TagsHeader control icons, standalone RSS panel icons, Snapshot toolbar/page actions, ThemeSwitcher, article-content SVGs, and Extension icons as deferred.
- [x] 1.2 Add typed registry metadata for `inline`, `mask`, `brand`, and `raster` entries with per-kind required fields, supported default sizes, explicit `decorative`/`control-labelled`/`standalone` accessibility modes, paint behavior, intrinsic dimensions, and provenance; verify the registry type-checks and rejects incomplete entries.
- [x] 1.3 Curate the first sidebar and BookmarkList empty-state assets under the Web-owned icon asset directory, record source paths and source commit/hash, and verify every in-scope consumer resolves a registry key without retaining `designIcons.ts` as its runtime source.

## 2. SVG validation and rendering

- [x] 2.1 Implement `tooling/icon-registry.mjs` to validate full source SVGs, reject DOCTYPE/entity declarations, scripts, `<style>`, `on*` attributes, `foreignObject`, CSS `url(...)`, any non-fragment `href` or `xlink:href`, missing view boxes for inline or mask geometry, and paint-policy violations, then generate only validated inline inner geometry; verify rejection and acceptance fixtures with focused tests.
- [x] 2.2 Add `pnpm icons:check` and wire it into Frontend CI before Web typecheck/tests; verify CI fails when an unsafe fixture or stale generated registry is introduced.
- [x] 2.3 Implement the kind-aware Web icon renderer so inline, mask, brand, and raster entries use their permitted rendering paths; verify default and explicit sizes, currentColor behavior, fixed brand paint, generated-geometry-only imports, and unknown-key handling.
- [x] 2.4 Implement explicit accessibility behavior for decorative, control-labelled, and standalone icons; verify exact `aria-hidden`/label output, visible failure when a standalone icon has no label, and translated `aria-label` output for collapsed sidebar buttons.

## 3. Initial Web migration

- [x] 3.1 Replace all in-scope sidebar, BookmarkList empty-state, SearchHeader, TagsHeader, and feed-closed consumers listed in task 1.1 with the registry-backed renderer while preserving existing selected, hover, layout, and hit-area behavior; verify focused component tests and snapshots.
- [x] 3.2 Verify migrated surfaces in light, dark, and e-ink themes at the existing supported icon sizes and the primary responsive transition; record visual/accessibility verification results.
- [x] 3.3 Leave deferred Snapshot toolbar, page action, ThemeSwitcher, article-content, standalone RSS panel, TagsHeader control, and Extension icon paths unchanged and verify the migration diff contains no out-of-scope consumer edits; verify layered tab types cannot fall through to an empty raw-SVG fallback.

## 4. Repository validation

- [x] 4.1 Run `pnpm icons:check`, the Web icon tests, affected Web component tests, Web lint/type checks, `pnpm design:check`, and `pnpm agent:check`; verify all required checks pass or document unrelated pre-existing failures.
- [x] 4.2 Run the local review passes required by `REVIEW.md`, resolve any Important findings, and prepare a change summary for human review before any commit or pull request is created.
