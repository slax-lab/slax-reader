## 1. 冲突清理与基线

- [x] 1.1 清理 `.rulesync/rules/overview.md`、`.gitignore`、生成的 AGENTS/CLAUDE 文件和所有冲突标记；验证全仓库（排除 node_modules、生成运行状态）不再包含 `<<<<<<<`/`=======`/`>>>>>>>`，并通过 `rulesync generate --check`。
- [x] 1.2 合并根 `package.json` 的重复 scripts/devDependencies 对象和上游工具版本，保持合法 JSON、workspace 元数据及现有后端迁移依赖；验证 `node -e` 解析成功且根 `pnpm install --lockfile-only --ignore-scripts` 可运行。
- [x] 1.3 以合并后的 manifests 重新生成 `pnpm-lock.yaml`，不手工拼接冲突片段；验证 `pnpm install --frozen-lockfile --ignore-scripts` 和两个 workspace importer 的依赖解析成功，且 lockfile 不再含冲突标记。

## 2. 具体命令回归 API 应用

- [x] 2.1 将根 manifest 中的 API 具体 scripts 完整迁回 `apps/api/package.json`，保留原 API 内短命令及参数语义；增加/调整 API 内部调用所需的相对配置路径，并验证 `pnpm --filter slax-reader-backend run <command>` 对每个支持命令可解析。
- [x] 2.2 将 API-only 的 TypeScript、Vitest、ESLint、Prettier、Prisma 配置和 API worker 类型配置归位到 `apps/api/`，识别并保留真正共享的根配置；验证唯一权威文件、没有重复配置副本、所有 API 脚本引用均可解析。
- [x] 2.3 将 API 专属 Prisma schema 与迁移目录的命令引用统一到 `apps/api/prisma/`，保持历史 SQL 字节不变；使用占位数据库 URL 从 API 命令执行 Prisma client 生成，验证 D1/PG/logs client 输出和业务 imports 不变。
- [x] 2.4 调整 `apps/api/script/`、`apps/api/test/runtime/` 和 API 部署/生成调用的 cwd 与路径基准；验证从 API workspace 命令执行时生成路由/DI、类型、Worker 配置和 local HTTP harness 均不依赖根具体 alias。

## 3. 根抽象 API 入口

- [x] 3.1 在根 `package.json` 保留唯一抽象 `api` 入口，使用 workspace 包身份转发 `pnpm api -- <command> [args...]`；验证根不再包含具体 `dev:api`/`gen:api`/`lint:api`/`test:api` 等 API catalog scripts。
- [x] 3.2 新增根入口契约测试，覆盖成功转发、任意参数透传、未知命令失败、子进程退出码和 SIGINT/SIGTERM 行为；从根运行测试并验证不需要用户 `cd apps/api`。
- [x] 3.3 为危险操作和本地安全入口建立抽象调用映射（包括远程部署/迁移、离线 build、HTTP/集成 smoke）；验证秘密隔离、local/remote 区分、`--pull=never`/临时资源边界和已有退出码不变。

## 4. CI、文档和规则同步

- [x] 4.1 将 API CI 改为从根调用 `pnpm api -- <command>`，不设置 API working-directory；验证生成、lint、typecheck、test 和四 Worker build 在 CI 中均经抽象入口执行。
- [x] 4.2 更新 README、`docs/api` 中英日文档，统一示例为 `pnpm api -- <command>`，说明具体命令在 `apps/api/package.json`、API-only 配置/迁移在 `apps/api/`，并保留危险操作说明；搜索确认无旧具体根命令作为必需步骤。
- [x] 4.3 更新 `.rulesync` 规则源说明 app-owned scripts/root abstract API entry，运行 `rulesync generate`；验证 AGENTS/CLAUDE 与规则源一致且无冲突标记。
- [x] 4.4 更新命令契约、路径、部署、生成和安全测试，移除依赖根具体命令名称的断言；验证测试以应用 scripts 为事实来源而不是维护第二份根命令清单。

## 5. 最终业务保持验收

- [x] 5.1 从根执行 `pnpm install --frozen-lockfile`、`pnpm api -- gen:all`、`pnpm api -- lint`、`pnpm api -- test` 和 API typecheck；对比迁移前生成文件、路由/DI、业务源码、schema/历史 SQL与测试发现，确认无漏测或新增失败。
- [x] 5.2 从根通过抽象入口执行 单份配置四 Worker离线构建，验证配置、bindings、migrations_dir和bundle语义与已确认基线一致，且构建不覆盖开发中的配置。
- [x] 5.3 从根通过 `pnpm api -- test:http` 等实际应用命令运行隔离 HTTP smoke，验证鉴权、书签增删查、PostgreSQL/D1/logs持久化；通过 `pnpm api -- test:integration:local` 运行可用的隔离集成套件，失败项必须原样记录。
- [x] 5.4 汇总冲突清理、根抽象命令覆盖、配置归属、标准检查、构建、HTTP 和集成结果；只有所有必需验收通过才标记完成，现有支付 `auto_renew` 失败不得隐藏、放宽或归咎于命令迁移而未经证据确认。

## 6. 用户确认的单份部署配置

- [x] 6.1 统一 api.toml.example/api.toml，移除环境文件与 runtime.toml；配置缺失明确失败，类型生成隔离不泄露配置值。
- [x] 6.2 名称、内部绑定、Workflow 和 DO 归属由单份配置推导，保留自有资源和历史迁移；离线构建不覆盖活动配置，部署支持首次 bootstrap。
- [x] 6.3 配置驱动 Host 和队列映射，未知队列失败；覆盖自定义名称和旧名称的业务分发回归。
- [x] 6.4 修正支付测试的 provider fixture，保留既有断言；本地 PowerSync 端口限定 loopback。
- [x] 6.5 更新三语部署/开发文档、CI、规则源并进行最终统一回归。

- [x] 6.6 自定义前端 origin 同步支持 events CORS、图片 Referer 与分享识别，截图和通知图标使用配置 URL，保留精确来源校验和旧部署兼容；统一回归。

## 7. 自动加载环境文件（用户补充确认）

- [x] 7.1 Prisma 配置和 Cloudflare 工具自动加载 deploy/local/.env；使用固定应用路径、保留进程环境优先和 setup 本地目标，显式环境文件不存在时明确失败。
- [x] 7.2 验证实际 Prisma CLI、D1 子进程凭据传递与本地 Worker 的 .dev.vars 路径；保持 build/types/资源计划不加载秘密，不执行远程操作。
- [x] 7.3 同步三语文档和规则源，集中运行完整测试、生成、类型检查、lint、构建和隔离本地验收。

## 8. 一键开发、外部配置部署与可移植性调研

- [x] 8.1 新增 dev:full，先检查开发配置、PowerSync 密钥与运行变量，再串联本地 setup 和全部 Workers；失败停止、信号透传，不覆盖现有文件，不执行远程迁移。
- [x] 8.2 用 SLAX_API_CONFIG 统一所有工具的外部配置入口，提供拉取独立配置仓库的可复用/手动 CI 部署 workflow，保留 types/build 秘密隔离。
- [x] 8.3 更新初始化和 CI 使用文档，集中验证失败前置、配置路径、部署调用、类型生成和既有 API 行为。
- [x] 8.4 按用户澄清，本轮仅调研 Docker adapter 拆分与 HTTP 合约边界，给出源码定位、官方来源、阶段方案和验收门槛，不宣称已实现 Docker runtime。

## 9. 用户确认的环境文件集中存放

- [x] 9.1 将工具环境文件默认路径改为 deploy/local/.env，与 .dev.vars/api.toml 同目录；保留显式文件选择、进程优先及秘密隔离。
- [x] 9.2 同步文档、规则源和生成规则；用合成文件集中验证 Prisma/D1 自动读取、旧路径不隐式读取、Worker 文件传递及离线命令隔离。

## 10. 本地目录与完整 setup（用户明确要求）

- [x] 10.1 本地 api.toml/.env/.dev.vars 与生成配置归位 deploy/local，公开模板保留 Cloudflare 目录，更新全部默认路径、规则与文档。
- [x] 10.2 setup 只读检查用户准备的本地配置/开发密钥，缺失时报错（按用户最终要求撤回自动准备），统一执行完整后台启动，失败停止并显示原因。
- [x] 10.3 PowerSync 提前检查配置，Compose 等待服务健康；集中验证缺失/失败/重复执行/完整流程及隔离真实 PowerSync 启动。

## 11. 原生 Wrangler 配置（用户最终确认）

- [x] 11.1 移除 workers 自定义格式，按原生 name/services/env 和旧后端身份读取配置，不转换或备份用户文件。
- [x] 11.2 setup/dev/local D1 使用 env.dev，构建/类型/部署/资源支持显式环境，缺项报错且不写配置或生成密钥。
- [x] 11.3 集中验证原生环境隔离、源文件不变、启动流程、单测、类型、lint、构建和 OpenSpec。

## 12. PowerSync 重复密钥配置修复

- [x] 12.1 以 API 的 .dev.vars 私钥为唯一来源，公开参数通过内存传给 Compose，不读取或改写旧重复文件。
- [x] 12.2 精确诊断 JSON/字段/签名问题，覆盖文件缺失、旧值冲突、签名验签和环境参数优先级。
- [x] 12.3 集中执行启动脚本与完整单测、lint/typecheck、真实隔离 PowerSync 启动及用户配置只读预检，清理本轮临时目录。

## 13. 初始化与项目启动分离（用户最新要求）

- [x] 13.1 setup 校验后执行一次 Wrangler login，登录成功才初始化依赖，完成后退出；dev 独立启动 Workers。
- [x] 13.2 移除 dev:full 混合入口，使用 setup 作为唯一初始化命令，--check 不登录；同步错误码/信号回归、文档与规则。
- [x] 13.3 集中运行完整单测、lint/typecheck、Shell/OpenSpec/规则检查，验证登录次数与顺序、登录失败不初始化、setup 从不启动 Workers。
