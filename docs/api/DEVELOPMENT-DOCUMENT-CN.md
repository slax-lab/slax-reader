# API 开发

要求 Node.js >= 22.13.0 和根 packageManager 固定的 pnpm 版本。从仓库根执行以下命令。根 `package.json` 只声明通用 `api` 转发入口；具体命令与依赖在 `apps/api/package.json`，运行 cwd 由 workspace 自动切到 API。

API 独有的 TypeScript、Vitest、ESLint、Prettier、EditorConfig 都在 `apps/api/`，四份 Prisma config 在 `apps/api/prisma/`，与 schema 和历史迁移一起维护。Prisma 的 schema/migrations 路径相对 config 文件，而非调用命令的位置；不需要为从根执行命令而把配置搬到根目录。

```bash
pnpm install --frozen-lockfile
pnpm api -- setup
pnpm api -- dev
```

```bash
pnpm api -- gen:all
pnpm api -- lint
pnpm api -- typecheck
pnpm api -- test
pnpm api -- build
```

`setup` 检查你准备的本地配置和密钥，完成数据库初始化、迁移和代码生成，执行一次 Wrangler 登录并等待 PowerSync 健康后退出；Workers 单独用 `pnpm api -- dev` 启动。无需分别初始化 PostgreSQL/PowerSync 。配置集中在 `deploy/local/`，不自动补写配置或生成密钥，缺失时明确退出。`setup --check` 只读检查；云资源和第三方凭据仍需自行配置。详见[完整启动说明](DEV-AND-CI-CN.md)。

Prisma 自动读取 `deploy/local/.env` 中的 `HYPERDRIVE_DATABASE_URL` 和 `LOGS_DATABASE_URL`，无需手动 export。占位 URL 只适用于生成客户端，迁移必须使用明确目标。`migration:local` 不含 logs，单独调用对应入口。`gen:pull` 必须明确 pgsql/logs，会改写 schema；`gen:diff:d1` 的数据库路径按仓库根解析，拒绝覆盖已有迁移。历史 SQL 不得随配置移动改写。

`types` 从 api.toml 提取兼容日期和 flags，然后在隔离临时目录使用最小配置与空 env 生成 runtime 类型，保留人工维护的 Env 接口，避免把部署值或秘密写入类型。不要直接运行 wrangler types。新增绑定同时维护模板、`script/deploy/config.ts` 和 Env；新增 HTTP 控制器登记 `script/gen-routers.ts`。

可选 smoke 使用预先缓存的 `postgres:17-alpine`，集成套件还需 `redis:7-alpine`，容器启动固定 `--pull=never`。HTTP 测试需要 8787 空闲；集成测试还需要固定容器名 `slax-payment-review`、6543 端口，拒绝复用已有资源。数据库测试可能 TRUNCATE，只能使用可丢弃数据库。结果与日志在独立 `.tmp-root-tooling-http-*` 目录。

`dev:local` 是 smoke 的受限入口：四个路径均必填，配置与 state 必须位于仓库内 `.tmp-root-tooling-http-*`，env 必须为空，只允许 dev、loopback PostgreSQL 和本地 Edge→Core 服务绑定，拒绝远程资源。

远程部署、资源创建、远程迁移需明确授权，参考 [部署文档](CLOUDFLARE-DEPLOY-CN.md)。`backfill:device-alias` 保留只读事务与默认计数，输出 SQL 不自动应用，输出路径按根解析。Apple 证书生成需网络；Stripe CLI 必须预先安装；没有 seed 命令。`keys:powersync` 仅用于生成 PowerSync 密钥，与浏览器 Web Push 无关。

| Task / 操作 | Command |
| --- | --- |
| Discover commands | `pnpm api -- --help` |
| Initialize config (exclusive copy) | `pnpm api -- config:init` |
| Prisma clients | `pnpm api -- gen:model` |
| Runtime Worker types | `pnpm api -- types` |
| DI / router / cron / consumer | `pnpm api -- gen:di` / `gen:router` / `gen:cron` / `gen:consumer` |
| Introspect selected DB | `pnpm api -- gen:pull pgsql` / `logs` |
| D1 diff | `pnpm api -- gen:diff:d1 <root-relative-sqlite-file> <migration-name>` |
| PostgreSQL / logs diff | `pnpm api -- gen:diff:pgsql` / `gen:diff:logs` |
| Local D1 + PostgreSQL + fulltext | `pnpm api -- migration:local` |
| Local logs migrations | `pnpm api -- migration:local:logs` |
| Deploy PostgreSQL / logs migrations | `pnpm api -- migration:deploy:pgsql` / `migration:deploy:logs` |
| Remote D1 / fulltext migrations | `pnpm api -- migration:remote:d1` / `migration:remote:fulltext` |
| Offline bundle | `pnpm api -- build [core\|edge\|ai\|browser]` |
| Config generation only | `pnpm api -- deploy --dry-run` |
| Dev with explicit isolated configs | `pnpm api -- dev:local --edge-config <file> --core-config <file> --state <dir> --env-file <empty-file>` |
| Real HTTP / database integration | `pnpm api -- test:http` / `test:integration:local` |
| Resource plan / create | `pnpm api -- resources` / `resources --apply` |
| Wrangler command with actual config | `pnpm api -- wrangler edge <command> [args...]` |
| Edge logs | `pnpm api -- tail` |
| Complete local API setup | `pnpm api -- setup` |
| Maintenance | `pnpm api -- gen:apple-certs` / `backfill:device-alias` |
| Diagnostics | `pnpm api -- debug:hashids` / `debug:hash-article` |
| Optional CLI tools | `pnpm api -- stripe:webhook` / `mcp:tool` / `update:cli` |

## 环境文件位置

- `deploy/local/api.toml`：实际部署配置，只放非秘密参数；唯一公开模板是`deploy/cloudflare/api.toml.example`。
- `deploy/local/.dev.vars`：本地 Worker 密钥，dev 脚本通过 `--env-file` 显式加载；不放到仓库根或 apps/api 再维护副本。生产密钥使用 Cloudflare Worker secrets。
- `deploy/local/powersync-local/compose.env`：Docker Compose 使用的 PowerSync 公钥参数，由 `pnpm api -- keys:powersync` 生成。
- `deploy/local/.env`：Prisma 数据库 URL，以及 D1/Wrangler、dev、deploy、resources --apply 的 Cloudflare 工具凭据（如 `CLOUDFLARE_API_TOKEN`）。自动加载，不需要 export；D1 数据库绑定仍来自 api.toml。已有 shell/CI 变量优先，`setup` 固定本地数据库 URL，不会被文件覆盖。默认文件缺失时可使用 CI 环境或 Wrangler 登录态。
- 工具环境文件固定为仓库根下的 `deploy/local/.env`，不受工作目录影响；不可读会失败，文件缺失时允许 CI 直接提供进程变量。根 `.env` 不自动加载。build、types、deploy --dry-run、resources 计划不会读取工具环境文件。
- `.vars` 和 `.vars.temp` 不是受支持的人工配置入口。所有实际环境文件和密钥均不提交。

## 一键启动与 CI 外部配置

完成首次资源和环境文件准备后运行 `pnpm api -- setup`，或先执行 `pnpm api -- setup --check`。setup 执行一次 Wrangler 登录、初始化依赖、迁移和生成后退出；另行执行 `pnpm api -- dev` 启动 Workers；Vectorize/AI 等仍依赖云端。所有工具支持 `SLAX_API_CONFIG` 指向独立配置仓库中的 api.toml，types 也支持 `--config`。完整准备清单与 CI workflow 示例见 [一键开发与配置仓库](DEV-AND-CI-CN.md)，Docker adapter 和公共 HTTP 类型边界见 [调研](DOCKER-ADAPTER-RESEARCH-CN.md)。
