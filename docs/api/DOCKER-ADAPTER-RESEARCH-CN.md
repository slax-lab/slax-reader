# Docker 自部署与 adapter 拆分调研

调研日期：2026-09-21。结论：可以实现，但当前 API 仍不能直接用 Docker 启动成完整自部署后台。本轮只完成源码盘点和方案，没有增加 Docker runtime，也没有用开发模拟器冒充生产部署。

## 当前阻碍

HTTP 层大量使用标准 Request/Response，已有 DI 容器，数据库也已使用 Prisma driver adapter，这是可复用基础。但平台依赖已进入入口、上下文和业务编排，并非集中在一个适配器文件中：

三份 Prisma schema 的 generator 当前都指定 `runtime = "cloudflare"`。Node 路线还需单独验证客户端生成目标、WASM/原生驱动加载与输出目录，不能直接覆盖现有 Cloudflare client 后让两个平台共用未经验证的产物。

| 位置 | 现有依赖 | Docker 方向与必须保留的行为 |
| --- | --- | --- |
| `apps/api/src/di/data.ts` | PrismaD1、Hyperdrive、Vectorize、Env | 分离注册工厂；PostgreSQL 直接使用 PrismaPg + 连接池；D1 初期保留 SQLite，分别持久化主库与 fulltext 库 |
| `apps/api/src/infra/repository/dbBookmarkSearch.ts`、`prisma/d1_migrations/fulltext/` | SQLite FTS5、BM25、触发器、原始 SQL | 首期验证同一批 SQLite SQL 与 FTS 行为；不要把 provider 改成 PostgreSQL 就宣布兼容 |
| `apps/api/src/utils/context.ts` | 全局 Env、ExecutionContext | 提取业务配置、身份和请求清理接口；后台任务不能简单替换成不受监督的 Promise |
| `apps/api/src/entry/edge/index.ts`、`entry/ai/index.ts` | WorkerEntrypoint、service binding、可信 Edge 身份转发 | 抽取应用 HTTP handler；Node HTTP adapter 继续执行鉴权、CORS、限流与身份边界，不直接公开 Core |
| `apps/api/src/infra/repository/KVClient.ts`、`bucketClient.ts` | KV、R2 | 缓存接口适配 Redis；对象存储接口适配 S3 兼容存储；保留 TTL、元数据、条件写入与流式读取语义 |
| `apps/api/src/infra/queue/queueClient.ts`、`entry/edge/workflows/` | Queues、WorkflowEntrypoint、持久化 step、重试 | 独立 Queue 与 Workflow 接口；明确确认、重试、死信、去重和断点恢复，不把 Workflow 直接改为串行函数调用 |
| `apps/api/src/infra/message/websocket.ts`、Jieba/MCP/Browser DO | Durable Objects 的命名、对象状态、WebSocket/会话 | 按能力拆 Tokenizer、Realtime、MCP session、Browser；单机锁不能被当成多副本一致性方案 |
| `apps/api/src/infra/repository/remoteVectorizeIndex.ts`、`dbVectorize.ts` | 五个向量分片、metadata filter、topK、score | 可适配 pgvector，保持 1024 维 cosine、书签权限过滤、删除、排序和分页语义，另做结果与召回验收 |
| `apps/api/src/utils/browser.ts`、`entry/browser/index.ts` | Cloudflare Puppeteer、Browser DO | 独立浏览器进程/容器，Node Puppeteer adapter；保留 URL 安全检查、并发限制、超时与失败清理 |
| `deploy/local/` | PostgreSQL、PowerSync | 现有 Compose 只覆盖依赖；生产仍需 API/任务进程、健康检查、迁移任务、持久卷和备份恢复 |

## 官方资料能确认什么

- Prisma 支持 SQLite、D1 和 `@prisma/adapter-better-sqlite3`，因此复用 schema 后替换数据库驱动有官方支持。但 adapter 不能保证现有 FTS、触发器、迁移和并发语义天然等价。[Prisma SQLite](https://docs.prisma.io/docs/orm/core-concepts/supported-databases/sqlite)
- Cloudflare 的开发能力矩阵列明 Vectorize 和 Workers AI 没有本地模拟；D1、KV、R2、Queues、Workflows 等支持本地开发。这解释了为什么当前 dev 仍需云端开发资源，也说明开发模拟与生产自部署是两个验收目标。[开发绑定矩阵](https://developers.cloudflare.com/workers/local-development/bindings-per-env/)
- `workerd` 官方支持自托管应用服务器和生产运行，所以“Workers 绝对不能 Docker 自托管”不成立。但它是运行时；本仓库依赖的托管服务、运维和一致性仍须逐项提供。把 wrangler dev 装进 Docker 不能证明这些条件已满足。[workerd](https://github.com/cloudflare/workerd)
- Durable Objects 提供有身份的有状态计算和一致性边界。迁移实时会话、MCP 与对象状态时，必须重新实现相关语义。[Durable Objects](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/)
- pgvector 支持 cosine 距离及精确/近似检索；近似索引会影响召回。当前分片、权限过滤、score 转换和排序需要合约测试，不能直接返回数据库距离冒充原来的相关性分数。[pgvector](https://github.com/pgvector/pgvector)
- BullMQ 可以作为任务队列候选，但重试依赖幂等任务设计；Workflows 的持久执行可另评估 Temporal。两者都不是现有 Cloudflare WorkflowStep 的无修改替换。[BullMQ 幂等任务](https://docs.bullmq.io/patterns/idempotent-jobs)、[Temporal Workflow execution](https://docs.temporal.io/workflow-execution)
- Puppeteer 提供 Node 浏览器启动接口，可以作为 Browser adapter 的基础，仍需单独处理运行时依赖、资源限制与网络策略。[Puppeteer launch](https://pptr.dev/api/puppeteer.puppeteernode.launch)

## 建议拆分顺序

以下是基于源码和上述资料的设计建议。HTTP 合约已开始抽到共享包；平台 adapter 和 Docker runtime 尚未实现。

1. 先抽平台无关的 HTTP wire contracts 到 `packages/contracts`，再让 `ContextManager` 依赖业务配置和能力接口；禁止公共合约引用 Env、Prisma Client、DurableObject 或内部 DI。
2. 将现有 Cloudflare 实现移动到 `apps/api/src/platform/cloudflare/`，保持现有 Worker 功能与协议不变；接口放 `platform/ports/`，不制造一个照抄整个 Env 的万能接口。
3. 增加 `platform/node/`：HTTP server、PostgreSQL、两个 SQLite 数据库、对象存储、缓存和浏览器。先验收鉴权、书签、标记、全文搜索、图片与同步。
4. 接入持久队列/工作流、WebSocket、MCP、向量检索和调度。单独验证重复投递、重启恢复、支付幂等、删除恢复及连接中断；未实现能力应明确不可用，不能空实现后返回成功。
5. 最后提供 Dockerfile/Compose：迁移任务完成后启动 API 与任务进程，暴露健康检查，定义持久卷与备份，执行完整自部署验收。首版明确单机边界，再决定是否支持多副本及 SQLite 的写入归属。

`workerd` 自托管可作为另一条原型路线评估，可能复用更多 Worker 入口，但托管绑定、状态归属与运维成本仍需验证。若目标是长期独立于 Cloudflare，优先推进按业务能力定义的 Node adapter；不要在本次目录重构里顺带替换所有运行时。

## 验收门槛

- 同一套 HTTP 合约测试同时运行于 Cloudflare 与 Docker，覆盖状态码、响应 envelope、鉴权、API key、CORS、流式响应与错误语义。
- 历史 PostgreSQL 与 SQLite/FTS 迁移可从空库完整执行；已有数据的时间、ID、约束、排序与搜索行为有对照。
- 重启任务进程后任务能恢复；支付回调重复投递不重复入账；删除和导入可恢复，不丢弃死信。
- 多用户的书签和向量检索不串数据；WebSocket/MCP 会话在约定的重连/重启边界内正确。
- HTTP 停机、任务关闭、数据库连接池与浏览器进程能被正确清理；备份恢复经过实际验证。

## HTTP 类型现在能否提前拆出

已建立 `@slax-reader/contracts`，入口为 `packages/contracts/src/index.ts`。当前覆盖和消费方式见 [contracts README](../../packages/contracts/README.md)。API 通过 workspace 依赖使用共享定义，客户端 DTO 默认使用 JSON 日期字符串；服务端使用显式 Date 泛型。当前数字 hashid 与字符串 UUID 保持不变。

公开错误名称、envelope、分页和书签/标记/标签/合集/API Key/客户端事件的首批 DTO 已迁出；部分直接展开数据库行的详情/列表尚需逐项核对，不能把 Prisma PO 当成公开协议。原响应字段、拼写、body code/HTTP status 和事件独立响应不变。

Env、ExecutionContext、Prisma 模型、数据库 PO、控制器类和内部 Workflow 参数留在 API；`worker-configuration.d.ts` 仍为 API 的运行时类型。拆出合约不代表 Docker adapter 已完成。
