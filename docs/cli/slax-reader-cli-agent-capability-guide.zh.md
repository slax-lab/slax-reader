# Slax Reader CLI：让 AI Agent 帮你收藏一切

你的 AI Agent 很聪明——能调研、能总结、能写代码、能起草邮件。但当它找到一篇值得收藏的文章时，它什么也做不了。它只能告诉你"这是链接"，然后你得自己打开浏览器、登录、手动保存。

Slax Reader CLI 改变了这一点。安装之后，你的 Agent 可以直接把任何 URL 保存到你的 Slax Reader 收藏库——带标题、描述、标签和归档模式。不用再复制粘贴链接，不用再"等会儿再收藏"然后就忘了。

以前：AI 找到了，你来存。现在：AI 找到了，AI 帮你存。你只管拍板。

## 快速开始

### 方式一：让 AI Agent 帮你安装

将以下提示词复制发送给你的 AI Agent（Claude Code、Codex、Gemini CLI、Cursor 等）：

```
帮我安装并配置 Slax Reader CLI：https://github.com/slax-lab/slax-reader/blob/dev/docs/cli/ai-agent-installation-guide.zh.md
```

### 方式二：手动安装

```bash
npm install -g @slax-lab/reader-cli@latest
npx -y skills add https://github.com/slax-lab/slax-reader/tree/dev/apps/cli/skills/slax-reader --skill slax-reader -g -y
reader-cli login
```

就这么简单。你的 Agent 现在可以执行 `reader-cli` 命令了。

---

## 用户场景

### 场景 1：边研究边收藏

你正在和 AI 做深度调研，它不断找到文章、论文和文档。不用逐个打开保存，直接说一句话：

| 你的提示词 | AI 做了什么 |
|-----------|-----------|
| "把这些链接都存到我的阅读列表，打上 'research' 标签" | Agent 对找到的每个链接执行 `reader-cli add <url> --tags "research"` |
| "刚才那篇关于 Transformer 的文章很好，收藏一下" | Agent 从上下文中识别出 URL，执行 `reader-cli add https://arxiv.org/abs/... --title "Attention Is All You Need" --tags "ml,论文"` |

### 场景 2：写代码时顺手收藏

Code Review 或调试过程中，Agent 找到了相关文档、Stack Overflow 回答或 GitHub Issue。不用打断工作流就能保存：

| 你的提示词 | AI 做了什么 |
|-----------|-----------|
| "把这个 GitHub Issue 收藏起来，后面要跟进" | `reader-cli add https://github.com/org/repo/issues/42 --tags "bug,跟进"` |
| "收藏这个 MDN 页面，我老是要查" | `reader-cli add https://developer.mozilla.org/... --title "CSS Grid 指南" --tags "参考,css"` |
| "这篇博客文章归档一下，怕以后打不开" | `reader-cli add https://blog.example.com/post --archive --tags "技术"` |

### 场景 3：每日阅读整理

让 Agent 帮你整理每天的阅读。告诉它你关心什么话题，让它把好内容存下来：

| 你的提示词 | AI 做了什么 |
|-----------|-----------|
| "这是我今天在 Hacker News 上喜欢的链接：[列表]。全部存下来，用今天的日期当标签" | Agent 逐个保存，带 `--tags "hn,2026-05-11"` |
| "看看我这周 star 的 GitHub 仓库，把 README 写得好的收藏起来" | Agent 逐个检查仓库，评估 README 质量，保存优秀的 |

### 场景 4：团队知识分享

发现了团队应该看的好内容？收藏并打上团队标签：

| 你的提示词 | AI 做了什么 |
|-----------|-----------|
| "收藏这篇 API 设计指南，打上 'team-reading' 标签方便大家找" | `reader-cli add https://... --title "API 设计最佳实践" --tags "team-reading,api"` |
| "这三篇关于 React Server Components 的文章收藏一下，给前端组看" | Agent 逐个保存，带 `--tags "前端,rsc,team-reading"` |

### 场景 5：趁它还在，赶紧存

网页内容会消失。博客文章会被删、页面会改版、付费墙会加上。当 Agent 找到有价值的内容，赶紧归档：

| 你的提示词 | AI 做了什么 |
|-----------|-----------|
| "这个看起来随时可能被删，归档一下" | `reader-cli add https://... --archive --title "..." --tags "归档"` |
| "把这个帖子里所有文档链接都存下来并归档" | Agent 提取所有 URL，逐个执行 `reader-cli add <url> --archive` |

---

## 能力地图

| 业务域 | CLI 能做什么 |
|--------|-----------|
| 书签收藏 | 保存任意 URL，支持自定义标题、描述、标签和归档模式 |
| 浏览阅读库 | 列出书签（支持筛选和分页）；获取书签详情和正文内容 |
| 身份验证 | 通过 API Key 登录、登出、查看当前用户信息 |
| 标签管理 | 使用逗号分隔的标签组织书签，便于检索 |
| 内容归档 | 启用归档模式，保留页面原始内容 |
| 书签整理 | 归档、取消归档、加星、取消加星、删除、恢复已保存的书签 |
| 版本更新 | 自动检测新版本，一键升级 |

---

## 命令参考

执行 `reader-cli --help` 可查看命令总览。

| 操作 | 命令 |
|------|------|
| 使用 API Key 登录 | `reader-cli login [--api-key <key>]` |
| 登出 | `reader-cli logout` |
| 查看当前用户 | `reader-cli whoami` |
| 保存书签 | `reader-cli add <url> [-t 标题] [-d 描述] [--tags 标签1,标签2] [--archive]` |
| 列出书签 | `reader-cli list [--page <n>] [--size <n>] [--filter all\|inbox\|archive\|starred]` |
| 获取书签详情 | `reader-cli get <bookmark-id> [--markdown]` |
| 归档书签 | `reader-cli archive <bookmark-id>` |
| 取消归档 | `reader-cli unarchive <bookmark-id>` |
| 给书签加星 | `reader-cli star <bookmark-id>` |
| 取消加星 | `reader-cli unstar <bookmark-id>` |
| 删除书签（可恢复） | `reader-cli delete <bookmark-id>` |
| 恢复已删除书签 | `reader-cli restore <bookmark-id>` |
| 检查更新 | `reader-cli upgrade --check` |
| 升级到最新版 | `reader-cli upgrade` |
| 查看帮助 | `reader-cli --help` |

---

## 常见问题

- **API Key 存在哪里？**

  存在你本地的系统配置目录（由 [conf](https://github.com/sindresorhus/conf) 库管理）。运行 `reader-cli whoami` 可以看到配置文件路径。你的密钥除了调用 Slax Reader API 外不会离开你的机器。

- **安装后提示 `command not found: reader-cli`？**

  你的 npm 全局 bin 目录可能不在 PATH 中。运行 `npm root -g` 查看全局目录，然后把它的上级 `bin/` 文件夹加到 PATH。

- **AI Agent 每次保存都需要我批准吗？**

  取决于你的 Agent 的权限模型。例如 Claude Code 默认会在执行 Shell 命令前询问，除非你预先授权。你可以把 `reader-cli` 加入 Agent 的允许命令列表，获得更流畅的体验。

- **支持私有部署的 Slax Reader 吗？**

  支持。使用 `reader-cli login --api-base https://your-instance.com` 将 CLI 指向你自己的服务器。

- **怎么切换账号？**

  目前 CLI 一次存储一个 API Key。切换账号请先执行 `reader-cli logout`，再用另一个账号的 Key 执行 `reader-cli login`。

- **如何获取帮助？**

  执行 `reader-cli --help` 查看命令总览，或访问 [GitHub 仓库](https://github.com/slax-lab/slax-reader) 提交 Issue。
