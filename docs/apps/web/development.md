# Web 本地开发与验证

[开发者入门](../../contributing/development.md) · [Developer setup in English](../../contributing/development.en.md)

## 配置归属

Web 配置集中在 `apps/web/config`，环境 schema 在 `apps/web/env.schema.ts`。
加载位置从旧仓库根移动到 `apps/web`；加载顺序仍为 `.env`、`.env.<SLAX_ENV>`、
`.env.<SLAX_ENV>.local`。进程中已设置的同名变量优先；loader 未开启 `override`，文件之间同名值也是先读到的保留。
`.local` 后缀不代表会覆盖前面文件。
环境文件由开发者自行配置，不提交，也不从旧仓库复制。

可先复制 [`apps/web/.env.example`](../../../apps/web/.env.example) 作为起点：

```sh
cp apps/web/.env.example apps/web/.env
```

示例中的值只适合本地占位；真实 OAuth、Turnstile、Push 或 Stripe 配置需要由开发者自行填写。

下表只有变量名和用途，不含真实环境值：

| 变量 | 用途 |
| --- | --- |
| `PUBLIC_BASE_URL`, `AUTH_BASE_URL`, `SHARE_BASE_URL` | 本地 Web / 登录 / 分享入口 |
| `DWEB_API_BASE_URL` | 独立 backend API 地址 |
| `COOKIE_DOMAIN`, `COOKIE_TOKEN_NAME` | 本地登录 cookie 配置 |
| `GOOGLE_OAUTH_CLIENT_ID`, `APPLE_OAUTH_CLIENT_ID` | OAuth 公共客户端标识 |
| `TURNSTILE_SITE_KEY` | Turnstile 公共 site key |
| `SLAX_BACKEND_DIR` | 独立 backend 检出目录的绝对路径，仅本地 Worker 联调需要 |
| `SLAX_ENV` | development（默认）、preview、beta、production |

其他可选项以 `env.schema.ts` 为准。不要把服务端密钥放入前端公开配置。

## 后端边界

`pnpm web -- dev` 延续原实现：需要 backend 已生成 `config/.wrangler/state/v3`，
并通过 `wrangler.local.toml` 的 `BACKEND` service binding 调用本地 Worker。
常规 Nuxt prepare、类型检查和 build 不需要该后端路径。本文不承诺登录、书签同步或保存
可以在没有 backend 的情况下工作。

不要为了验证本次迁移去启动、安装或修改旧前端仓库或 backend 仓库。
连接已有联调环境前由开发者提供适用的配置。本次不部署 Cloudflare，也不修改线上绑定。

## 无真实服务时的检查配置

在当前终端导出以下本地占位值，可以先做 prepare、类型检查、单元测试和构建：

```sh
export SLAX_ENV=development
export PUBLIC_BASE_URL=http://localhost:3000
export AUTH_BASE_URL=http://localhost:3000
export SHARE_BASE_URL=http://localhost:3000
export DWEB_API_BASE_URL=http://localhost:8787
export COOKIE_DOMAIN=localhost
export COOKIE_TOKEN_NAME=slax_test
export GOOGLE_OAUTH_CLIENT_ID=
export APPLE_OAUTH_CLIENT_ID=
export TURNSTILE_SITE_KEY=
```

这些值不会启动 backend，也不能用于验收真实登录、同步或生产部署。
默认 development profile 的构建通过不等于 production 配置已经验证。
完整依赖安装的已知问题见[最终验收清单](../../migrations/final-verification.md)。

## 验证顺序

在仓库根：

```sh
pnpm install --frozen-lockfile
pnpm --filter @apps/slax-reader-dweb type
pnpm --filter @slax-reader/selection typecheck
pnpm web -- typecheck
pnpm web -- test
pnpm web -- build
```

以上测试沿用原项目 Vitest 用例。测试和构建不等于真实后端联调成功。

取得本地联调配置后，运行 `pnpm web -- dev`，验收登录、书签列表、文章、高亮和评论，
并检查 `/x/ext-bridge` 与扩展的配合。联调仅使用开发测试账户。

`build` 延续原 Nuxt hook：按 `SLAX_ENV` 更新 `apps/web/wrangler.toml` 的 service 名称；
检查构建后的 diff，不要把一次验证产生的环境切换当成迁移改动提交。

## 迁移时的目录约定

`open_docs` 是 Nuxt Content 读取的产品内容，保留在 app 内。`content.config.ts` 还配置了
app 内 `docs/en`、`docs/zh` 内容入口，但当前快照没有这两个目录。
开发者长文档放在仓库 `docs/apps/web`，不会成为页面数据。
应用依赖声明在 app manifest，共享库通过 workspace 链接，不依赖旧仓库 `node_modules`。
