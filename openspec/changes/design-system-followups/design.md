# Design

## Context

See `proposal.md` for motivation. The merged `runtime-icon-registry` and `web-icon-registry-followup` changes already own the registry, validator, renderer, migration matrix, and focused component tests. This change closes review nits and records bounded follow-up work without reopening the completed migration scope.

## Goals / Non-Goals

**Goals:**

- Make the Snapshot side-panel action name robust for keyboard and assistive-technology users.
- Remove migration residue that no longer affects the icon geometry.
- Make registry metadata describe the actual default consumer size.
- Give future contributors one maintained backlog with explicit boundaries and a definition of done.

**Non-Goals:**

- Migrating every remaining inline SVG in the Web application.
- Changing article-content or RSS preview SVG sanitization.
- Migrating Extension assets into the Web registry.
- Re-theming legacy payment, subscription, collection, import, or dashboard surfaces.
- Changing icon artwork, action order, hit areas, breakpoints, or visible copy.

## Decisions

### Use explicit control naming at the component boundary

Snapshot side-panel buttons keep their current `title` for pointer hover and add the translated action label as `aria-label`. The icon remains decorative/control-labelled, so it does not create duplicate output. This fixes the actual accessibility contract at the control boundary instead of making `AppIcon` guess labels from arbitrary parents.

### Treat consumer size as the executable default

For each affected registry entry, the `defaultSize` is set to the size produced when the consumer omits an explicit size. Fifteen- and seventeen-pixel artwork are approved compact menu/toolbar sizes alongside the existing reference sizes because the migrated Snapshot controls already use them. Consumers with an intentional optical adjustment may keep an explicit size override, but that exception must be visible in the migration matrix or a focused component test. No artwork or layout dimensions change in this slice.

### Keep backlog documentation separate from the normative contract

`DESIGN.md` remains the semantic authority. A new `docs/design/backlog.md` records deferred icon families, legacy theme-token debt, exclusions, and suggested sequencing. The index links to it, while the contract links to it as a planning aid. Backlog entries do not authorize implementation by themselves; a visible change still requires an OpenSpec change.

### Keep all remaining SVGs intentionally classified

The backlog distinguishes reusable application controls that are good registry candidates from local one-off geometry, renderer-owned SVG (charts, Mermaid, article content), and Extension-owned assets. This avoids treating a raw search count as a design-system completion metric.

## Risks / Trade-offs

- **[Risk]** Adding `aria-label` can produce duplicate accessible names if visible text is later added to the same control. → Keep the icon decorative and test the control's accessible name at the component boundary.
- **[Risk]** Correcting metadata may expose consumers that relied on an implicit size. → Compare generated registry defaults with rendered component props and cover intentional overrides in focused tests.
- **[Risk]** A backlog can become stale or be mistaken for a commitment. → Link it from the design entry point, include scope/ownership/completion criteria, and update it whenever a design-related PR closes a listed slice.

## Migration Plan

1. Update the Snapshot control, TagsHeader style, registry metadata, and focused tests.
2. Add and link the backlog document, then run design, icon, Web, OpenSpec, and agent checks.
3. After this PR merges, create a separate small archive branch from the latest `dev` to archive `web-icon-registry-followup` and remove its active change directory.

## Open Questions

None for this change. The backlog contains future work items, not unresolved implementation decisions.
