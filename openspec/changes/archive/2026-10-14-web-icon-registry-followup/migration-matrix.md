# Web Runtime Icon Registry Follow-up Migration Matrix

This matrix records the Web control surfaces included in `web-icon-registry-followup`. The registry manifest is the executable source of truth for keys, sizes, paint policy, accessibility mode, source hashes, and provenance. The matrix records why each consumer is in scope and which renderer remains deliberately outside this change.

| Surface / consumer | Existing source | Target registry key(s) | Kind / size | Accessibility | Provenance recorded in manifest | Verification notes |
| --- | --- | --- | --- | --- | --- | --- |
| `BookmarkList/TagsHeader.vue` add tag | Inline plus SVG | `tags.add` | inline / 13px | decorative | `TagsHeader.vue#add-tag` | The `.tag-add` surface remains the named clickable affordance. |
| `BookmarkList/TagsHeader.vue` untagged | Inline tag SVG | `tags.untagged` | inline / 12px | decorative | `TagsHeader.vue#untagged` | Button text remains the accessible name. |
| `BookmarkList/TagsHeader.vue` filter back | Inline chevron SVG | `tags.back` | inline / 14px | decorative | `TagsHeader.vue#back` | The existing translated back label owns the accessible name; registry geometry is hidden from AT. |
| `BookmarkList/TagsHeader.vue` add filter | Text `+` glyph | `tags.add-filter` | inline / 14px | decorative | `TagsHeader.vue#add-filter` | The visible translated label remains the button name; icon is supplemental. |
| `RssPanel.vue` RSS compatibility wrapper | `RssIcon.vue` local path map | `rss.rss`, `rss.plus`, `rss.back`, `rss.bookmark`, `rss.check`, `rss.refresh`, `rss.close`, `rss.edit`, `rss.trash`, `rss.external`, `rss.inbox` | inline / 20px | decorative | `RssIcon.vue#<name>` | Action buttons retain their translated `aria-label`; article preview HTML keeps its existing sanitizer. |
| `Snapshot/panels.ts` and `SnapshotSidePanel.vue` | Inline panel SVG strings | `snapshot.ai`, `snapshot.transcript`, `snapshot.chat`, `snapshot.comment`, `snapshot.collapse` | inline / 16–20px | decorative | `panels.ts#<id>`, `SnapshotSidePanel.vue#collapse` | Surrounding tabs own translated labels and active state; collapse keeps its existing labelled button. |
| `SnapshotBottomToolbar.vue`, `SnapshotRightEdgeToolbar.vue`, `SnapshotMoreMenu.vue`, and detail pages | `v-html` action/panel strings | Panel keys above plus `bookmark-action.archive`, `bookmark-action.star`, `snapshot.back-to-top`, `snapshot.edit-title`, `snapshot.feedback`, `snapshot.more` | inline / 15–20px | decorative | Toolbar/MoreMenu consumers; source geometry from `pages/b/[id].vue` and `pages/s/[id].vue` where applicable | Button title/visible label and existing responsive breakpoints remain unchanged. |
| `pages/b/[id].vue` bookmark detail actions | Inline archive/star strings | `bookmark-action.archive`, `bookmark-action.archive-active`, `bookmark-action.star`, `bookmark-action.star-active` | inline / 18px | decorative | `[id].vue#archive`, `[id].vue#star` | Active state is still owned by `active`; only geometry changes. |
| `pages/s/[id].vue` shared detail top action | Inline arrow SVG | `snapshot.back-to-top` | inline / 24px | decorative | `[id].vue#top` | Existing “top” action and event handling remain unchanged. |
| `global/ThemeSwitcher.vue` | Inline mode SVG strings | `theme.light`, `theme.dark`, `theme.eink` | inline / 14px | decorative | `ThemeSwitcher.vue#<theme>` | Buttons retain translated title, `aria-pressed`, collapsed/expanded behavior, and Web-only scope. |

## Explicit exclusions

| Surface | Reason it remains outside this change |
| --- | --- |
| Article-content and RSS preview HTML SVG processing | User/remote content has a separate sanitization and renderer trust boundary. |
| Browser Extension icons | The Extension has a separate fixed-dark profile, asset ownership, and bundle budget. |
| Snapshot share menu and unrelated local SVGs | SharePopover has its own menu/content renderer; those controls remain a separately reviewable migration. |

## Verification record

Verification completed in the Web light, dark, and e-ink theme paths at desktop width, the primary 768px transition, and the 600px narrow mobile width used by the Snapshot toolbar. Focused Web Vitest coverage for the changed surfaces is 53 tests across five files; registry tooling has 17 tests. The local Web suite still prints the pre-existing missing-environment warnings, while the separate full typecheck remains outside this change because the local Nuxt-generated runtime config is typed as `unknown` without the development environment values.
