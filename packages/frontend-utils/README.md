# @commons/frontend-utils

从旧前端 `commons/utils` 迁入并重新命名的前端共享工具库。
Web（`apps/web`）与 Extension（`apps/extension`）均通过 workspace 使用此库。

在使用它的 app 的 `package.json` 中声明 `"@commons/frontend-utils": "workspace:*"`。
不发布到 npm。修改导出或类型时，需要同时验证 Web 和 Extension。

来源、映射和许可证见 [迁移记录](../../docs/migrations/slax-reader-web-extension.md)。
