# Legacy frontend synchronization audit

Inspected and synchronized on 2026-10-09. All 16 identified application commits are ported across the 23 audited paths. See `validation.md` for checks and the additional regression fixes made during the port.

## Immutable comparison points

- Read-only source checkout: `/Users/yjc/Documents/Company/slax-reader` (`unnoo/slax_reader_frontend`).
- Original import: `8a983148fdd1da2f145e7797be070d3fbe8f791a`, documented by v2 commit `eacc624` in its historical `docs/migrations/slax-reader-web-extension.md`.
- Source local `develop`: `3ee57104cf1a4d68dc62a13e90e2513d85d5bc81` (2026-09-28).
- Selected source: remote-verified `origin/develop`, `378d9ae91c3fc004c453d7947f1d77ee5fe5a7eb` (2026-09-30). It includes the tag changes missing from local `develop`.
- V2 comparison/base: remote-verified `origin/dev`, `eab5d518721a18033a60b25ea6d2064856afe34e` (2026-10-08).
- Task branch: `feat/sync-legacy-frontend-develop`; PR base: `dev`.

Initial inspection used the adjacent source checkout while GitHub access was unavailable. Before implementation, GitHub access was restored and the source branch API and target fetch confirmed both SHAs above. Existing untracked `docs/superpowers/` in the source checkout was not read or modified.

## Counts and method

The reachable range `8a983148..378d9ae9` contains **28 commits: 8 merge commits and 20 non-merge commits**. Of the 20, **16 contain unsynchronized application changes** (12 tag presentation, 2 article table, 2 Extension fixes); 2 concern legacy CI/deployment and 2 temporary reports. Merge commits are excluded from feature counts to avoid double counting.

The net application diff is **23 files (18 modified, 5 added), 776 insertions and 55 deletions**: Web 21 files (+767/-52), Extension 2 (+9/-3). This includes 15 implementation files and 8 tests. There are no shared-library changes. The full net source diff additionally includes 3 CI/deployment files (26 files total).

For each changed application file, compare three blobs: source baseline, source tip, and the mapped v2 base. All 18 existing target files retain the baseline behavior: 3 are byte-identical and 15 differ only through v2 package/API import migration. All 5 new source files are absent from v2. No application delta in this range was already synchronized. This is content-based accounting; snapshot migration means commit ancestry alone would overcount missing work.

## Commit dispositions

| Commit | Date | Subject | Disposition |
| --- | --- | --- | --- |
| `ddcf9bc6` | 2026-09-21 | fix: prepare CI env before dependency install | Exclude: legacy CI; v2 supplies job environment before installation. |
| `50de9f64` | 2026-09-22 | fix: allow CI checks with Cloudflare-only web config | Exclude: legacy CI/deployment docs; v2 has independent config and validation. |
| `b40dffbe` | 2026-09-28 | 🐛 修复扩展聊天输入框 Shift+Enter 光标错位 | Ported application changes; temporary reports excluded. |
| `aff24a66` | 2026-09-28 | 🐛 提升采集弹窗容器 z-index 避免被页面元素遮挡 | Ported application changes; temporary reports excluded. |
| `35726b58` | 2026-09-28 | 🎨 表格超宽时启用横向滚动而非直接裁切 | Ported application changes; temporary reports excluded. |
| `284ed6a5` | 2026-09-28 | fix: make article tables fit or scroll on mobile | Ported application changes; temporary reports excluded. |
| `76060744` | 2026-09-29 | feat(dweb): add explicit bookmark tag variants | Ported application changes; temporary reports excluded. |
| `42a2c00c` | 2026-09-29 | fix(dweb): scope tag action styles by variant | Ported application changes; temporary reports excluded. |
| `330351d6` | 2026-09-29 | feat(dweb): wire bookmark list tag visual variants | Ported application changes; temporary reports excluded. |
| `607cf8d4` | 2026-09-29 | fix(dweb): size bookmark tag overflow controls by variant | Ported application changes; temporary reports excluded. |
| `96d5aff0` | 2026-09-29 | style(dweb): refresh topics tag chips | Ported application changes; temporary reports excluded. |
| `6a540b24` | 2026-09-29 | fix(dweb): preserve topics chip action gutter | Ported application changes; temporary reports excluded. |
| `1690b91b` | 2026-09-29 | test(dweb): wire detail bookmark tag variant | Ported application changes; temporary reports excluded. |
| `979745e5` | 2026-09-29 | docs: report detail bookmark tag task | Exclude: temporary task report, removed later. |
| `b032b891` | 2026-09-29 | fix(dweb): align tag action visibility and text overflow | Ported application changes; temporary reports excluded. |
| `75fcf9bf` | 2026-09-29 | fix(dweb): match text tag action geometry | Ported application changes; temporary reports excluded. |
| `48f183c7` | 2026-09-30 | deleted md | Exclude: deletion of temporary task reports. |
| `c61c01e1` | 2026-09-30 | 🔧 拆分详情页标签样式，修复列表标签 hover 展开与分割线 | Ported application changes; temporary reports excluded. |
| `4cf9b0b7` | 2026-09-30 | 🎨 微调 topics 标签关闭图标垂直位置 | Ported application changes; temporary reports excluded. |
| `4a40ae61` | 2026-09-30 | 🐛 修复列表页标签高亮态误变边框颜色 | Ported application changes; temporary reports excluded. |

## File inventory

| Source path | V2 path | Change |
| --- | --- | --- |
| `apps/slax-reader-dweb/app/components/Article/BookmarkArticle.vue` | `apps/web/app/components/Article/BookmarkArticle.vue` | Merge delta |
| `apps/slax-reader-dweb/app/components/Article/processors/index.ts` | `apps/web/app/components/Article/processors/index.ts` | Merge delta |
| `apps/slax-reader-dweb/app/components/Article/processors/table-layout.processor.ts` | `apps/web/app/components/Article/processors/table-layout.processor.ts` | Add |
| `apps/slax-reader-dweb/app/components/BookmarkList/BookmarkCell.vue` | `apps/web/app/components/BookmarkList/BookmarkCell.vue` | Merge delta |
| `apps/slax-reader-dweb/app/components/BookmarkList/TagCandidatePopover.vue` | `apps/web/app/components/BookmarkList/TagCandidatePopover.vue` | Merge delta |
| `apps/slax-reader-dweb/app/components/BookmarkList/TagChip.vue` | `apps/web/app/components/BookmarkList/TagChip.vue` | Merge delta |
| `apps/slax-reader-dweb/app/components/BookmarkList/TagChipDetail.vue` | `apps/web/app/components/BookmarkList/TagChipDetail.vue` | Add |
| `apps/slax-reader-dweb/app/components/BookmarkList/TagSection.vue` | `apps/web/app/components/BookmarkList/TagSection.vue` | Merge delta |
| `apps/slax-reader-dweb/app/components/BookmarkList/TagsHeader.vue` | `apps/web/app/components/BookmarkList/TagsHeader.vue` | Merge delta |
| `apps/slax-reader-dweb/app/components/BookmarkTags.vue` | `apps/web/app/components/BookmarkTags.vue` | Merge delta |
| `apps/slax-reader-dweb/app/composables/bookmark/useArticleSelection.ts` | `apps/web/app/composables/bookmark/useArticleSelection.ts` | Merge delta |
| `apps/slax-reader-dweb/app/composables/useTagChipInteraction.ts` | `apps/web/app/composables/useTagChipInteraction.ts` | Add |
| `apps/slax-reader-dweb/styles/article/_content-mixin.scss` | `apps/web/styles/article/_content-mixin.scss` | Merge delta |
| `apps/slax-reader-dweb/tests/integration/components/Article/BookmarkArticle.spec.ts` | `apps/web/tests/integration/components/Article/BookmarkArticle.spec.ts` | Merge delta |
| `apps/slax-reader-dweb/tests/unit/components/Article/processors/table-layout.processor.spec.ts` | `apps/web/tests/unit/components/Article/processors/table-layout.processor.spec.ts` | Add |
| `apps/slax-reader-dweb/tests/unit/components/BookmarkList/BookmarkCell.spec.ts` | `apps/web/tests/unit/components/BookmarkList/BookmarkCell.spec.ts` | Merge delta |
| `apps/slax-reader-dweb/tests/unit/components/BookmarkList/TagChip.spec.ts` | `apps/web/tests/unit/components/BookmarkList/TagChip.spec.ts` | Merge delta |
| `apps/slax-reader-dweb/tests/unit/components/BookmarkList/TagChipDetail.spec.ts` | `apps/web/tests/unit/components/BookmarkList/TagChipDetail.spec.ts` | Add |
| `apps/slax-reader-dweb/tests/unit/components/BookmarkList/TagSection.spec.ts` | `apps/web/tests/unit/components/BookmarkList/TagSection.spec.ts` | Merge delta |
| `apps/slax-reader-dweb/tests/unit/components/BookmarkList/TagsHeader.spec.ts` | `apps/web/tests/unit/components/BookmarkList/TagsHeader.spec.ts` | Merge delta |
| `apps/slax-reader-dweb/tests/unit/components/BookmarkTags.spec.ts` | `apps/web/tests/unit/components/BookmarkTags.spec.ts` | Merge delta |
| `apps/slax-reader-extensions/src/components/Chat/ChatBot.vue` | `apps/extension/src/components/Chat/ChatBot.vue` | Merge delta |
| `apps/slax-reader-extensions/src/entrypoints/content/index.ts` | `apps/extension/src/entrypoints/content/index.ts` | Merge delta |

## Reproduction

Run the following read-only commands in the source checkout:

```sh
git rev-list --count 8a983148..378d9ae9
git rev-list --count --no-merges 8a983148..378d9ae9
git log --reverse --no-merges --format=oneline 8a983148..378d9ae9
git diff --stat 8a983148 378d9ae9 -- apps/slax-reader-dweb apps/slax-reader-extensions commons
```

Read individual application blobs with `git show <commit>:<path>` and map the two app prefixes as listed above. Do not compare or copy secret files, generated artifacts, or uncommitted source files.

## Final synchronization status

- All 23 mapped application paths are present in the final diff: 21 Web and 2 Extension files. The set exactly matches the audited source application delta. No shared-package, dependency/lockfile, deployment, generated-agent, or unrelated target changes are included.
- V2 frontend types, API contract imports, and existing formatting are retained. Existing Mermaid, theme, e-ink highlighting, and outline code remains intact.
- Additional fixes within the imported tag behavior: Enter on a removal control does not also select the tag; detail clickability reacts to prop updates; list-card hover keeps its border; hidden measurement controls are inert; reduced-motion rules suppress tag/action transitions. Regression tests cover keyboard behavior, reactivity, measurement accessibility, table resize/cleanup, scroll retention, and annotation DOM identity.
- The source checkout remains on local `develop`, with no tracked changes and only its pre-existing untracked `docs/superpowers/` directory. Application files in the validation copy match the task worktree byte-for-byte.
- Validation and environment limitations are documented in `validation.md`. Published as [PR #181](https://github.com/slax-lab/slax-reader/pull/181), targeting `dev`, and attached to the task.

## Approval and remote verification

The user approved implementation on 2026-10-09: “继续同步吧，把相关的修复调整，同步到v2中”. GitHub access is now available. `git fetch origin dev` confirmed v2 `eab5d518`; the GitHub branch API confirmed legacy develop remains `378d9ae9`. The original audited range is current.
