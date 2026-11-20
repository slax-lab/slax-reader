# Cloudflare API 部署

只维护 `deploy/cloudflare/api.toml.example` 一份公开模板。执行根命令 `pnpm api -- config:init` 创建忽略的 `api.toml`，填写实际资源。开发、离线构建、部署、类型生成默认读取这份文件，缺失即失败；不会偷偷回退模板。多套安装可各自保存忽略的配置，通过 `build/deploy --config <仓库根相对路径>` 显式选择；每套使用独立资源名称。

1. 安装依赖，配置 api.toml，在 deploy/local/.env 填写 Prisma 的两个 URL 和 Cloudflare 工具凭据（自动加载），执行 `pnpm api -- gen:all`。占位 URL 仅可生成客户端。
2. 使用原生 Wrangler 的 `name`、`services`、`[env.*]`，不使用自定义 `[workers.*]`。Core 采用所选环境的 name，AI/Browser 使用 AIGC（或 VECTOR）/SlaxBrowser 服务名称；可通过 EDGE 服务绑定指定 Edge 名称，通过 OBJECTS 服务绑定指定 Objects 名称（默认把 Core 名称中的 `reader-core` 换成 `reader-objects`）。设置该环境的 BACKEND_API_PREFIX 和前端/图片/PowerSync URL。远程 API origin 必须是真实 HTTPS，只有 Edge 公开 HTTP。
3. 创建自己的 D1、KV、R2、队列、五个 1024 维 cosine Vectorize 索引，配置 PostgreSQL/Hyperdrive、PowerSync。`resources` 默认仅列计划，`--apply` 才创建缺失资源并输出 ID，需账号与 API token；Hyperdrive/数据库/外部服务不由它创建。模板的 SlaxTwitterFxembed 是外部 `fxembed` 服务，需自行部署实现或提供等价服务名。Cloudflare 账号需具备这些产品及 Browser Rendering 的权限。
4. 保留逻辑 binding 名称，自定义物理资源名。队列映射使用原生 producer binding，导入死信队列通过 IMPORT_OTHER 消费者的 dead_letter_queue 关联。配置原文件不被改写。环境间隔离物理队列和 Workflow 名称。
5. 已有安装必须保留原 Worker 名、资源 ID、DO migration tags/classes 与所有历史迁移，模板不是生产配置的替代品。远程 D1/fulltext 与 PostgreSQL/logs 迁移需独立核对目标并运行开发文档中的对应命令。
6. Secret 使用 Cloudflare Worker secrets；本地使用忽略的 `deploy/local/.dev.vars`。Edge/Core/AI 配置同一个 EDGE_SHARED_SECRET，按功能配置 JWT、Hashids、支付、OAuth、模型和 PowerSync 等凭据（完整 Env 契约在 apps/api/worker-configuration.d.ts）。不要写进 TOML。支付/OAuth 等提供方的回调域名也要配置为自己的 origin。

```bash
pnpm api -- build
pnpm api -- deploy --dry-run
pnpm api -- resources                 # plan only
pnpm api -- resources --apply         # creates remote resources
pnpm api -- deploy --bootstrap        # NEW installation only
pnpm api -- deploy                    # subsequent updates
pnpm api -- deploy edge               # update one existing Worker
pnpm api -- wrangler edge secret put EDGE_SHARED_SECRET
pnpm api -- topology:transition --step 1 --dry-run   # 已有安装执行一次，见下文
```

`build` 真正离线打包（minify）五个 Worker，使用临时配置与空 env，不覆盖开发中的生成配置，并为每个 Worker 写出 `bundle-<worker>.meta.json`。`deploy --dry-run` 只生成 `.generated/`，不打包也不调用云端。生成文件不是第二份配置源，请勿手动维护。

新安装的 bootstrap 顺序为 Browser → Objects → Core（临时移除 service/Workflow 绑定）→ AI → Edge → Core（恢复完整绑定，并创建 Workflow、队列消费者和 cron），解决循环依赖。普通发布顺序为 Browser → Objects → AI → Core → Edge。仅在新安装使用；中断后重新运行 bootstrap 完成初始化。已有部署使用普通 deploy。部署/secret/资源创建与远程迁移均是真实云操作，自动化代理需获得明确授权。

## Worker 拓扑

| Worker | 运行位置 | 负责 |
|---|---|---|
| Edge（公开） | 不设置，就近运行 | HTTP 入口：CORS、缓存、图片代理、鉴权，转发到 Core 或 AI；`ContentEntry` |
| Core | `aws:ap-southeast-1` | `AI_ROUTES` 以外的 Reader 路由、队列消费者、cron、newsletter 邮件、六个 Workflow、`VectorPreferenceObject` |
| AI | `aws:ap-southeast-1` | `apps/api/src/const/routes.ts` 中 `AI_ROUTES` 列出的路由（AIGC、概要/大纲、搜索、推荐、向量刷新）和 `AiEntry` 向量 RPC |
| Objects | `aws:ap-southeast-1` | `SlaxJieba`、`SlaxWebSocketServer`、`ScreenshotBrowser` 三个 Durable Object，不提供 HTTP |
| Browser | 不设置 | `SlaxBrowser`（不变） |

placement 由 `apps/api/script/deploy/config.ts` 的 `DATABASE_REGION` 决定，即离主 PostgreSQL 最近的区域。私有配置中出现 `[placement]` 会在任何远程操作前被拒绝。Core 和 Edge 保留原有的 `SlaxJieba`、`SlaxWebSocketServer`、`ScreenshotBrowser` 命名空间，由返回 410 的空壳类承接（`apps/api/src/entry/retired.ts`），这些数据不会被删除。MCP Server 已下线，其 `SlaxMcpServer` 命名空间连同保存的会话一起删除：只要私有迁移历史创建过这个类，Core 的生成配置就会追加 `retire-mcp-v1`（`deleted_classes = ["SlaxMcpServer"]`），迁移第 4 步把它应用到 Edge 和 Core。Objects 使用独立迁移标签 `objects-v1`。

## 五 Worker 迁移（已有安装）

普通 `deploy` 会先读取账号状态（Worker、Workflow、队列、cron、Durable Object 命名空间）。若 Objects、AI 或 Core 未部署，有 Workflow 或队列消费者仍属于 Edge，Edge 仍有 cron，或仍存在 `SlaxMcpServer` 命名空间，则在发布前停止。每套安装执行一次迁移：先 test 账号，再 beta，最后在低峰期执行生产。凭据使用 `CLOUDFLARE_API_TOKEN`（需 Workers Scripts、Queues、Workflows、Durable Objects 编辑权限）或 `wrangler login` 的 token，配置选择与 `deploy` 相同（`--config`/`--env`）。每一步先读取状态，可重复执行，并支持 `--dry-run`。第 1 到 3 步不删除任何东西；Core 和 Edge 在第 4 步之前继续导出 MCP 空壳类（`src/entry/transition/`）。

变量和 secret 要跟着代码走。部署使用 `--keep-vars`，用 `wrangler secret put` 设置的 secret 只留在原来那个脚本上。`apps/api/script/deploy/runtimeKeys.ts` 列出每个 Worker 的代码会读取的字符串变量和 secret（测试会从构建产物重新推导，防止过期）。第 1 到 3 步发布前，以及每次普通发布前，命令会按名称列出：某个 Worker 需要读取、本安装的其他 API Worker 上存在、但该 Worker 自己和所选 `[vars]` 都没有的 key，然后停止。请把这些 key 加到私有配置的 `[vars]`，或对该 Worker 执行 `pnpm api -- wrangler <worker> secret put <NAME>`。2026-11-20 的只读检查发现：生产和 beta 的 `DEEPSEEK_API_KEY` 只在旧 Edge 上（YouTube 转文章和播客 Workflow 会移到 Core，AI 也会读取）；test 账号有 17 个 Core 需要、5 个 AI 需要的 key 只在旧 Edge 上。任何 Worker 都没有的 key 属于当前未配置的可选功能，不会报出。

1. `--step 1` 发布 Browser 和 Objects。确认 Objects 的三个命名空间已存在。
2. `--step 2` 发布 AI，移除每个队列的 Edge 消费者并清空 Edge 的 cron，然后发布 Core（含 Workflow、消费者、cron 和指向 Objects 的 DO 绑定）。期间消息在队列中等待约一次部署的时长。之后若有 Workflow 或队列消费者不属于 Core 则失败，并打印 Workflow 归属的前后对比。确认运行中的实例继续推进。
3. `--step 3` 发布精简后的 Edge。随后在控制台把 newsletter 的 Email Routing 规则从 Edge 改到 Core。
4. 先在精简后的 Edge 上检查路由、`ContentEntry`、图片代理、一条 AI 路由、WebSocket 升级、一次队列往返和一次 Workflow 创建。然后执行 `--step 4`：要求所有归属检查通过，依次发布带 `retire-mcp-v1` 的 Edge 和 Core，并确认不再有 `SlaxMcpServer` 命名空间。这一步不可逆，会永久删除保存的 MCP 会话。先发 Edge 是因为只要还有 Worker 绑定 Core 的命名空间，Cloudflare 就拒绝删除。若私有配置中 Core 的迁移历史没有记录 `SlaxMcpServer`，第 4 步前按 Cloudflare 报告的标签补上（例如 `{ tag = "v2", new_sqlite_classes = ["SlaxMcpServer"] }`），这样 Wrangler 只追加删除这一步。

回滚：第 2 步之前，用 `wrangler rollback` 回到旧版本即可。第 2 步之后、第 4 步之前，先为 Edge 重新加上队列消费者和 cron，部署旧版 Edge（仍声明 Workflow），再部署旧版 Core，并把 Email Routing 改回 Edge；此时没有删除任何命名空间，不会丢失对象数据。第 4 步之后 MCP 命名空间已删除，Wrangler 拒绝回滚到这次部署之前；其余拓扑变更仍可按上述方式回退，但所用版本不能再导出 `SlaxMcpServer`。

这仍是 Cloudflare Workers 架构，并非可直接用 Docker 部署的 Node API。离线构建与本地测试不能替代真实账号的资源权限、secrets 和第三方功能验收。上线后检查鉴权、书签、异步队列、支付回调和同步功能。

自定义前端 origin 同时用于 events 凭据 CORS、图片 Referer 和分享链接识别；截图使用 IMAGE_PREFIX，通知图标使用 FRONT_END_URL。生产图片前缀应以 `/` 结尾并指向自己的图片服务。远程部署必须设置 `RUN_ENV = "prod"`，关闭开发端点并启用生产校验；`RUN_TYPE = "prod"` 使用正式支付，beta/dev 使用测试支付。

## 一键启动与 CI 外部配置

完成首次资源和环境文件准备后运行 `pnpm api -- setup`，或先执行 `pnpm api -- setup --check`。setup 执行一次 Wrangler 登录、初始化依赖、迁移和生成后退出；另行执行 `pnpm api -- dev` 启动 Workers；Vectorize/AI 等仍依赖云端。所有工具支持 `SLAX_API_CONFIG` 指向独立配置仓库中的 api.toml，types 也支持 `--config`。完整准备清单与 CI workflow 示例见 [一键开发与配置仓库](DEV-AND-CI-CN.md)，Docker adapter 和公共 HTTP 类型边界见 [调研](DOCKER-ADAPTER-RESEARCH-CN.md)。
