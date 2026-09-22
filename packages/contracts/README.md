# @commons/contracts

前后端共享的 API、领域数据和事件契约。

这里的类型描述跨进程、跨应用传输的数据：API 请求与响应、同步消息、共享枚举和埋点事件。
它不能依赖 Vue、浏览器 API、Nuxt 或 WXT。当前迁移保留了部分历史领域类型，其中有少量可选字段也被
local-first 列表使用；backend 接入 v2 后，再根据真实响应把这些字段细分为传输 DTO 和前端本地模型。

在使用它的 app 或 backend 的 `package.json` 中声明 `"@commons/contracts": "workspace:*"`。
不发布到 npm。修改契约时，需要同时检查 Web、Extension 以及未来的 backend。

来源和迁移边界见 [迁移记录](../../docs/migrations/slax-reader-web-extension.md)。
