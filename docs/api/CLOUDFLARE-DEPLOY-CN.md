# Cloudflare API 部署

只维护 `deploy/cloudflare/api.toml.example` 一份公开模板。执行根命令 `pnpm api -- config:init` 创建忽略的 `api.toml`，填写实际资源。开发、离线构建、部署、类型生成默认读取这份文件，缺失即失败；不会偷偷回退模板。多套安装可各自保存忽略的配置，通过 `build/deploy --config <仓库根相对路径>` 显式选择；每套使用独立资源名称。

1. 安装依赖，配置 api.toml，在 deploy/local/.env 填写 Prisma 的两个 URL 和 Cloudflare 工具凭据（自动加载），执行 `pnpm api -- gen:all`。占位 URL 仅可生成客户端。
2. 使用原生 Wrangler 的 `name`、`services`、`[env.*]`，不使用自定义 `[workers.*]`。Core 采用所选环境的 name，AI/Browser 使用 AIGC（或 VECTOR）/SlaxBrowser 服务名称；可通过 EDGE 服务绑定指定 Edge 名称。设置该环境的 BACKEND_API_PREFIX 和前端/图片/PowerSync URL。远程 API origin 必须是真实 HTTPS，只有 Edge 公开 HTTP。
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
```

`build` 真正离线打包四个 Worker，使用临时配置与空 env，不覆盖开发中的生成配置。`deploy --dry-run` 只生成 `.generated/`，不打包也不调用云端。生成文件不是第二份配置源，请勿手动维护。

新安装的 bootstrap 顺序为 Browser → Core（临时移除 service/Workflow 绑定）→ AI → Edge（创建 Workflow）→ Core（恢复完整绑定），解决循环依赖。仅在新安装使用；中断后重新运行 bootstrap 完成初始化。已有部署使用普通 deploy。部署/secret/资源创建与远程迁移均是真实云操作，自动化代理需获得明确授权。

这仍是 Cloudflare Workers 架构，并非可直接用 Docker 部署的 Node API。离线构建与本地测试不能替代真实账号的资源权限、secrets 和第三方功能验收。上线后检查鉴权、书签、异步队列、支付回调和同步功能。

自定义前端 origin 同时用于 events 凭据 CORS、图片 Referer 和分享链接识别；截图使用 IMAGE_PREFIX，通知图标使用 FRONT_END_URL。生产图片前缀应以 `/` 结尾并指向自己的图片服务。远程部署必须设置 `RUN_ENV = "prod"`，关闭开发端点并启用生产校验；`RUN_TYPE = "prod"` 使用正式支付，beta/dev 使用测试支付。

## 一键启动与 CI 外部配置

完成首次资源和环境文件准备后运行 `pnpm api -- setup:api`，或先执行 `pnpm api -- setup:api --check`。setup 执行一次 Wrangler 登录、初始化依赖、迁移和生成后退出；另行执行 `pnpm api -- dev` 启动 Workers；Vectorize/AI 等仍依赖云端。所有工具支持 `SLAX_API_CONFIG` 指向独立配置仓库中的 api.toml，types 也支持 `--config`。完整准备清单与 CI workflow 示例见 [一键开发与配置仓库](DEV-AND-CI-CN.md)，Docker adapter 和公共 HTTP 类型边界见 [调研](DOCKER-ADAPTER-RESEARCH-CN.md)。
