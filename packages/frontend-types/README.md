# @commons/frontend-types

Web 与 Extension 共用的前端实现类型。

这里放浏览器端、local-first 和本地存储相关类型，例如扩展面板配置和 `LocalStorageKey`。
前后端通信协议统一放在 [`@slax-reader/contracts`](../contracts/README.md)，不要把 API DTO 放回本包。

在使用它的 app 的 `package.json` 中声明 `"@commons/frontend-types": "workspace:*"`。
不发布到 npm。修改类型时，需要同时验证 Web 和 Extension。
