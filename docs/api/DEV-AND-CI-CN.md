# 环境初始化、项目启动与独立配置仓库部署

## 本地开发

安装 Node.js >= 22.13、仓库固定的 pnpm 和 Docker Compose（支持 `up --wait`），启动 Docker，首次检出后执行 `pnpm install --frozen-lockfile`。配置准备好后，初始化与项目启动分开执行：

```bash
pnpm api -- setup
pnpm api -- dev
```

`setup` 先检查配置，再在 apps/api 中执行一次 `pnpm exec wrangler login`（需要在浏览器完成授权）。登录成功后启动 PostgreSQL，执行主库/logs/D1/fulltext 迁移、生成 Prisma/types/路由，再启动 PowerSync、等待健康检查通过，然后退出。它只启动 PostgreSQL/PowerSync 依赖，不启动 Core、Edge、AI、Browser。`pnpm api -- dev` 单独启动四个 Worker。登录失败或被中断会停止后续初始化。

配置由你准备：`api.toml` 使用原生 Wrangler 格式（`name`、`services`、`[env.dev]` 等）；`.dev.vars` 至少包含 JWT_SECRET_TEXT、HASH_IDS_SALT、EDGE_SHARED_SECRET 和有效的 RSA 签名私钥 POWERSYNC_JWK_PRIVATE_KEY（包括 kid）。本地 PowerSync 使用从该私钥推导出的公钥，通过启动进程传给 Compose；不再要求 dev-jwks-private.json、dev-jwks-public.json、compose.env 三份文件，也不读取或改写其中的旧密钥。工具凭据和 Prisma URL 放在同目录 `.env`，CI 也可通过进程变量提供。

`setup` 不创建、补写、迁移或备份这些配置文件，也不生成密钥。缺少什么就明确报告，由你补齐后重试。仅主动执行 `config:init` 才复制公开模板，主动执行 `keys:powersync` 才生成开发密钥。现有非空密钥、原配置和数据库数据保留；任何预检或服务启动失败都会停止后续阶段。

`setup`、`dev` 和本地 D1 默认选择文件中的 `[env.dev]`；没有该环境时读取顶层。`build`、`types`、资源计划和远程部署默认读取顶层；`--env <name>` 或 `SLAX_API_ENV` 可显式选择命名环境。遵循 Wrangler 的环境隔离：vars 和资源 bindings 不从生产顶层继承。所有环境可以放在同一份 api.toml，不需要 `[workers.*]`。

Worker 身份来自原生 name 和服务绑定：Core 使用所选环境的 name，AI 使用 AIGC/VECTOR，Browser 使用 SlaxBrowser。已有 reader-core 系列的 Edge 名称沿用原后端；其他自定义名称默认追加 -edge，也可用原生 EDGE 服务绑定显式指定。脚本仅在 deploy/local/.generated 生成各入口使用的运行配置，不改写 api.toml。

本地文件集中在 `deploy/local/`：

```text
deploy/local/
├── api.toml          # 实际配置，忽略提交
├── .env              # Prisma URL、Cloudflare 工具凭据，忽略提交
├── .dev.vars         # Worker 本地密钥，忽略提交
├── .generated/       # 临时 Worker 配置，忽略提交
├── .wrangler/state/  # 本地 D1 等状态，忽略提交
└── powersync-local/  # PowerSync 服务配置（旧密钥文件可保留，不参与 setup）
```

CI 的 `wrangler-environment` 输入选择 TOML 中的命名环境；留空使用顶层，与 GitHub 部署 environment 独立。

唯一公开模板仍在 `deploy/cloudflare/api.toml.example`。`.env` 与 `.dev.vars` 同目录但用途独立，工具凭据不会自动成为 Worker bindings。旧 apps/api/.env 和 deploy/cloudflare 下的本地文件不再加载。外部 TOML 配置可继续用 SLAX_API_CONFIG，工具凭据文件固定为 deploy/local/.env。

`pnpm api -- setup --check` 只读检查当前准备情况，不触发 Wrangler 登录、不创建文件、不启动服务、不迁移。它会列出缺失文件，检查本地数据库目标、运行变量、PowerSync 私钥格式、必要字段及 RS256 签名验签能力和 Docker 可用性，但不验证云端权限或声称服务已经健康。真正启动时才等待 PowerSync 健康检查通过。

setup 同样不会启动 Workers。移除原先混合初始化与启动的 `dev:full` 入口；旧 init:pgsql 已移出公开命令。Ctrl-C 停止前台 Worker，Docker 依赖和数据库保留。

本地使用 development/dev；Worker 监听 127.0.0.1:8787，PostgreSQL 15432，PowerSync 18080。BACKEND_API_PREFIX 可保留现有开发域名，不强制改为 localhost。全功能仍需在 api.toml 配置专用 Cloudflare 开发资源，在 .env 放工具凭据（或 Wrangler 登录），在 .dev.vars 放所启用的 OAuth/模型/支付等服务密钥。Vectorize/Workers AI 仍依赖云端，已有生产配置不会被自动改成本地配置。

PowerSync 使用官方示例的 `/probes/liveness` 健康检查，Compose 通过 `--wait --wait-timeout` 等待服务健康。它表示服务存活，不保证所有业务表已完成首次同步。[PowerSync 官方示例](https://github.com/powersync-ja/self-host-demo/blob/main/services/powersync.yaml)、[Docker Compose up](https://docs.docker.com/reference/cli/docker/compose/up/)。

## 配置来自其他仓库

统一的 `SLAX_API_CONFIG` 支持仓库根相对路径或绝对路径，覆盖 dev、setup、build、deploy、types、resources 和 Wrangler/D1。支持 --config 的 build/deploy/types/setup，其显式参数优先。文件不复制、不改写；所有迁移和源码路径仍解析回代码仓库。

```bash
SLAX_API_CONFIG=../reader-operations/dev/api.toml pnpm api -- setup
SLAX_API_CONFIG=../reader-operations/dev/api.toml pnpm api -- dev
SLAX_API_CONFIG=../reader-operations/prod/api.toml pnpm api -- gen:all
SLAX_API_CONFIG=../reader-operations/prod/api.toml pnpm api -- build
SLAX_API_CONFIG=../reader-operations/prod/api.toml pnpm api -- deploy --dry-run
```

初始化和启动分别执行时，应使用相同的 `SLAX_API_CONFIG` / `SLAX_API_ENV`，或在两条命令中传入相同的 `--config` / `--env`；setup 不会保存这些选择。

`config:init` 始终只创建默认的 deploy/local/api.toml，且不覆盖现有文件。CI 使用外部配置时不需要运行它。工具固定加载 deploy/local/.env；CI 可直接注入进程环境变量，其优先级高于文件值。

## GitHub Actions

新增 `.github/workflows/api-deploy.yml`，支持手动触发和由本代码仓库其他 workflow 调用。它检出当前源码和指定配置仓库，检查 config-path 位于配置 checkout 内，记录配置 commit SHA，执行生成/lint/typecheck/test/build，成功后部署全部 Worker。配置内容不输出、不作为 artifact 上传。实际部署由手动触发或调用 workflow 明确发起，不在普通 PR/push 时自动执行。

需要准备：

- 配置仓库 owner/name、ref（建议固定 commit SHA）和 api.toml 在该仓库内的路径。
- `CONFIG_REPO_TOKEN`：仅有配置仓库 contents:read 权限的 token；默认 GITHUB_TOKEN 通常不能读取另一个私有仓库。
- `CLOUDFLARE_API_TOKEN`，以及可选 `CLOUDFLARE_ACCOUNT_ID`（也可在 TOML 设置 account_id）。
- dev/beta/prod 对应的 GitHub Environment，可在 GitHub 设置审批和允许部署的分支。同名 Environment secret 会优先于调用方传入的 secret。[GitHub 可复用工作流与环境秘密](https://docs.github.com/en/enterprise-cloud%40latest/actions/how-tos/reuse-automations/reuse-workflows)
- 已创建的 D1/KV/R2/Queues/Vectorize/Hyperdrive 等资源、已核对的数据库迁移、所需外部服务，以及各 Worker 的 runtime secrets。配置仓库只存非秘密 TOML；本 workflow 不自动创建资源、迁移远程数据库或上传 runtime secrets。

调用示例，owner、ref、文件路径替换为自己的值：

```yaml
jobs:
  deploy-api:
    uses: ./.github/workflows/api-deploy.yml
    with:
      config-repository: your-org/reader-operations
      config-ref: reviewed-config-commit-sha
      config-path: prod/api.toml
      environment: prod
      bootstrap: false
    secrets:
      CONFIG_REPO_TOKEN: ${{ secrets.CONFIG_REPO_TOKEN }}
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

新安装才选择 bootstrap；普通更新保持 false。CI 的 PostgreSQL URL 是客户端生成占位值，不连接数据库。Cloudflare 部署 token 仅在最后的部署步骤注入，不提供给安装、生成或测试步骤。第一次安装的 Worker secrets 仍须按部署指南配置好，再验收业务端点。

配置仓库可以是任意受控位置；其他 CI 系统只要检出该文件并设置 SLAX_API_CONFIG，就可以调用相同命令，不依赖 GitHub 专有配置格式。GitHub 的权限、Environment 保护和真实云端部署需要在实际账号里验收，本地测试不会代替这些检查。
