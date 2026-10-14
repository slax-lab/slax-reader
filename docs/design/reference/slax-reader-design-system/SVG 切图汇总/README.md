# SVG 切图汇总

从 `slax-reader-redesign.html`、`slax-reader-snapshot.html` 与 `slax-reader-collection.html` 抽取所有 SVG（含内联 `<svg>` 与 CSS `url("data:image/svg+xml;...")`），按视觉去重并补充业务新增图标后得到 **42** 个独立 icon。

原始 SVG 实例总数：106（去重比例 61%）。

## 尺寸标准化（2026-05-29）

原项目尺寸碎片化严重（13 档：32 / 24 / 22 / 20 / 18 / 17 / 16 / 15 / 14 / 13 / 12 / 10 / 9），其中相邻 1px 的几乎肉眼无差异。经多轮统一，最终归约为 **7 档标准尺寸**：

| 标准尺寸 | 合并来源 | 涉及 icon |
| --- | --- | --- |
| **32** | 32×32 | 列表页空态 icons / 合集关闭空态 |
| **24** | 24×24 | Logo |
| **20** | 20 + **22** | edge-toolbar / panel tab + FAB plus |
| **18** | 18 + **17** | 侧边栏 / 底部工具栏 + topbar 更多/分享 |
| **16** | 16 + **15** | 弹窗/选区/列表布局 + 下拉菜单项 |
| **14** | 14 + **13** | 详情页 topbar + Topbar 主题切换（列表页主题原 16，已统一） + comment-bubble mask |
| **12** | 12 + **9/10** | 卡片小辅助 / mask / share-check tick（含 padding 占位） |

源 HTML（redesign 与 snapshot）已同步替换。

## 使用说明

- 所有 SVG 都已包含 `xmlns="http://www.w3.org/2000/svg"` 根节点，可直接预览/导入设计工具。
- 大部分 icon 使用 `stroke="currentColor"` 或 `fill="currentColor"`，在外层 CSS 用 `color` 控制颜色即可。
- 个别 icon（`icon-bookmark-source.svg`、`icon-comment-bubble-mask.svg`、`icon-image.svg`、`icon-x-twitter.svg`）保留了原始颜色定义。
- 同形不同填充的 icon（典型如 `icon-star.svg`）只保留一份 path，由消费方决定 outline / filled 渲染（`fill="none"` 还是 `fill="currentColor"`）。
- 「尺寸」列指的是 **原项目里实际渲染的像素大小**（已统一为 8 档标准尺寸：32 / 24 / 20 / 18 / 16 / 14 / 12 / 10，已合并近邻 1px 差异）。多数 SVG 本身 `viewBox` 为 `0 0 24 24`；侧边栏替换版图标使用 `0 0 18 18`，可按展示尺寸放缩。

## ⚠️ 设计系统不一致提醒

扫描原项目时发现以下「几乎一样但 path 不同」或「同一功能多个版本」的 icon。建议在重构 / 设计系统化时统一为单一版本：

| # | 涉及 icon | 差异 | 建议 |
| --- | --- | --- | --- |
| 1 | `icon-pencil.svg` ↔ `icon-edit-title.svg` | `icon-pencil.svg` 已替换为侧边栏专用铅笔图标；`icon-edit-title.svg` 保留为更多菜单「修改标题」图标。两者不再是同一视觉。 | 分开维护：侧边栏用 `icon-pencil.svg`，更多菜单继续使用 `icon-edit-title.svg` |
| 2 | ~~`icon-copy.svg` ↔ `icon-copy-thin.svg`~~ **已统一** | 之前 rect `13×13`（粗 1.5）vs `11×11`（细 1.6）。现在三处复制（分享菜单·复制链接 / 选区浮窗·复制 / Chat AI 回答·复制）全部统一为 `icon-copy.svg`。 | ✅ 已合并 |
| 3 | `icon-close.svg` ↔ `icon-close-x.svg` | 同一个 X 形状，仅 stroke-width 1.5 vs 2，并且 `icon-close.svg` 用 `<path>`、`icon-close-x.svg` 用 `<line>`。**12×12 用途已统一为 close-x**（搜索清空 / 评论引用清除 / 搜索历史删除）；弹窗关闭仍用 close，侧边面板关闭已替换为 `icon-side-panel-close.svg`。 | 后续可考虑全部统一为 close-x，stroke 通过 CSS 控制 |
| 4 | `icon-comment.svg` ↔ `icon-comment-bubble.svg` ↔ `icon-comment-bubble-mask.svg` | 三个评论气泡 path 完全不同：<br>• `icon-comment.svg`：圆角矩形 + 左下尾巴（edge-toolbar / side-panel-tab / 底部工具栏） <br>• `icon-comment-bubble.svg`：圆角矩形 + 左下尾巴，但 path 不同（选区浮窗）<br>• `icon-comment-bubble-mask.svg`：圆角矩形 + 左下尾巴，stroke 黑色，仅做 CSS mask（被评论划线行末标记） | 统一为单一气泡 path，通过尺寸 / 颜色区分用途 |
| 5 | `icon-ai-chat.svg` ↔ `icon-chat-dots.svg` | 「Chat」按钮在不同位置用了完全不同的视觉：edge-toolbar / side-panel-tab 用 **笑脸圆圈**（ai-chat，20×20），选区浮窗用 **气泡 + 三点**（chat-dots，16×16）。 | 同一功能应统一视觉 |
| 6 | `icon-ai-sparkles.svg` ↔ `icon-sparkle-single.svg` | 「AI」相关有两个 sparkle 版本：双 sparkle（AI 解析按钮 / tab）与单 sparkle（Chat 空态装饰）。 | 可保留双 sparkle 一种，单 sparkle 替换为同款缩小版 |

## 清单

| 文件 | 尺寸 | 用途 | 出处 |
| --- | --- | --- | --- |
| `icon-ai-sparkles.svg` | `20×20` | AI 解析（两个 sparkles 闪光） | slax-reader-snapshot.html: 右侧 edge-toolbar AI 解析按钮（.edge-btn svg）/ Side panel AI tab（.side-panel-tab svg） |
| `icon-archive.svg` | `18×18`（侧栏 / 底部工具栏） | 归档（收纳盒） | slax-reader-redesign.html: 侧边栏 - 归档（.sidebar-icon）<br>slax-reader-snapshot.html: 底部工具栏 - 未归档状态（.bottom-tool svg） |
| `icon-archived.svg` | `18×18` | 已归档（收纳盒） | slax-reader-snapshot.html: 底部工具栏 - 已归档状态（.bottom-tool.archived svg） |
| `icon-bell.svg` | `18×18` | 通知（铃铛） | slax-reader-redesign.html: topbar Notifications 按钮（inline `width="18" height="18"`，外层 .topbar-icon 容器 36×36） |
| `icon-bookmark-source.svg` | `mask: 12×12` | 划线来源标记（小书签） | slax-reader-redesign.html: 划线列表项前的来源 icon（.highlight-source::before，CSS data-uri，`width:12px;height:12px`） |
| `icon-chat-dots.svg` | `16×16` | Chat 气泡（带 3 个点，selectionTool 专用） | slax-reader-snapshot.html: 选区浮窗 Chat 按钮（.selection-tool-btn svg） |
| `icon-ai-chat.svg` | `20×20` | AI Chat（笑脸圆形） | slax-reader-snapshot.html: 右侧 edge-toolbar Chat 按钮（.edge-btn svg）/ Side panel Chat tab（.side-panel-tab svg） |
| `icon-arrow-right.svg` | `14×14`（13×13 用途归入 14 档） | 指示箭头（横向） | slax-reader-redesign.html: 订阅者列表「查看合集主页」入口（.feed-home-btn svg = 13×13） |
| `icon-check.svg` | `14×14`（订阅 feature list） / `12×12`（share-check tick，含 padding 占位） | 勾选/对勾（细，stroke-width=2） | slax-reader-redesign.html: 订阅弹框 feature list 勾选（.sub-feature-list li svg = 14×14，共 14 处）<br>slax-reader-snapshot.html: 分享菜单 - 允许查看划线和评论 share-check tick（.share-check-tick = 12×12，viewBox `-2 -2 28 28` 加 padding 使实际勾选视觉保持 10×10） |
| `icon-chevron-left.svg` | `14×14` | 返回（左 caret） | slax-reader-redesign.html: 搜索结果视图返回按钮（.search-back-btn svg） |
| `icon-clock.svg` | `14×14` | 时钟（最近搜索历史项前置 icon） | slax-reader-redesign.html: 搜索历史列表项（.search-history-item svg） |
| `icon-image.svg` | `14×14` | 图片 / 图像（相框 + 山形） | slax-reader-redesign.html: 星标合集提示「了解更多」入口（.starred-share-text-icon） |
| `icon-close-x.svg` | `12×12` | 关闭/清空（粗 X，stroke-width=2） | slax-reader-redesign.html: 搜索清空按钮（.topbar-search-clear svg = 12×12）/ 搜索历史项删除（.search-history-item-remove svg = 12×12） |
| `icon-close.svg` | `16×16`（modal-close） | 关闭（细 X，stroke-width=1.5，弹窗 modal-close 通用） | slax-reader-redesign.html: 添加文章弹框关闭 / 订阅弹框关闭（.modal-close svg = 16×16，共 5 处） |
| `icon-side-panel-close.svg` | `16×16` | 关闭侧边面板（侧栏收起样式） | slax-reader-snapshot.html: 侧栏面板关闭按钮（.side-panel-close img） |
| `icon-comment-bubble-mask.svg` | `mask: 14×14` | 评论气泡（被划线评论行末标记，CSS mask 用，stroke=black 原始色） | slax-reader-snapshot.html: `.article-body .hl.hl-comment::after` 行末标记（CSS mask，`width:14px;height:14px`） |
| `icon-comment-bubble.svg` | `16×16` | 评论气泡（带尾巴，selectionTool 专用） | slax-reader-snapshot.html: 选区浮窗 评论按钮（.selection-tool-btn svg） |
| `icon-comment.svg` | `20×20`（edge / panel tab） / `18×18`（底部工具栏） | 评论（聊天气泡，1.5px 边线） | slax-reader-snapshot.html: 右侧 edge-toolbar 评论按钮（.edge-btn svg = 20×20）/ Side panel Comment tab（.side-panel-tab svg = 20×20）/ H5 底部工具栏「更多」按钮（.bottom-tool svg = 18×18） |
| `icon-copy.svg` | `16×16` | 复制（双层方块，stroke-width=1.5） | slax-reader-snapshot.html: 分享菜单 - 复制链接（.popover-item svg）/ 选区浮窗复制按钮（.selection-tool-btn svg）/ Chat AI 回答复制按钮（.chat-msg-tool-btn svg） |
| `icon-document-outline.svg` | `16×16` | 全文解析（带顶/左分割的文档外框） | slax-reader-snapshot.html: AI 解析面板 - 全文解析按钮（.panel-action svg） |
| `icon-empty-archive.svg` | `32×32` | 归档空态 | slax-reader-redesign.html: 归档空态 icon（.empty-view-icon img） |
| `icon-empty-inbox.svg` | `32×32` | 收件箱空态 | slax-reader-redesign.html: 收件箱空态 icon（.empty-view-icon img） |
| `icon-empty-lock.svg` | `32×32` | 锁定 / 关闭合集空态 | slax-reader-redesign.html: 订阅源关闭空态（.feed-closed-lock img）<br>slax-reader-collection.html: 合集关闭后，访客 / 订阅者空态（.empty-view-icon img）<br>slax-reader-design-system.html: 空态锁定示例（.empty-view-icon img） |
| `icon-empty-topics.svg` | `32×32` | 标签空态 | slax-reader-redesign.html: 标签空态 icon（.empty-view-icon img） |
| `icon-empty-trash.svg` | `32×32` | 回收站空态 | slax-reader-redesign.html: 回收站空态 icon（.empty-view-icon svg） |
| `icon-edit-title.svg` | `16×16` | 修改标题（更多菜单铅笔） | slax-reader-snapshot.html: 更多菜单 - 修改标题（.popover-item svg） |
| `icon-feedback-message.svg` | `16×16` | 反馈问题（圆角对话气泡） | slax-reader-snapshot.html: 更多菜单 - 反馈问题（.popover-item svg） |
| `icon-highlight-marker.svg` | `16×16` | 划线（A 字形 + 底部下划线，selectionTool 专用） | slax-reader-snapshot.html: 选区浮窗 划线按钮（.selection-tool-btn svg） |
| `icon-inbox.svg` | `18×18` | 收件箱（圆角方框 + 横线） | slax-reader-redesign.html: 侧边栏 - 收件箱（.sidebar-icon） |
| `icon-layout-card.svg` | `16×16` | 卡片列表布局（两个横向卡片） | slax-reader-redesign.html: 列表布局切换 - 卡片列表（.layout-btn svg） |
| `icon-layout-list.svg` | `16×16` | 文字列表布局（横线列表 + 圆点） | slax-reader-redesign.html: 列表布局切换 - 文字列表（.layout-btn svg） |
| `icon-link.svg` | `16×16` | 链接（链条/铰链） | slax-reader-redesign.html: 添加文章弹框 URL 输入框前置 icon（.modal-input-icon） |
| `icon-logo-bookmark.png` | `24×24`（2x 资产 48×48） | Slax Reader logo 书签形状 | slax-reader-redesign.html: topbar 左上角 logo（.topbar-logo img，src 指向 SVG 切图汇总/icon-logo-bookmark.png） |
| `icon-logout.svg` | `16×16` | 退出账号（箭头出门） | slax-reader-redesign.html: 用户菜单 - 退出账号（.popover-item svg） |
| `icon-more-vertical.svg` | `18×18` | 更多（竖排三点） | slax-reader-snapshot.html: topbar 更多菜单触发按钮（inline `width="18" height="18"`，外层 .topbar-icon = 34×34）/ H5 底部工具栏更多（.bottom-tool svg = 18×18） |
| `icon-pencil.svg` | `18×18` | 划线（侧边栏铅笔） | slax-reader-redesign.html: 侧边栏 - 划线（.sidebar-icon） |
| `icon-plus.svg` | `20×20`（FAB） / `14×14`（添加标签） | 加号（FAB / 标签添加） | slax-reader-redesign.html: FAB 添加文章（inline `width="20" height="20"`，外层 .fab = 52×52）<br>slax-reader-snapshot.html: 添加标签按钮（.tag-add svg = 14×14） |
| `icon-search.svg` | `16×16` | 搜索（放大镜） | slax-reader-redesign.html: topbar 搜索框前置 icon（inline `width="16" height="16"`） |
| `icon-share-nodes.svg` | `18×18` | 分享（三个圆点连线，share-nodes 风格） | slax-reader-snapshot.html: topbar 分享菜单触发按钮（inline `width="18" height="18"`，外层 .topbar-icon = 34×34） |
| `icon-sparkle-single.svg` | `18×18` | Chat 空态装饰（单个 sparkle） | slax-reader-snapshot.html: Chat 面板空态 icon（.chat-empty-icon svg） |
| `icon-star.svg` | `12×12`（文章卡片加星） / `18×18`（侧栏 / 详情页底部） | 星标（五角星；outline 与 filled 共用同一 path，外层用 fill 控制） | slax-reader-redesign.html: 侧边栏星标（.sidebar-item svg = 18×18）/ 文章卡片加星按钮（.article-star svg = 12×12，outline + filled 共 29 处）<br>slax-reader-snapshot.html: 详情页加星按钮（.bottom-tool svg = 18×18） |
| `icon-theme-eink.svg` | `14×14` | 墨水屏模式（带文本的设备） | slax-reader-redesign.html: topbar 主题切换按钮（.theme-btn svg）<br>slax-reader-snapshot.html: topbar 主题切换按钮（.theme-btn svg） |
| `icon-theme-moon.svg` | `14×14` | 夜间模式（月亮） | slax-reader-redesign.html: topbar 主题切换按钮（.theme-btn svg）<br>slax-reader-snapshot.html: topbar 主题切换按钮（.theme-btn svg） |
| `icon-theme-sun.svg` | `14×14` | 日间模式（太阳） | slax-reader-redesign.html: topbar 主题切换按钮（.theme-btn svg）<br>slax-reader-snapshot.html: topbar 主题切换按钮（.theme-btn svg） |
| `icon-topics.svg` | `18×18`（侧栏） | 标签（书签式标记） | slax-reader-redesign.html: 侧边栏 - 标签（.sidebar-icon = 18×18） |
| `icon-trash.svg` | `18×18`（侧栏） | 回收站（垃圾桶） | slax-reader-redesign.html: 侧边栏 - 回收站（.sidebar-item svg = 18×18） |
| `icon-user.svg` | `16×16` | 个人中心（人像） | slax-reader-redesign.html: 用户菜单 - 个人中心（.popover-item svg） |
| `icon-x-twitter.svg` | `16×16` | X / Twitter 品牌 logo | slax-reader-snapshot.html: 分享菜单 - 分享到 Twitter（.popover-item svg） |
