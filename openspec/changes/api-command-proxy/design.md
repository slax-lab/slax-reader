## Context

本变更建立在已有后端迁移工作之上。当前工作区已经把大量 API 具体命令、API 专属配置和 Prisma 配置提升到了仓库根；这满足了从根执行的目标，但把应用内部任务定义和不可复用文件放错了边界。当前工作区还曾出现冲突标记、重复 JSON keys 和不同版本的根工具依赖，需要先形成一个可解析、可冻结安装的基线。

`apps/api` 是 pnpm workspace 成员，应用包名为 `slax-reader-backend`。根目录可以通过 pnpm workspace 过滤器或等价的显式 workspace 调度从根启动应用命令；具体命令应由应用 manifest 维护，根不应复制命令列表。

## Goals / Non-Goals

**Goals:**
- 让 API 的具体命令和命令组合回到 `apps/api/package.json`。
- 根只提供稳定的 `api` 抽象入口，支持任意 API 子命令和参数透传。
- 将 API-only 的配置、Prisma schema/config、迁移、测试运行配置和生成类型放回 `apps/api`，保留真正共享的根级配置和 `deploy/` 目录。
- 清理冲突和重复 manifest 后，以冻结安装、完整测试、四 Worker 构建和真实 HTTP 作为回归证据。

**Non-Goals:**
- 不改变业务路由路径、鉴权、支付规则、数据库模型或历史 SQL；允许按已确认方案扩展部署域名、图片前缀和队列名称解析。
- 不把部署模板、本地 Compose/PowerSync 运行资源或跨应用 agent/OpenSpec 配置强行搬进 `apps/api`。
- 不保留根级 `gen:api`、`lint:api`、`test:api` 等具体 API 命令作为第二套长期入口。
- 不通过修改支付集成测试来掩盖当前已记录的 `auto_renew` 失败。

## Decisions

### 1. 根入口使用 workspace 抽象调度

根 manifest 只增加一个抽象入口：

```json
{"api": "node tooling/api.mjs"}
```

调用形式为：

```bash
pnpm api -- dev
pnpm api -- gen:all
pnpm api -- test
```

通用代理移除根调用分隔符后，以参数数组调用 `pnpm --filter slax-reader-backend run <command>`；不使用 shell 拼接。脚本名称必须来自 API manifest，剩余参数原样传递。相比为每个命令增加根 alias，这种方式不需要根 manifest 随 API 命令表增长，也不会让根承担 API-specific 相对路径。

备选方案是根脚本调用 `pnpm --dir apps/api`; 不采用它，因为它把目录路径和工作目录技巧暴露到根入口，且不利用 workspace 包身份。应用脚本内部允许使用 API cwd，因为那是应用自身的命令上下文。

### 2. API 脚本恢复为应用内具体命令

把当前根 manifest 中 API-specific scripts 迁回 `apps/api/package.json`，恢复应用内短命令名：`dev`、`build`、`gen:all`、`gen:model`、`gen:di`、`types`、`test`、`lint`、`migration:local`、`tail` 等。应用脚本的路径全部按 `apps/api` 作为基准修正：

- API-local Prisma configs 用 `prisma/*.config.ts`。
- API-local tsconfig/Vitest/ESLint/Prettier 配置用应用相对路径。
- 生成器、API 测试和应用维护脚本从 API manifest 调用时保留现有输出位置。
- API 部署、构建和资源脚本归 `apps/api/script/deploy/`；共享运行资源仍留在 `deploy/`。

根入口不添加一张镜像命令表。命令覆盖测试读取 `apps/api/package.json` 的 scripts 并验证根只存在抽象入口。

### 3. API-only 配置和迁移归位，根保留共享资产

归位到 `apps/api/` 的候选文件包括：

```text
apps/api/tsconfig.json
apps/api/vitest.config.ts
apps/api/eslint.config.mjs
apps/api/.prettierrc.mjs
apps/api/.editorconfig
apps/api/prisma/d1.config.ts
apps/api/prisma/pgsql.config.ts
apps/api/prisma/logs.config.ts
apps/api/prisma/diff.config.ts
apps/api/prisma/d1_migrations/
apps/api/prisma/pg_migrations/
apps/api/prisma/logs_migrations/
apps/api/worker-configuration.d.ts
```

如果某个根配置确实同时服务其他 workspace，保留它为共享配置并让 API 配置继承它；否则不留重复权威副本。`deploy/cloudflare/`、`deploy/local/`、根 OpenSpec/rulesync/CI 文件属于仓库级或部署级资产，不因命令归属变化而搬到 API。

迁移时必须以文件引用图为准，不机械移动：生成器、Wrangler、Prisma schema-relative output、CI 和测试都要更新到唯一权威路径。历史 SQL 内容不能改写。

### 4. 冲突解决采用语义合并后重新生成 lockfile

- `.rulesync/rules/overview.md` 合并为新的 app-owned scripts + root abstract entry 规则；通过 `rulesync generate` 重新生成 `AGENTS.md`/`CLAUDE.md`，不手改生成文件。
- `.gitignore` 同时保留 pnpm fallback store 和 API/Worker 临时产物忽略规则。
- 根 `package.json` 保留上游 agent/tooling 配置和当前 API 迁移所需工具依赖，但删除重复 JSON keys，最终只有一个 `scripts` 和一个 `devDependencies` 对象。
- `pnpm-lock.yaml` 不手工拼接冲突片段；先完成两个 manifest 的语义合并，再使用固定版本的 `pnpm install --lockfile-only` 重建并用 `pnpm install --frozen-lockfile` 验证。
- 如上游工具版本与迁移版本冲突，优先保留当前分支已声明的上游版本并通过真实安装重新解析；不得留下重复 importer 或失效 package snapshot。

### 5. 文档和 CI 只使用抽象入口

所有贡献文档和 CI 使用：

```bash
pnpm api -- <command> [args...]
```

例如：

```bash
pnpm api -- gen:all
pnpm api -- lint
pnpm api -- test
pnpm api -- migration:local
```

根级命令 `agent:*`、OpenSpec、rulesync 等继续直接执行，因为它们不是 API 应用脚本。CI 可在根执行 `pnpm api -- ...`；不设置 `working-directory: apps/api`，除非某个显式安全临时 workspace 是测试内部实现。

### 6. 回归验证按旧命令语义和新入口双重检查

先记录冲突解决后的 manifest/lockfile 是否可解析，再从根执行：

1. `pnpm install --frozen-lockfile`。
2. `pnpm api -- gen:all`、`pnpm api -- lint`、`pnpm api -- test` 以及 API 类型检查等具体应用命令。
3. 单份配置四 Worker 离线构建，通过应用命令或共享 build 入口执行，比较配置和 bundle 语义。
4. 根抽象入口的参数透传、未知命令失败和退出码测试。
5. 真实本地 HTTP 书签增删查和隔离 PostgreSQL/Redis 集成；支付 fixture 补全 provider 后保留原断言验证，不修改业务规则。

验收必须证明没有因为“搬回应用目录”而漏掉测试、生成器或部署安全校验。

## Risks / Trade-offs

- [根入口成为唯一抽象入口但用户习惯旧具体根命令] → 在文档和 CI 中统一新形式，并提供明确的命令映射表；不长期保留第二套具体 alias。
- [相对路径在 API cwd 和根 cwd 间切换产生错误] → 每个脚本显式引用唯一配置，先运行生成器/测试/构建并比较基线产物。
- [API-only 配置误搬导致其他脚本失效] → 先搜索所有引用，按引用图决定共享或归位，不删除 deploy/shared assets。
- [上游 pnpm lockfile/manifest 冲突] → 语义合并后只用 pnpm 重建 lockfile，冻结安装和 workspace importer 检查作为门槛。
- [规则生成文件继续带冲突标记] → 只编辑 `.rulesync` 源，运行 rulesync generate/check；将 `AGENTS.md`/`CLAUDE.md` 作为生成结果验证。
- [现有支付集成失败阻断“全部业务通过”] → 保留失败及证据路径，禁止用跳过、重写断言或业务改动掩盖。

## Migration Plan

1. 在独立 `chore/api-command-proxy` worktree 中清理冲突、重复 JSON keys 和 lockfile。
2. 建立新根抽象入口，将 API 具体 scripts 和 API-only 配置/迁移归位。
3. 更新生成器、部署脚本、CI、文档、规则源和命令契约测试。
4. 重新生成 agent 文件和 lockfile，执行冻结安装、生成、lint、类型检查、测试、构建和真实本地验收。
5. 不执行远程部署；如果需要回退，回退本变更新增的命令/配置归属，不回滚先前业务迁移。

## 已确认的单份配置与应用边界

- API-only 部署实现归入 `apps/api/script/deploy/`；根只保留通用入口，公开运行资源保留在 `deploy/`。所有 Prisma config 位于 `apps/api/prisma/`，路径相对该目录。
- 唯一模板为 `deploy/cloudflare/api.toml.example`，实际配置为同目录忽略的 `api.toml`。所有命令默认读取实际配置，缺失时明确报错；CI 显式复制公开模板，不能自动回退模板部署。
- 配置保留 Wrangler 共有字段，使用原生 name/services/[env.*]，从服务绑定和原后端名称约定解析目标身份。生成器剥离编排字段，推导内部 service、Durable Object 和 Workflow 的归属，不重写用户资源 ID、队列名、迁移标签或显式兼容设置。
- Edge owns queue/cron/workflows；Core owns业务 DO；Browser owns SlaxBrowser；AI 引用 Core 的 SlaxJieba。仅 Edge 为公开 HTTP 入口。BACKEND_API_PREFIX 仍是部署期要求的公开 origin（见 `apps/api/script/deploy/config.ts`）；Core 运行时的 Host 校验已由变更 `drop-core-host-allowlist` 移除，不再保留既有 Host 兼容。
- 队列通过逻辑 producer binding/dead_letter_queue 与物理 queue name 的显式映射调度；保留历史名称兼容，未知队列必须失败而不是静默确认。
- types 从 api.toml 提取兼容日期和 flags，隔离临时目录+空 env 生成 runtime；不加载本地秘密或生成字面量 Env。
- 远程部署先完成全部目标配置与前置校验。提供显式 bootstrap 模式，先部署不绑定内部 service/Workflow 的 Core，再部署 AI，先部署持有 Workflow 的 Edge，最终恢复 Core 完整绑定；常规更新不降级现有服务。现有部署须原样保留 DO migration history。
- 统一改完再进行一轮冻结安装、生成、lint、类型检查、完整 Vitest、四 Worker bundle、隔离 HTTP 与 PostgreSQL/Redis 回归；对失败先汇总原因，禁止逐个修改逐个测试。

- FRONT_END_URL 的精确 origin 同时扩展 events 凭据 CORS、图片 Referer 和分享快捷识别；IMAGE_PREFIX 用于截图链接，通知图标跟随前端 URL。不扩大到任意来源。远程部署要求 RUN_ENV=prod，避免暴露 development 端点及绕过生产校验；RUN_TYPE 按支付环境选择。

## 自动加载环境文件

Prisma 的四份 config 与 Wrangler（含 D1）、dev、真实 deploy、resources --apply 显式调用同一工具环境加载器。工具与 Worker 配置集中在 deploy/cloudflare/，工具默认文件固定为 deploy/local/.env，不跟随 cwd 或从祖先目录探测。已存在的进程变量优先，setup 固定的本地数据库连接不能被文件覆盖。SLAX_API_ENV_FILE 可指定仓库根相对或绝对文件；显式文件不存在/不可读应失败，默认文件不存在则兼容 CI/登录态。加载器不打印内容，dotenv 不执行 shell 表达式。

本地 Worker 运行变量仍通过 --env-file 加载 deploy/local/.dev.vars；工具凭据不作为 Worker bindings。D1 的资源身份仍来自 api.toml，.env 用于 Cloudflare 工具认证。build、types、deploy --dry-run 和 resources 计划不调用加载器。验证只使用自建临时文件，不读取用户真实环境文件。

## 一键开发与 CI 外部配置

setup:api 与 dev 分离，setup:backend 仅兼容初始化；--check 只读且不登录。预检要求 development/dev、本地 API origin、与 Compose 匹配的 Hyperdrive 数据库、Worker 必需密钥、PowerSync API 私钥可以完成 RS256 签名验签及 Docker 可用。所有预检发生在 setup 前。初次需要自行准备专用 Cloudflare 开发资源和外部服务凭据；Vectorize/AI 仍是远程依赖，不宣称离线全功能。

SLAX_API_CONFIG 的默认值为 deploy/local/api.toml，支持仓库根相对和绝对路径；build/deploy/types 的 --config 显式参数优先。D1 包装器、resources 和 setup 共享同一选择。config:init 始终只创建默认本地文件，不向外部配置仓库写入。CI 提供 workflow_call/workflow_dispatch，分别检出源码与配置仓库，使用只读配置仓库 token，校验配置文件位于该 checkout，生成/检查/打包后显式部署，不自动迁移或新建云资源。生产 secret 保持 Worker secrets，配置仓库中不保存明文秘密。

## 统一完整后台启动

setup:api 为初始化入口，setup:backend 保留兼容转发，移除混合 dev:full。用户自行提供配置、环境文件与有效的 API PowerSync 签名私钥；预检只读，不补写、不转换、不备份、不自动生成密钥。预检通过后在 apps/api 中执行一次 pnpm exec wrangler login，继承终端以完成浏览器 OAuth 授权；成功后内部 Bash setup 负责基础设施/迁移/代码生成，PowerSync 健康后退出。Workers 使用 dev 独立启动。登录失败或信号中断时不进入后续阶段。

唯一 api.toml 使用原生 Wrangler name/services/env。setup/dev/local D1 在 env.dev 存在时选择它，否则读取顶层；--env/SLAX_API_ENV 显式选择环境，其余命令默认顶层。命名环境的 vars 和 bindings 不继承顶层，避免意外使用生产资源。Core 按原生 name 环境后缀规则命名；AI/Browser 使用原生服务绑定；Edge 可由 EDGE 服务指定，已有 reader-core 命名沿用旧部署身份，其他命名默认追加 -edge。生成入口配置保持资源 ID、历史迁移和源文件不变。旧 parser-dev 队列不自动删除、不编造处理器，实际未知消息保持原有失败行为。

实际 api.toml/.env/.dev.vars、运行状态与入口生成配置位于 deploy/local，公开模板保留在 deploy/cloudflare。测试临时目录结束时清理，不新增 worktree。PowerSync 健康检查和隔离数据库验收边界保持不变。


## PowerSync 单一密钥来源

用户实际运行遇到重复密钥文件不一致导致启动失败。以 Worker 实际使用的 deploy/local/.dev.vars 中 POWERSYNC_JWK_PRIVATE_KEY 为唯一来源：校验 JSON、RSA 私钥字段、签名用途和真实签名验签；推导公开的 n/e/kid，仅通过基础设施子进程的 PS_JWK_* 环境传给 Compose，不打印、不写入配置。Compose 使用空 env-file，忽略旧 compose.env 中的公钥，且启动前要求三个公开参数齐备。旧 dev-jwks-private/public 文件不再作为先决条件，保留原文件。签名私钥只在 API 的既有运行变量文件中维护，不重新生成或覆盖。
