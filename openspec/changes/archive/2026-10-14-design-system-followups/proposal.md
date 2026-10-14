# Proposal

## Why

The Web icon registry follow-up is merged, but its review left three small consistency gaps: Snapshot side-panel controls rely on `title` alone, TagsHeader retains an obsolete font rule from the raw SVG migration, and a few registry default sizes do not match the sizes actually rendered by their consumers. The design system also needs a durable backlog so future icon migration and theme-token cleanup remain bounded work instead of an implicit requirement to remove every local SVG.

## What Changes

- Give Snapshot side-panel icon controls an explicit translated `aria-label` while preserving their current visible title and interaction behavior.
- Remove the obsolete TagsHeader add-filter font declaration left by the icon migration.
- Align affected registry `defaultSize` metadata with the consumer render sizes and add regression coverage for the contract.
- Add a design-system backlog document linked from the design documentation entry points. It will classify remaining icon migrations, theme-token debt, explicit exclusions, and the criteria for closing future slices.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `runtime-icon-registry`: strengthen the accessible-name contract for interactive controls and keep registry size metadata aligned with rendered consumers.

## Impact

- Web Snapshot and TagsHeader Vue components and their focused tests.
- `apps/web/app/icons/registry.json` and generated registry output.
- `docs/design/README.md`, `DESIGN.md`, and a new design-system backlog document.
- No API, data model, Extension, article-content sanitizer, or remote content behavior changes.
