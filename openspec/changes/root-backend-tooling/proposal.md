> 本草案的根目录工具归属方案已由用户确认的 `api-command-proxy` 替代，不再按本草案实施；迁移业务保持与隔离回归要求仍沿用。

## Why

当前后端虽然进入 monorepo，但根命令仍转到 `apps/api`，ESLint、Vitest、TypeScript、Prisma 和代码生成仍依赖子目录配置或 cwd，部分操作只能调用子包脚本。开发者需要在仓库根完成全部后端操作，同时需要用迁移前后的同一组业务回归证明工具链调整没有破坏已有行为。

## What Changes

- 将根 `package.json` 作为全部受支持后端命令的唯一声明入口，覆盖开发、预览、代码生成、检查、测试、打包、部署、数据库迁移、资源配置和维护操作；现有根命令保持兼容。
- 将开发工具配置的权威入口提升到仓库根：ESLint、Prettier、EditorConfig、TypeScript、Vitest 和命名明确的多数据库 Prisma 配置。部署模板和本地基础设施配置继续由根级 `deploy/` 管理。
- 将相关 CLI 的工作目录及路径解析调整为仓库根语义，去掉 `pnpm --dir apps/api`、API 内 `process.chdir` 及根配置反向导入子包配置的依赖；安全生成器使用隔离临时目录的例外保持明确。
- 将开发工具依赖归到根，保留 API 的运行时依赖、源码、数据库 schema/迁移和测试归属，不把 monorepo 扁平化。
- **BREAKING**：移除原子包作为独立操作入口的命令和配置路径；更新所有文档、CI、规则源及测试引用，提供根命令的完整映射。保留原有根命令的参数、危险操作边界和退出状态语义。
- 增加根 cwd、生成路径、四 Worker 配置等回归，并执行迁移前后测试对比、真实打包、本地 HTTP/存储链路验收；不能以编译通过代替业务验收。

## Capabilities

### New Capabilities

- `backend-development`: 后端命令和开发配置的根目录执行契约、安全操作边界，以及工具链迁移的业务保持验收要求。

### Modified Capabilities

无。现有 `agentic-pr-review` 能力不变；本次不改变产品业务契约。

## Impact

- 涉及根/API package manifest 和 lockfile，根工具配置、`apps/api/script/`、Prisma 配置、`scripts/deploy/`、现有路径相关测试、`.github/workflows/api-ci.yml`、`README.md`、`docs/api/`、`.rulesync/` 及其按规则生成的产物。
- 不调整 API 路由、鉴权/支付/书签业务规则、数据库模型及历史 SQL、四 Worker 职责、队列/定时任务/Workflow 绑定和生产资源身份。
- 不升级依赖版本，不部署到远程，不读取或迁移秘密文件，不使用业务数据库跑会清理数据的集成测试。
- 当前工作区已有尚未提交的后端迁移；实施须以当前工作区为基线保留已有改动，不使用 HEAD 回滚或覆盖未跟踪文件。
