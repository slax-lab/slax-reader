# 扩展本地开发与验证

[开发者入门](../../contributing/development.md) · [Developer setup in English](../../contributing/development.en.md)

## 配置位置

扩展配置在 `apps/extension/config`，schema 在 `apps/extension/env.schema.ts`。
环境文件加载位置从旧仓库根调整为 `apps/extension`；顺序仍是 `.env`、`.env.<SLAX_ENV>`、
`.env.<SLAX_ENV>.local`，进程中设置的变量优先。loader 未开启 `override`，文件之间也是先读到的同名值保留；
`.local` 后缀不会自动覆盖前面文件。自行配置，不从旧仓库复制，不提交环境文件。

| 变量 | 用途 |
| --- | --- |
| `PUBLIC_BASE_URL` | Web 地址，也是 `/x/ext-bridge` 所属 origin |
| `AUTH_BASE_URL` | 登录入口 |
| `SHARE_BASE_URL` | 分享入口 |
| `EXTENSIONS_API_BASE_URL` | backend API 地址 |
| `COOKIE_DOMAIN`, `COOKIE_TOKEN_NAME` | 与 Web 开发环境一致的登录 cookie 配置 |
| `SLAX_ENV` | development（默认）、preview、beta、production；控制图标、扩展 ID 和构建设置 |
| `UNINSTALL_FEEDBACK_URL` | 可选的卸载反馈入口 |

其余可选字段以 schema 为准。扩展中的配置会进入客户端产物，不要放入服务端凭据。
扩展不需要 `SLAX_BACKEND_DIR`，但其业务仍需要可访问的 Web 和 backend。
开发配置会把 `http://127.0.0.1:3000` 的 Web/分享地址规范为 `http://localhost:3000`，
并相应调整 cookie domain；这是原有行为。联调时统一使用一致的主机名。

## 验证命令

在仓库根执行：

```sh
pnpm install --frozen-lockfile
pnpm typecheck:extension
pnpm test:extension
pnpm build:extension
pnpm zip:extension
```

`typecheck:extension` 会构建 selection、运行 `wxt prepare`，再执行 `vue-tsc`。
`test:extension` 同样自动完成 selection 和 WXT 准备。`build`、`zip` 会先构建 selection。
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
pnpm build:extension
```

这些占位值不会启动 backend，不代表登录或同步可以工作。
默认 `SLAX_ENV=development` 的 `wxt build` 会输出可加载的构建，但不是线上环境配置验收。
真实 backend 联调统一留到所有迁移阶段完成后的最终验收。

## 加载与开发

`pnpm dev:extension` 使用端口 3001，自动生成 `.vendor/vendor.js` 加速开发。
在 Chrome / Edge 的扩展管理页开启开发者模式，加载 `apps/extension/build/chrome-mv3-dev`。
若只使用 `pnpm build:extension`，加载 `apps/extension/build/chrome-mv3`，重建后手动刷新扩展。
扩展各环境保留原 public manifest key，因此扩展 ID 及 Web 允许列表不因目录迁移而变化。

`.wxt`、`.vendor`、`build` 都是本地生成目录，不提交。zip 包也生成在 `build` 下。
源码保留 Firefox 命令；本迁移阶段验收 Chrome / Edge 的 Chromium 路径，未承诺 Firefox 完整功能。

## 可选的隔离浏览器测试

现有 offscreen 测试使用本地测试服务，不需要真实 backend。先准备可用于自动化加载扩展的
Chromium 或 Chrome for Testing，然后通过 `CHROME_PATH` 指定可执行文件；
脚本保留旧项目的 macOS 默认缓存路径，其他机器应显式指定。

```sh
CHROME_PATH=/absolute/path/to/chromium HEADLESS=1 pnpm --filter @apps/slax-reader-extensions test:offscreen:e2e
```

该命令会重新构建带测试插桩的扩展。完成后重新运行 `pnpm build:extension`，
再把普通构建用于人工体验或打包。长时间测试另见 app 中的 `test:offscreen:401-soak`
和 `test:offscreen:timing`，它们不替代最终业务联调。

## 已记录的安装问题

Web 依赖 `better-sqlite3` 曾因本机 Xcode 许可阻止完整 workspace 安装。
按迁移计划在全部阶段完成后处理，详见[迁移记录](../../migrations/slax-reader-web-extension.md#deferred-installation-follow-up)。
迁移期间的 `--ignore-scripts` 仅用于临时验证，不是推荐给贡献者或 CI 的标准安装方式。
