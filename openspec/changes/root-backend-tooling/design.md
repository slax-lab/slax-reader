## Context

动机见 proposal.md。当前根 `package.json` 只包装部分 API 命令，工具依赖主要声明在 `apps/api/package.json`。根 ESLint 和部署 Prettier 反向导入 API 配置。`apps/api/script/root.ts` 导入即切换 cwd；部署脚本子进程和 setup 也切入 API。现有测试包含按 API cwd 读取源码和断言旧 cwd 的用例，直接换 Vitest 入口会漏测或误失败。

部署配置位于根 `deploy/`，业务源码、Prisma schema/迁移和测试已合理位于 `apps/api`。当前工作区还包含未提交的迁入内容，不能以 HEAD 作为完整后端基线。现有正式 spec 只有 `agentic-pr-review`，没有后端开发契约。

本设计跨 manifest、生成器、数据库配置和 CI，并影响配置发现及数据安全，因此需要设计文档。

## Goals / Non-Goals

**Goals:**
- 根目录直接执行，根拥有配置权威；不仅是给 `pnpm --dir` 起别名。
- CLI 依赖由根声明，操作参数和错误码一致，路径不依赖偶然的 cwd。
- 用当前迁入工作区建立基线，比较迁移前后测试发现、生成产物和部署资源语义，完成真实运行验收。

**Non-Goals:**
- 不重拆四个 Worker，不重构 domain/infra，不抽取 contracts，不迁移其他 app。
- 不改变业务路由、请求/响应、数据库字段、历史 SQL、队列/cron/Workflow 所属资源。
- 不把源码/schema/测试平铺到根，不升级工具版本，不引入新的任务编排框架。
- 不远程部署、开通资源、升级 Wrangler、下载证书或运行涉及真实业务数据的维护任务来完成验证。

## Decisions

### 1. 配置上移，应用资产不动

目标布局：

```text
package.json
pnpm-workspace.yaml
pnpm-lock.yaml
eslint.config.mjs
.prettierrc.mjs
.editorconfig
tsconfig.json
tsconfig.api.json
tsconfig.api.test.json
vitest.config.ts
prisma.d1.config.ts
prisma.pgsql.config.ts
prisma.logs.config.ts
prisma.diff.config.ts
scripts/deploy/
deploy/cloudflare/
deploy/local/
apps/api/package.json
apps/api/src/
apps/api/script/
apps/api/prisma/
apps/api/test/
apps/api/worker-configuration.d.ts
```

- 根 `tsconfig.json` 保存共同编译选项，API 目标配置显式声明 API 源码、脚本和 Env；测试配置覆盖对应 alias/include。根 CLI、生成器和 Wrangler 显式选择 API 配置，不把未来 web/extension 误纳入 API 编译范围。
- 根 ESLint 独立定义现有规则并限定 API/部署脚本范围；根 Prettier 保留现有格式，不顺带格式化整个仓库；EditorConfig 上移后限定 API 相关设置，不把原来的 tab 设置扩散到其它应用。
- 根 Vitest 保留默认仓库 cwd，include 改为 `apps/api/test/**/*.test.ts`，alias 明确指向 API 的源码和测试。测试中读取文件使用固定仓库/API 路径，不借 `root: apps/api` 隐藏 cwd 依赖。
- 四份 Prisma 配置上移后，schema/migrations 路径按新配置位置重算。schema 文件不搬；PG/logs 的 schema-relative client 输出继续落在 `apps/api/node_modules/@prisma/*-client`，D1 的默认客户端生成与业务导入契约必须实际验证。
- 根级 `deploy` 继续保留，不另造一套 config 目录。移除被取代的 API 工具配置，避免两个权威来源。

放弃仅增加根包装命令的方案：无法满足配置归属与实际根 cwd 要求。放弃把整个 API 扁平化：会破坏已合理建立的 app 边界。

### 2. 根命令完整覆盖，API manifest 留运行时身份

将现有工具 CLI、其配置插件和生成器专用依赖移到根 devDependencies，沿用 lockfile 当前解析版本。API manifest 保留应用名称和运行时依赖；若某依赖也用于运行时代码，不因其被工具使用而从 API 删掉。根命令直接调用已安装的 CLI 和脚本，不引用 `apps/api/node_modules/*` 可执行路径。同步根/API manifest 和 lockfile，避免为了移动依赖造成隐式升级。

实施验证发现 Prisma 7 的 `prisma-client-js` 按 schema 位置检查 `prisma` 与 `@prisma/client` 是否可从同层解析。为保持原客户端及输出契约，API 保留同版本 `prisma` 的生成解析依赖，根同时声明 `prisma` 和 `@prisma/client`；这不增加 API 命令或配置入口，实际 CLI 和 cwd 仍在根。

命名以 `动作:api[:子任务]` 为主；现有根 `keys:powersync`、`deploy:api` 等保持兼容。以下映射均为拟新增或调整后的根入口：

| 现有 API 操作 | 根入口 |
| --- | --- |
| dev / preview / setup | dev:api / preview:api / setup |
| test / lint / lint:fix / lint:fix:gen | test:api（一次运行）/ test:api:watch / lint:api / lint:api:fix / lint:api:fix:gen |
| types / gen:all / gen:model | types:api / gen:api / gen:api:model |
| gen:di / gen:cron / gen:consumer / gen:router | gen:api:di / gen:api:cron / gen:api:consumer / gen:api:router |
| gen:diff / gen:diff:d1 / gen:diff:pgsql / gen:diff:logs | gen:api:diff 及对应 :d1 / :pgsql / :logs |
| gen:pull | gen:api:pull，必须显式指定受支持的数据库配置 |
| migration:local 及 d1/fulltext/pgsql/logs 子项 | migrate:api:local 及同名子项 |
| migration:preview / migration:remote | migrate:api:beta / migrate:api:prod（仍为原 D1 远程操作） |
| tail:dev / tail:preview / tail:prod | tail:api:dev / tail:api:beta / tail:api:prod |
| insights:d1:max:sum/time/write | insights:api:d1:max:sum/time/write |
| stripe:webhook / mcp:tool / init:pgsql / update:cli | stripe:api:webhook / mcp:api / init:api:pgsql / update:api:cli |
| 原有根 deploy/resources/keys | 保持原名称和语义 |
| CI 四 Worker 打包循环 | build:api（离线生成配置并实际打包，可指定环境/目标） |
| 类型检查 | typecheck:api，显式使用根 API TypeScript 配置 |

维护脚本 `gen-apple-certs.ts`、`backfill-user-device-alias.ts`、hash 诊断脚本提供明确命名的根入口或在根命令索引中明确调用方式；保留只读/输出文件/网络操作边界，不纳入默认 gen/check 链。`snippets-image.js` 是 Worker 模块，`root.ts` 是辅助模块，不应伪装成 CLI。`gen-keys.js` 输入目前为空占位且输出含私钥，不把它作为可用密钥生成命令或自动验证项；文档明确它是未配置的开发片段。

原聚合 local migration 不包含 logs；维持此语义并单列 logs。Stripe 使用外部 CLI，缺失时清楚报错，不默默增加 npm 依赖。Wrangler 升级命令显式作用于根 devDependency，本次迁移不得执行升级。

### 3. 显式路径替代 cwd 补丁

`apps/api/script/root.ts` 改为无副作用的仓库/API/源码/生成目录路径定义。逐个改生成器的输入、输出、扫描过滤、tsconfig 和 import 相对基准：

- gen-di：扫描范围仍是 API src，避免根路径迁移后生成空注册表。
- gen-cron/gen-consumer/gen-routers：保留控制器显式清单、输出和相对 import 语义，不能只修改输出目录。
- gen-dao：SQLite 输入参数按仓库根解析，schema、diff config 和迁移输出显式定位；保留 SQL 过滤、编号和防覆盖写入。
- gen-apple-certs：输出仍为 API 的 generated 文件，不能因 cwd 改动写到根 src。
- 数据回填：用户相对输出路径按根解释，保留只读事务、默认计数及 SQL 不自动应用的行为。

`scripts/deploy/{deploy,wrangler}.ts` 普通子进程 cwd 统一 ROOT，CLI 来自根工具链。生成 TOML 的 `main/tsconfig/migrations_dir` 仍以生成 TOML 所在目录为相对基准，这与命令 cwd 是两个概念，不能机械改为根相对。setup 留在根并调用根入口，保持本地 URL 固定、执行顺序和不自动启动 Worker 的行为。

`deploy:api --dry-run` 保持只生成配置；新 `build:api` 承担 Wrangler 的真实离线打包，避免旧 dry-run 意义突变。CI 不再有 `working-directory: apps/api` 或手写子包命令。

### 4. 配置发现与安全边界显式化

普通数据库工具使用显式导出的环境变量；迁出的 Prisma 配置和回填命令不再通过 API cwd 隐式发现 `.env`。Worker 本地秘密继续由既有 `deploy/cloudflare/.dev.vars` 显式加载；本次不读取、复制、移动或生成用户秘密。文档说明以前依赖 API-local dotenv 的使用者必须自行配置环境变量，不静默切换来源。

安全的 Worker runtime 类型生成继续使用最小 public runtime config、空 env 文件、关闭自动 dotenv 和 metrics，保留隔离临时 cwd 例外，输出仍是 API `worker-configuration.d.ts`。不能为了所有 cwd 字面一致而削弱隔离机制。

已发现的既有问题按以下方式处理，不臆造业务行为：
- `d1.config.ts` 引用不存在的 `prisma/seed.ts`：移除失效 seed 声明并说明当前没有 seed 操作，不创建业务 seed。
- `gen:pull` 未指定配置，不能保证原先可用：根入口要求显式数据库配置；缺省时报错并给出用法，不猜测 PostgreSQL 或 D1。不在迁移验证中执行会改写真实 schema 的 introspection。
- 不将空输入密钥转换脚本自动纳入命令验收。

### 5. 验收必须区分工具链正确与业务正确

先以当前工作区（包含未跟踪迁入文件）记录测试发现清单、已跳过套件、业务源码/SQL摘要、生成路由/DI和四 Worker 的公共配置语义。不能用只含旧占位目录的 HEAD 代替迁移前基线，也不能备份秘密或 node_modules。

验证分层：
1. **结构与进程**：命令映射完整、根配置不反向导入、正常进程 cwd 为根、用户参数/错误码透传；安全生成器的隔离例外单独测。
2. **静态与产物**：从根冻结安装、Prisma/路由/DI生成、lint、类型检查、Vitest；dev/beta/prod 全部四 Worker 配置比较，实际离线打包四 Worker。生成器连续运行保持幂等；业务实现和 SQL 不应有内容漂移。
3. **已有业务回归**：完整现有 suite，不缩小 include 或跳过失败。覆盖书签保存/UID/内容、集合权限、认证/撤权、订阅/支付、导入、queue/cron等既有用例。记录迁移前后测试数量和跳过原因。
4. **真实本地集成**：检查 PostgreSQL/Redis 测试 setup，在可丢弃且明确隔离的本地实例运行可用集成套件。`paymentPostgres` 会 TRUNCATE 且使用固定端口/数据库，未证实隔离前绝不启用；其它 opt-in 套件同理。
5. **真实 HTTP 场景**：使用根启动入口和隔离测试配置启动 Worker，执行网关路由、未授权拒绝、测试身份的书签写入/读取/删除，并从本地存储确认效果。配置测试资源不能修改生产 handler 或用完全 mock 的函数调用冒充运行时请求。

当前 `test/entry/edge.test.ts` 大量 mock Core，只能作为路由单测，不能替代最后一层。默认 dev AI Vectorize 有远程依赖，不能为烟测擅自连接远程；必须用明确的本地测试绑定/运行环境，无法建立时报告具体阻塞，不把 bundle 或单测通过称为完整验收。外部 OAuth、支付供应商、AI/Browser 云能力不在未授权的真实调用范围；既有安全/支付测试仍需执行，未验证的供应商链路须单列。

迁移前若已有失败，先记录并区分，不能把它当作迁移导致，也不能忽略后声称“全部通过”。与工具路径无关的业务失败不应夹带修复；需要另行确认范围。

## Risks / Trade-offs

- [根 ESM package 类型影响原 CJS 辅助脚本] → 保留正确的模块边界，逐项执行非危险命令验证，不一并重命名或改算法。
- [Prisma 配置位置、schema-relative output 和 pnpm resolution 混淆] → 保留 schema/client import 契约，实际生成并在业务测试和四 Worker bundle 中消费；不凭目录推测成功。
- [测试 cwd 改动导致用例悄悄消失] → 比较迁移前后发现列表，修路径不减覆盖，不依赖 Vitest 切回 API。
- [工具依赖移动造成 lockfile 升级] → 保持解析版本，审阅依赖 diff，冻结安装验证。
- [秘密加载来源意外变化] → 采用明确环境变量/既有 Worker 路径，文档写明；不读或复制秘密文件。
- [既有集成测试会删除数据] → 先检查 setup，使用新建可丢弃测试资源，不使用开发/生产现有数据库。
- [本地依赖不足阻断端到端验证] → 先完成可验证部分，列出准确阻塞；不得将未完成验收标为完成。
- [用户已有未提交迁移内容被覆盖] → 只做增量改动，记录本次文件范围，不执行 reset/checkout/clean 或提交。

## Migration Plan

1. 当前工作区建立安全基线，先运行既有标准检查并记录结果；这一步仅为比较旧行为，实施后的开发入口不保留对子包的要求。
2. 上移配置和工具依赖，建立完整根命令；应用代码、schema、SQL及生成输出位置不动。
3. 修生成器、部署/setup、测试的路径和配置发现；增补根执行及安全回归。
4. 更新 CI、三语开发/部署文档、README 和 `.rulesync` 源，再运行 `pnpm agent:sync`；不手改生成规则文件。
5. 完成上述验证层级，报告通过/失败/跳过/未验证项，不远程部署。
6. 如需回退，只撤回本次明确记录的工具链改动；不回退已有业务迁入、不修改数据库、不删除用户本地状态和秘密。
