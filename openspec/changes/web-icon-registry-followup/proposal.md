# Proposal

## Why

The first runtime icon registry migration established the Web renderer and migrated the BookmarkList foundation, but several Web controls still carry raw SVG strings or a parallel icon component. This leaves accessibility, provenance, and SVG validation guarantees uneven across the Web profile and makes future icon changes harder to audit.

## What Changes

- Extend the Web registry to cover the deferred control surfaces that share the existing Web profile: TagsHeader controls, the standalone RSS panel, Snapshot panel and toolbar actions, and ThemeSwitcher modes.
- Replace those consumers' raw SVG strings and local path maps with registry keys and `AppIcon`, preserving current sizes, interaction states, theme colors, responsive behavior, and accessible naming.
- Add registry-owned fixtures and checks for mask, brand, and raster entries so each rendering kind is exercised by a real manifest entry rather than metadata-only tests.
- Harden source validation and generated metadata around binary asset hashing, symlink-resolved source boundaries, and standalone accessible-label typing.
- Record the migrated consumers and intentionally deferred article-content and Extension surfaces in an updated migration matrix.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-icon-registry`: extend the Web migration contract to the remaining selected Web control surfaces and strengthen registry validation guarantees for non-inline assets and accessible labels.

## Impact

- Web Vue components and icon assets under `apps/web/app/components`, `apps/web/app/pages`, `apps/web/app/icons`, and `apps/web/app/assets/icons`.
- The root icon registry validator and focused registry/component tests under `tooling/` and `apps/web/tests/`.
- The archived runtime icon migration matrix and the living `runtime-icon-registry` spec.
- No API, persistence, Extension, or article-content renderer changes. The unresolved local Nuxt environment/typecheck issue involving `$config` remains a separate task.
