# @commons/frontend-types

Web 与 Extension 共用的前端实现类型。

这里放浏览器端、local-first 和本地存储相关类型，例如扩展面板配置和 `LocalStorageKey`。
前后端通信协议统一放在 [`@slax-reader/contracts`](../contracts/README.md)，不要把 API DTO 放回本包。

`/selection` 和 `/models` 是现有前端实现的兼容层：selection 使用浏览器节点的
`path/start/end` 标记路径，models 包含标记树的 `children`、local-first 标签的
`id_kind/display/tag_ids` 等 UI 字段。它们保留 Web/Extension 的现有运行时数据形状，
不会替代 contracts `/marks` 中 API 使用的 `xpath/start_offet/end_offset` DTO。

在使用它的 app 的 `package.json` 中声明 `"@commons/frontend-types": "workspace:*"`。
不发布到 npm。修改类型时，需要同时验证 Web 和 Extension。
