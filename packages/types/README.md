# @commons/types

从旧前端 `commons/types` 迁入的共享库；旧 `commons/types-pro` 的应用扩展类型、常量和埋点类型也已统一并入此包。
Web（`apps/web`）与 Extension（`apps/extension`）均通过 workspace 使用此库。

在使用它的 app 的 `package.json` 中声明 `"@commons/types": "workspace:*"`。
不发布到 npm。修改导出或类型时，需要同时验证 Web 和 Extension。

来源、映射和许可证见 [迁移记录](../../docs/migrations/slax-reader-web-extension.md)。
