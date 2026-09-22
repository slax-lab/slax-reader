# Slax Reader 文档 / Documentation

按你想做的事情开始。阅读文档、反馈问题、通过网页修正文案，不需要安装 Node.js、pnpm 或 Xcode。
Choose an entry below. Reading docs, reporting issues, and making small edits on GitHub do not require a local development environment.

| 我想做什么 / I want to… | 入口 / Start here |
| --- | --- |
| 反馈问题、提建议、修改文案 / Report, suggest, edit text | [参与指南](contributing/README.md) · [Contributing in English](contributing/README.en.md) |
| 修改代码并在本地验证 / Develop locally | [开发者入门](contributing/development.md) · [Developer setup in English](contributing/development.en.md) |
| 理解目录和 Web、扩展的关系 / Understand the frontend layout | [目录与应用关系](architecture/frontend.md) |
| 开发 Web / Work on Web | [Web README](../apps/web/README.md) · [配置与验证](apps/web/development.md) · [架构](apps/web/architecture.md) |
| 开发浏览器扩展 / Work on Extension | [Extension README](../apps/extension/README.md) · [配置与验证](apps/extension/development.md) · [架构](apps/extension/architecture.md) |
| 查看迁移来源、进度及待验收项 / Inspect migration status | [迁移记录](migrations/slax-reader-web-extension.md) · [最终验收清单 / Final verification](migrations/final-verification.md) |

本目录存放贡献者文档，直接在 GitHub 或编辑器中阅读，目前没有单独的文档站启动命令。
产品内的隐私、条款等内容位于 [`apps/web/open_docs`](../apps/web/open_docs)，由 Web 读取，不能当成开发文档搬走。
These are repository docs, readable on GitHub or in an editor; no documentation-site command is configured.
Product-facing content remains in the Web app.

当前迁移包含 Web、扩展及三个前端共享库。Backend 仍在外部仓库；没有为本次迁移配置自动 PR 预览或免后端演示模式。
Web and Extension have been imported; the backend remains external. Automatic PR previews and a backend-free demo are not configured by this migration.
