# Design System Backlog

This backlog records bounded follow-up work for the Slax Reader UI design system. The normative contract remains DESIGN.md; runtime values remain in the owning application token files; the prototype snapshot remains provenance and visual reference.

## Icon migration

### Candidate next slices

- Repeated Web core controls in BookmarkList, Collection, Notification, and shared navigation that currently duplicate the same semantic geometry.
- Remaining Snapshot share-menu and local action icons when their menu-specific accessibility and state behavior can be reviewed as one slice.
- Repeated login, error, and empty-state artwork when the same meaning is used by more than one surface.

Each slice should add semantic registry keys, provenance, supported sizes, accessibility metadata, focused tests, and a migration-matrix entry. Prefer migrating repeated application-owned controls over one-off geometry.

### Deliberate exclusions

- Article-content and RSS preview SVG processing stays with its content sanitization boundary.
- Mermaid diagrams, charts, exported images, and other renderer-owned SVG stay with their renderer.
- Browser Extension icons stay in the Extension profile and are not imported into the Web registry.
- A local one-off SVG may remain local when moving it into the registry would add a key without creating reuse or a clearer semantic contract.

The completion metric is coverage of approved reusable control surfaces, not a zero count of SVG elements in the repository.

## Theme and token debt

- Review legacy payment, subscription, invite, collection-management, and import surfaces before claiming dark or e-ink support.
- Replace repeated hard-coded Web core colors with existing semantic --slax-* roles when a surface is actively changed.
- Add a new token only when the value is repeated, theme-dependent, or represents a stable product meaning.
- Keep chart, brand, and renderer-specific palettes documented as intentional fixed-profile exceptions.
- Consolidate a legacy surface only when its states, responsive widths, and required themes can be verified together.

## Suggested sequencing

1. Repeated Web core controls with existing focused component coverage.
2. Snapshot/share and other toolbar families with clear state and keyboard contracts.
3. Legacy theme-token cleanup by product surface, starting with the next feature that already touches the surface.
4. Extension or renderer-specific work only through a separate profile-specific change.

## Definition of done for a slice

- The affected semantic roles and application profile are named in the change.
- Runtime tokens or registry entries are owned by the correct application.
- Accessibility, state, theme, and responsive behavior are covered by focused checks.
- The migration matrix, this backlog, or the normative contract is updated when scope changes.
- icons:check, design:check, relevant Web checks, strict OpenSpec validation, and the local review passes are recorded.
- Any remaining exception is local, named, documented, and intentionally bounded.

Backlog entries are planning guidance, not automatic authorization. A visible UI, accessibility, interaction, or theme change still requires its own OpenSpec change.
