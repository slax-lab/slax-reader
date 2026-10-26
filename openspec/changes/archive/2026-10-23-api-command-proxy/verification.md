# API 命令、配置归属与部署验收

2026-09-21，在 `chore/api-command-proxy` 工作树完成。初始变更基于已复制到该工作树的后端迁移。用户确认开始修改后实施，未执行远程资源创建、部署或迁移。

## 结论与实现

- 根 manifest 只保留通用 `api` 入口及仓库工具，具体 API 命令和工具依赖归 `apps/api/package.json`。`pnpm api -- <command> [args...]` 覆盖参数透传、退出码、SIGINT/SIGTERM 和未知命令检查。
- API-only 配置归 `apps/api/`，Prisma 的四份 config 归 `apps/api/prisma/`，不留根副本。Prisma 支持显式 `--config`，schema/migrations 路径相对配置文件，无需因为从仓库根调用而提升配置位置。[Prisma 配置参考](https://docs.prisma.io/docs/orm/reference/prisma-config-reference)
- 公开配置仅 `deploy/cloudflare/api.toml.example`；`config:init` 独占创建忽略的 `api.toml`，不覆盖已有文件。dev、build、deploy、资源工具、Wrangler 包装器与 types 使用该实际配置。types 保留隔离目录、空 env 和不生成秘密字面量的边界。
- Worker 名称与内部 service/DO/Workflow 绑定由单份配置推导。首次部署使用显式 bootstrap：Browser → Core 临时配置 → AI → Edge → Core 完整配置；跨脚本 Workflow 的 `script_name` 指向 Edge。[Cloudflare Workflow 绑定参考](https://developers.cloudflare.com/workflows/build/workers-api/)
- 仅 Edge 公开。远程部署拒绝占位资源、无效公开 origin，以及任何 Worker 的 development runtime。普通更新不走 bootstrap，不自动覆盖已有资源 ID、队列名或 DO migration history。
- 配置驱动 API Host、前端 CORS/Referer、分享快捷识别、截图和通知图标地址；自定义物理队列名映射到原业务 handler，未知队列失败。匹配使用精确 origin，保留原部署兼容。
- 本地 PowerSync 端口限定 loopback；PostgreSQL readiness 改为等待最终 TCP 服务，避免误认 Docker 初始化临时服务器。支付测试补全四处 provider fixture，保留原断言和生产支付规则。
- 中英日开发/部署文档、CI、CODEOWNERS、规则源及生成规则文件同步。旧 `root-backend-tooling` 草案注明由本变更替代，没有伪装成已合并归档。

## 最终验证

| 检查 | 结果 | 本地证据 |
| --- | --- | --- |
| 冻结安装 | 通过 | `.local/regression/install.log` |
| Prisma / types / DI / router / cron / consumer 生成 | 通过 | `.local/acceptance/generate.log` |
| lint | 0 errors，337 warnings；未扩散修改已有 warning | `.local/verified/lint.log` |
| API TypeScript | 通过 | `.local/verified/typecheck.log` |
| 完整 Vitest | 1,456 passed，48 skipped，0 failed | `.local/verified/unit.json` |
| 可选 PostgreSQL/Redis 集成 | 47 项全部通过，含支付 19 项、账号撤销 12 项；历史 PG/logs migrations 全部成功 | `.local/readiness-acceptance/integration.log` |
| 四 Worker 真实离线 bundle | 全部通过 | `.local/acceptance/build.log` |
| 隔离真实 HTTP | 通过 | `.local/verified/http.log`、`.tmp-root-tooling-http-jc1Zr2/` |
| 本地 setup 命令契约 | 通过 | 完整 Vitest 中的 `setupBackend.test.ts` |
| OpenSpec strict / rulesync drift | 通过；最终任务状态更新后再次校验 | `.local/final-repo-checks.log` |

默认套件的 48 个 skipped 包含需要显式启用的数据库/Redis 测试及一项未配置的导入样本测试；其中 47 项已在隔离集成入口单独运行并通过，没有通过放宽断言或删除测试消除失败。

HTTP 实测覆盖未登录、无效 token、伪造 Edge 身份的 401，自定义前端 events CORS 与恶意域名后缀拒绝，以及自定义前端分享书签增删查。结果核对 PostgreSQL、D1/fulltext 和 logs 的真实持久化。测试容器与 Worker 进程已经清理。

124 份 Prisma schema 和历史迁移文件与开始修改时的 SHA-256 基线完全一致。原 route、DI 和 cron 生成内容未改变；consumer 仅增加配置映射与未知队列失败行为。鉴权、支付实现及数据库业务模型未修改。

## 发现过的问题与修复记录

先集中完成修改再运行整套回归；回归中发现问题后批量修复，并补跑受影响检查，没有在每个小改动后触发回归。保留早期失败日志：

- 初轮 TypeScript：ES2021 类型库不包含 Object.hasOwn；改用 hasOwnProperty.call，保留编译目标。
- 自定义域名验收补全了 CORS/Referer、分享和资源 URL 的配置接入。
- 新建 PostgreSQL 容器偶发在临时 init 服务关闭时收到 SQL：等待 TCP readiness 修复，不重试或忽略失败 SQL。
- 扩展 OPTIONS 验收时，HTTP 测试包装器错误地为 204 构造 body，且未复制响应 headers；已修正并将回调错误交给 Promise reject，确保 finally 清理。该次异常遗留的自有进程和容器已单独清理。

## 验证边界

没有真实账号部署验收。离线 bundle、配置测试和本地功能通过，不代表 Cloudflare 账号权限、配额、服务绑定、secrets 或第三方 OAuth/支付回调已配置正确。部署前仍需提供自有资源、外部 fxembed 服务、PostgreSQL/Hyperdrive/PowerSync，以及所启用功能的凭据。该应用仍运行在 Cloudflare Workers，Compose 只提供本地依赖，不是通用 Node/Docker API runtime。

旧部署升级必须保留自身 Worker 身份、资源 ID 和 DO migration history，不能拿新安装模板覆盖生产配置。页面中的部分品牌展示素材仍沿用原产品内容，未把此次配置重构扩展成品牌改造。

Wrangler 在嵌套工作树构建时报告的 duplicate package keys 指向工作树外的主 checkout `../../../../package.json`；本工作树 manifest 已消除重复 keys。未修改主 checkout 来消除这项外部警告。

## 同步至当前主目录

用户随后明确要求忽略工作树限制、以当前打开的目录为准，授权直接同步到 `/Users/daguang/project/slax-reader`。同步前核对业务源码/schema 与原基线一致；仅同步本任务公开源码，保留既有密钥、环境文件和运行状态，不读取或复制其内容。根目录旧的四份 Prisma config、API 专属工具配置与旧部署脚本已移除；规则从 .rulesync 重新生成。现行代码以主目录为准，旧工作树只是此前验证记录。

主目录转移记录与非秘密文件备份保存在 `.local/api-layout-transfer/`。转移后的统一回归记录保存在 `.local/api-layout-transfer/validation/`。环境文件实际加载规则已补入三语开发文档：本地 Worker 使用 deploy/cloudflare/.dev.vars，Prisma 继续使用导出的进程环境，Compose 配置留在 deploy/local。

主目录最终验收全部通过：冻结安装、生成、类型检查、1,456 项默认测试、47 项隔离数据库/Redis 集成、四 Worker 离线构建、真实 HTTP、OpenSpec strict、规则同步与 diff 检查。默认套件仍有 48 项按条件跳过，lint 为 0 errors / 337 warnings；124 份 schema/历史迁移哈希未变。

转移后首次回归发现旧 node_modules 缺少 API 包的 tsx 链接，造成 7 项部署脚本测试无法启动。pnpm 的 optimisticRepeatInstall 提前判定安装无需更新；禁用该检查后冻结安装正确重建包链接，并在 workspace 配置中保留禁用项。随后完整回归通过，没有修改或跳过失败测试来掩盖安装问题。安装记录见 `.local/api-layout-transfer/install-final.log`。

## 自动环境文件加载补验

用户进一步明确需要从文件自动加载，此前仅验证 export/进程环境的结论不能证明文件可用。工具环境加载器已接入全部 Prisma config、D1/Wrangler、dev、真实 deploy、resources --apply。当前文件固定为 deploy/local/.env，Worker runtime 显式使用 deploy/local/.dev.vars；文档中此前“Prisma 不自动加载”的说明由本节与现行开发文档替代。进程变量优先，文件缺失兼容 CI，不可读失败且不打印内容。

集中修改后统一回归全部通过，日志在 .local/api-env-regression/validation/：

- 新增 13 项文件加载验证，含实际 Prisma CLI validate、D1 子进程的合成凭据、不同 cwd、setup/CI 优先级、显式文件及失败边界、Worker .dev.vars、离线入口隔离。
- 生成命令的数据库 URL 仅来自自建临时文件；未注入对应进程变量。
- HTTP 与 47 项 PostgreSQL/Redis 集成通过；隔离环境中的 PostgreSQL/logs 历史迁移实际从临时文件加载连接串，D1 历史迁移和持久化亦通过。
- 完整套件 1,469 passed / 48 skipped / 0 failed；四 Worker bundle、typecheck、lint（0 errors / 337 warnings）、OpenSpec strict、rulesync drift、diff 检查均通过。124 份 schema/历史 SQL 哈希不变。

只检查实际环境文件是否存在，没有读取其内容：主目录当时没有 apps/api/.env 或 deploy/cloudflare/.dev.vars。验证使用合成文件与本次创建的隔离数据库，没有验证真实凭据或执行远程操作。

## 一键开发、独立配置仓库与 Docker 调研

按后续用户要求实现 dev:full 与 SLAX_API_CONFIG，并提供手动/可复用 API deploy workflow。用户已明确 Docker 本轮仅调研，结果见 docs/api/DOCKER-ADAPTER-RESEARCH-CN.md；HTTP 类型仅评估共享合约边界，未迁出也未增加 Docker runtime。

dev:full 的前置检查覆盖 development/dev、本地 API 与数据库目标、Worker 必需变量、PowerSync JWK/Compose 一致性及 Docker 可用性；随后顺序执行 setup 和 dev，阶段失败停止，SIGINT/SIGTERM 正确透传并保留 130/143 退出码。不自动创建云资源、执行远程迁移或覆盖本地配置/密钥。

SLAX_API_CONFIG 贯通 dev/setup、build/deploy、types、D1/Wrangler 与 resources，支持根相对和绝对路径；显式 --config 优先。config:init 不向外部仓库写入。实际生成和四 Worker 构建使用 .local/api-dev-ci/operator configuration/api.toml，名称修改为 ci-reader-*，证明外部路径和空格可用。配置入口测试同时验证默认 api.toml 不存在时各工具仍正确读取外部文件、types 保持空 env 隔离且配置不改写。

统一验证记录：.local/api-dev-ci/validation/。首次完整批次的原始日志保存在 first-validation/；发现的问题一起修复后补跑完整默认套件、lint/typecheck/workflow/spec/rules 检查。

- 冻结安装、外部配置 gen:all、四 Worker 离线构建：通过。
- 完整 Vitest：1,483 passed / 48 skipped / 0 failed。
- HTTP 与 47 项隔离数据库/Redis 集成：通过；历史迁移与持久化覆盖保留。
- lint：0 errors / 337 warnings；typecheck、actionlint、OpenSpec strict、rulesync drift、diff 检查通过。124 份 schema/历史 SQL 哈希不变。
- 首次发现 SIGTERM 退出码与 130 约定不一致，统一修为 SIGINT=130 / SIGTERM=143 并分别测试；另发现 Prisma checkpoint 后台写入临时 HOME 的缓存导致 ENOTEMPTY，测试关闭 checkpoint 并对目录删除作有界重试，未放宽功能断言。

真实 GitHub 私有配置仓库权限、Environment 保护规则、Cloudflare 部署和完整云端依赖没有执行验收。dev:full 的编排、失败和信号通过隔离子进程测试；真实 HTTP/数据库验收覆盖本地 Edge/Core 与持久化，不等于四 Worker 加全部第三方功能已在本机用真实凭据启动。首次准备清单与这些边界已写入 docs/api/DEV-AND-CI-CN.md。

## 环境文件集中存放（后续用户确认）

本节替代上文历史验证中的默认 apps/api/.env 路径。当前工具文件固定为 deploy/local/.env，与 .dev.vars 和 api.toml 同目录；Prisma 配置仍位于 apps/api/prisma。进程变量优先、本地 setup 固定 URL 和离线命令隔离保持不变。

统一回归：13 项文件读取测试（真实 Prisma CLI、D1 包装器、cwd 独立、显式覆盖、旧路径不隐式加载、Worker 文件传递及离线隔离）；全量 1495 passed、48 skipped、0 failed；API/共享合约类型检查、lint（0 errors，337 个原有 warnings）、四 Worker 离线构建、OpenSpec strict、生成规则检查通过。记录位于 .local/api-env-colocated/validation。124 个 schema/历史迁移内容不变。

只检查实际文件的存在性：apps/api/.env、deploy/cloudflare/.env、deploy/cloudflare/.dev.vars 均不存在，没有读取或搬运用户凭据，也没有生成假密钥。测试只使用合成文件；未执行远程部署或资源操作。

## 完整 setup 与本地目录（后续用户确认）

本节替代前述环境路径结论：实际 api.toml、.env、.dev.vars 和生成配置默认统一 deploy/local，唯一公开模板保留 deploy/cloudflare/api.toml.example。已存在的三个本地文件仅按文件名移动，没有读取内容或覆盖目标。

setup 自动创建缺失的本地配置和安全随机开发密钥，将 PowerSync 私钥自动接入 Worker；已有值不覆盖，不完整或不匹配密钥明确报错。--check 只读且列出缺失路径。内部 setup 复用预检，依次初始化数据库、迁移、生成、等待 PowerSync 健康后启动四个 Workers。兼容旧入口，移除独立 init:pgsql 公开命令。

集中回归：1501 passed、48 skipped、0 failed；13 项环境文件测试、完整 setup 首次创建/重复运行/缺失/信号/失败传播测试通过。四 Worker 离线构建、类型检查、生成、47 项数据库集成及真实 HTTP 回归通过。额外用独立 Compose 项目、新端口和新卷执行主库/logs 历史迁移，真实启动 PowerSync unified 与 API 两个服务，Compose 健康检查和各自 HTTP liveness 均通过，验证后清理测试容器/卷。没有对用户现有 dev-postgres 执行迁移或停止其 Worker。

首轮发现旧模板测试路径、隔离 HOME 下 Compose 插件发现、HTTP 测试固定端口冲突；集中修正后重跑相关检查。HTTP harness 现使用独立端口；PowerSync harness 只链接发现的 Compose 可执行文件，不读取或复制 Docker 凭据文件。另修复一处格式检查。记录在 .local/api-setup-complete/validation；124 个 schema/历史迁移内容未改。未执行远程部署或创建云资源；Cloudflare/第三方凭据仍需操作者提供。


## 原生 Wrangler 配置与只读准备检查（用户最终确认）

- 撤回自定义 workers 表要求和自动配置/密钥准备，删除自动转换模块。setup/dev/local D1 选择原生 env.dev；build/types/resources/deploy 支持 --env 或 SLAX_API_ENV，CI 提供独立 wrangler-environment 输入。原配置、服务名称、迁移历史和开发域名保留。
- 用户当前 api.toml 只做无秘密文件访问的结构校验：通过；解析身份为 reader-core-dev、reader-backend-dev、reader-ai、browser-backend。配置文件未改写，没有 .legacy 备份；没有新建 worktree。未读取用户 .env/.dev.vars 或执行其真实数据库迁移/云部署。
- 集中生成、lint、API/contracts typecheck、四 Worker 离线构建、真实隔离 HTTP/数据库 smoke、OpenSpec strict、规则生成漂移和 diff 检查通过。
- 初轮单测暴露一个参数化测试传参错误及两个并发子进程超时，集中修正参数和既有开发域名兼容限制后，以 --maxWorkers=4 复验：139 个文件通过，1506 个测试通过，48 跳过，无失败；lint/typecheck/OpenSpec/rules/diff 再验通过。数据库 schema/历史迁移 124 个文件哈希保持不变。
- 临时配置与数据库测试使用隔离合成数据，退出后清理；此验收不代表已用用户真实云凭据启动整套服务。


## PowerSync 单一签名密钥来源修复

- 本地 setup 从 .dev.vars 的 API 签名私钥推导 PowerSync 公开验证参数，经子进程环境传给 Compose。旧公私钥副本/compose.env 不再是先决条件，也不改写或生成这些文件。JSON、字段、用途和 RSA 签名验签错误分别报告。
- 集中回归全部通过：1512 项单测通过、48 跳过；lint 无错误、API/contracts 类型检查通过；Shell 语法、OpenSpec strict、规则漂移和 diff 检查通过。124 个 schema/历史迁移哈希不变。
- 隔离真实 PostgreSQL/PowerSync 验收通过：API 私钥与旧生成文件刻意不一致，两个 PowerSync 服务健康；Compose 中的公钥参数与 API 私钥相符，JWT 签名验签测试通过。测试容器和本轮临时目录清理。
- 用户授权修复后，以其真实 deploy/local/api.toml 与 .dev.vars 执行 setup --check，通过（退出码 0）。诊断只在本机内部使用私钥，不显示或改写密钥；没有对用户数据库执行迁移或进行云部署。


## 初始化与项目启动分离（用户最新要求）

- setup 校验配置后，在 apps/api 执行一次 pnpm exec wrangler login；成功后初始化 PostgreSQL、迁移、代码生成和 PowerSync，健康检查通过后退出。dev 独立启动 Workers，setup 作为唯一初始化命令，删除混合入口 dev:full。--check 保持只读且不登录。
- 完成修改后统一回归：1514 项测试通过、48 跳过、0 失败；lint、API/contracts 类型检查、Shell 语法、OpenSpec strict、规则漂移与 diff 检查通过；124 个 schema/历史迁移哈希不变。
- 登录参数/cwd/顺序与每次一次、登录失败停止、基础设施失败传播、两个阶段的 SIGINT/SIGTERM、初始化不启动 Workers 均通过模拟子进程验证；没有实际触发浏览器 OAuth。用户现有配置的 setup --check 再次通过，未改写配置、执行用户数据库迁移或启动其项目。
- 测试临时目录已清理，仓库根目录没有 .tmp 目录；没有新建或修改已有 worktree。记录位于 .local/api-legacy-config/validation。
