# 参与 Slax Reader

[English](README.en.md) · [文档首页](../README.md) · [开发者入门](development.md)

不需要会写程序才能参与。你可以描述使用中的困惑、复现问题、校对翻译，或者改善说明文档。

## 选一个入口

| 想做的事 | 第一步 | 需要本地安装吗？ |
| --- | --- | --- |
| 反馈使用问题 | 搜索[现有 Issues](https://github.com/slax-lab/slax-reader/issues)，再选 Bug report | 不需要 |
| 提出功能或体验建议 | 新建 [Feature request](https://github.com/slax-lab/slax-reader/issues/new?template=feature.yml)，描述使用场景 | 不需要 |
| 修改一处错字、翻译或说明 | 按下面的网页编辑步骤提交建议 | 不需要 |
| 帮忙验收界面变化 | 在相关 PR 留下测试意愿，请作者提供可用的测试地址或扩展包 | 使用测试网站不需要；扩展需要手动加载 |
| 修改代码 | 从[开发者入门](development.md)选择 Web 或扩展 | 需要 |

Issue 是讨论问题的帖子；PR（Pull Request）是请维护者检查并合并一组修改。
不确定文件在哪时，直接开 Issue 描述问题即可。可以使用中文或英文。

## 写一个容易跟进的反馈

在 [Bug report](https://github.com/slax-lab/slax-reader/issues/new?template=bug.yml) 中选择 Web 或 Browser Extension，按实际情况填写：

```text
位置：扩展侧边栏，中文界面
环境：浏览器名称及版本；扩展版本，或网站地址和发生时间
步骤：1. 打开一篇文章 2. 点击…… 3. 看到了……
期望：我希望看到……
实际：现在显示……
频率：每次发生 / 偶尔发生
附件：圈出问题位置的截图（如有）
```

不知道 Web 的版本时，可在必填版本栏写“线上 Web，发生时间……”。功能建议重点写“我想完成什么、现在卡在哪里”。
截图和日志只保留复现所需内容，隐藏账户信息、私密文章、cookie 和 token。

## 不安装软件，提交一个小修改

1. 在 GitHub 仓库的分支选择器中选择 `dev`，打开需要修改的文件。迁移尚未进入 `dev` 时，请使用作者指定的迁移分支，并将 PR 的目标设为集成分支 `feat/integrate-slax-reader-web-extension`。
2. 点击编辑按钮（铅笔）。没有写入权限时，GitHub 会引导你 Fork，也就是创建自己的仓库副本。
3. 只改本次要修正的文字。查看差异预览；Markdown 可切换 Preview 检查排版。
4. 选择创建新分支并提出修改，不直接提交到 `dev`、`beta` 或 `main`。例如单处错字使用 `docs/fix-reader-wording`。
5. 创建 PR，确认目标仓库为 `slax-lab/slax-reader`、目标分支正确。写清原文、改文、原因，以及出现位置。
6. 如实填写验证情况，例如“只检查了 Markdown 预览，未本地运行，请协助确认界面”。与修改无关的检查项无需假装完成。

单文件、错字规模的修改可使用这个入口。较大的翻译整理、多文件编辑或行为改动，先开 Issue，
再由你或协作者按[本地工作流程](development.md)处理。纯错字和说明修订的 PR 可写 `OpenSpec: n/a`；
功能、API 或行为修复要先完成方案评审，维护者可以协助，不需要反馈者先学会 OpenSpec。

## 文案和翻译在哪里

| 内容 | 中文 | 英文 |
| --- | --- | --- |
| Web 界面 | [zh.json](../../apps/web/i18n/locales/zh.json) | [en.json](../../apps/web/i18n/locales/en.json) |
| 扩展界面 | [zh_CN.json](../../apps/extension/src/locales/zh_CN.json) | [en.json](../../apps/extension/src/locales/en.json) |
| 开发、使用仓库的说明 | 本目录和 [docs](../README.md) | 对应的 English 入口 |

打开文件后搜索界面上看到的原文，只改冒号右侧的显示文字，保留左侧 key 和 JSON 的引号、逗号、括号。
Web 和扩展分别维护翻译，相同文字不一定共用一个条目。新加语言或修改 key 需要开发者一起处理。

例如 Web 的 `"comment_placeholder": "回复 {username}"` 中，`{username}` 会被替换为用户名；
扩展对应文案使用 `"comment_placeholder": "回复 $1"`。修改文案时分别保留 `{username}` 或 `$1`，
也保留原有的 `\n` 换行标记，不要互相替换它们。

提交时附上语言、出现位置和前后文字；如果没有运行环境，写明需要作者帮忙检查文字是否被截断、变量是否正常显示。
涉及付费、隐私或条款含义的修改先讨论；[产品内文档](../../apps/web/open_docs)会直接展示给用户。

## 如何看到自己的修改

GitHub 的 Markdown Preview 只能预览文档排版；JSON 文件的编辑不会自动展示成产品界面。
现在没有自动生成每个 PR 的测试站点，也没有免后端本地演示模式。
可以请 PR 作者提供已有的测试环境、截图，或针对该 PR 构建的扩展包，并标明对应提交。
[线上网站](https://r.slax.com)能帮助描述已有问题，但不代表它已经包含你的分支修改。

文档、翻译和反馈都不要求安装 Xcode。只有本地编译某些 Node 原生依赖时才可能需要平台编译工具，
相关已知问题见[最终验收清单](../migrations/final-verification.md)。

提交前遵循仓库的[行为准则](../../CODE_OF_CONDUCT.md)。代码与素材的许可见 [LICENSE](../../LICENSE)、
[NOTICE](../../NOTICE)；迁入内容的来源及商标说明见[迁移记录](../migrations/slax-reader-web-extension.md)。
