# Proposal

## Why

The Web and Extension snapshot imported at legacy commit `8a983148fdd1da2f145e7797be070d3fbe8f791a` predates fixes and tag UI updates on the legacy frontend's develop line. Comparing the remote-verified source tip `378d9ae91c3fc004c453d7947f1d77ee5fe5a7eb` with v2 `eab5d518721a18033a60b25ea6d2064856afe34e` identifies 16 unsynchronized application commits affecting 23 files; see `audit.md` for the reproducible inventory and exclusions.

## What Changes

- Port the final legacy tag presentation for topics, card lists, text lists, and article details, including action visibility, keyboard focus, truncation, and compact overflow measurement.
- Make article tables fill the available width when content fits and scroll horizontally when it does not, preserving the saved-annotation DOM and existing outline highlighting.
- Port Extension Shift+Enter caret handling and the elevated collection-popup host stacking level.
- Port the related Web tests, adapt imports to v2's shared frontend types and API contracts, and add focused regression coverage where the imported behavior needs it.
- Record the source baseline, source tip, commit/file counts, and excluded legacy CI/documentation changes so future synchronization has an explicit reference.

## Capabilities

### New Capabilities

- `bookmark-tag-presentation`: Context-specific tag presentation and overflow controls with existing tag operations preserved.
- `article-table-layout`: Responsive article table layout that retains annotation-compatible structure.
- `extension-input-and-overlay`: Native multiline input behavior and collection-popup stacking in the Extension.

### Modified Capabilities

None. Existing outline navigation requirements remain unchanged and must continue to pass.

## Impact

Changes are limited to `apps/web`, `apps/extension`, their relevant tests, and this change's audit and planning artifacts. No API schema, database, dependency version, deployment configuration, or shared package change is planned. V2's API/type separation, design tokens, Mermaid rendering, e-ink code highlighting, outline fixes, and local setup remain authoritative.

## Non-goals

Do not import legacy CI workflows, deployment guides, temporary agent reports, environment files, generated configuration, or the entire old application tree. Do not merge or deploy the resulting PR. The inventory uses immutable Git objects verified against the source and target remote branches before implementation.
