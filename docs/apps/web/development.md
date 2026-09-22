# Web 本地开发与验证

[开发者入门](../../contributing/development.md) · [Developer setup in English](../../contributing/development.en.md)

## 配置归属

Web 配置集中在 `apps/web/config`，环境 schema 在 `apps/web/env.schema.ts`。
根目录的 `pnpm web -- ...` 会从 `deploy/local_web` 加载 `.env` 和 profile 文件；development profile 使用 `.env.dev`，其他 profile 使用 `.env.<SLAX_ENV>`。
`.env.dev` 覆盖 `.env`，进程中已设置的同名变量优先。直接运行 app 包也使用同一 deploy 配置，不再读取 app 目录的环境文件。
环境名称按终端 `SLAX_ENV` → deploy `.env` 中的 `SLAX_ENV` → `development` 选择，profile 文件不能再切换它。所有根命令（包括 `dev` 和 `build`）都使用这套规则；根目录 `.env` 不会自动加载。
环境文件由开发者自行配置，不提交，也不从旧仓库复制。

可先复制 [`deploy/local_web/.env.example`](../../../deploy/local_web/.env.example) 作为起点：

```sh
cp deploy/local_web/.env.example deploy/local_web/.env
```

示例中的值只适合本地占位；Google OAuth 是 Web 登录必需配置，Apple OAuth 和 Turnstile 是可选能力。
真实 OAuth、Turnstile、Push 或 Stripe 配置需要由开发者自行填写。

下表只有变量名和用途，不含真实环境值：

| 变量 | 必填性 | 用途 |
| --- | --- | --- |
| `PUBLIC_BASE_URL`, `AUTH_BASE_URL`, `SHARE_BASE_URL` | 必填 | 本地 Web / 登录 / 分享入口 |
| `DWEB_API_BASE_URL` | 必填 | API 服务地址（本地联调通常由 `apps/api` 提供） |
| `COOKIE_DOMAIN`, `COOKIE_TOKEN_NAME` | 必填 | 本地登录 cookie 配置 |
| `GOOGLE_OAUTH_CLIENT_ID` | 必填 | Google Web OAuth 客户端 ID |
| `APPLE_OAUTH_CLIENT_ID` | 可选 | 配置后显示 Apple 登录按钮；留空时不显示 |
| `TURNSTILE_SITE_KEY` | 可选 | 配置后启用 Turnstile；留空时跳过相关验证 |
| `SLAX_API_CONFIG` / `deploy/local/api.toml` | 仅 Web dev 必填 | API 配置文件路径；默认使用 deploy/local/api.toml，仅本地 Worker 联调需要 |
| `SLAX_ENV` | 可选，默认 development | development、preview、beta、production |

其他可选项以 `env.schema.ts` 为准。不要把服务端密钥放入前端公开配置。

## 创建 Google OAuth 客户端 ID

Google 登录必须使用 Web 应用类型的 OAuth 客户端 ID。创建流程如下：

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)，创建或选择项目。
2. 进入 **APIs & Services → OAuth consent screen**，完成应用名称、支持邮箱和必要的授权范围配置。
3. 进入 **APIs & Services → Credentials → Create Credentials → OAuth client ID**。
4. 应用类型选择 **Web application**。
5. 在 **Authorized JavaScript origins** 中填写 `PUBLIC_BASE_URL`，例如 `http://localhost:3000`。
6. 在 **Authorized redirect URIs** 中填写 `${AUTH_BASE_URL}/auth`，例如 `http://localhost:3000/auth`。
7. 复制生成的 **Client ID** 到 `GOOGLE_OAUTH_CLIENT_ID`。

这里只需要公开的 Client ID。Client Secret 属于服务端凭据，不要放进前端环境文件、`deploy/local_web/.env.example` 或浏览器产物。

## 后端边界

`pnpm web -- dev` 延续原实现：需要 API 已生成 `deploy/local/.wrangler/state/v3`，
并通过生成于 `deploy/local_web/.generated/wrangler.toml` 的配置中的 `BACKEND` service binding 调用本地 Worker。
常规 Nuxt prepare、类型检查和 build 不需要该后端路径。本文不承诺登录、书签同步或保存
可以在没有 API 联调环境的情况下工作。

不要为了验证本次迁移去启动、安装或修改旧前端仓库。
连接 API 联调环境前由开发者提供适用的配置。本次不部署 Cloudflare，也不修改线上绑定。

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
# Google OAuth Client ID 必填；创建方法见上文。
export GOOGLE_OAUTH_CLIENT_ID=your-google-client-id
# Apple 登录可选；留空时不显示 Apple 登录按钮。
export APPLE_OAUTH_CLIENT_ID=
# Turnstile 可选；留空时跳过相关验证。
export TURNSTILE_SITE_KEY=
```

这些值不会启动 API，也不能用于验收真实登录、同步或生产部署。
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

`build` 延续原 Nuxt hook：从 API 的公开 TOML 投影生成 `deploy/local_web/.generated/wrangler.toml`，不会改写 apps/web/wrangler.toml。

## 迁移时的目录约定

`open_docs` 是 Nuxt Content 读取的产品内容，保留在 app 内。`content.config.ts` 还配置了
app 内 `docs/en`、`docs/zh` 内容入口，但当前快照没有这两个目录。
开发者长文档放在仓库 `docs/apps/web`，不会成为页面数据。
应用依赖声明在 app manifest，共享库通过 workspace 链接，不依赖旧仓库 `node_modules`。
