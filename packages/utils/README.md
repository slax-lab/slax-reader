# @commons/utils

从旧前端 `commons/utils` 迁入的共享库，保留原包名及导出。
Web 与 Extension 在来源快照中均使用此库；本阶段先为 Web 提供，Extension 下一阶段接入。

在使用它的 app 的 `package.json` 中声明 `"@commons/utils": "workspace:*"`。
不发布到 npm。修改导出或类型时，需要同时验证 Web 和后续迁入的 Extension。

来源、映射和许可证见 [迁移记录](../../docs/migrations/slax-reader-web-extension.md)。
