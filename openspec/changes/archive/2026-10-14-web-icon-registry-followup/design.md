# Design

## Context

See `proposal.md` for the motivation and selected scope. The completed `runtime-icon-registry` change owns the Web registry manifest, generated metadata, `AppIcon.vue`, and the initial BookmarkList migration. The remaining selected Web controls still pass raw SVG strings through `v-html` or maintain a local path map, while the validator's non-inline and filesystem-boundary behavior is covered mainly by synthetic metadata tests.

The follow-up must preserve the Web profile's light, dark, and e-ink behavior and must not change the Extension or article-content renderers. The living contract is `openspec/specs/runtime-icon-registry/spec.md`; the archived migration matrix remains provenance for the first phase, so this change will add a new matrix section under the active change and retire it with the follow-up.

## Goals / Non-Goals

**Goals:**

- Give every selected Web control surface one stable registry key and one explicit accessibility mode.
- Keep existing component APIs where that reduces behavior risk, while removing raw SVG markup from runtime consumer data structures.
- Exercise all four registry kinds with real manifest-owned fixtures and make path/hash checks resistant to symlink and binary-input edge cases.
- Verify visual, keyboard, responsive, and theme compatibility for the selected Web controls.

**Non-Goals:**

- Changing article-content SVG sanitization or the renderer used for user/remote article markup.
- Migrating Extension icons or sharing Web values with the Extension profile.
- Re-theming Snapshot or RSS surfaces beyond replacing their icon source.
- Fixing the separate Nuxt environment/typecheck issue unless a narrowly scoped regression is found in the touched files.

## Decisions

### Use semantic registry keys and keep compatibility wrappers narrow

Add semantic keys grouped by surface, such as `tags.*`, `rss.*`, `snapshot.*`, `bookmark-action.*`, and `theme.*`, instead of naming entries after component-local variables. `RssIcon.vue` may remain as a thin compatibility wrapper while its public names map to registry keys; it must not retain path data or render raw SVG. This keeps existing RSS templates readable and reduces a large template rewrite, while the registry remains the only source of geometry.

Snapshot panel definitions, bottom-toolbar actions, page actions, and ThemeSwitcher definitions will carry typed icon keys rather than SVG strings. `AppIcon` will be the only renderer for these migrated controls, preserving the existing label and active-state ownership in the surrounding button.

### Preserve size and interaction contracts at the consumer boundary

Registry entries will record the existing optical size and view box for each asset. Consumers will keep their current CSS dimensions, button hit areas, ordering, breakpoints, active colors, and translated labels. Tests will assert the registry key and rendered `AppIcon` output alongside existing interaction assertions so a migration cannot silently change control semantics.

### Harden validator inputs at the filesystem and byte boundaries

The validator will canonicalize both manifest source paths and provenance paths with `realpath` before checking containment under the asset or repository root. SVG text will be decoded only after the canonical file is accepted; source hashes will be computed from the original bytes. Tests will use a symlink escape fixture and a one-byte raster mutation fixture. The generated file remains checked in and freshness-checked by `pnpm icons:check`.

### Make standalone naming explicit and non-empty

Registry validation will reject whitespace-only standalone labels, and `AppIcon` will trim caller labels before deciding whether a standalone icon has a usable accessible name. Control-labelled and decorative entries remain hidden from the accessibility tree, leaving the surrounding control responsible for naming.

### Keep article content and Extension out of the migration boundary

Article-content SVG processing has a different trust boundary and sanitization lifecycle; Extension assets have a different profile and bundle budget. The migration matrix, proposal, and tests will explicitly assert that neither surface is routed through the Web registry.

## Risks / Trade-offs

- **[Risk]** Converting string-based Snapshot action data to typed keys could expose forgotten consumers. → Search all action/panel construction sites, migrate them together, and add compile-time and focused component coverage before deleting the string field.
- **[Risk]** RSS compatibility wrappers could preserve an accidental second icon API. → Keep the wrapper's accepted names limited to the existing call sites, map directly to registry keys, and document removal as a later cleanup only after all consumers use semantic keys.
- **[Risk]** Canonical path checks may reject legitimate repository symlinks used by local development. → Resolve and validate only registry-owned asset/provenance paths, report the canonical path in the failure, and keep the allowed roots explicit.
- **[Risk]** Icon extraction can change optical alignment at 13–20px sizes. → Preserve source view boxes and existing CSS sizes, add focused snapshots, and verify light, dark, e-ink, desktop, 768px, and narrow mobile states.

## Migration Plan

1. Add the follow-up manifest entries, curated assets, validator hardening, and focused registry fixtures.
2. Migrate TagsHeader and RSS controls, then Snapshot controls and ThemeSwitcher, keeping each group independently testable.
3. Run focused component tests, icon tests/checks, design checks, OpenSpec validation, and the local review passes.
4. Roll back by reverting the consumer and manifest changes; the first-phase registry and the deferred raw renderers remain available.

## Open Questions

None. Article-content and Extension work are explicit follow-up changes rather than unresolved decisions in this scope.
