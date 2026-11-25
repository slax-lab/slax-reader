# Cloudflare API 部署

只维护 `deploy/cloudflare/api.toml.example` 一份公开模板。执行根命令 `pnpm api -- config:init` 创建忽略的 `api.toml`，填写实际资源。开发、离线构建、部署、类型生成默认读取这份文件，缺失即失败；不会偷偷回退模板。多套安装可各自保存忽略的配置，通过 `build/deploy --config <仓库根相对路径>` 显式选择；每套使用独立资源名称。

1. 安装依赖，配置 api.toml，在 deploy/local/.env 填写 Prisma 的两个 URL 和 Cloudflare 工具凭据（自动加载），执行 `pnpm api -- gen:all`。占位 URL 仅可生成客户端。
2. 使用原生 Wrangler 的 `name`、`services`、`[env.*]`，不使用自定义 `[workers.*]`。Core 采用所选环境的 name，AI/Browser 使用 AIGC（或 VECTOR）/SlaxBrowser 服务名称；可通过 EDGE 服务绑定指定 Edge 名称，通过 OBJECTS 服务绑定指定 Objects 名称（默认把 Core 名称中的 `reader-core` 换成 `reader-objects`）。设置该环境的 BACKEND_API_PREFIX 和前端/图片/PowerSync URL。远程 API origin 必须是真实 HTTPS，只有 Edge 公开 HTTP。
3. 创建自己的 D1、KV、R2、队列、五个 1024 维 cosine Vectorize 索引，配置 PostgreSQL/Hyperdrive、PowerSync。`resources` 默认仅列计划，`--apply` 才创建缺失资源并输出 ID，需账号与 API token；Hyperdrive/数据库/外部服务不由它创建。模板的 SlaxTwitterFxembed 是外部 `fxembed` 服务，需自行部署实现或提供等价服务名。Cloudflare 账号需具备这些产品及 Browser Rendering 的权限。
4. 保留逻辑 binding 名称，自定义物理资源名。队列映射使用原生 producer binding，导入死信队列通过 IMPORT_OTHER 消费者的 dead_letter_queue 关联。配置原文件不被改写。环境间隔离物理队列和 Workflow 名称。
5. 已有安装必须保留原 Worker 名、资源 ID、DO migration tags/classes 与所有历史迁移，模板不是生产配置的替代品。远程 D1/fulltext 与 PostgreSQL/logs 迁移需独立核对目标并运行开发文档中的对应命令。
6. Secret 使用 Cloudflare Worker secrets；本地使用忽略的 `deploy/local/.dev.vars`。Edge/Core/AI/Vector 配置同一个 EDGE_SHARED_SECRET，按功能配置 JWT、Hashids、支付、OAuth、模型和 PowerSync 等凭据（完整 Env 契约在 apps/api/worker-configuration.d.ts）。不要写进 TOML。支付/OAuth 等提供方的回调域名也要配置为自己的 origin。

```bash
pnpm api -- build
pnpm api -- deploy --dry-run
pnpm api -- resources                 # plan only
pnpm api -- resources --apply         # creates remote resources
pnpm api -- deploy --bootstrap        # NEW installation only
pnpm api -- deploy                    # subsequent updates
pnpm api -- deploy edge               # update one existing Worker
pnpm api -- wrangler edge secret put EDGE_SHARED_SECRET
pnpm api -- secrets:sync --from ~/slax-secrets/prod.env --dry-run   # 新增 Worker 的发布前执行，见下文
```

`build` 真正离线打包（minify）六个 Worker，使用临时配置与空 env，不覆盖开发中的生成配置，并为每个 Worker 写出 `bundle-<worker>.meta.json`。`deploy --dry-run` 只生成 `.generated/`，不打包也不调用云端。生成文件不是第二份配置源，请勿手动维护。

新安装的 bootstrap 顺序为 Browser → Objects → Vector → AI → Edge，其中 AI 之前先发布一个临时移除 service/Workflow 绑定的 Core，最后发布带完整绑定和 Workflow 的 Core，解决循环依赖。普通发布顺序为 Browser → Objects → Vector → Core → AI → Edge。仅在新安装使用；中断后重新运行 bootstrap 完成初始化。已有部署使用普通 deploy。部署/secret/资源创建与远程迁移均是真实云操作，自动化代理需获得明确授权。

## Worker 拓扑

| Worker | 运行位置 | 负责 |
|---|---|---|
| Edge（公开） | 不设置，就近运行 | HTTP 入口：CORS、缓存、图片代理、鉴权，转发到 Core 或 AI；`ContentEntry`；队列消费者、cron 和 Email Routing 的接收方，收到的事件原样转给 Core 的内部主机 `jobs.internal` |
| Core | `aws:ap-southeast-1` | `AI_ROUTES` 以外的 Reader 路由；通过内部主机 `jobs.internal` 执行的队列、cron 和 newsletter 邮件处理；六个 Workflow、`VectorPreferenceObject` |
| AI | `aws:ap-southeast-1` | `apps/api/src/const/routes.ts` 中 `AI_ROUTES` 列出的路由（AIGC、概要/大纲、搜索、推荐、向量刷新）和 `AiEntry` 向量 RPC |
| Objects | `aws:ap-southeast-1` | `SlaxJieba`、`SlaxWebSocketServer`、`ScreenshotBrowser` 三个 Durable Object，不提供 HTTP |
| Vector | `aws:us-east-1` | 不带 tag 的 `/v1/bookmark/search` 语义步骤（查询向量化、一次带向量的 V5 文章查询、按平台均值去中心化打分），通过内部主机 `vector.internal/search` 提供给 AI 的 `VECTOR_SEARCH` 绑定；只绑定 `VECTOR_V5_ARTICLE`，没有路由 |
| Browser | 不设置 | `SlaxBrowser`（不变） |

placement 由 `apps/api/script/deploy/config.ts` 的 `DATABASE_REGION` 决定，即离主 PostgreSQL 最近的区域。私有配置中出现 `[placement]` 会在任何远程操作前被拒绝。Core 和 Edge 保留原有的 `SlaxJieba`、`SlaxWebSocketServer`、`ScreenshotBrowser` 命名空间，由返回 410 的空壳类承接（`apps/api/src/entry/retired.ts`），这些数据不会被删除。MCP Server 已下线，其 `SlaxMcpServer` 命名空间连同保存的会话一起删除：只要账号中还有这个命名空间，发布就会给 Edge 和 Core 加上 `retire-mcp-v1`（`deleted_classes = ["SlaxMcpServer"]`，见下文），私有迁移历史无需修改。Objects 使用独立迁移标签 `objects-v1`。

Vector 的名字由 Core 推导（`reader-core` → `reader-vector`，`reader-core-beta` → `reader-vector-beta`，其余为 `<core>-vector`），也可用 `services.VECTOR_SEARCH.service` 指定；位置由 `VECTOR_REGION`（`aws:us-east-1`）决定，靠近查询编码器和 Vectorize 索引。AI 通过服务绑定以 `fetch` 调用它，而不是 RPC，因为 placement 只对 `fetch` 处理函数生效；请求携带 `EDGE_SHARED_SECRET`。没有该绑定时（隔离的本地运行），AI 在本进程执行同样的步骤。首次包含 Vector 的发布前，每个账号先创建它并写入它要读取的值：

```bash
pnpm api -- deploy --target vector
pnpm api -- secrets:sync --from ~/slax-secrets/prod.env   # 给 Vector 上传 JINA_API_KEY 和 EDGE_SHARED_SECRET
```

只有 `deploy --target vector` 可以在 Vector 尚不存在时不带这些值发布；其他任何发布在 Vector 缺少其中任一值时都会停止，并给出这条命令。

## 拆分后的首次发布（已有安装）

Edge 保留它现有的队列消费者、cron 和 Email Routing 接收方，把每个事件通过现有的 `CORE` 服务绑定以 `fetch` 方式原样发到内部主机 `jobs.internal`，并用 `EDGE_SHARED_SECRET` 鉴权。与 RPC 不同，fetch 会遵循 Core 的 placement，所以这些任务在新加坡、靠近数据库执行；服务绑定的 fetch 与 RPC 计费相同（不额外计请求费，只计 CPU 时间）。因此没有任何触发器、消费者或邮件规则需要移动，拆分后的首次发布就是一次普通 `deploy`（CI 或 `pnpm api -- deploy`）。已完成拆分、现在新增 Vector 的安装，先执行上文 Vector 的两条命令；之后的整体发布只会在 Vector 仍缺值时停止。远程发布在第一次发布前读取账号：

- 若某个 Worker 缺少其代码读取的值（见下文），停止并列出 Worker 和 key 名；
- 决定发布顺序。账号中还有 `SlaxMcpServer` 命名空间时，按 Browser → Objects → Core（仍导出 MCP 空壳，因为旧 Edge 绑定着 Core 的命名空间）→ AI → Edge（删除 Edge 的命名空间）→ Core（删除 Core 的命名空间）发布；Wrangler 在 Core 首次发布时把 Workflow 转到 Core。之后的发布不再有命名空间，按 Browser → Objects → Core → AI → Edge 发布。

变量和 secret 要跟着代码走。部署使用 `--keep-vars`，用 `wrangler secret put` 设置的 secret 只留在原来那个脚本上。`apps/api/script/deploy/runtimeKeys.ts` 列出每个 Worker 的代码会读取的字符串变量和 secret（测试会从构建产物重新推导，防止过期）。发布前会按名称列出：某个 Worker 需要读取、本安装的其他 API Worker 上存在、但该 Worker 自己和所选 `[vars]` 都没有的 key，然后停止。Cloudflare 不会返回 secret 的值，无法从旧 Edge 复制，需要你提供保存值的文件（密码管理器导出或原始 `.env`，放在仓库外或被忽略的 `deploy/local/` 下）。文件可以是 `.env`、JSON（`{"KEY": "value"}` 或 `[{"name": "KEY", "value": "value"}]`，也接受 `key`），或由顶层 `KEY = "value"` 行组成的 `.toml`；数字和布尔值按字符串上传；其他以 `{` 或 `[` 开头的内容按 JSON 读取。读取失败时只报告位置、key 名和值的类型，不会输出值，然后执行：

```bash
pnpm api -- secrets:sync --from ~/slax-secrets/prod.env --dry-run   # 只列出 Worker 和 key 名
pnpm api -- secrets:sync --from ~/slax-secrets/prod.env             # 用 wrangler secret bulk 上传
```

它只给每个 Worker 上传其代码会读取、其他 API Worker 已有但它自己缺少的 key，不会覆盖已有 secret；值通过 stdin 交给 Wrangler，不出现在命令行、文件或日志中；跳过尚未部署的 Worker；文件里缺少需要的 key 时返回失败。首次发布前为 Core 和 AI 执行一次。Objects 是新 Worker，创建前无法持有 secret，它读取的值（目前只有 `FRONT_END_URL`）必须放在 `[vars]` 中，否则发布会停止。也可以改为把值放进私有配置的 `[vars]`。2026-11-23 的只读检查发现：生产和 beta 的 Core、AI 缺少 `DEEPSEEK_API_KEY`；test 账号已齐全。任何 Worker 都没有的 key 属于当前未配置的可选功能，不会报出。

首次发布期间，大约在几次发布的时间内：AI 路由在 AI 的 Workflow 绑定等待新 Core 时可能失败；Core 与 AI 两次发布之间搜索分词会失败，因为旧 AI 仍访问 Core 已下线的 jieba 命名空间；旧 Edge 上调用 Core 已下线 Durable Object 的任务会失败并由队列重试。请在低峰期执行：先 test 账号，再 beta，最后生产。

回滚：MCP 命名空间删除之前（即本次发布的最后两次发布之前），用 `wrangler rollback` 把各 Worker 回到上一版本。删除之后，Wrangler 拒绝把 Edge 或 Core 回滚到删除之前；其余变更仍可通过部署不导出 `SlaxMcpServer` 的版本回退。

这仍是 Cloudflare Workers 架构，并非可直接用 Docker 部署的 Node API。离线构建与本地测试不能替代真实账号的资源权限、secrets 和第三方功能验收。上线后检查鉴权、书签、异步队列、支付回调和同步功能。

自定义前端 origin 同时用于 events 凭据 CORS、图片 Referer 和分享链接识别；截图使用 IMAGE_PREFIX，通知图标使用 FRONT_END_URL。生产图片前缀应以 `/` 结尾并指向自己的图片服务。远程部署必须设置 `RUN_ENV = "prod"`，关闭开发端点并启用生产校验；`RUN_TYPE = "prod"` 使用正式支付，beta/dev 使用测试支付。

## 一键启动与 CI 外部配置

完成首次资源和环境文件准备后运行 `pnpm api -- setup`，或先执行 `pnpm api -- setup --check`。setup 执行一次 Wrangler 登录、初始化依赖、迁移和生成后退出；另行执行 `pnpm api -- dev` 启动 Workers；Vectorize/AI 等仍依赖云端。所有工具支持 `SLAX_API_CONFIG` 指向独立配置仓库中的 api.toml，types 也支持 `--config`。完整准备清单与 CI workflow 示例见 [一键开发与配置仓库](DEV-AND-CI-CN.md)，Docker adapter 和公共 HTTP 类型边界见 [调研](DOCKER-ADAPTER-RESEARCH-CN.md)。
