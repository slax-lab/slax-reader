# Slax Reader DWeb

## 项目概述

Slax Reader DWeb 是基于 Nuxt 4 的阅读 Web 应用（"Read It Later"产品）。前端源码集中在 `apps/web`，通过 workspace 使用共享库，不依赖 Git 子模块。业务运行仍需要外部 backend。

## 项目结构

```
apps/web/
├── app/                            # Nuxt 4 app 目录
│   ├── assets/
│   │   └── styles/                 # 业务主题 token
│   ├── components/
│   │   ├── Article/
│   │   │   ├── BookmarkArticleLocalFirst.vue  # Local-First 文章视图
│   │   │   └── Selection/          # 划线选区交互
│   │   ├── BookmarkList/
│   │   ├── Chat/                   # AI 对话
│   │   ├── Collection/             # Collection 管理 UI
│   │   ├── Dashboard/              # 数据统计图表
│   │   ├── Login/                  # 登录横幅等
│   │   ├── Snapshot/               # 快照页扩展
│   │   └── global/                 # 全局自动注册组件
│   ├── composables/
│   │   ├── bookmark/               # 书签相关
│   │   ├── useLocalFirst.ts        # Local-First 数据桥接
│   │   ├── useDashboardMetrics.ts  # 仪表盘指标
│   │   ├── useSubscribeChecking.ts # 订阅状态检查
│   │   └── ...
│   ├── local-first/
│   │   ├── connector.ts            # PowerSync 连接器
│   │   └── schema.ts               # 本地 SQLite schema
│   ├── middleware/
│   ├── pages/
│   │   ├── [blogger]-reader/       # 博主公开阅读页
│   │   ├── b/[id].vue              # 文章详情页（书签）
│   │   ├── bookmarks/              # 书签列表
│   │   ├── c/[id]/                 # Collection 页面
│   │   ├── dashboard/              # 数据仪表盘
│   │   ├── login.vue
│   │   └── subscription/           # 订阅 / 付费页面
│   ├── plugins/
│   │   ├── powersync.client.ts     # PowerSync 初始化
│   │   ├── local-first-adapters.client.ts
│   │   ├── dashboard-metric.client.ts
│   │   └── pinia.ts
│   ├── service-worker/             # PWA Service Worker
│   └── utils/
├── server/                         # Nitro / Cloudflare Worker 服务端逻辑
├── tests/                          # Vitest 测试
├── i18n/                           # 国际化配置
├── public/                         # 静态资源
├── nuxt.config.ts                  # 构建配置 + 环境 profile 表
├── wrangler.toml                   # Cloudflare Workers 部署配置
└── package.json
```

## 技术栈

### 核心框架

- **Nuxt 4** (Vue 3) + **Vite** — 全栈框架，Cloudflare Workers 部署预设
- **PowerSync** (`@powersync/vue` + `@powersync/web`) — Local-First 离线数据同步（SQLite）
- **Pinia** + `pinia-plugin-persistedstate` — 状态管理
- **VueUse** — 实用组合式函数
- **Vite-PWA** — PWA / Service Worker 支持

### 功能库

- **@nuxt/content** — 内容页面（文档、博客等）
- **nuxt-og-image** + **satori** — 动态 OG 图片生成
- **Stripe** (`@stripe/stripe-js`) — 支付集成
- **Firebase** — 推送通知等
- **Markmap** — 思维导图渲染
- **KaTeX** — 数学公式渲染
- **virtua** — 虚拟列表
- **canvas-confetti** — 动效

### 部署 & 构建

- **Cloudflare Pages + Workers** — 生产部署
- **Wrangler** — Workers CLI / 本地开发
- **UnoCSS** — 原子化 CSS

## 开发指南

命令、环境配置和后端要求见[本地开发与验证](development.md)，首次参与见[开发者入门](../../contributing/development.md)。
应用的 `server` 目录属于 Nuxt，独立 backend 仍通过现有 service binding 和 API 协作。

### 环境 Profile

`nuxt.config.ts` 中维护了一张 `ENV_PROFILES` 表，按 `SLAX_ENV` 环境变量切换：

| SLAX_ENV      | 用途     | minify | sourcemap |
| ------------- | -------- | ------ | --------- |
| `development` | 本地开发 | ✗      | ✓         |
| `preview`     | 测试环境 | ✗      | ✓         |
| `beta`        | 灰度环境 | ✓      | ✓         |
| `production`  | 正式生产 | ✓      | ✗         |

## 国际化 (i18n)

项目使用 `@nuxtjs/i18n`（基于 vue-i18n），规范如下：

**避免字符串拼接**，使用插值：

```javascript
// 配置: "{tips} 访问中"
t('"{tips}" 访问中...', { tips: '列表页' })
```

**动态组件中获取翻译函数**：

```javascript
const t = (text: string) => useNuxtApp().$i18n.t(text)
```

**key 命名规范**：

```
page.[页面文件名].[描述]         // page.auth.title
component.[组件名].[描述]       // component.login_view.title
util.[工具名].[描述]            // util.request.error
common.[大类名].[描述]          // common.tips.success
```

## 调试入口

类型提示缺失时运行 `pnpm --filter @apps/slax-reader-dweb type`。
修改 `packages/selection/src` 后运行 `pnpm --filter @slax-reader/selection build`，或使用自动准备它的 app 命令。
本地同步存储应在开发账户中调试；清空 IndexedDB 会丢失尚未同步的数据，先确认同步状态。

## 许可证

仓库许可见 [LICENSE](../../../LICENSE)，导入代码的原始许可和来源见[迁移记录](../../migrations/slax-reader-web-extension.md)。
