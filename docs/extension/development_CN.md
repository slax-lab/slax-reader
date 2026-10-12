# 扩展本地开发与验证

[English](development.md) · [通用参与和提交流程](../web/development_CN.md#参与项目web-与-extension-通用) · [Web 开发](../web/development_CN.md)

## 配置位置

扩展配置在 `apps/extension/config`，schema 在 `apps/extension/env.schema.ts`。
根目录的 `pnpm extension -- ...` 会从 `deploy/local`（与 API、Web 共用目录，靠文件名区分）加载 `.env.extension` 和 profile 文件；development profile 使用 `.env.extension.dev`，其他 profile 使用 `.env.extension.<SLAX_ENV>`，进程中设置的同名变量优先。
profile 文件覆盖 `.env.extension`。环境名称按终端 `SLAX_ENV` → deploy `.env.extension` 中的 `SLAX_ENV` → `development` 选择，profile 文件不能再切换它。所有根命令（包括 `dev`、`build` 和 `zip`）都使用这套规则；根目录 `.env` 不会自动加载。
直接运行 app 包也使用同一 deploy 配置，不再读取 app 目录的环境文件。自行配置，不从旧仓库复制，不提交环境文件。

## 首次准备

先准备下面的 Extension 环境文件，再在仓库根目录运行只读预检和 Extension 初始化：

```sh
pnpm preflight --app extension
pnpm extension -- setup
```

也可以运行 `pnpm setup:all` 按 API、Web、Extension 顺序完成全部初始化。
删除 `.wxt/` 或本地构建缓存后，需要重新运行 Extension setup；setup
只准备 WXT 生成状态，不会启动 `pnpm extension -- dev`，也不代表 Web/API 联调已经通过。

可先复制 [`deploy/local/.env.extension.example`](../../deploy/local/.env.extension.example) 作为起点：

```sh
cp deploy/local/.env.extension.example deploy/local/.env.extension
```

示例中的值只适合本地占位；扩展构建会把部分配置带入客户端产物，不要填写服务端密钥。

| 变量 | 必填性 | 用途 |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | 必填 | Web 地址，也是 `/x/ext-bridge` 所属 origin |
| `AUTH_BASE_URL` | 必填 | 登录入口 |
| `SHARE_BASE_URL` | 必填 | 分享入口 |
| `EXTENSIONS_API_BASE_URL` | 必填 | backend API 地址 |
| `COOKIE_DOMAIN`, `COOKIE_TOKEN_NAME` | 必填 | 与 Web 开发环境一致的登录 cookie 配置 |
| `SLAX_ENV` | 可选，默认 development | development、preview、beta、production；控制图标、扩展 ID 和构建设置 |
| `UNINSTALL_FEEDBACK_URL` | 可选 | 卸载反馈入口 |

其余可选字段以 schema 为准。扩展中的配置会进入客户端产物，不要放入服务端凭据。
扩展不需要 `SLAX_API_CONFIG` / `deploy/local/api.toml`，但其业务仍需要可访问的 Web 和 backend。
开发配置会把 `http://127.0.0.1:3000` 的 Web/分享地址规范为 `http://localhost:3000`，
并相应调整 cookie domain；这是原有行为。联调时统一使用一致的主机名。

## 验证命令

在仓库根执行：

```sh
pnpm install --frozen-lockfile
pnpm extension -- typecheck
pnpm extension -- test
pnpm extension -- build
pnpm extension -- zip
```

`pnpm extension -- typecheck` 会构建 selection、运行 `wxt prepare`，再执行 `vue-tsc`。
`pnpm extension -- test` 同样自动完成 selection 和 WXT 准备。`build`、`zip` 会先构建 selection。
各命令以 `apps/extension/package.json` 为准。

只验证构建时，可在当前终端导出以下本地占位配置（不包含真实账户或密钥）：

```sh
export SLAX_ENV=development
export PUBLIC_BASE_URL=http://localhost:3000
export AUTH_BASE_URL=http://localhost:3000
export SHARE_BASE_URL=http://localhost:3000
export EXTENSIONS_API_BASE_URL=http://localhost:8787
export COOKIE_DOMAIN=localhost
export COOKIE_TOKEN_NAME=slax_test
pnpm extension -- build
```

这些占位值不会启动 API，不代表登录或同步可以工作。
默认 `SLAX_ENV=development` 的 `wxt build` 会输出可加载的构建，但不是线上环境配置验收。
真实 API 联调统一留到所有迁移阶段完成后的最终验收。

## 加载与开发

`pnpm extension -- dev` 使用端口 3001，自动生成 `.vendor/vendor.js` 加速开发。
在 Chrome / Edge 的扩展管理页开启开发者模式，加载 `apps/extension/build/chrome-mv3-dev`。
若只使用 `pnpm extension -- build`，加载 `apps/extension/build/chrome-mv3`，重建后手动刷新扩展。
扩展各环境保留原 public manifest key，因此扩展 ID 及 Web 允许列表不因目录迁移而变化。

`.wxt`、`.vendor`、`build` 都是本地生成目录，不提交。zip 包也生成在 `build` 下。
源码保留 Firefox 命令；本迁移阶段验收 Chrome / Edge 的 Chromium 路径，未承诺 Firefox 完整功能。

## 可选的隔离浏览器测试

现有 offscreen 测试使用本地测试服务，不需要真实 API。先准备可用于自动化加载扩展的
Chromium 或 Chrome for Testing，然后通过 `CHROME_PATH` 指定可执行文件；
脚本保留旧项目的 macOS 默认缓存路径，其他机器应显式指定。

```sh
CHROME_PATH=/absolute/path/to/chromium HEADLESS=1 pnpm --filter @apps/slax-reader-extensions test:offscreen:e2e
```

该命令会重新构建带测试插桩的扩展。完成后重新运行 `pnpm extension -- build`，
再把普通构建用于人工体验或打包。长时间测试另见 app 中的 `test:offscreen:401-soak`
和 `test:offscreen:timing`，它们不替代最终业务联调。

## 已记录的安装问题

Web 依赖 `better-sqlite3` 曾因本机 Xcode 许可阻止完整 workspace 安装。
真实 API 联调在前端配置和后端开发环境准备完成后进行。
迁移期间的 `--ignore-scripts` 仅用于临时验证，不是推荐给贡献者或 CI 的标准安装方式。
