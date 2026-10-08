# Spec Delta

## Purpose

Provides a safe, typed, and accessible Web icon contract so curated application assets can be rendered consistently without treating arbitrary SVG markup as trusted runtime input.

## ADDED Requirements

### Requirement: Runtime icons have explicit typed metadata

The Web runtime SHALL resolve each registered icon by a stable key whose metadata identifies its rendering kind as `inline`, `mask`, `brand`, or `raster`. Metadata SHALL record the source provenance, default size, and the view box or equivalent intrinsic dimensions required by that kind. Inline and mask icons SHALL declare their paint behavior, and every icon SHALL declare an accessibility mode of `decorative`, `control-labelled`, or `standalone`; standalone entries SHALL include a default accessible label or require one from the caller.

The registry SHALL enforce per-kind fields: inline entries require a source SVG, view box, current-color or documented fixed paint policy, and default size; mask entries require a source SVG, view box, mask paint policy, and default size; brand and raster entries require an approved source, intrinsic dimensions, default size, and fixed-paint or image metadata.

#### Scenario: Registered inline icon is complete

- **WHEN** a consumer resolves an inline icon by registry key
- **THEN** the registry returns validated geometry, a non-empty view box, a supported default size, paint metadata, and provenance metadata

#### Scenario: Unknown icon key is requested

- **WHEN** a consumer requests a key that is not present in the registry
- **THEN** the renderer fails in a deterministic development-visible way and does not fetch or interpret external markup

### Requirement: Imported SVG content passes the active-content boundary

The Web build SHALL validate every imported SVG used by the runtime registry before it can be consumed by application code. Validation MUST reject DOCTYPE declarations, entity declarations, scripts, `<style>` elements, `on*` event attributes, `foreignObject`, CSS `url(...)` references, any non-fragment `href` or `xlink:href` references, missing `viewBox` declarations for inline or mask geometry, and undocumented fixed paint where the entry requires `currentColor`. The validation and generated-registry freshness check SHALL run through `pnpm icons:check` and Frontend CI before Web typecheck or tests are accepted.

#### Scenario: Unsafe SVG is introduced

- **WHEN** an imported SVG contains active content, an external reference, or a missing required view box
- **THEN** the build-time validation fails, generated registry output is not refreshed, and the asset is unavailable to the runtime registry

#### Scenario: Curated current-color SVG is introduced

- **WHEN** an imported inline SVG uses only permitted geometry and current-color-compatible paint
- **THEN** validation succeeds and the icon can be registered with its declared metadata

### Requirement: Rendering honors icon kind, size, paint, and accessibility metadata

The Web icon renderer SHALL choose the rendering mechanism from the registry kind. Inline icons SHALL render inside an application-owned SVG viewport using generated, validated inner geometry; mask icons SHALL render through a mask surface; and brand or raster icons SHALL render as image content. The renderer SHALL apply the requested size while preserving the registry default when no size is supplied, SHALL not override documented brand paint, and SHALL follow the explicit accessibility mode rather than infer a parent control's accessible name.

#### Scenario: Decorative icon

- **WHEN** an icon with `decorative` mode is rendered
- **THEN** the icon is hidden from the accessibility tree with no title or label output

#### Scenario: Icon labelled by its surrounding control

- **WHEN** an icon with `control-labelled` mode is rendered inside a button or link
- **THEN** the icon is hidden from the accessibility tree and the surrounding control remains responsible for the accessible name

#### Scenario: Standalone meaningful icon

- **WHEN** an icon with `standalone` mode is rendered
- **THEN** the renderer exposes the registry label or an explicit caller label as the icon's accessible name, and fails visibly when neither is available

#### Scenario: Mask icon changes theme color

- **WHEN** a mask icon is rendered under a different Web theme
- **THEN** its geometry remains unchanged and its visible color follows the consuming semantic color

### Requirement: Initial Web migrations preserve existing behavior

The first migration SHALL replace ad hoc icon markup on the following Web surfaces with registry-backed rendering while preserving the existing action semantics, layout dimensions, theme behavior, and control hit areas: `TabsSidebar.vue` including its RSS icon, `useBookmarkRelative.ts` collection/tab icon definitions, `bookmarkEmptyConfig.ts`, `BookmarksEmptyState.vue`, and `BookmarksEmptyView.vue`. Snapshot toolbar/page action icons, ThemeSwitcher icons, article-content SVGs, and Extension icons SHALL remain explicitly deferred.

#### Scenario: Sidebar icon migration

- **WHEN** a user views the Web bookmark sidebar in light, dark, or e-ink mode
- **THEN** each migrated sidebar icon remains visually aligned, uses the intended theme color, and keeps its existing selected and interactive states

#### Scenario: Empty-state icon migration

- **WHEN** a user views a migrated empty state
- **THEN** the icon, text, and surrounding layout remain available at the existing supported sizes and the icon does not add duplicate screen-reader output
