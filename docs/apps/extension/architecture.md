# Slax Reader 浏览器扩展

[配置与验证](development.md) · [应用关系](../../architecture/frontend.md)

Slax Reader 浏览器扩展的完整源码，包含开源社区基础能力与 Pro 能力（订阅付费 UI、指标埋点、本地优先书签桥等），均在同一份代码里维护，不依赖任何外部子模块。

## 技术栈

- **核心框架**：Vue 3.5（`@wxt-dev/module-vue`）
- **扩展框架**：WXT 0.21（Manifest V3）
- **构建工具**：Vite 8
- **样式**：UnoCSS（`@wxt-dev/unocss`）+ SCSS
- **国际化**：`@wxt-dev/i18n`（en / zh_CN）
- **埋点分析**：`@wxt-dev/analytics` + Google Analytics 4
- **内容解析**：`@slax-lab/readability`
- **划线引擎**：`@slax-reader/selection`（workspace 包）
- **浏览器 API**：Chrome / Firefox Extensions API（最低 Chrome 115）

## Pro 能力

- **订阅 / 付费 UI**：`components/SubscribeCard.vue`、`components/SubscribePlaceholder.vue`。
- **本地优先书签桥（local-first bridge）**：让插件在不维护自己的书签副本的前提下，直接读取网页 origin 的 PowerSync 数据判断收藏状态：
  - `entrypoints/background/bridgeService.ts` —— Service Worker 侧代理，负责保证 offscreen document 存在、把登录 token 交给它挂载 iframe。
  - `entrypoints/offscreen/` —— offscreen document，内部挂一个指向网页 `/x/ext-bridge` 的隐藏 iframe，通过 `postMessage` 与网页侧 PowerSync 通信。
  - `bridge/request.ts`、`bridge/selectionAdapters.ts` —— 请求层适配：自动把 `bookmark_id` 占位符换成真实 `bookmark_uid`，并为划线标注引擎提供基于书签桥的数据源适配。
  - `entrypoints/background/index.ts` 中的 `notifySenderTabWhenReady` —— 收藏/取消收藏后，带退避轮询等待桥数据同步落地，再通知对应 tab 刷新侧边栏，避免"数据还没同步就查"的竞态。
- **指标埋点服务**：`entrypoints/background/metricService.ts` —— 心跳与 Dashboard 行为埋点（节流上报），依赖 `@commons/contracts`。
- **消息协议扩展**：`config/message.ts` 里 `RecordBookmark`、`QueryBookmarkChange`、`BookmarkStatusRefresh`、`TrackDashboardMetric` 等 action，以及书签桥用到的 `BookmarkActionType`/`BookmarkLookupResult` 类型。

## 项目结构

```
.
├── src/
│   ├── app.config.ts             # WXT App Config（埋点/分析配置）
│   ├── components/
│   │   ├── SidePanel.vue          # 侧边栏面板主组件（含书签桥收藏状态）
│   │   ├── SubscribeCard.vue      # 订阅 / 付费卡片
│   │   ├── SubscribePlaceholder.vue # 订阅占位 UI
│   │   ├── AIOverview.vue / AISummaries.vue  # AI 大纲 / 摘要面板
│   │   ├── Collect.vue           # 收藏弹窗
│   │   ├── Chat/                 # Chatbot 对话组件
│   │   ├── Markdown/             # Markdown / 思维导图渲染
│   │   ├── Modal/                # 关于 / 反馈 / 分享弹窗
│   │   ├── Selection/            # 划线标注 UI 与适配器
│   │   ├── Tips/                 # 侧边栏引导提示
│   │   └── Toast/                # 轻提示组件
│   ├── bridge/                   # 本地优先书签桥的请求层适配
│   │   ├── request.ts             # bookmark_id → bookmark_uid 占位符替换
│   │   └── selectionAdapters.ts   # 划线标注引擎的书签桥数据源适配
│   ├── config/
│   │   ├── message.ts            # 消息协议：background ↔ content ↔ offscreen 的 action 定义
│   │   └── panel.ts             # 侧边栏面板项配置（图标 / 文案）
│   ├── entrypoints/
│   │   ├── background/
│   │   │   ├── index.ts          # 后台编排：书签桥轮询通知 + 装配各 service
│   │   │   ├── authService.ts    # 登录 / 会话查询
│   │   │   ├── browserService.ts # tab 通知、content-script 就绪等待、右键菜单
│   │   │   ├── bridgeService.ts   # 书签桥 SW 侧代理：管理 offscreen document 与 iframe 挂载
│   │   │   ├── messageHandler.ts  # 消息路由兜底
│   │   │   ├── metricService.ts  # 指标埋点（心跳 / Dashboard 行为）
│   │   │   ├── sessionService.ts # 会话状态管理
│   │   │   └── storageService.ts # 本地存储读写
│   │   ├── offscreen/             # 书签桥 offscreen document：挂载指向网页 /x/ext-bridge 的隐藏 iframe
│   │   ├── content/index.ts      # 内容脚本：挂载 SidePanel + Collect 弹窗
│   │   └── mark.content.css      # 注入页面的划线高亮样式
│   ├── assets/                   # 图标 / 图片资源
│   ├── locales/                  # 国际化文案（en.json / zh_CN.json）
│   ├── styles/reset.scss         # 样式重置
│   └── utils/                    # 工具函数（request / locale / url / website / analytics / examine / session / pinnedStatus）
├── vendor-shims/                 # dev 环境重依赖外置（markmap / highlight.js / katex）的 shim
├── vendor.config.ts              # vendor 外置接线（生成 .vendor/vendor.js，缺失时自动回退正常打包）
├── scripts/build-vendor.script.ts # 预打包 vendor.js（升级 markmap/highlight.js/katex 后需重跑）
├── plugins/                      # 构建插件（auto-import-unocss、auto-migrate-icons、to-utf8）
├── package.json
├── tsconfig.json
└── wxt.config.ts                 # WXT 配置
```


配置与命令见[本地开发指南](development.md)。源码位于 `apps/extension`；前端共享库位于 `packages`。
