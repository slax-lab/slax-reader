# Design

## 实现定稿补充（2026-09-23）

用户授权先完成三端实现。Feed 使用仓库已有 Linkedom 和显式 HTML 白名单重建；Cron 直接消费 PG 租约；收藏通过独立 save outbox 与确定 workflow ID 恢复。APP 按用户最新确认，将每个 RSS 源放在 Inbox 顶部与 Collection 同级切换；实验室开关仅位于设置，文章复用现有书签详情阅读器。两个外部仓库按要求直接修改，详见 verification.md。


## Context

动机与产品范围见 `proposal.md`，验收行为见 `specs/rss-labs/spec.md`。以下是本次检查到的代码事实，区别于待实现设计：

- `apps/api/src/domain/lab.ts` 已有按用户保存的实验室注册与开关；HTTP 层已有 `/v1/user/labs` 和 setting enable/disable 接口。
- API 采用 Workers、PG/Prisma、R2，以及已有 Cron/Queue/Workflow，HTTP/DI/Cron/consumer 有生成注册机制。
- `publicFetch` 是 HTTP 安全封装。普通文章仍由 `CrawlService` 调用 Zyte，再回退 ScrapingRobot；RSS Feed 获取与正文提取是不同请求。
- `Imager` 与 `imageProxy` 已有签名图片代理及 R2 缓存，但通用图片替换未覆盖全部 srcset/懒加载情况，超限路径会重定向源站。现有正文清理也不能直接作为不可信 RSS HTML 的完整净化器。
- 现有 `add_url` 返回空 `bmId`；普通收藏重入可能更新时间。RSS 需要独立结果 DTO 与明确的幂等入口，不能直接让客户端调用旧接口后假设得到书签 ID。
- Web 位于外部 Nuxt fork/layer 仓库；APP 是 KMP Compose，已有 Ktor、Koin、StateFlow、Ksoup 和原生图片组件。用户最新要求复用现有书签详情，因此 RSS 缓存正文接入该阅读器既有的 HTML 渲染容器。
- 已接入 API 基线 51b27a8，按用户要求在主目录任务分支和两个兄弟仓库直接修改，保留其无关改动。

## Goals / Non-Goals

**Goals:**

- 在已有基础设施内实现三端可用闭环，RSS 缓存和正式书签有独立生命周期。
- 后端产生单一、有限的安全 HTML 表示；Web 展示，APP 将其转换为原生内容块，避免双重抓取和平台内容差异。
- 通过少量表、受限调度和按需图片缓存控制实验室成本。

**Non-Goals:**

- 不迁移 OAuth、不更换商业正文服务、不修改旧 `add_url` 响应契约。
- 不实现 OPML、自动发现网页 Feed、JSON Feed、推荐源目录、分类/未读同步、自动收藏、通知、播客下载或全文付费订阅。
- 不部署 Miniflux/Folo/RSSHub，也不为 RSS 增加 PowerSync 表或离线全文下载系统。现有收藏后的同步继续使用。
- 原生预览支持规定的基本图文语义，不复刻任意网页的 CSS、脚本和嵌入播放器。

## Decisions

### 1. 共享 Feed 与用户订阅

PG 使用 rss_feed 保存唯一完整规范化地址、源站元信息、条件请求、退避与租约；rss_subscription 仅保存 user_id、feed_id、remark、created_at，唯一约束为用户与 Feed。相同完整 URL 可复用，保留 query/token，不合并不同令牌地址，也不提供全局 Feed 查询接口。所有文章访问仍通过当前用户订阅与 Labs 授权；用户名称和收藏状态始终独立。

首次添加先检查现有成功缓存与配额，已有成功缓存直接关联；新地址抓取并解析成功后才创建 Feed 占位、领取发布租约，随后写 R2 和提交条目。抓取或解析失败不创建 Feed、条目或订阅；R2/提交失败只清理本次仍持有租约且无成功缓存/订阅的占位。完全同时的首次请求可能重复验证，但数据库发布与后续刷新仍由共享租约互斥。网络与 R2 写入不放在数据库事务中；提交时重新校验用户/订阅、租约和活动订阅者。

### 2. 条目、正文与迁移

rss_entry 按 (feed_id, entry_key) 去重，id 用于客户端引用，entry_key 使用源 GUID/Atom ID 或稳定回退标识。PG 只保留元信息与 content_key，正文复用 BucketClient 写入 R2。抓取后先净化 HTML，再通过 Imager 的 RSS 模式批量替换图片，写入 R2 后才发布数据库引用；图片二进制仍按需共用现有代理缓存。变更正文使用新对象路径；对象路径携带正文摘要，相同正文仅复用当前条目引用的对象，减少源站始终返回 200 时的重复写入。旧任务不能覆盖现有正文；304 与失败保留上次成功引用。

时间线以 `sort_at DESC, id DESC` 做稳定游标：正常使用发布时间，无日期时固定为首次发现时间，源站修正发布时间才调整已有条目的 `sort_at`。数据库同时维护全局时间线索引和按 Feed 的时间线索引。Web 按本地日期分组显示，并在顶部用 Collection 风格的来源头像切换；站点 `/favicon.ico` 通过签名图片代理按需缓存，失效时跳过书名号、标点、数字和 emoji，按名称中的顺序提取首个汉字或首个完整单词，无可用文字时显示 RSS，浏览器不直接请求站点图标。

旧 RSS 实验数据直接丢弃，重新建立共享 Feed 表，不保留旧订阅或正文；已有 Inbox 收藏位于书签表，不随 RSS 表删除。用户删除订阅不删除其他订阅者使用的缓存；无订阅 Feed 定时清理，R2 不再引用且超过 24 小时的正文对象分批清理，覆盖替换、失效租约和写入失败遗留对象。

### 3. Feed 获取与解析分离

使用 `publicFetch` 获取字节后交给解析器，不调用自带网络抓取的 `parseURL`。Feed 默认允许公共 HTTP(S)，拒绝 URL userinfo，校验每个跳转，不透传用户会话、Authorization 或 Cookie；以最终响应地址及规范内的 base 信息解析相对 URL。规范化保留 query 和路径语义，去掉 fragment，避免将不同令牌地址误合并。

首选 [Feedsmith](https://github.com/macieklamberski/feedsmith) 的字符串解析与格式识别，通过本项目 adapter 统一 RSS/Atom/RDF 字段；它提供 Feed 解析和命名空间支持，不能替代 HTTP、安全和业务缓存。安装时锁定已发布稳定版本并在真实 Workers bundle/runtime 中验证。备选 `rss-parser.parseString` 只有在兼容性测试失败时评估，不能静默减少规格中的格式支持。

传输总时限 30 秒，解压后上限 5 MiB，跳转次数使用现有封装限制；校验字符编码并保留常见 UTF-8/UTF-16/XML 声明样例，拒绝外部实体和 DTD 展开。有效空 Feed 是成功，HTML 页面、无效 XML 和无支持格式是错误。源站 HTTP validator 仅在完整解析与事务提交成功后保存；304 不清空缓存。重定向后条件头的转发遵循现有跨源限制，不能削弱 `publicFetch`。

[Miniflux](https://github.com/miniflux/v2) 的 fetcher/request/response 处理作为条件请求、304、429 和 Retry-After 的参考，不引入其 Go 服务。这里直接请求的是 Feed 文档；用户收藏后的网页正文仍走现有商业服务。

### 4. 有界调度、租约及重试

Cron 每 5 分钟扫描至少有一个活动订阅者的到期 Feed，单轮最多 100 个，通过 PG 原子条件领取随机 token 租约，分批直接处理；不新增 Queue。并发受限，超时失败由下一轮恢复过期租约。

成功后默认 30 分钟再检查；失败采用指数退避，普通错误退避最高 24 小时；合法 Retry-After 的未来时间是额外下界，即使超过 24 小时也不得提前请求。添加验证按用户限流，手动刷新按共享 Feed 冷却并领取租约，至少 5 分钟间隔且遵守 retry_not_before。

抓取不持有长数据库事务。首次添加提交锁定用户与 Feed，重新校验账户、开关、配额及未过期租约；刷新提交锁定 Feed，校验仍存在活动订阅者及租约 token。关闭最后一个活动订阅者时清除租约，其他订阅者开启时保留共享任务。数据库遵循 relationMode=prisma，订阅、过期条目、无订阅 Feed 和孤立 outbox 使用显式 SQL 清理，不依赖迁移外键。界面以 lease_until 判定是否仍在更新。

添加先进行受限格式验证，再在事务中重新校验开关、配额和唯一约束并写入首次缓存；失败不占订阅槽。网络验证前的限流防止重复错误地址消耗不受限请求。

### 5. 安全预览与图片按需缓存

使用 [sanitize-html](https://github.com/apostrophecms/apostrophe/tree/main/packages/sanitize-html) 显式白名单净化。其依赖为纯 JavaScript，但 Workers 可运行性仍须 bundle/runtime 实测，不依赖 Node 文档就认定兼容。禁用 style、class、事件属性、iframe、SVG、object、表单、脚本及外部资源标签，限定链接协议为 HTTP(S)。净化前解析 lazy src、srcset/picture，选择一个受支持候选并转换成普通 img，移除剩余候选；净化后再验证最终可加载 URL。

安全 HTML 经图片替换后保存在 R2，条目保存对象引用；抓取时为受支持图片生成签名 HTTPS 代理地址；缩略图同样处理，不返回能被界面误用的 source fallback。提取现有 `Imager` 的签名构造为共享 helper。图片缓存使用现有代理与 R2，增加受签名保护的 RSS 图片模式或独立 RSS 路径，限制安全 MIME 和 3 MiB；缓存 key 纳入该模式，命中旧缓存也验证类型/大小，避免误取旧重定向或媒体响应。该模式的失败只能返回受控错误，不能重定向源站。保持旧书签图片及视频 Range 行为。

仅在预览或缩略图实际展示时获取并持久缓存图片，不为每个轮询条目全量预热。图片签名访问复用既有 capability URL 模型；具有完整签名 URL 的持有者可访问对应缓存，订阅 API 的用户隔离不等同于图片逐请求会话鉴权。源站地址查询参数不记录日志；签名 URL 只向有权限的请求返回。缓存生命周期遵循现有图片策略，不由删除 RSS 条目触发全局图片对象删除。

### 6. 收藏保留现有正文链路并增加幂等语义

新增 RSS save domain 入口，从已授权条目读取 article_url，沿用现有 URL 规范化和书签唯一键。在事务中查找/创建书签关系；已有有效关系直接返回并保留其时间、归档、标签和标注，已删除关系走现有恢复逻辑。新增书签才启动既有 `BookmarkAddOrchestrator` 的 URL 工作流，不能把 Feed 摘要当成完整 inline HTML 正文。

通过数据库唯一约束加稳定工作流标识保证并发请求复用同一处理；数据库提交后启动任务失败须可恢复：保存 pending 工作状态，复用现有补偿任务或扩展其扫描，重试不创建第二个书签。客户端只在持久化成功后显示已收藏，正文异步处理失败使用现有书签失败/重试能力。

列表/详情中的已收藏状态从当前用户的有效书签关系按规范化 URL 批量查询，不依赖容易过期的 RSS saved 布尔值，不因用户在 Inbox 删除书签而永久显示已收藏。无需第三张 RSS 收藏映射表。RSS 缓存清理与书签正文对象互不删除。

### 7. API 与三端契约

路径延续现有 `/v1` 风格，使用现有成功/错误 envelope 及认证中间件。以下为计划中的业务契约，字段采用各仓库既有命名映射，但其含义固定：

| API | 输入/输出 |
| --- | --- |
| GET `/v1/rss/subscriptions` | 当前用户订阅数组及更新/错误状态 |
| POST `/v1/rss/subscriptions` | `{ url, remark? }`；返回已验证订阅，重复返回原记录 |
| POST `/v1/rss/subscriptions/:id/update` | `{ remark }`；仅修改当前用户自定义显示名称，null 清空 |
| POST `/v1/rss/subscriptions/:id/delete` | 删除已授权订阅，重试幂等 |
| POST `/v1/rss/subscriptions/:id/refresh` | 返回刷新已受理/进行中与 nextAllowedAt，不等待全部条目完成 |
| GET `/v1/rss/entries` | subscriptionId 可选、cursor、limit；返回摘要数组与 nextCursor |
| GET `/v1/rss/entries/:id` | 条目、安全 HTML、文章地址、来源和当前收藏状态 |
| POST `/v1/rss/entries/:id/save` | 返回 bookmarkUserUuid、created/restored/alreadySaved、processingStatus |

外部 ID 均为不透明字符串，时间为 UTC ISO 8601 或 null；旧接口及 ID 字段不改。错误码区分 lab_disabled、invalid_feed、unsafe_url、limit_reached、refresh_limited、source_unavailable、not_found 和 article_url_missing，对外不暴露内部异常/源地址。Labs 不可用时客户端不乐观开启入口。API-key scopes 不因 RSS 自动扩大，首版跟随 Web/APP 用户会话认证。

`packages/contracts` 保存 DTO 与示例 fixtures；外部 Web 的 types-pro/API wrapper 和 APP 的 kotlinx.serialization data class 按相同 fixtures 校验，避免引入尚不存在的跨仓库包发布链路。

### 8. Web 保持 fork/layer 边界

在 `apps/slax-reader-dweb` 的 fork 层新增 RSS 页面、组件、API 和状态；通过现有 Labs composable 与导航扩展点接入。仅在缺少扩展点时做最小的上游同名组件覆盖，不拷贝整个阅读模块。复用基本按钮、对话框、图标、日期和排版样式，RSS cell 不伪装成 `BookmarkItem` 来触发书签专用副作用。

预览只渲染后端净化的内容并对 URL 做前端防御校验，禁止原始 HTML 直通；页面文字标明内容来自 RSS。Abort/请求序号隔离快速切换，登出和关闭开关清空状态。收藏成功后接入已有 Inbox 更新机制，详情跳转使用返回的书签关系标识。

### 9. APP 顶部来源栏与共享详情

设置通过独立 RssLabsApi 和 ViewModel 读写实验室状态，不加载订阅和文章。CollectionFeedSwitcher 扩展为统一来源栏：我的 Inbox、Collection、各 RSS 订阅源、添加 RSS。RSS 图标采用站点图标、文字回退、选中描边；InboxListScreen 原位切换内容，用 SaveableStateHolder 保留列表状态，不设置独立 RSS 首页路由。文章显示标题、摘要、缩略图；订阅管理使用现有菜单及底部编辑面板，失败保留输入，成功收起。

用户要求复用现有详情，替代此前独立 Compose 正文方案。BookmarkRoutes 增加 rssEntryId，DetailScreen 的 RSS 来源分支加载授权的缓存 HTML，调用原有 Android/iOS DetailScreen、WebViewHost.Html 与阅读器模板。不绑定 BookmarkDetailViewModel，不启动书签同步、AI、划线或阅读记录写入。顶部提供收藏与原文；Android 自然滚动正文后插入底部收藏，iOS 用底部 inset 为随正文滚动的原生按钮留位。正文和头部超过视口时才出现底部按钮，监听异步图片和视口变化。

图片复用现有 ImageViewer，RSS 使用独立缓存键。原文沿用平台打开方式。RssArticleViewModel 管理详情与收藏，RssRepository 将已确认收藏广播给首页缓存；成功后原位反馈，两处按钮共享状态，不等待 PowerSync 或自动跳转。使用现有 LocaleString，退出账号清理状态。

## Risks / Trade-offs

- [旧版 RSS Worker 与共享 schema 不兼容] → 同步更新后端与迁移；本次不承诺新旧 RSS Worker 混跑，部署期间暂停旧 RSS 请求和调度。
- [Workers 依赖兼容性与 XML 资源消耗] → 首个实现检查即运行固定解析/净化 fixtures 的 Workers smoke test；锁定依赖、大小与节点预算，失败不以关闭安全校验继续。
- [源站提供摘要、格式异常或超大 Feed] → 明示来源、提供打开原文与显式收藏；受限失败保留旧缓存，不承诺 Feed 全文。
- [平台滚动布局存在差异] → Android 测量自然滚动正文，iOS 监听内容与视口大小；长短文章及异步图片的实际显示仍需平台确认。
- [共享 Feed 泄露私有 URL] → 完整 URL 精确匹配、按用户订阅授权读取，不公开全局搜索或 Feed 标识。
- [队列重投递或启动工作流失败] → 租约 token、数据库唯一约束、稳定工作流 ID 与可恢复 pending 状态共同保证不丢失、不重复创建。
- [三端发布不同步] → 后端兼容性接口先发、开关默认关闭；旧客户端不受影响，新客户端对不可用 Labs 给出明确状态。

## Migration Plan

1. 审阅本提案；接入已审阅 API 迁移基线并记录 commit。按用户要求直接修改三个项目主目录，不覆盖已有未提交修改。
2. 按实际仓库脚本安装依赖、建立基线检查。新增 PG 表与索引，完成 contracts、API、任务及测试；生成路由/DI/Cron/consumer 注册。
3. 停止旧 RSS Worker 后，仅删除旧 RSS 表和对应迁移记录；通过 `pnpm api -- gen:diff` 生成新迁移，再运行 `pnpm api -- migration:local:pgsql`。其他环境需单独确认数据丢弃并运行部署迁移。功能默认关闭；先在测试账号验证三端闭环、Cron、R2、关闭/删除竞争和重复收藏。
4. 三端关联 PR 指向本 OpenSpec change；monorepo PR 目标 dev，外部仓库遵循各自规则。推送前按 REVIEW.md 完成 Bugs/Security/Compliance，Important 全部解决。
5. 回滚先停止 RSS 调度和关闭可用注册，再回滚客户端/后端代码；新表先保留供后续清理，不回滚或删除正常书签。全部相关实现合并后，以独立小变更归档规格。


## 2026-09-23 实现补充

- Web 的 RSS 是现有 bookmarks 页内的面板，通过 `view=rss` 选择；稳定页面 key 保留 Inbox。fork 层侧栏将 RSS 放在 Inbox 下方，复用布局、搜索和列表模式切换器；旧 `/rss` 路径跳转至该面板。
- Web 按来源缓存列表、游标、已加载页数和更新时间，60 秒 TTL；页面定时检查和手动重新加载保留旧数据，重新校验已加载页后整体替换。缓存只在当前会话内保留，账号变化、关闭功能和组件销毁时清除。
- 订阅增加可空 remark，自定义显示名称独立于源站 title。添加可填写，编辑只改名称；清空回退到 title，抓取不覆盖 remark。当前 Prisma schema 和生成的迁移使用 TEXT，业务层限制 120 个 UTF-16 单元。
- 图片代理生产环境要求 HTTPS，开发环境允许运营者配置的 HTTP 代理；无效缩略图不会中断整个列表。详情保留所有正文顶层节点，代理生成失败移除对应图片，仍返回文字。
- 用户提出共享 Feed、R2 正文和复用书签图片处理链路的架构调整。已按本设计实施共享 Feed、R2 正文和抓取时替换图片；旧 RSS 数据直接丢弃。

## RSS 分页与 Cloudflare 回退定稿

- 新订阅验证和定时更新只获取 Feed 最新页。普通列表 API 只读共享缓存；显式 Load more 在游标后缓存不足一页时才沿 RSS/Atom 的 next 或 prev-archive 链接抓取历史、保存并重新查询。分页过程不会被自动轮询触发。
- RSS 复用 SlaxFetch 中现有 Zyte 凭据及 API，增加原始 HTTP Response 方法。直连识别 cf-mitigated: challenge、Cloudflare 的 403/503 或带挑战脚本的 HTML 后回退一次；普通无效 Feed、429 和有效 Retry-After 不触发付费重试。失败继续保留旧缓存，首次失败仍不创建 Feed。
- Zyte 请求 httpResponseBody 和 httpResponseHeaders，不使用 browserHtml、文章提取或 AI。每个目标跳转都由现有 createPublicFetch 校验；供应商跟随重定向关闭，不转发用户 Cookie/Authorization，跨源跳转清除条件请求头。原始解压后字节按 5 MiB 限制，JSON/base64 包装有独立上限，共享单次 30 秒截止时间，保留 XML 编码声明与 HTTP validator。
- 该回退用于首次添加、最新页刷新和用户主动历史分页；不增加独立服务或配置项。Zyte 未配置或仍返回挑战时报告 source_unavailable，不把挑战页当 Feed 保存。

- 原生 APP 仅 RSS 添加与显式历史加载使用 120 秒 request/socket 等待窗口，避免默认 15 秒 socket 超时提前中断商业回退；普通缓存读取与其他接口保持默认设置。
