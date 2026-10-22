# Proposal

## Why

用户需要先浏览自己订阅的 RSS，再选择值得阅读的文章收藏到 Inbox；当前系统只有收藏后的阅读链路，缺少独立的订阅、定期更新和预览缓存。通过实验室开关提供最小完整功能，复用现有认证、任务调度、图片缓存与收藏处理，避免每条 RSS 都触发正文抓取和 AI 处理。

## What Changes

- 在现有实验室中增加默认关闭的 RSS 功能；Web 与原生 APP 均可开启、关闭。
- 支持用户添加 RSS/Atom 地址、查看及删除订阅、浏览缓存文章、手动刷新和查看更新失败状态；后台定期增量更新。
- 相同规范化 Feed URL 共享抓取、条目与正文缓存；用户只保留订阅关联和自定义显示名称，查询参数保持完整语义。
- 提供独立于书签的安全图文预览，图片通过现有签名代理与 R2 缓存；图片失败不会退回直接加载源站。
- 用户主动收藏时接入现有 Inbox 与商业正文抓取链路，提供幂等的收藏结果；定时抓取不会自动创建书签。
- Web 遵循现有 Nuxt fork/layer 组织。APP 使用原生设置与首页来源栏，RSS 与 Collection 同级；文章按用户最新要求复用现有书签详情阅读器。
- 首版支持 RSS 2.0、RSS 1.0/RDF、Atom；以用户提供的 Feed 地址为输入，不引入 RSSHub 部署、全文订阅系统或新的抓取服务。

## Capabilities

### New Capabilities

- `rss-labs`: 实验室开关、用户订阅、定时更新、缓存文章与图片、安全预览、显式收藏，以及 Web/原生 APP 的一致行为。

### Modified Capabilities

无。现有 living specs 只有发布分支与代码评审流程，本功能不改变它们。

## 超出本变更的附带改动

本分支还带两处与 RSS 无关、来自原合并分支的改动。它们与本变更的能力范围无关，保留在此以便就近评审：

- `apps/api/src/utils/authLogin/authGoogle.ts` 与 `apps/api/test/utils/googleNativeAudience.test.ts`：Web 平台 Google ID token 增加 `azp` 与 clientId 一致性校验，属于独立的登录安全修复。
- `deploy/local/dockerfile-local-pgsql.yaml`：本地 PowerSync 端口由 `127.0.0.1:18080` 改为对所有接口发布 `18080`，与本地 PostgreSQL 绑定回环的既有约定方向相反，需要单独决策。

其余与本变更无关的内容已拆出：`setup:api` 改名与工具环境文件收敛在 `chore/rename-setup-command`，Core Host allowlist 移除在 `chore/drop-core-host-allowlist`。

## Impact

- **后端源：`apps/api`**。涉及实验室注册、PG/Prisma 数据模型与迁移、RSS domain/repository/controllers、Cron、图片代理、用户删除，以及对应生成注册与测试；不修改登录/OAuth 协议。
- **共享接口：`packages/contracts`**。定义 RSS DTO、分页、错误和收藏结果；外部仓库使用各自现有类型组织，通过共同接口样例验证一致性。
- **Web：`../slax_reader_frontend`**。扩展实验室及导航，新增订阅管理、文章列表、预览和收藏入口。
- **原生 APP：`../slax-reader-client`**。扩展 Ktor、Koin、repository/ViewModel、现有详情路由、原生 UI 与多语言；将授权的 RSS 缓存 HTML 接入既有书签正文引擎。
- 复用已有 Linkedom 实现 Feed 解析与显式 HTML 白名单净化；网络请求仍使用现有安全 HTTP 封装，普通文章仍由现有商业服务抓取。
- API 迁移基线已接入；实现保持现有登录和配置边界，保存用户原有未提交改动。
- 三个代码仓库分别使用任务工作树及关联变更，按后端先行、客户端随后启用的顺序发布。本提案是三端共同验收依据。
