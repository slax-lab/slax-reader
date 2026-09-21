# Slax Reader DWeb

## 项目概述

Slax Reader DWeb 是基于 Nuxt 4 的阅读 Web 应用（"Read It Later"产品）。项目完全开源，是一个自包含的单一 Nuxt 项目，不依赖任何子模块。

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

### 环境要求

- **Node.js** ^22.22.2 或 ^24.15.0 或 >= 26
- **pnpm** 11.25.0（仓库固定版本）

### 快速开始

```bash
# 在仓库根目录安装依赖
pnpm install

# 启动 dweb 开发服务器
pnpm dev:web

# 构建生产版本
pnpm build:web

# 运行测试
pnpm test:web
pnpm --filter @apps/slax-reader-dweb test:coverage
```

### 本地 Cloudflare Worker 调试

项目通过 `wrangler.local.toml` 绑定本地 backend worker，开发时会自动代理 API 请求。详见 `wrangler.toml` / `wrangler.local.toml` 中的 `services` 绑定配置。

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

## 注意事项

- **Local-First 调试**：改动 PowerSync schema 后需清除 IndexedDB 重新同步
- **自动引入**：如 IDE 类型提示失效，运行 `npx nuxt prepare`
- **selection 包**：改动 `packages/selection/src` 后须 `tsup` rebuild dist，否则运行时不生效

## 许可证

`Slax Reader` 基于 [Apache License 2.0](../../LICENSE) 许可，社区版 100% 免费且开源。
