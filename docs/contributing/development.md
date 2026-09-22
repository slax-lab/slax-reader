# 开发者入门

[English](development.en.md) · [参与指南](README.md) · [目录与应用关系](../architecture/frontend.md)

先选择一个应用：阅读器页面在 `apps/web`，浏览器扩展在 `apps/extension`。你可以先了解和修改其中一端，
不必参与 backend 迁移；但登录、收藏同步等功能需要可用的开发 backend 和相应配置。

## 准备自己的工作目录

使用 Git、符合 app 要求的 Node.js（`^22.22.2 || ^24.15.0 || >=26.0.0`），以及固定的 pnpm 11.25.0。
根包的 Node 最低要求较低，运行前端请以 app 的 `engines` 为准。macOS 不是必需条件；
部分脚本使用 POSIX shell，Windows 贡献者可使用 WSL2，并留意浏览器与 backend 路径。
本迁移尚未完成各操作系统的干净安装验收。

没有写入权限时先 Fork，克隆自己的副本，把官方仓库设置为 `upstream`，并获取它的 `dev`：

```sh
git remote add upstream https://github.com/slax-lab/slax-reader.git
git fetch upstream
git worktree add .worktrees/fix-reader-wording -b docs/fix-reader-wording --no-track upstream/dev
cd .worktrees/fix-reader-wording
```

若已经有 `upstream`，无需重复添加。有写入权限、`origin` 就是官方仓库时，使用 `git fetch origin` 和 `origin/dev`。
上面的 `fix-reader-wording` 是示例任务名，换成自己的名称；工作树目录和分支后缀保持相同。
在工作树内修改，每个任务独立分支。完整约定见 [AGENTS.md](../../AGENTS.md)。

**迁移期间例外：** Web/扩展尚未合入 `dev` 时，以上 `dev` 基线不含本指南描述的全部源码。
本次迁移各阶段从已推送或本地已有的 `feat/integrate-slax-reader-web-extension` 创建分支，再汇回它；
最终由集成分支通过 PR 合入 `dev`。没有远端分支时，请维护者先提供已发布的基线。
普通贡献在迁移合入后仍以 `dev` 为目标。

## 配置与安装

在任务工作树根目录确认 `node --version`、`pnpm --version`，然后安装：

```sh
pnpm install --frozen-lockfile
```

安装后可以先运行 setup check 检查本机是否完成依赖安装，以及 Web 和 Extension 的必要前端环境变量：

```sh
pnpm run setup:check
```

它只检查前端，不会读取或显示环境变量值，也不会启动 backend。检查单个应用或指定环境时可使用
`pnpm run setup:check --app web`、`pnpm run setup:check --app extension` 或 `pnpm run setup:check --env preview`。
当前 loader 读取的是各 app 目录中的 `.env`、`.env.<SLAX_ENV>` 和 `.env.<SLAX_ENV>.local`；根目录 `.env`
不会自动生效，setup check 会对此给出提醒。

安装整个 workspace 可能包含另一个 app 的工具依赖；按应用运行命令不等于依赖安装完全隔离。
配置字段见 [Web](../apps/web/development.md) 或 [Extension](../apps/extension/development.md)，schema 分别在
[`apps/web/env.schema.ts`](../../apps/web/env.schema.ts) 和 [`apps/extension/env.schema.ts`](../../apps/extension/env.schema.ts)。
环境文件由你在对应 app 目录自行配置，或在终端提供变量。不从旧仓库复制环境文件，不提交凭据。

加载顺序是 `.env` → `.env.<SLAX_ENV>` → `.env.<SLAX_ENV>.local`。当前 loader 没有开启 dotenv 的 `override`，
因此进程变量优先，其后先读到的同名值保留；不能因为文件名带 `.local` 就假定它会覆盖前面文件。

## 运行一个应用

以下命令都在任务工作树根执行：

| 操作 | Web | Extension |
| --- | --- | --- |
| 开发 | `pnpm dev:web` | `pnpm dev:extension` |
| 类型检查 | `pnpm typecheck:web` | `pnpm typecheck:extension` |
| 单元测试 | `pnpm test:web` | `pnpm test:extension` |
| 构建 | `pnpm build:web` | `pnpm build:extension` |
| 扩展压缩包 | — | `pnpm zip:extension` |

首次 Web 检查先执行：

```sh
pnpm --filter @apps/slax-reader-dweb type
```

Web 默认开发端口为 3000；它要求 `SLAX_BACKEND_DIR` 指向开发 backend，且该 backend 已有
`config/.wrangler/state/v3`。Nuxt prepare、类型检查、单元测试和构建可先使用公开占位配置，
无需启动真实 backend；可复制的占位值见 [Web 验证说明](../apps/web/development.md)。
开发服务器没有免后端演示模式。

扩展开发服务器使用 3001，`dev:extension` 自动构建 selection 和 vendor；类型检查及单元测试也会先生成 WXT 类型。
普通构建完成后，在 Chrome / Edge 扩展管理页开启开发者模式并加载 `apps/extension/build/chrome-mv3`；
开发模式用 `build/chrome-mv3-dev`。真实业务依赖 Web 的 `/x/ext-bridge` 与 backend。
环境主机名、cookie 配置和扩展环境要一致，详见[扩展指南](../apps/extension/development.md)。

## 修改后验证什么

| 修改范围 | 验证 |
| --- | --- |
| 文档 | 检查链接、Markdown 预览、命令和路径是否存在；无需启动应用 |
| 翻译 | 检查 JSON 和占位符，运行对应 app 的检查并观察界面；无环境时在 PR 标明需协助验收 |
| Web 或扩展代码 | 对应 app 的类型检查、相关测试和构建；交互修改补充人工验证 |
| 共享包 | 修改 `contracts`、`frontend-types` 或 `frontend-utils` 时验证 Web 与 Extension；修改 selection 时再运行 `pnpm --filter @slax-reader/selection typecheck` |
| OpenSpec 文档 | `pnpm exec openspec validate --all --strict` |

根命令只是入口，具体行为以 [Web package.json](../../apps/web/package.json)、
[Extension package.json](../../apps/extension/package.json) 为准。Web 的根类型检查覆盖 app；
修改 `apps/web/server` 时，在 prepare 后补跑：

```sh
pnpm --filter @apps/slax-reader-dweb exec vue-tsc --noEmit -p .nuxt/tsconfig.server.json
```

根目录目前没有统一的 `dev`、`test`、`lint` 或 `format` 命令。现有 CI 的配置校验也不等于应用测试已运行，
请在 PR 列出你实际做过的检查。Web 构建可能按环境修改 `wrangler.toml`，提交前检查 diff。

## 提交与评审

功能、API 和行为修复必须先有 OpenSpec 提案并由人评审，再实现任务。可以使用 `$openspec-propose`，
或按仓库 [OpenSpec 约定](../../AGENTS.md)操作；任务名、分支后缀和 change-id 保持一致。
文档、错字或不改变行为的重构可跳过提案。

提交前阅读 [REVIEW.md](../../REVIEW.md)，按 [PR 模板](../../.github/PULL_REQUEST_TEMPLATE.md)写清问题、改动、验证及限制。
行为变更写 `OpenSpec: <change-id>`，纯文档通常写 `OpenSpec: n/a`；本迁移关联 `integrate-slax-reader-web-extension`。
推送自己的任务分支，在 GitHub 创建 PR 并确认 base 为 `dev`（迁移阶段使用上面的例外）。
合并后再清理工作树；OpenSpec change 按仓库约定在合并后归档。

不要手改 `AGENTS.md`、`CLAUDE.md`、`.agents`、`.codex` 等生成文件。
需要修改代理规则时编辑 `.rulesync` 并运行 `pnpm agent:sync`。只使用一个 app 的代码留在 app；
至少两个 app 共用的库才放到 `packages`。

## 常见卡点

| 现象 | 下一步 |
| --- | --- |
| 找不到 `.nuxt` 或 `.wxt` 类型 | Web 运行 `pnpm --filter @apps/slax-reader-dweb type`；扩展运行 `pnpm --filter @apps/slax-reader-extensions type` |
| 找不到 selection 的 `dist` | 运行 `pnpm --filter @slax-reader/selection build`，或使用会自动准备它的 app 命令 |
| Web 提示缺少 backend 路径或本地状态 | 按 Web 指南配置独立 backend；没有环境时先做不依赖它的检查 |
| macOS 安装停在 `better-sqlite3` / Xcode 许可 | 保留 Node、系统和安装错误信息，查看[已记录事项](../migrations/final-verification.md)；不要把跳过脚本当作安装成功 |
| 想在线预览 PR | 当前没有自动 PR 预览部署，向作者索取可用的测试环境或对应构建 |
