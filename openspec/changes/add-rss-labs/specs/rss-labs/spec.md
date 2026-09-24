# Spec Delta

## Purpose

让用户在 Web 与原生 APP 的实验室功能中管理自己的 RSS 订阅，浏览定期更新的图文缓存，并主动将感兴趣的文章收藏到现有 Inbox，同时保证订阅数据隔离、图片访问安全以及收藏内容不受订阅生命周期影响。

## ADDED Requirements

### Requirement: RSS laboratory feature gate

系统 SHALL 提供默认关闭、按用户保存的 RSS 实验室开关。RSS 业务接口 SHALL 要求用户认证、功能开启及资源归属校验。关闭后 SHALL 停止该用户的新抓取与 RSS 业务访问，保留订阅供重新开启使用；已收藏书签 SHALL 继续可用。注销账户 SHALL 删除该用户订阅关系；共享文章只有不再被订阅使用时才可清理。

#### Scenario: Enable on one client
- **WHEN** 用户在 Web 或 APP 开启 RSS 并在另一端重新读取实验室状态
- **THEN** 两端均显示 RSS 可用，并能访问相同订阅

#### Scenario: Disabled or unauthorized access
- **WHEN** 未登录用户、未开启 RSS 的用户或其他订阅的非所有者调用 RSS 接口
- **THEN** 系统拒绝请求且不泄露订阅地址、文章内容或收藏关系

#### Scenario: Disable during refresh
- **WHEN** 抓取期间用户关闭功能、删除订阅或注销账户
- **THEN** 系统不重新创建该用户已删除的订阅；仍有其他活动订阅者时共享抓取可继续，否则旧租约失效且不能提交新条目

### Requirement: Add and remove personal subscriptions

用户 SHALL 能添加 RSS 2.0、RSS 1.0/RDF 或 Atom 的 HTTP(S) Feed 地址。系统 SHALL 验证安全性与格式，每用户最多保留 20 个订阅；同一用户重复添加同一规范化地址 SHALL 返回已有订阅。删除 SHALL 只删除该用户的订阅关系，不删除其书签或影响其他用户。地址查询参数 SHALL 保留其语义，并且不得出现在操作日志或错误提示中。

#### Scenario: Valid feed including an empty feed
- **WHEN** 用户提交有效 Feed 地址且未达到订阅上限
- **THEN** 系统创建订阅，展示 Feed 标题、更新状态和可用条目；合法空 Feed 显示空列表

#### Scenario: Duplicate and quota
- **WHEN** 用户重复提交已有订阅地址，或在已有 20 个订阅时提交新地址
- **THEN** 重复地址返回原订阅且不重复占用配额，新地址返回可理解的配额错误

#### Scenario: Invalid or unsafe URL
- **WHEN** 地址为非 HTTP(S)、带 URL 用户名密码、指向内网或经重定向访问非公共目标，或者响应不是合法 Feed
- **THEN** 系统拒绝添加，不创建新 Feed、条目或订阅，并返回不包含敏感地址的错误

#### Scenario: Remove a subscription with saved entries
- **WHEN** 用户删除包含已收藏条目的订阅
- **THEN** 订阅从两端后续查询中消失，先前收藏的书签仍可正常打开

### Requirement: Bounded periodic refresh

系统 SHALL 对已启用用户的订阅定期更新，正常情况下按 30 分钟目标间隔安排抓取，调度允许至多 5 分钟扫描延迟但不承诺故障期间的时效。系统 SHALL 使用 ETag/Last-Modified 条件请求、处理 304、限制响应体解压后大小为 5 MiB、单次 Feed 获取总时长为 30 秒，并限制每次解析与写入数量。用户 SHALL 可手动请求刷新，刷新间隔至少 5 分钟，且不得绕过源站要求的重试等待时间。

#### Scenario: Unchanged feed
- **WHEN** 之前成功获取的 Feed 返回 304
- **THEN** 系统保留既有条目和排序，记录本次成功检查并安排下一次检查

#### Scenario: Source unavailable or throttled
- **WHEN** 源站超时、返回错误或要求延迟重试
- **THEN** 系统保留上次成功缓存、显示失败与上次成功时间，并退避重试；手动刷新不能绕过有效 Retry-After

#### Scenario: Repeated refresh request
- **WHEN** 多个客户端同时请求同一订阅刷新或后台重复投递任务
- **THEN** 系统不并发提交同一订阅的重复更新，并告知客户端正在刷新或允许再次刷新的时间

### Requirement: Stable bounded article cache

系统 SHALL 基于 Feed 条目标识去重；缺少有效标识时 SHALL 使用稳定的替代标识。同一条目的内容修订 SHALL 更新原条目。每次 Feed 解析 SHALL 最多接收 200 条；共享缓存 SHALL 按首次收录时间保留 30 天，不按累计条数裁剪；列表 SHALL 支持按订阅筛选和稳定的游标分页，单页最多 50 条。全部订阅与单个订阅的文章 SHALL 按发布时间倒序排列，同一时间用 ID 稳定排序；最新页缺少日期或日期异常的条目 SHALL 使用首次发现时间作为排序回退，历史页此类条目 SHALL 排在该源已知文章之后。源站修正发布时间时 SHALL 更新排序时间，无日期条目 SHALL 不因重复抓取改变排序时间。数据库 SHALL 为全部订阅和单源时间线提供对应索引。

#### Scenario: Repeat feed with revised content
- **WHEN** Feed 重复返回同一标识的条目且内容有所更新
- **THEN** 列表只显示一条记录并提供更新后的预览，不重复创建书签

#### Scenario: Pagination while new items arrive
- **WHEN** 用户翻阅下一页时 Feed 添加新条目
- **THEN** 下一页使用固定游标边界，不因前端页码偏移而重复此前已返回的条目

#### Scenario: 跨来源时间线与日期修正
- **WHEN** 用户浏览全部订阅，且不同来源文章日期交错，随后源站修正一篇文章的发布时间
- **THEN** 列表按新发布时间重新排序；无日期的旧条目保留首次发现时间，分页仍以排序时间和 ID 为边界

#### Scenario: Retention limit
- **WHEN** 缓存达到数量或保留期上限
- **THEN** 系统清理超限条目，已收藏书签及其正文和图片读取能力不受 RSS 条目删除影响

### Requirement: Safe feed preview and cached images

系统 SHALL 将 Feed 自带正文或摘要提供为独立预览，标注其为订阅源提供的内容而不宣称其必然是全文。显示的 HTML SHALL 经过白名单净化和相对链接解析，脚本、事件处理器、危险协议及可绕过图片代理的外部嵌入 SHALL 被移除。预览与缩略图中的所有远程图片 SHALL 使用受控的 HTTPS 图片缓存地址；仅开发环境 SHALL 允许使用运营者配置的 HTTP 图片代理地址，仍校验源图片地址和代理签名；图片获取失败、类型不受支持或超限时 SHALL 显示占位，不重定向或回退到源图片地址。

#### Scenario: Image with relative URL or alternative sources
- **WHEN** 条目包含相对图片地址、懒加载图片或 srcset/picture 候选
- **THEN** 系统解析支持的图片并转换为缓存地址，删除其他可触发源站直接请求的候选

#### Scenario: Malicious or malformed HTML
- **WHEN** Feed 内容包含脚本、事件属性、危险链接或外部 iframe
- **THEN** Web 与 APP 预览均不执行这些内容、不访问被禁止目标，并保留可安全呈现的文字

#### Scenario: Image unavailable
- **WHEN** 缓存未命中且源图片抓取失败、非图片响应或超过限制
- **THEN** 客户端显示占位或替代文字，并且不直接加载源站图片

### Requirement: Explicit idempotent save to Inbox

系统 SHALL 仅在用户主动收藏具有有效原文 HTTP(S) 链接的条目时创建 Inbox 书签，并复用现有正文处理流程。RSS 抓取和预览 SHALL 不自动创建书签、不触发商业正文抓取或 AI 处理。重复或并发收藏同一用户的同一原文 SHALL 返回同一有效书签关系；已有有效书签的归档、标签、标注和时间 SHALL 保留。已删除书签 SHALL 按现有恢复语义恢复。客户端 SHALL 在确认成功后显示已收藏，并允许打开书签。

#### Scenario: Save a new article
- **WHEN** 用户点击一条尚未收藏文章的收藏按钮
- **THEN** 系统将其加入 Inbox、返回可用于打开的书签关系标识，并由现有流程异步处理正文

#### Scenario: Retry or concurrent save
- **WHEN** 收藏请求被重试，或者 Web 和 APP 同时收藏同一原文
- **THEN** 系统返回同一书签关系，不重复排队同一次正文处理，也不重置已保存内容的用户元数据

#### Scenario: Previously archived article
- **WHEN** 用户查看已归档书签对应的 RSS 条目
- **THEN** 系统显示已收藏及打开入口，不因重复点击收藏自动取消归档

#### Scenario: Entry without an article URL
- **WHEN** 条目没有可用的 HTTP(S) 原文链接
- **THEN** 用户仍能预览其安全内容，但收藏与打开原文操作不可用且有清楚说明

### Requirement: Web RSS user experience

Web SHALL 提供实验室开关、可发现的 RSS 入口、订阅添加与删除、按订阅浏览文章、手动刷新、图文预览、打开原文及收藏操作。界面 SHALL 遵循现有设计和语言设置，覆盖加载、空列表、错误、离线、更新中及已收藏状态。过期请求 SHALL 不覆盖后来选择的订阅；退出账号或关闭功能 SHALL 清除当前用户的 RSS 页面状态。

Web SHALL 在顶部以 Collection 风格的来源头像呈现全部订阅和单个来源，并为文章按日期显示时间线。源站图标 SHALL 经签名图片代理按需缓存；图标失败时 SHALL 使用本地占位，不直接请求源站图片。RSS 文案 SHALL 从页面实际使用的 `rss.*` 本地化键读取。

#### Scenario: Complete web flow
- **WHEN** 用户开启功能、添加订阅、打开条目并收藏
- **THEN** 用户能看到缓存图文、得到收藏反馈，并在现有 Inbox 中看到该书签

#### Scenario: Rapid navigation or logout
- **WHEN** 用户在请求期间快速切换订阅或退出账号
- **THEN** 界面不显示过期订阅响应，也不保留前一账号的内容

### Requirement: Native application RSS user experience

APP SHALL 使用原生 Compose 实现实验室设置、订阅管理和文章列表。每个 RSS 订阅源 SHALL 在 Inbox 顶部来源栏中与我的 Inbox、Collection 平级，以圆形图标直接切换内容，不使用独立 RSS 首页路由。文章 SHALL 通过现有 BookmarkRoutes / DetailScreen 的 RSS 来源模式打开，复用现有阅读器排版、平台滚动容器及图片查看；预览不创建书签，收藏仅由用户显式触发。

#### Scenario: Shared bookmark reader
- **WHEN** 用户在 Android 或 iOS 上从 RSS 列表打开含图片的文章
- **THEN** 系统将后端净化的缓存 HTML 交给现有书签详情阅读器，复用正文渲染及图片查看，不启动书签同步、划线或 AI 操作

#### Scenario: Select an RSS source beside collections
- **WHEN** 用户在 Android 或 iOS 首页点击顶部某个 RSS 圆形来源图标
- **THEN** 在同一首页显示该源文章，图标呈选中状态；点击我的 Inbox 或 Collection 直接切回对应内容，顶部不再出现第二排 RSS 来源选择，也不在 Inbox 下拉菜单增加 RSS 项

#### Scenario: Add a source from the shared rail
- **WHEN** 用户点击顶部来源栏末尾的添加 RSS
- **THEN** 已开启实验室时显示底部订阅表单，未开启时前往设置；名称可修改，输入及错误在失败后保留，成功后关闭表单并选中新订阅

#### Scenario: Settings only controls the RSS experiment
- **WHEN** 用户在 APP 设置中开启或关闭 RSS 实验室
- **THEN** 设置页只读取和写入实验室状态，不加载 RSS 订阅或文章，不跳转到内容页；开启失败保留已确认状态并提供重试

#### Scenario: RSS uses Inbox feed components
- **WHEN** 用户打开已启用的 RSS 内容页
- **THEN** 页面复用 Inbox 顶部来源栏、导航、分隔线和圆角列表；RSS 采用网页的圆形站点图标、文字回退及名称，文章行显示来源时间、标题、摘要和右侧缩略图；订阅管理使用菜单和底部面板

#### Scenario: Save before bookmark synchronization completes
- **WHEN** 后端确认收藏而本地书签同步尚未完成
- **THEN** APP 在当前 RSS 详情显示已收藏，并更新首页缓存及按钮状态，保持阅读位置，不等待 PowerSync 或自动跳转

#### Scenario: Save actions in the shared reader
- **WHEN** 用户阅读 RSS 文章
- **THEN** 详情顶部显示收藏到 Inbox、打开原文按钮；正文和头部总高度超过当前视口时，文章末尾也显示收藏按钮，短文章不重复显示；图片加载或视口变化后更新测量，两处按钮共享忙碌和收藏状态

#### Scenario: Return to the source list
- **WHEN** 用户从详情返回首页，或者在来源栏切换 RSS 与 Inbox
- **THEN** 原列表保留缓存、选择和滚动位置，预览或收藏不会重新创建首页


### Requirement: Web 在 Inbox 中显示 RSS 并保留列表缓存

Web SHALL 在 Inbox 侧栏紧接 Inbox 下方显示已启用的 RSS 入口，复用现有页面布局、搜索与列表模式切换组件。切换 RSS 与 Inbox SHALL 保留各自的列表状态，不重新挂载整个页面。RSS SHALL 按来源保存当前会话的列表、分页游标及已加载页数；定时检查和手动重新加载 SHALL 保留旧列表直到新数据成功返回，失败保留旧缓存。退出账号或关闭功能 SHALL 清除缓存。

#### Scenario: 切换与刷新期间保留列表
- **WHEN** 用户切换来源、切回 Inbox，或者定时和手动更新 RSS 列表
- **THEN** 已缓存列表立即可见，更新期间不清空列表，过期响应不会覆盖后来选择的来源

### Requirement: 自定义订阅显示名称

订阅 SHALL 支持独立于源站标题的可空 remark，Web SHALL 在添加和编辑订阅时允许填写。显示名称 SHALL 优先使用 remark，留空恢复使用源站标题。系统 SHALL 去除首尾空白、拒绝控制字符和超过 120 个 UTF-16 单元的值；定时更新源站标题 SHALL 保留用户自定义名称。编辑 SHALL 校验当前用户的资源归属及实验室开关。

#### Scenario: 编辑和清空显示名称
- **WHEN** 用户添加或修改显示名称，随后刷新订阅或清空该名称
- **THEN** 自定义名称用于来源选择和文章列表，刷新不覆盖该名称，清空后显示源站原标题


### Requirement: 共享 Feed 与 R2 正文

相同完整规范化 Feed URL SHALL 共享 Feed 元信息、刷新租约、条件请求、文章和正文缓存。不同 URL 查询参数 SHALL 保持隔离。用户订阅名称和收藏状态 SHALL 独立，读取文章仍 SHALL 校验当前用户订阅与实验室开关。新正文 SHALL 在净化及图片代理替换后写入 R2，数据库 SHALL 仅保存正文引用。失败和过期任务 SHALL 不替换已发布缓存。

#### Scenario: 多人订阅同一 Feed
- **WHEN** 两个用户添加相同地址，或同时刷新各自订阅
- **THEN** 系统只保留一份 Feed 和文章、同一时刻最多一个任务发布缓存或刷新；全新地址在发布租约建立前允许并发验证，两人保留自己的名称与收藏状态

#### Scenario: 对象写入失败
- **WHEN** 新正文写入 R2 失败或任务租约过期
- **THEN** 系统保留原缓存与引用，不发布缺失正文的条目

#### Scenario: 最后一个订阅者退出
- **WHEN** 删除某用户的订阅或关闭功能
- **THEN** 其他活动订阅者的刷新和缓存保持可用；无活动订阅者时停止抓取，无订阅 Feed 和不再引用的 R2 正文按保留策略回收

#### Scenario: 重建实验室 RSS 表
- **WHEN** 将旧 RSS 实验表替换为共享 Feed 模型
- **THEN** 旧 RSS 订阅、条目和正文被丢弃，用户需重新添加订阅；已有 Inbox 收藏关系不受影响，新正文只写入 R2

### Requirement: 按需混合读取历史
系统 SHALL 定时更新最新页，普通列表查询 SHALL 只读共享缓存。显式 fetch_history=1 的 Load more 请求在当前游标后缓存不足一页时 SHALL 沿源提供的 next 或 prev-archive 链接补抓、共享保存并重新查询。一次请求 SHALL 最多补抓三个源，每源一页历史，旧订阅允许额外读取最新页发现历史入口。共享租约 SHALL 排除并发重复抓取，历史修订 SHALL 不覆盖已缓存的新版本。历史抓取 SHALL 保留 URL 校验、内容净化和图片缓存流程。

#### Scenario: 最新页只有十条且有历史入口
- **WHEN** 用户点击 Load more 且缓存已读完
- **THEN** 服务端抓取一页历史并保存，客户端从头重新校验已展开窗口，保持时间顺序且不重复条目

#### Scenario: 源没有提供历史或暂时失败
- **WHEN** 历史链接已耗尽或请求失败
- **THEN** 响应 SHALL 区分耗尽与可重试状态；耗尽时隐藏 Load more，失败保留缓存及进度并至少冷却 60 秒且尊重 Retry-After

#### Scenario: 自动列表检查
- **WHEN** 客户端定时校验缓存窗口
- **THEN** 请求不包含 fetch_history，不触发源站历史抓取，只有所有缓存页成功返回后才替换现有列表

### Requirement: 首次失败不保留无效 Feed
新地址 SHALL 在抓取与解析成功后才创建 Feed 占位。首次正文写入或提交失败 SHALL 清理本次持有租约且无成功缓存、无订阅和无条目的占位；失败处理 SHALL 不删除新租约持有者的记录或既有成功缓存。

#### Scenario: 首次请求失败
- **WHEN** 新地址超时、被拦截或返回无效 XML/HTML
- **THEN** API 返回错误，数据库不新增 Feed、条目或订阅

#### Scenario: 首次 R2 写入失败
- **WHEN** 已解析的首次 Feed 正文写入失败
- **THEN** 清理本次未发布占位；过期任务不删除新持有者的记录

### Requirement: 来源图标文字占位
Web 图标占位 SHALL 忽略名称开头的标点、书名号、数字和 emoji，按顺序提取首个汉字或首个单词；无有效文字时显示 RSS。此提取 SHALL 不改变完整显示名称。

#### Scenario: 标点或 emoji 开头的名称
- **WHEN** 图标加载失败且名称为《联合早报》或 🔥 The Verge
- **THEN** 占位分别显示 联 或 The，完整名称保持不变

### Requirement: Cloudflare Feed 商业回退
RSS 抓取 SHALL 优先直连；识别 Cloudflare 挑战后 SHALL 在已有 Zyte 配置可用时进行一次商业回退。回退 SHALL 请求原始 HTTP 字节和响应头、保留 XML 解析流程，不使用网页正文提取或 browserHtml。新订阅、定时更新与用户手动历史抓取 SHALL 共用此行为。

#### Scenario: 第一页或历史页被挑战
- **WHEN** 源返回 cf-mitigated: challenge、Cloudflare 的 403/503 或含 Cloudflare 挑战脚本的 HTML
- **THEN** 系统在剩余时限内请求 Zyte 原始响应；只在得到合法 Feed 时发布缓存，Zyte 仍返回挑战则失败且不循环重试

#### Scenario: 限流或普通错误
- **WHEN** 源返回 429、有效 Retry-After，或者没有挑战特征的无效 Feed
- **THEN** 系统不触发付费回退，遵守等待时间并保留旧缓存

#### Scenario: 供应商重定向与资源限制
- **WHEN** Zyte 返回重定向、超限响应或非法目标地址
- **THEN** 系统逐跳校验公共 URL、最多跟随五次跳转，跨源清除条件头，不向源发送商业凭据；超限或非法目标失败且不发布条目
