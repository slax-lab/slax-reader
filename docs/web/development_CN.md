# Web 本地开发与验证

[English](development.md) · [Web 架构](architecture_CN.md) · [Extension 开发](../extension/development_CN.md)

## 配置归属

Web 配置集中在 `apps/web/config`，环境 schema 在 `apps/web/env.schema.ts`。
根目录的 `pnpm web -- ...` 会从 `deploy/local`（与 API 共用目录，通过文件名区分）加载 `.env.web` 和 profile 文件；development profile 使用 `.env.web.dev`，其他 profile 使用 `.env.web.<SLAX_ENV>`。
`.env.web.dev` 覆盖 `.env.web`，进程中已设置的同名变量优先。直接运行 app 包也使用同一 deploy 配置，不再读取 app 目录的环境文件。
环境名称按终端 `SLAX_ENV` → deploy `.env.web` 中的 `SLAX_ENV` → `development` 选择，profile 文件不能再切换它。所有根命令（包括 `dev` 和 `build`）都使用这套规则；根目录 `.env` 不会自动加载。
环境文件由开发者自行配置，不提交，也不从旧仓库复制。

## 首次准备

先准备下面的 Web 环境文件，再在仓库根目录运行只读预检和 Web 初始化：

```sh
pnpm preflight --app web
pnpm web -- setup
```

也可以运行 `pnpm setup:all` 按 API、Web、Extension 顺序完成全部初始化。
删除 `.nuxt/` 或本地生成的 Web 配置后，需要重新运行 Web setup；setup
只准备生成文件，不会启动 `pnpm web -- dev`，也不代表 API 联调已经通过。

可先复制 [`deploy/local/.env.web.example`](../../deploy/local/.env.web.example) 作为起点：

```sh
cp deploy/local/.env.web.example deploy/local/.env.web
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

这里只需要公开的 Client ID。Client Secret 属于服务端凭据，不要放进前端环境文件、`deploy/local/.env.web.example` 或浏览器产物。

## 后端边界

`pnpm web -- dev` 延续原实现：需要 API 已生成 `deploy/local/.wrangler/state/v3`，
并通过生成于 `deploy/local/.generated/web/wrangler.toml` 的配置中的 `BACKEND` service binding 调用本地 Worker。
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
完整安装需要按本机系统准备 Node.js、pnpm 及可能的原生编译工具；跳过安装脚本不等于完整安装成功。

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

`build` 延续原 Nuxt hook：从 API 的公开 TOML 投影生成 `deploy/local/.generated/web/wrangler.toml`，不会改写 apps/web/wrangler.toml。

## 迁移时的目录约定

`open_docs` 是 Nuxt Content 读取的产品内容，保留在 app 内。`content.config.ts` 还配置了
app 内 `docs/en`、`docs/zh` 内容入口，但当前快照没有这两个目录。
开发者长文档放在仓库 `docs/web`，不会成为页面数据。
应用依赖声明在 app manifest，共享库通过 workspace 链接，不依赖旧仓库 `node_modules`。

## 参与项目（Web 与 Extension 通用）

不需要本地环境也可以参与：可以在 GitHub Issues 反馈问题或提出建议，也可以直接编辑
Markdown 文档和翻译文件。反馈时请写明位置、环境、复现步骤、期望结果和实际结果，并隐藏
账户信息、私密文章、cookie 和 token。

小范围文案、翻译或文档修改可以在 GitHub 网页编辑器中完成，检查 Markdown 预览后从新分支
提交 PR；较大的多文件修改先开 Issue，再按本地开发流程处理。不要直接提交到 `dev`、
`beta` 或 `main`。功能、API 和行为修改需要先提出并评审 OpenSpec，纯文档修改可以写
`OpenSpec: n/a`。

翻译文件位于 `apps/web/i18n/locales` 和 `apps/extension/src/locales`。保留原有 key、
占位符、换行符和 JSON 结构；Web 使用 `{username}` 一类占位符，Extension 使用 `$1`
一类占位符。修改代码时，在独立 worktree 中创建任务分支，按受影响的应用运行类型检查、
测试和构建，并在 PR 中列出实际执行过的检查。
