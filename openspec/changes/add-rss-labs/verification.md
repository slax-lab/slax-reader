# RSS Labs implementation verification — 2026-09-23

代码直接位于 `/Users/daguang/project/slax-reader`、`/Users/daguang/project/slax_reader_frontend`、`/Users/daguang/project/slax-reader-client`，按用户要求未写入 `.worktrees`。三个项目已有的其他未提交修改保持原样；尚未提交、推送、创建 PR 或部署。

## 数据库

用户明确要求丢弃旧 RSS 实验数据且不备份。仅删除了本地 PostgreSQL 的旧 `sr_rss_*` 表及其旧 RSS Prisma 迁移记录，其他业务表和 Inbox 收藏未重置。最终模型由 `pnpm api -- gen:diff` 生成 `20260923042657_reset_rss_labs_shared_feed`；追加时间线索引后，再由同一命令生成 `20260923044137_add_rss_timeline_index`。两个迁移均通过 `pnpm api -- migration:local:pgsql` 在本地应用。数据库可见 `sr_rss_entry_page` 和 `sr_rss_entry_timeline` 两个索引。未对其他环境执行 RSS 表清理或数据库部署。

## 实现状态

- API：共享 Feed、用户订阅及自定义名称、源级租约、定时和手动更新、R2 正文及签名图片代理、收藏到 Inbox 的持久化补偿。没有旧 HTML 回填或备份逻辑。
- 时间线：跨来源和单来源均按 `sort_at DESC, id DESC` 查询与游标分页；发布时间修正时重排，无日期条目固定在首次发现时间。两个查询范围各有数据库索引。
- Web：RSS 位于 Inbox 下方并复用其页面布局；顶部按 Collection 风格显示来源头像，站点图标经签名代理加载，失败回退到本地字母头像。文章按日期分组；`rss.description`、`rss.empty_hint` 及页面使用的其他 `rss.*` 文案已放到正确语言层级。
- APP：原生 Compose 页面支持订阅名称、来源缓存、预览和收藏；不使用 WebView。API 增加可选图标字段供客户端解析。

## 检查与待办

最新 API/contracts TypeScript 检查、Android 编译、OpenSpec 严格校验及三个仓库 `git diff --check` 通过。前端 vue-tsc 没有 RSS 修改相关错误，仍有 9 项位于未修改的 upstream 代码。此前 iOS 编译通过，但可选图标 DTO 加入后尚未重新编译 iOS。用户要求先暂停单测，因此本轮时间线、图标和文案修改尚未运行单测。浏览器视觉与真实三端联调、生产 R2/bindings、其他环境迁移仍待验证.

## 2026-09-23 Cloudflare Feed 回退

已核对默认只抓源第一页、显式 Load more 才补抓共享历史。新增 SlaxFetch.zyteResponse 保留 XML 字节/响应头，在 Feed 挑战时回退；各跳转校验公共目标、跨源清除条件头，并遵守源 Retry-After、体积及总时限。APP 仅 RSS 添加和 Load more 扩展到 120 秒等待。API typecheck、Android compileDebugKotlinAndroid、定向 lint（1 个既有 unused lang 警告）、OpenSpec strict 和 diff whitespace 检查通过。已补充回归，按用户要求未执行单测，未使用真实 Zyte 凭据请求源站。历史分页迁移仍未生成/同步，等待用户本机执行规定命令；不能将此项记为数据库闭环完成。

## 2026-09-23 财富中文网实源与迁移确认

直接检查用户提供的 Feed XML 顶层条目与链接：15 条、无历史分页链接。本地对应 Feed 同样为 15 条和空 history_url。已只读确认本地 _prisma_migrations 中 20260923065020 与 20260923071634_add_rss_history_paging 均已应用，解除此前迁移状态阻塞；后者为空迁移，测试已改为加载实际添加字段的 20260923065020。Web/APP 尾部提示改为未发现更多 RSS 分页链接，避免声称网站历史已全部收录。

## 2026-09-23 APP 顶部来源与详情调整

按用户确认，每个 RSS 源与 Collection 平级显示在 Inbox 顶部，原位切换并保留列表状态；独立 RSS 首页路由及下拉入口已删除。文章显示标题、摘要、缩略图。订阅编辑改用底部面板，失败保留输入。详情通过现有 BookmarkRoutes / DetailScreen 的 RSS 来源模式复用阅读器，顶部及长文末尾提供共享状态的收藏按钮，并将收藏结果回传首页。

最新 Android compileDebugKotlinAndroid 编译、diff whitespace 和 OpenSpec 严格校验通过。没有运行单测、仪器测试或 UI 测试，后续遵守用户不运行测试的要求。iOS 编译此前阻塞在 StoreKit Swift 包构建的 sandbox_apply 权限错误，本轮未再次运行；没有运行中的模拟器，视觉效果及 iOS 长文底部按钮尚未实际确认。

## 2026-09-23 Web consolidation onto current dev

Merged `origin/dev` at `9fe4057` into the local `feat/add-rss-labs` branch with a fast-forward. Existing API changes and untracked RSS files were restored after the update; conflicts in the contracts exports were resolved by retaining both the new dev exports and RSS.

Ported the legacy frontend working-tree delta from `../slax_reader_frontend/apps/slax-reader-dweb` into `apps/web`: Inbox integration, RSS navigation, source icons, the RSS panel and redirect route, cache/history composable, preview sanitizer, locale entries and existing regression files. Imports now use the flattened app paths and `@slax-reader/contracts`. The duplicate `commons/types-pro` RSS DTO and fixture are already covered by the canonical contracts package; its fixture also carries the newer icon/history fields. Preserved dev's existing Labs translations and settings navigation, and adapted the RSS settings link to `#features`.

The legacy Nuxt persistence-path override is superseded by `apps/web/config/backend-binding.ts`, which already selects `deploy/local/.wrangler/state/v3`. The new dev Nuxt configuration was retained. No legacy environment files were read or copied. The legacy frontend checkout and the native APP checkout were not modified.

`pnpm install --frozen-lockfile`, contracts type checking, targeted ESLint (0 errors; 23 existing style/type warnings), OpenSpec strict validation (10 items) and whitespace checks passed. `pnpm web -- typecheck` generated Nuxt types, then reported 11 errors in unchanged authentication/request/notification code involving unknown runtime configuration values; none referenced migrated RSS files. The command also warned that required Web environment values were absent from the new configuration location. These findings do not establish a successful runtime or visual check. No tests were executed, per the user's instruction.
