# Tasks

## 1. Inventory and registry extension

- [ ] 1.1 Extend the migration matrix with every selected TagsHeader, RSS, Snapshot, and ThemeSwitcher consumer; record semantic registry keys, kind, size, accessibility mode, provenance, and the article-content/Extension exclusions.
- [ ] 1.2 Curate and validate the selected Web SVG assets under `apps/web/app/assets/icons/`; add typed manifest entries for TagsHeader, RSS, Snapshot, bookmark detail actions, and ThemeSwitcher icons without changing Extension-owned assets.
- [ ] 1.3 Add real manifest fixtures for `mask`, `brand`, and `raster` entries, including a small binary raster fixture, and document why each fixture is safe for runtime use.

## 2. Registry hardening

- [ ] 2.1 Compute source hashes from raw bytes while still decoding SVG text for XML validation; regenerate the checked-in registry and verify a one-byte binary change makes `pnpm icons:check` fail until regenerated.
- [ ] 2.2 Resolve source and provenance paths canonically before containment checks; add a symlink escape fixture that fails before reading or emitting the target.
- [ ] 2.3 Reject whitespace-only standalone labels and trim caller-provided labels before `AppIcon` exposes them; preserve exact decorative/control-labelled behavior.

## 3. Tags and RSS migration

- [ ] 3.1 Replace TagsHeader add, back, untagged, and add-filter SVGs with registry-backed `AppIcon` usage while preserving keyboard behavior, labels, focus treatment, and the existing 768px layout.
- [ ] 3.2 Convert `RssIcon.vue` into a registry-backed compatibility wrapper or remove it where safe; migrate RSS panel actions and empty/loading states without changing RSS behavior or image/content sanitization.
- [ ] 3.3 Add focused component tests covering registry keys, accessible names, action events, loading/error states, and currentColor behavior for TagsHeader and RSS.

## 4. Snapshot and theme migration

- [ ] 4.1 Replace Snapshot panel definitions and toolbar/page action SVG strings with typed registry keys and `AppIcon`, preserving action ordering, active state, translated labels, and desktop/768px/narrow mobile behavior.
- [ ] 4.2 Replace ThemeSwitcher SVG strings with registry keys while preserving its collapsed/expanded interaction, theme selection, and Web-only profile behavior.
- [ ] 4.3 Add focused Snapshot and ThemeSwitcher tests for icon rendering, responsive visibility, active state, keyboard labels, and theme transitions.

## 5. Validation and review

- [ ] 5.1 Run `pnpm icons:write`, `pnpm icons:test`, `pnpm icons:check`, affected Web Vitest suites, and the design checks; record the supported Web theme and viewport verification in the migration matrix.
- [ ] 5.2 Run `pnpm exec openspec validate --all --strict` and `pnpm agent:check`; resolve unrelated failures separately instead of expanding this change.
- [ ] 5.3 Run the local review passes required by `REVIEW.md`, resolve Important findings, and prepare the PR summary with `OpenSpec: web-icon-registry-followup`.
