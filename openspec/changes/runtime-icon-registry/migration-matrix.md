# Runtime Icon Registry Migration Matrix

This matrix is the auditable inventory for the first Web migration. Source hashes and provenance are recorded in `apps/web/app/icons/registry.generated.ts` and verified by `pnpm icons:check`.

| Surface / consumer | Current source | First-change treatment | Target registry entry | Accessibility | Notes |
| --- | --- | --- | --- | --- | --- |
| `TabsSidebar.vue` built-in tabs | `TabIcons` from `useBookmarkRelative.ts` and `designIcons.ts` | Migrate | `bookmark.inbox`, `bookmark.starred`, `bookmark.topics`, `bookmark.highlights`, `bookmark.archive` | `control-labelled` | Button receives translated `aria-label`; icon is hidden from the a11y tree. |
| `TabsSidebar.vue` collections tab | Layer override / `TabIcons.collections` | Migrate | `bookmark.collections` | `control-labelled` | Layered tab definitions must resolve to a registry key. |
| `TabsSidebar.vue` RSS tab | Inline path in `TabsSidebar.vue` | Migrate | `bookmark.rss` | `control-labelled` | Only the sidebar RSS icon is in scope; `RssIcon.vue` remains deferred. |
| `TabsSidebar.vue` trash button | Inline SVG in `TabsSidebar.vue` | Migrate | `bookmark.trash` | `control-labelled` | Keeps selected/hover states and explicit translated label. |
| `bookmarkEmptyConfig.ts` configured empty states | `designIcons.ts` plus inline strings | Migrate | `empty.inbox`, `empty.starred`, `empty.topics`, `empty.highlights`, `empty.archive`, `empty.trashed`, `empty.collections` | `decorative` | Config stores semantic registry keys, not SVG strings. |
| `bookmarkEmptyConfig.ts` fallback | Inline circle string | Migrate | `empty.fallback` | `decorative` | Keeps the existing 24×24 fallback viewBox. |
| `BookmarksEmptyState.vue` | `v-html` into an application-owned SVG | Migrate | Configured key from `bookmarkEmptyConfig.ts` | `decorative` | No duplicate screen-reader output. |
| `BookmarksEmptyView.vue` default slot | Inline circle SVG | Migrate | `empty.fallback` | `decorative` | Default slot remains available for non-registry callers. |
| `SearchHeader.vue` no-results slot | Inline search SVG | Migrate | `empty.search` | `decorative` | Search result text remains the meaningful content. |
| `TagsHeader.vue` empty-tags slot | Inline tag SVG | Migrate | `empty.tags` | `decorative` | Empty state remains visually unchanged. |
| `pages/bookmarks/index.vue` feed-closed lock | Inline lock SVG | Migrate | `empty.lock` | `decorative` | Existing surrounding heading and description remain unchanged. |
| `TagsHeader.vue` add/back/untagged controls | Inline control SVGs | Defer | — | Existing behavior | Separate control-surface migration. |
| `RssIcon.vue` and RSS panel | Component-local path map | Defer | — | Existing behavior | Separate RSS surface and accessibility review. |
| Snapshot toolbar and page actions | Component-local inline/mask paths | Defer | — | Existing behavior | Different renderer and state profile. |
| `ThemeSwitcher.vue` | Component-local icons | Defer | — | Existing behavior | Theme control needs its own state review. |
| Article-content SVG processing | User/content renderer | Defer | — | Existing behavior | Not application-owned registry input. |
| Extension icons | Extension-owned assets and profile | Defer | — | Existing behavior | Keep Web and Extension profiles separate. |

## Verification record

- `pnpm icons:test`: passed (13 tests).
- `pnpm icons:check`: passed (20 generated entries, source hashes and generated output agree).
- Focused Web Vitest coverage for `AppIcon`, `TabsSidebar`, `BookmarksEmptyState`, `BookmarksEmptyView`, `SearchHeader`, and `TagsHeader`: passed (67 tests).
- Focused Web ESLint: passed with five pre-existing warnings (four unused parameters in `useBookmarkRelative.ts` and one existing explicit-`any` warning in the sidebar test); no errors.
- `pnpm design:check`, `pnpm exec openspec validate --all --strict`, and `pnpm agent:check`: passed.
- Web typecheck and full Web test execution remain blocked by the pre-existing missing `mermaid` package from `packages/frontend-utils/src/mermaid.ts`; the focused icon/component checks pass independently.
- A temporary browser harness rendered all migrated registry entries in light, dark, and e-ink profiles at the registered 18px/32px sizes and at the 768px responsive transition; icons retained their currentColor contrast, stroke geometry, and layout behavior. The authenticated `/bookmarks` route itself redirects to sign-in in this environment, so page-level data states remain covered by the focused component tests.
