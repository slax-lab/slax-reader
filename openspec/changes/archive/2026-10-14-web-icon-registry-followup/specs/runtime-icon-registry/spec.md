# Spec Delta

## MODIFIED Requirements

### Requirement: Runtime icons have explicit typed metadata

The Web runtime SHALL resolve each registered icon by a stable key whose metadata identifies its rendering kind as `inline`, `mask`, `brand`, or `raster`. Metadata SHALL record the source provenance, default size, and the view box or equivalent intrinsic dimensions required by that kind. Inline and mask icons SHALL declare their paint behavior, and every icon SHALL declare an accessibility mode of `decorative`, `control-labelled`, or `standalone`; standalone entries SHALL include a non-empty default accessible label or require a non-empty label from the caller.

The registry SHALL enforce per-kind fields: inline entries require a source SVG, view box, current-color or documented fixed paint policy, and default size; mask entries require a source SVG, view box, mask paint policy, and default size; brand and raster entries require an approved source, intrinsic dimensions, default size, and fixed-paint or image metadata. Validation fixtures SHALL exercise all four rendering kinds with the same metadata rules used by production entries.

#### Scenario: Registered inline icon is complete

- **WHEN** a consumer resolves an inline icon by registry key
- **THEN** the registry returns validated geometry, a non-empty view box, a supported default size, paint metadata, and provenance metadata

#### Scenario: Unknown icon key is requested

- **WHEN** a consumer requests a key that is not present in the registry
- **THEN** the renderer fails in a deterministic development-visible way and does not fetch or interpret external markup

#### Scenario: Standalone label is blank

- **WHEN** a standalone icon entry or caller label contains only whitespace
- **THEN** registry validation or rendering fails visibly instead of exposing an empty accessible name

### Requirement: Imported SVG content passes the active-content boundary

The Web build SHALL validate every imported SVG used by the runtime registry before it can be consumed by application code. Validation MUST reject DOCTYPE declarations, entity declarations, scripts, `<style>` elements, `on*` event attributes, `foreignObject`, CSS `url(...)` references, any non-fragment `href` or `xlink:href` references, reusable `<use>` elements, missing `viewBox` declarations for inline or mask geometry, and undocumented fixed paint where the entry requires `currentColor`. Source and provenance paths SHALL be resolved through canonical filesystem paths and MUST remain inside their respective repository-owned roots, including when a symlink is present. Binary asset hashes SHALL be calculated from raw bytes rather than a decoded text representation. The validation and generated-registry freshness check SHALL run through `pnpm icons:check` and Frontend CI before Web typecheck or tests are accepted.

#### Scenario: Unsafe SVG is introduced

- **WHEN** an imported SVG contains active content, an external reference, or a missing required view box
- **THEN** the build-time validation fails, generated registry output is not refreshed, and the asset is unavailable to the runtime registry

#### Scenario: Curated current-color SVG is introduced

- **WHEN** an imported inline SVG uses only permitted geometry and current-color-compatible paint
- **THEN** validation succeeds and the icon can be registered with its declared metadata

#### Scenario: Registry source escapes through a symlink

- **WHEN** a manifest source or provenance path resolves through a symlink outside its allowed repository root
- **THEN** validation fails before the file is read or emitted into generated runtime metadata

#### Scenario: Binary asset provenance is checked

- **WHEN** a brand or raster asset changes by one byte
- **THEN** its generated source hash changes and `pnpm icons:check` detects stale generated output

### Requirement: Initial Web migrations preserve existing behavior

The Web runtime icon migration SHALL replace ad hoc icon markup on the initial surfaces and the approved follow-up Web control surfaces with registry-backed rendering while preserving existing action semantics, layout dimensions, theme behavior, responsive behavior, control hit areas, and accessible naming. The follow-up surfaces are TagsHeader add/back/untagged/add-filter controls, the standalone RSS panel and `RssIcon.vue`, Snapshot panel/bottom-toolbar/right-edge/page-action icons, and ThemeSwitcher mode icons. Article-content SVG processing and Extension icons SHALL remain explicitly deferred because they use separate renderer or application-profile contracts.

#### Scenario: RSS and tag controls retain their action contract

- **WHEN** a user uses an RSS or TagsHeader control in light, dark, or e-ink Web mode
- **THEN** the control keeps its existing label, focus behavior, hit area, visual state, and action while its icon is rendered from the registry

#### Scenario: Snapshot controls retain responsive behavior

- **WHEN** a user views Snapshot panel or toolbar controls at desktop, the 768px transition, or the narrow mobile width
- **THEN** the same controls remain available in the same order and state, with registry icons preserving their current optical size and accessible labels

#### Scenario: ThemeSwitcher remains profile-scoped

- **WHEN** a user changes between light, dark, and e-ink Web themes
- **THEN** ThemeSwitcher keeps its current collapsed/expanded interaction and each mode icon follows semantic currentColor without changing Extension styling

#### Scenario: Deferred renderers remain isolated

- **WHEN** article content or Extension UI renders an SVG outside the migrated Web control surfaces
- **THEN** it continues using its existing renderer and is not routed through the Web registry by this change

#### Scenario: Existing migrated surfaces remain compatible

- **WHEN** a user views the previously migrated BookmarkList surfaces
- **THEN** their selected, hover, empty-state, collapsed-sidebar, theme, and accessibility behavior remains unchanged

#### Scenario: Sidebar icon migration

- **WHEN** a user views the Web bookmark sidebar in light, dark, or e-ink mode
- **THEN** each migrated sidebar icon remains visually aligned, uses the intended theme color, and keeps its existing selected and interactive states

#### Scenario: Empty-state icon migration

- **WHEN** a user views a migrated empty state
- **THEN** the icon, text, and surrounding layout remain available at the existing supported sizes and the icon does not add duplicate screen-reader output

#### Scenario: Collapsed sidebar control remains labelled

- **WHEN** the desktop sidebar is collapsed and a user navigates its buttons with assistive technology
- **THEN** each button exposes its translated tab label through `aria-label` even though its visible text is hidden, and the decorative/control-labelled icon does not create duplicate output

#### Scenario: Layered tab resolves to a registry entry

- **WHEN** a Web layer or fork adds a tab type to `BookmarkTabTypes`
- **THEN** the tab resolves to a registered semantic icon key or an explicit registered fallback entry, and the renderer never receives an empty raw-SVG fallback or an unvalidated icon string
