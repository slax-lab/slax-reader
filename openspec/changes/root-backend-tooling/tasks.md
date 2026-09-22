## 1. 建立当前迁入工作区基线

- [x] 1.1 对当前根/API manifests 逐项记录命令映射及普通 CLI cwd，记录业务源码、Prisma schema/历史 SQL和生成路由/DI摘要；验证基线包含未跟踪迁入文件且不包含秘密、node_modules或用户运行状态。
- [x] 1.2 用隔离占位数据库 URL 执行现有根 `pnpm gen:api`、`pnpm lint:api`、`pnpm test:api`，记录测试发现清单、数量、失败与跳过原因；验证没有启用任何会访问真实数据库的 opt-in 套件。
- [x] 1.3 记录公共模板下 dev/beta/prod 四 Worker 配置和现有离线 bundle 基线，验证不读取本地秘密/override、不触发部署或资源创建，记录既有失败而非忽略。

## 2. 上移配置和工具依赖

- [x] 2.1 将开发 CLI、配置插件和纯生成器依赖归到根 `package.json`，保留 API 运行时依赖及应用身份，同步 lockfile；验证依赖解析版本没有附带升级且根 `pnpm install --frozen-lockfile` 成功。
- [x] 2.2 将 ESLint、Prettier、EditorConfig 权威配置迁到根并移除反向导入和旧配置，限定作用范围；用根 lint 和生成文件格式检查验证不扩大到其他应用、不改变原有格式规则。
- [x] 2.3 创建根 `tsconfig.json`、`tsconfig.api.json`、`tsconfig.api.test.json` 并迁移 include/alias/Env路径；验证根类型检查使用预期文件集，记录任何迁移前已存在的类型错误，不削弱 strict 规则。
- [x] 2.4 迁移 Vitest 配置到根，显式定义 `apps/api/test/**/*.test.ts` 与两个 alias；比较基线用例发现列表，确认没有少测且测试进程不需要 API cwd。
- [x] 2.5 迁移四份 Prisma 配置到根并重算 schema/migrations 路径，移除不存在 seed 的失效声明和隐式 API-local dotenv 发现；用占位 URL 从根生成三种客户端，验证业务原有 import/output 契约和历史 schema/SQL内容不变。

## 3. 完整根命令与路径改造

- [x] 3.1 按 design.md 的映射在根建立全部受支持命令、watch/run区别及维护入口，移除原子包独立任务声明；通过 manifest/命令测试验证旧操作均有对应入口、现有根命令和参数保持兼容，不调用 `pnpm --dir apps/api` 或子包 CLI路径。
- [x] 3.2 将 `apps/api/script/root.ts` 改为无副作用路径定义，更新 DI、cron、consumer、router 生成器的扫描/输出/import基准；从根连续运行两次生成，比较注册/路由语义与基线并验证幂等、不产生根 src 或空注册表。
- [x] 3.3 更新 gen-dao、证书和回填等维护脚本的显式路径及根相对参数契约；用隔离 fixture/参数测试验证输出位置、防覆盖和只读边界，不实际下载证书、访问业务库或输出私钥。
- [x] 3.4 为原无明确配置的 schema pull 提供显式目标选择与缺省报错；测试参数和配置映射，不执行真实 introspection；文档准确标明不存在 seed 与未配置密钥片段不属于可用操作。
- [x] 3.5 更新 `scripts/deploy/deploy.ts`、`wrangler.ts`、setup 和相关初始化调用为根普通 cwd，调整根 tsconfig引用但保留 TOML-relative路径；运行路径/setup回归验证本地数据库固定、持久化目录、顺序、退出状态和不自动启动 Worker不变。
- [x] 3.6 添加根 `build:api` 以实际离线打包四 Worker，保留 `deploy:api --dry-run` 仅生成配置的语义；验证 build 的环境/目标参数、输出目录、无秘密配置加载及没有任何部署调用。
- [x] 3.7 更新安全 runtime 类型生成器的根 CLI可见性及调用参数，保留隔离临时目录例外；运行 `workerTypesSecurity` 验证空 env/最小runtime配置、Env保留及无秘密字面量行为。

## 4. 回归测试、文档和自动化

- [x] 4.1 更新 `apps/api/test/script/{deployPaths,setupBackend,workerTypesSecurity}.test.ts`、`test/sanity.test.ts`、HTTP security边界等 cwd相关读文件和旧断言；验证修复针对路径且原有业务断言没有被删除/弱化。
- [x] 4.2 在现有测试目录增加完整根命令/配置归属、子进程cwd、参数透传和失败退出回归；验证覆盖不止根 alias字符串，实际安全命令可从根调用且不依赖全局 CLI。
- [x] 4.3 更新 `.github/workflows/api-ci.yml`，用根命令执行生成、检查、测试和打包，补齐根配置 path filters；验证不存在 `working-directory: apps/api`，本地可复现 CI标准命令。
- [x] 4.4 更新 README 和 `docs/api` 中英日开发/部署文档，给出完整命令映射、根配置位置、环境变量来源、危险命令和外部CLI前提；搜索确认不再要求 cd/--dir API，也不把新 build 与配置 dry-run混淆。
- [x] 4.5 更新 `.rulesync` 规则源并运行 `pnpm agent:sync`；通过 `pnpm agent:check` 和 `pnpm exec openspec validate --all --strict` 验证生成文件一致且没有手工修改规则产物。

## 5. 交付验收：工具链与业务均需有证据

- [x] 5.1 从根执行最终冻结安装、`pnpm gen:api`、`pnpm lint:api`、`pnpm typecheck:api`、`pnpm test:api`；对比基线文件/测试数量与业务断言，验证无新增失败、无漏测、业务源码/schema/SQL无非预期漂移，已有失败不得隐藏。
- [x] 5.2 对 dev/beta/prod 全部四 Worker生成配置并执行 `pnpm build:api` 对应环境打包；验证 Worker/绑定/队列/cron/Workflow资源语义、迁移路径、向量和持久化设置与基线一致，仅配置文件位置发生预期改变。
- [ ] 5.3 检查并准备隔离可丢弃的本地 PostgreSQL/Redis测试资源，运行书签/集合/撤权/订阅支付等适用 opt-in集成套件；验证所有连接目标已确认，不触碰现有开发或生产数据，失败/跳过原因逐项记录。
- [x] 5.4 通过根启动入口和显式本地测试配置运行真实 Worker，发送网关/鉴权拒绝及测试用户书签写入、读取、删除HTTP请求并核对持久化结果；验证不借默认远程Vectorize、不修改业务代码以绕过依赖，不用 mock/import/编译结果替代端到端证据。
- [ ] 5.5 汇总根命令覆盖、配置迁移、基线对比、全部检查/真实HTTP结果和未验证外部集成；只有必须的业务验收已完成且检查通过才标记实现完成，否则保持相关任务未完成并清楚报告阻塞，不自动部署或归档。

## 验收记录

- 最终 standard 证据：`.tmp-root-tooling-validation/final-validation-summary.json`。10 条根命令全部 exit 0（`pnpm install --frozen-lockfile`、`gen:api` ×2、`lint:api`、`typecheck:api`、`test:api`、`vitest list`、`build:api dev|beta|prod`）。
- `pnpm gen:api` 连续两次幂等：第二次 drift = 0；6 个生成产物 sha256 与迁移前基线全部相同（apple-certs / consumer / cronjob / dependency / readerRouter / worker-configuration.d.ts）。业务源码/schema/SQL：323 个文件（201 src/*.ts + 119 prisma/*.sql + 3 prisma/*.prisma）与基线逐字节相同，仅删除了 4 个预期移除的旧 Prisma 配置。
- `pnpm lint:api` 0 errors / 336 warnings；`pnpm typecheck:api` 0 diagnostics；`pnpm test:api` 1442 passed / 48 skipped / 0 failed（134 文件通过，10 文件为可选数据库/外部样本套件跳过，跳过集合与基线一致，无业务用例遗漏）。
- `pnpm build:api dev|beta|prod`：12 个 bundle 全部 exit 0，四 Worker bundle 归一化后与基线逐字节相同（原始字节差仅为 esbuild 模块路径前缀），build 活动期间 TOML 配置前后不变，无部署调用、无 `.local.toml`/秘密读取，临时目录残留 0。
- 真实 HTTP 端到端：`.tmp-root-tooling-http-Eiu7dv/http-results.json`，passed——网关鉴权拒绝（unauthorized / invalid-token / spoofed-edge-identity 均 401）、测试用户书签写入/读取/删除并核对 PostgreSQL、D1 fulltext、变更日志和日志库持久化。
- 本地集成：`.tmp-root-tooling-validation/final-integration-command.log` 根命令 46 passed / 1 failed。失败为 `apps/api/test/infra/paymentPostgres.test.ts:238` 的支付 `auto_renew` 断言（`expected false to be true`），在全新隔离库重复复现。相关业务和测试文件与迁移前基线逐字节相同；迁移前该可选集成套件未启用，因此不能把源码一致性等同于迁移前实际运行证据。
- 已运行规则生成及检查，并在新建隔离库应用完整历史迁移；未执行远程部署或远程迁移。所有本次自建容器和 Worker 进程均已清理。任务 5.3、5.5 保持未完成。
- 需要另行确认处理：支付 `auto_renew` 失败对应的业务规则/断言，需人工确认后再决定是否修改。
