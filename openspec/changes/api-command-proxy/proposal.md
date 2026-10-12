## Why

当前后端迁移把所有具体 API 命令复制到仓库根 `package.json`，导致根 manifest 承担了应用内部任务、API 专属路径和不可复用配置的职责。这样既不符合 monorepo 中“命令属于应用”的边界，也让根目录随着后端命令增长而变得难以维护；同时当前工作区还遗留了规则源、lockfile 和根 manifest 的冲突，需要在新的命令归属方案中一次整理。

## What Changes

- 将 API 的具体 scripts、命令别名和 API 专属命令组合放回 `apps/api/package.json`，保留应用内部短命令语义。
- 根 `package.json` 只提供抽象 API 入口 `pnpm api -- <command>`，从根目录转发到 `apps/api`，不复制完整 API 命令清单。
- 将不可复用的 API 专属工具配置、Prisma 配置、测试配置、生成类型配置和 API 迁移配置放回 `apps/api`；只有确实被多个 workspace 复用的仓库级配置继续放在根目录。
- 保持用户从仓库根目录执行、参数透传、退出码、安全边界和远程操作授权语义；不要求用户手动 `cd apps/api`。
- 清理当前工作区残留的冲突标记、重复 JSON keys 和 lockfile 冲突，确保根 manifest、API manifest、lockfile、规则源和生成规则文件一致。
- **BREAKING**：移除根目录的具体 API 命令名（例如 `gen:api`、`lint:api`、`test:api`），改用 `pnpm api -- <apps/api 中的命令>`；同步文档、CI、测试和贡献规则。
- 重新执行根入口验证、API 内命令验证、四 Worker 离线构建、默认测试和真实 HTTP 验收；保留并明确现有支付集成断言失败，不擅自修改业务规则。

- 按用户确认，统一为 `deploy/cloudflare/api.toml.example` 与忽略的 `api.toml`，移除多环境模板和硬编码 Worker/资源名称；开发、打包、部署与类型生成共享配置入口。
- 修正已定位的支付集成测试 fixture 缺少 provider，保留原业务断言；不改支付业务规则。

## Capabilities

### New Capabilities

- `api-command-interface`: 定义 API 应用内部具体命令及仓库根抽象转发入口的行为契约和路径归属。

### Modified Capabilities

无。现有 `agentic-pr-review` 和此前的后端业务契约不改变；本次只调整命令、配置和验证入口的归属。

## Impact

- 影响根 `package.json`、`apps/api/package.json`、pnpm lockfile、API 专属配置、`apps/api/script/`、`apps/api/script/deploy/`、测试入口、CI、README、`docs/api`、`.rulesync` 以及生成的规则文件。
- 保留鉴权、支付、书签、数据库模型、历史 SQL 和四 Worker 职责；仅扩展配置驱动的 API/前端 origin、资源 URL 与队列名称解析，不改变业务处理逻辑。
- 不部署远程资源，不修改或读取秘密，不在真实业务库上运行破坏性测试；集成测试只使用新建隔离资源。
- 当前工作区包含未提交的后端迁移和规则冲突；实施必须保留已完成业务迁移，不回滚或覆盖既有改动。

用户补充确认：环境配置应由文件自动加载，不能要求手动 export。补齐 Prisma 与 Cloudflare 工具的 deploy/local/.env 加载，保留 Worker 的 deploy/local/.dev.vars 和隔离验证边界。

用户后续授权优化一键启动和 CI 外部配置；Docker 自部署经澄清本轮仅调研。新增 dev:full 将已配置开发环境的预检、基础设施、历史迁移、生成和 Worker 启动串联；SLAX_API_CONFIG 贯通各工具，CI 从独立仓库选择配置，不复制第二份权威配置。HTTP 类型仅评估 packages/contracts 的迁移边界。

用户最终确认：本地配置集中 deploy/local，setup 在配置齐备后一次性启动 PostgreSQL、迁移、PowerSync 与四个 Workers。用户自行准备缺失配置，不允许自动补写、转换或备份配置。遵循其现有原生 Wrangler name/services/env 格式，移除自定义 workers 表要求；各入口统一环境选择，运行时配置只生成在既有 .generated 目录。

用户最新确认：setup 与项目启动必须分离。setup 校验后执行一次 pnpm exec wrangler login，成功后准备 PostgreSQL/PowerSync、迁移和生成并退出；API Workers 由 dev 独立启动。移除混合 dev:full 入口，setup 仅负责初始化；--check 不登录。
