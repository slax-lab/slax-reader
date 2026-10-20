# 私人收藏与 Reader Fork 功能可行性分析

## 分析范围

本文用于核对当前收藏流程，并分析以下功能的实现方式：

1. 后续所有新收藏都属于收藏者自己的私有数据；
2. 收藏 `/b/<user-bookmark-uuid>` 时复制源文章内容，生成自己的私有副本；
3. 其他用户访问 `/b/<id>` 时，在页面顶部提供 Fork 按钮，手机浏览器也可以使用。

本文只做分析，不修改 API、数据库或 UI 行为。

## 当前代码行为核对

### “URL 收藏是公共内容”与当前代码不一致

当前主要收藏入口已经会创建私有收藏记录：

| 入口 | 路由/代码路径 | `sr_bookmark.private_user` |
| --- | --- | --- |
| 插件或内联 HTML | `POST /v1/bookmark/add` → `BookmarkService.createInlineBookmark` | 当前用户 ID |
| 添加 URL | `POST /v1/bookmark/add_url` → `BookmarkService.createUrlBookmark` | 当前用户 ID |
| 批量导入 URL | `BookmarkService.addUrlBookmarkItem` | 当前用户 ID |
| PowerSync 创建 | `DBSyncBatchOperation.executeCreateBookmark` | 当前用户 ID |

`createBookmarkBase` 会把这个值传给 `BookmarkRepo.createBookmark`。主表的唯一键是 `(target_url, private_user)`，随后还会在 `sr_user_bookmark` 中创建用户关系。相关代码位置：

- `apps/api/src/domain/bookmark.ts:118-193`：`createBookmarkBase`
- `apps/api/src/domain/bookmark.ts:199-247`：`createInlineBookmark`
- `apps/api/src/domain/bookmark.ts:267-317`：`createUrlBookmark`
- `apps/api/src/infra/repository/dbBookmark.ts:248-325`：查询、upsert 和用户关系创建
- `apps/api/test/domain/privateBookmarkSave.test.ts`：私有收藏测试

所以，你提出的“以后插件收藏和 URL 收藏都必须是私有数据”，在当前实现中实际上已经基本成立。后续改造重点应该是保留这个行为，并审计历史公共数据，而不是把这两个入口重新改成另一种默认模式。

有两个需要注意的地方：

- `private_user = 0` 是历史公共/共享内容的约定。数据库中已有的这些记录可能仍然是公共内容。
- `BookmarkService.bookmarkExists` 仍保留旧的公共查询分支。当前 `/s/<share-code>` 转存流程依赖公共/快捷方式语义，因此不能直接无条件改成只查当前用户。实现时应按“快捷方式”和“完整内容”明确区分，并确认哪些旧的 server-parse 调用还需要查询 `private_user = 0`。

工作流中出现的 `privateUser: 0` 只是旧 post-processing 使用的队列消息字段，不会改变已经创建好的 `sr_bookmark.private_user`。`CrawlWorkflow` 只有在当前书签记录本身确实是公共记录（`private_user === 0`）时才会短路复用；私有记录仍然会单独抓取和解析。

### 插件 HTML 和 URL 的解析、R2 写入流程

插件通过 `/v1/bookmark/add` 传入页面 HTML。服务端先创建一条 pending 状态的私有收藏，再把 HTML 作为 `inlineContent` 交给 crawl workflow。workflow 解析 HTML，最后把结果写入 R2。

URL 收藏通过 `/v1/bookmark/add_url` 创建 pending 状态的私有收藏，然后启动 crawl workflow。workflow 会直接请求 URL，或调用配置好的第三方服务获取内容，再完成解析、R2 写入和数据库更新。

新 workflow 对普通文章通常使用基于 `sr_user_bookmark.uuid` 生成的 key：

- `html/body/<user-bookmark-uuid>.html`
- `text/body/<user-bookmark-uuid>.txt`

`CrawlService.saveParseRes` 会写入这些对象，并更新 `content_key`、`content_md_key`、标题、摘要、字数、作者、站点名、发布时间和状态。对应代码在 `apps/api/src/domain/crawl.ts:702-719`。

Fork 时必须以源记录中实际保存的 `content_key` 和 `content_md_key` 为准。旧的解析路径可能使用 `html/parse/...` 这类历史 key，因此不能只根据源 UUID 猜测源对象路径；应该读取源记录中的 key，再复制到目标 key。

### `/b/<id>` 是用户收藏 UUID，不是公共文章 ID

`/b/<id>` 中的 ID 是 `sr_user_bookmark.uuid`，不是 `sr_bookmark.id`、`sr_bookmark.uuid`，也不是 share code。

访问链路如下：

1. Web 请求 `/api/content/<uuid>`。
2. `apps/web/server/utils/loadContent.ts` 读取 `html/body/<uuid>.html`，同时请求 `content.internal/content/meta?uuid=<uuid>`。
3. `ContentOrchestrator.loadBookmarkMeta` 读取用户收藏关系，并返回 `role`、`bookmark_uuid`、`user_id`、`target_url`、`user_info`、`content_key` 等元数据。
4. `resolveBookmarkReadAccess` 允许所有者直接访问；其他访问者必须通过删除状态、内容审核、用户状态、快照分享策略等检查。

权限代码在 `apps/api/src/utils/bookmarkAccess.ts`，元数据组装在 `apps/api/src/domain/orchestrator/content.ts`。

当前代码中还没有 fork API、R2 复制逻辑，也没有 `/b/[id]` 页面上的 Fork 按钮。

## 推荐实现方案

### 1. 保持普通收藏为私有

不要把 URL 收藏改回公共内容。`/add`、`/add_url`、导入、PDF 和 PowerSync 都应继续使用：

```ts
private_user = ctx.getUserId()
```

隐私加固可以单独处理：

- 按“快捷方式/完整内容”拆分 `bookmarkExists` 的查询意图，同时保留 `/s` 快捷方式兼容性；
- 只在明确的历史公共功能中查询公共行；
- 保留现有 `private_user = 0` 数据；审计其兼容调用边界，避免新流程误读或覆盖历史公共数据。

这样可以保证：其他用户之后收藏同一个 URL 时，不会更新第一个用户的私有记录。现有 `(target_url, private_user)` 唯一键已经提供了按用户隔离的基础。

### 2. 新增独立的 Fork 服务和 API

建议新增：

```http
POST /v1/bookmark/fork
Authorization: Bearer <token>
Content-Type: application/json

{ "bookmark_uid": "source-user-bookmark-uuid" }
```

建议响应：

```json
{
  "bmId": "目标收藏的编码 ID",
  "bookmark_uid": "目标用户收藏 UUID",
  "write_mode": "created",
  "fork_info": {
    "source_bookmark_uid": "源用户收藏 UUID",
    "source_user_id": "源用户编码 ID",
    "source_display_name": "Reader 用户名",
    "source_snapshot_url": "/b/source-user-bookmark-uuid"
  }
}
```

服务端应按以下顺序处理：

1. 要求当前请求已经登录，并且用户处于 active 状态；
2. 使用 `resolveBookmarkReadAccess` 校验源文章，不能相信客户端传入的 owner ID；
3. 源记录不存在、仍在 pending、解析失败、被删除、被审核拦截或没有有效内容时拒绝 fork；
4. 对同一用户、同一规范化 URL 的已有私有收藏执行覆盖写入；不因为已有记录而返回旧内容；
5. 没有已有记录时创建私有 `sr_bookmark` 和 `sr_user_bookmark.uuid`；已有记录时保留目标 `sr_user_bookmark.uuid`，以免改变现有 `/b/<id>` 地址；
6. 把新内容先复制到新的临时/版本化 R2 key，再以数据库更新切换目标记录；旧 R2 对象在确认新版本可读后异步清理；
7. 复制文章元数据，但不复制源用户的划线、评论、标签、摘要和分享设置；
8. 创建搜索索引、收藏变更记录等副作用，但不要启动新的抓取 workflow；
9. 返回目标 UUID，供 Web 页面跳转到新的私有副本。

每次 Fork 完成时都是源文章的一次快照。源文章之后重新解析、修改、撤销分享或删除，都不应该自动影响已经完成的目标内容；但同一用户之后再次以相同 URL 直抓或 Fork 时，新的内容会按“新数据覆盖旧数据”规则替换目标收藏。

### 3. R2 复制规则

当前代码没有封装 R2 的服务端 copy 方法。Fork 服务需要读取源对象，再以目标 key 写入 R2，并尽量保留 HTTP metadata 和 custom metadata。若后续数据库步骤失败，需要删除已经写入的目标对象。

覆盖已有收藏时，失败清理只能删除本次操作的新对象，必须保留上一版已发布内容。版本 key 与数据库指针切换需要同时调整读取路径：`apps/web/server/utils/loadContent.ts` 当前优先读取固定的 `html/body/<uuid>.html`，仅缺失时才读取 `content_key`；采用版本 key 后，必须以当前已提交的 `content_key` 为准，并刷新相关内容缓存，否则仍可能展示旧正文。直抓与 Fork 都需要遵循这一写入和读取协议。

至少需要复制：

- HTML：源记录的 `content_key` → 目标版本的 HTML key；
- 文本：源记录的 `content_md_key` → 目标版本的文本 key，如果存在；
- PDF 正文：从源记录实际的 `content_key` 派生 body key，再复制到目标版本的 PDF key；
- PDF 文本 sidecar：从源 PDF key 派生对应的 `text/pdf/...txt`；
- PDF 状态 sidecar：从源 PDF key 派生对应的 `pdf/meta/...json`。

如果 PDF 仍在等待文本提取，或者必要的 body/meta 对象缺失，应返回明确的“内容不可用”错误，不能生成一个看似成功但内容不完整的副本。

文章 HTML 中的图片通常已经被替换成图片代理 URL，因此一般不需要再次复制图片对象。但实现时仍应验证这些代理 URL 在目标副本中可以继续使用。

目标数据库记录必须指向新的 R2 key。直接复用源 key 会导致两个用户共享可变存储，无法满足私有隔离要求。

### 4. 保存 Fork 来源关系

建议新增独立的 `sr_bookmark_fork` 表，不要把 fork 信息直接塞进 `sr_user_bookmark.metadata`。这个 metadata 会被 PowerSync 相关 trigger 维护，不适合作为稳定的业务扩展字段。

建议字段：

```text
id
destination_target_url
destination_user_id
destination_bookmark_id
destination_user_bookmark_uuid
source_user_id
source_bookmark_id
source_user_bookmark_uuid
source_url
source_display_name_snapshot
source_display_name_visible
status              -- copying | success | failed
created_at
updated_at
```

同一用户可以多次 Fork 同一个源；每次成功写入都更新同一 URL 的目标收藏。lineage 应保存当前生效来源，并可选择保留历史版本用于审计；如果只保留当前来源，应对 `(destination_user_id, destination_target_url)` 建唯一约束，而不是把同一源 UUID 作为唯一维度。保存源、目标的 bookmark ID，便于查询和后续清理。

源用户的显示名必须遵守源文章的分享策略。当前项目已经支持按单篇分享控制是否显示用户信息：分享弹窗中的“显示我的用户信息”选项会写入 `show_userinfo`，访问 `/b/<id>` 时据此控制昵称和头像是否返回。这个设置不是全局的用户名隐藏开关；没有分享记录时，还会结合用户的 `snapshot_sharing` 设置和访问者是否为所有者处理。

Fork 实现应复用现有的分享策略计算，不要只读取 `show_userinfo` 一个字段。Fork 成功时保存“来源显示策略”和必要的展示快照：源文章取消分享后，已经完成的目标私有副本仍然可读，已授权的来源快照继续展示，源链接仍保留为原 `/b` 地址但可能无法打开。

### 5. 同 URL 覆盖、重试与并发规则

Fork 时按规范化后的 `(target_url, private_user)` 查找目标收藏。规则是：同一 URL、同一私有用户永远只有一份当前数据，任何新的直抓或 Fork 都覆盖旧内容。目标已有记录时，不返回旧内容作为幂等结果，而是执行覆盖写入并返回 `write_mode: "overwritten"`；没有记录时创建新行并返回 `write_mode: "created"`。目标仍使用原始 URL 作为 `target_url`，这样 Source 标签继续指向真实网页。

这里的“同一用户”是必要条件：`private_user` 必须等于当前用户 ID 且大于 0。其他用户的私有行以及存量 `private_user = 0` 行不能成为覆盖目标。插件、URL 收藏、导入、PowerSync 与 Fork 的同 URL 写入都遵守这条规则；URL 规范化沿用一致的规则，不因入口不同而创建另一份内容。

覆盖写入更新正文、文本/PDF sidecar、标题、网页描述、作者、站点信息和当前来源关系。新版本不适用的旧内容字段和 sidecar 指针也应清空，避免混用两版数据。不能把源用户的划线、评论、标签、AI 摘要或分享设置复制到目标；目标用户自己的标签、划线、评论和分享设置保留，正文改变后失效的划线定位及派生 AI 结果需要失效处理。已有目标处于 pending、failed 或垃圾桶状态时，也按新数据写入流程处理，并遵循现有关系恢复语义；新操作失败时保留上一版成功内容并返回失败，不能把旧内容当成本次成功结果。

当前展示的来源必须与正文一起切换：Fork 覆盖后，`Fork:` 更新为本次源收藏；直抓覆盖后，移除当前 `fork_info`，不能继续显示旧的 Fork 来源。历史来源可供审计，但不能作为当前正文的来源展示。源撤销分享不触发任何自动更新。

同一用户的同 URL 直抓版本和 Fork 版本不并存，后续继续采用新数据覆盖旧数据规则，不引入 `slax-fork://` synthetic URL。目标 `sr_user_bookmark.uuid` 建议保持不变，R2 内容采用新版本 key 后切换数据库指针，旧 key 异步清理；短期保留旧对象用于恢复不代表收藏列表中保留多份文章。

区分主动再次收藏和传输重试：用户主动再次直抓/Fork 是新操作，会重新获取或复制内容；同一操作的网络重试使用相同幂等键，返回该操作已有结果或状态，不重复写入。不能只按源 UUID 去重，否则用户无法再次 Fork 更新后的源内容。

推荐以服务端受理顺序为每个 `(target_url, private_user)` 的写入分配递增版本。成功提交的版本只能前进，旧任务晚完成或重试不能覆盖已经提交的新版本；失败操作不发布半成品。这个版本检查需要覆盖普通 crawl、Fork 和异步搜索/通知等副作用。推荐流程：

1. 校验源文章；
2. 按当前用户和幂等键识别重试；新操作在短数据库事务中为目标 URL 预留行或写入版本，不持有数据库锁等待 R2；
3. 新目标生成 UUID，已有目标复用原 UUID，记录复制任务的 `copying` 状态，保留上一版生效来源；
4. 将新内容复制到新版本 R2 key；
5. 在短事务中检查版本并提交内容指针、文章元数据、关系状态、当前 lineage 和数据库变更日志；唯一键冲突后重新定位同一目标并继续本次覆盖，不能直接返回旧内容；
6. 事务外按已提交版本更新搜索索引、缓存和通知，失败时可重试；被更新版本取代的操作返回明确状态，不宣称自己的内容已生效；
7. 失败或被取代时仅清理本次未发布对象；成功后异步清理已无引用的旧对象，崩溃遗留对象由恢复/清理任务处理。

由于 Fork 会放大存储使用量，应增加速率限制和对象大小限制。

### 6. 通过 URL 收藏 `/b/<uuid>`

普通 URL parser 不能真的去网络请求 `/b/<uuid>`。生产环境中，`URLPolicie` 只把 `/s/<code>` 识别为站内快捷方式，其他站内路径会被判定为 blocked，因此当前 `/add_url` 直接传 `/b` 会被拒绝。

应在进入 `URLPolicie` 前增加严格的 Reader URL 识别：

- 只允许配置中的 `FRONT_END_URL` origin；
- 只接受 `/b/<uuid>` 这种严格路径；
- 拒绝外部 origin、备用 host、异常 query、畸形路径；
- 识别成功后调用同一个 Fork 服务；
- 插件即使同时传了 HTML，也必须忽略这份 HTML；
- 不要进入普通 crawl workflow。

最干净的方案是让页面和移动端直接调用 `/v1/bookmark/fork`。为了兼容旧客户端，也可以让 `/v1/bookmark/add_url` 识别严格的 `/b/<uuid>` 并转调 Fork 服务。批量导入遇到 `/b` 时，应明确选择跳过或调用 Fork 服务，不能把它当普通网页放进解析队列。

### 7. `/b/[id]` 页面 UI

Fork 按钮最适合放在 `SnapshotTopBar` 右侧、分享按钮之前。桌面端和移动端共用这个顶部区域；当前 owner 专用的底部工具栏不适合承载访客操作。

交互建议：

- 访客访问一个可读的他人快照时显示 Fork；
- owner 查看自己的页面时隐藏 Fork；
- 未登录用户点击时先打开登录，并保留当前 `/b/<uuid>` 地址；
- 已登录用户点击后 POST 源 UUID，显示 loading 并禁止重复点击；
- 成功后跳转到返回的目标 `/b/<destination-uuid>`，或显示明确的成功状态；
- 源文章不可用、权限不足、仍在解析或复制失败时显示错误状态。

内容 metadata 建议增加可选的 `fork_info` 和 `can_fork`。当前 `SnapshotArticleSource` 显示的是原始 `target_url`、站点名和作者信息。应保留 Source 展示，再增加一个单独的 Fork 来源链接，指向源 `/b/<uuid>`。

不要复用 `footerVia`：当前 `/b/[id]` 页面把它固定为空，而 footer 的语义是 “Shared via”，与 Fork 来源不是一回事。

可能涉及的 Web 文件：

- `apps/web/app/pages/b/[id].vue`
- `apps/web/app/components/Snapshot/SnapshotTopBar.vue`
- `apps/web/app/components/Snapshot/SnapshotArticleSource.vue`
- `apps/web/app/components/Article/BookmarkArticle.vue`
- `apps/web/app/components/Article/BookmarkArticleLocalFirst.vue`
- `packages/contracts/src/augmentations.ts`
- Web locale 文件和 REST path 枚举

新按钮需要使用现有 `--slax-*` 语义 token，具备明显的 focus 状态、可访问名称、loading/error 状态和适合触屏的点击区域。需要验证桌面端、`768px` 断点、最窄移动端宽度，以及 light、dark、e-ink 三种模式。

## 主要风险与决策状态

以下事项已根据当前产品决定或本次讨论确定。标记为“已确定”的内容不再作为 OpenSpec 的待确认问题；标记为“采用默认方案”的内容按文档中的推荐方案实现，除非后续产品讨论明确改变它。

| 事项 | 当前决定 | 状态 |
| --- | --- | --- |
| 已有 `private_user = 0` 数据 | 保留存量数据，不静默迁移或删除；继续审计其兼容调用边界 | 已确定 |
| Fork 后源文章取消分享 | 不影响已经完成的 Fork 私有副本，目标内容继续保留 | 已确定 |
| 源用户隐藏姓名 | 使用现有单篇分享的 `show_userinfo` 策略；隐藏时不显示昵称和头像，至少保留匿名文案或源快照链接 | 已确定基本规则；实现需复用现有权限计算 |
| 来源姓名的保存方式 | Fork 时保存可审计的来源展示快照；源后续取消分享时，目标正文和已完成的 Fork 关系不变，已获得授权的来源快照继续显示，源链接仍指向原 `/b` 地址但可能无法再打开 | 采用默认方案 |
| 目标已有同 URL 私有收藏 | 使用同一目标行并用新抓取/Fork 数据覆盖正文、元数据和当前来源关系；返回 `write_mode: "overwritten"` | 已确定 |
| 源是快捷方式 | 第一版拒绝复制无正文的快捷方式，后续另行设计 | 采用默认方案 |
| 源仍在 pending/failed | 返回明确业务错误，不自动重新抓取源文章 | 采用默认方案 |
| PDF Fork | 第一版只支持 body、text、meta sidecar 均完整的 PDF；key 从源实际 `content_key` 派生 | 采用默认方案 |
| 直抓版本和 Fork 版本并存 | 不并存，后续也按同一用户、同 URL 新数据覆盖旧数据；不引入独立 Fork URL | 已确定 |
| 重试与并发 | 主动再次收藏是新写入；同一次操作的网络重试保持幂等；旧任务不能覆盖已提交的新版本 | 实现建议 |
| 当前 Fork 来源 | Fork 覆盖时更新来源，直抓覆盖时清除当前 Fork 来源；与内容一起提交 | 实现建议 |
| Fork 自己的文章 | 默认允许可读的源；同次操作重试去重，不同操作按覆盖规则处理；源与目标相同时不生成指向自身的来源关系 | 采用默认方案 |
| Fork 权限 | 仅允许通过现有 `getBookmarkReadAccess` 判定可读的源文章；不可读、删除、审核拦截或禁用分享的源拒绝 Fork | 采用默认方案 |
| 源用户删除或目标删除后的 lineage | 目标副本保留；来源关系按明确的 `SET NULL`/软删除策略保留可审计记录，并由清理任务处理孤儿对象 | 采用默认方案 |
| 大对象复制 | 大 HTML/PDF 使用异步复制任务或可恢复状态，不把长时间 R2 复制完全绑定在单次 HTTP 请求上 | 采用默认方案 |

## 建议实施阶段

### 阶段一：隐私加固

- 按快捷方式/完整内容意图拆分 `bookmarkExists`，保留 `/s` 兼容性；
- 保留并审计 `private_user = 0` 的历史数据；
- 增加服务层测试，确保 `/add`、`/add_url`、导入和 PowerSync 都持续写入私有记录。

### 阶段二：后端 Fork

- 增加 Fork contract 和 REST path；
- 增加 `sr_bookmark_fork` migration 和 repository 方法；
- 实现源权限校验、同 URL 覆盖、操作幂等、跨入口写入版本控制、R2 复制和失败恢复；
- 让内容读取、搜索索引、缓存和来源展示跟随已提交版本；
- 增加 HTML、文本、PDF、并发和重试测试；
- 增加速率和对象大小限制。

### 阶段三：`/b` URL 兼容

- 增加严格的 `/b/<uuid>` 识别；
- 让 `/add_url` 的 `/b` 请求转调 Fork 服务；
- 明确批量导入遇到 `/b` 时的处理策略。

### 阶段四：Web UI

- 增加 `fork_info` 和 `can_fork` metadata；
- 增加顶部 Fork 按钮和登录后返回逻辑；
- 增加 Source + Fork 来源展示和多语言文案；
- 验证响应式、主题、无障碍和错误状态。

这个功能会改变用户可见行为，因此正式实现前必须先走 OpenSpec proposal。Proposal 需要把上表中的决定转成可测试的行为，尤其是 `show_userinfo`、同 URL 新数据覆盖旧数据、并发写入顺序、PDF sidecar、R2/数据库失败恢复，以及 lineage 删除策略。

## 验证清单

- 插件 HTML 收藏使用当前用户的 `private_user`，并写入独立 R2 key；
- URL 收藏使用当前用户的 `private_user`，不会被其他用户复用或更新；
- 第二个用户收藏相同 URL 时，不能修改第一个用户的标题、正文或 R2 内容；
- 可访问的 `/b` 源文章可以在不重新请求原网页的情况下 Fork；
- 不可访问、已删除、被审核拦截或已禁用分享的源不能 Fork；
- 目标 HTML/text/PDF key 与源 key 不同；
- 源文章重新解析、撤销分享或删除不会自动改变目标私有副本；
- 同一用户同 URL 的直抓→Fork、Fork→直抓、Fork→Fork、直抓→直抓均覆盖原记录，目标 UUID 保持稳定；
- Fork→Fork 更新当前来源；Fork→直抓清除当前来源；内容和来源版本一致；
- 同次操作重试不重复写入；旧任务晚完成不能覆盖已提交的新版本；
- R2 复制或数据库提交失败保留上一版成功内容；读取和缓存不会继续优先返回旧固定 key 的正文；
- 源文章的划线、评论、标签、概览和分享策略不会被复制；
- Source 仍显示原始网页，Fork 链接指向源 Reader 快照；
- 未登录手机用户点击 Fork 时会进入登录，并保留原始 `/b` 地址；
- 正式实现后通过 `openspec validate --all --strict`。
