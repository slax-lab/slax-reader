# PR 通知（飞书）

本仓库的 PR 动态会通过一个外部服务推送到飞书群与个人私聊。**通知规则和凭据都不在本仓库里**，这里只记录约定，方便贡献者理解会收到什么。

## 你会收到什么

| GitHub 事件 | 投递方式 | 收件人 |
| --- | --- | --- |
| PR 创建 / 从草稿转为待评审 | 群消息 + 私聊 | 群；被指派的 reviewer |
| 有人被点名 review | 私聊 | 被点名者 |
| PR 被合并 | 群消息 | 群 |
| 收到 review | 私聊 | PR 作者 |
| PR 收到新评论 | 私聊 | PR 作者 |
| PR 分支上的 CI 失败 | 私聊 | PR 作者 |

不会产生通知的情况：草稿 PR 首次创建、PR 被关闭但未合并、自己评论或 review 自己的 PR、以及 PR 作者不是团队成员。

> **外部贡献者请注意**：非团队成员的 PR 默认不会触发任何通知。另外 fork PR 上的 workflow 默认不运行，因此也不会产生 CI 失败通知——这是 GitHub 的默认策略。

## 服务在哪

- **代码**：[`slax-lab/slax-notify-bridge`](https://github.com/slax-lab/slax-notify-bridge) —— Cloudflare Worker
- **端点**：`https://slax-notify-bridge.freshmind.workers.dev/github`
- **投递**：飞书自建应用「GitHub 提醒」的机器人

服务是独立仓库而非本 monorepo 的一部分，因为它需要服务多个仓库：本 monorepo 与长期独立维护的客户端仓库都在其中，而 monorepo 只是其中之一。把通知服务放进 monorepo 会让依赖方向反转——客户端仓库的通知需求将需要改动本仓库。

## 给其他仓库接入

Worker 不需要改代码，只要在目标仓库加一个 webhook：

| 字段 | 值 |
| --- | --- |
| Payload URL | `https://slax-notify-bridge.freshmind.workers.dev/github` |
| Content type | `application/json` |
| Secret | 与 Worker 的 `GITHUB_WEBHOOK_SECRET` 一致 |
| Events | Pull requests、Pull request reviews、Issue comments、Workflow runs、Check runs |

**每个仓库需要各自配置**，接入哪些仓库是逐个显式决定的。

## 要人收到私聊，需要两步

1. 该成员的 GitHub 登录名要映射到他在飞书应用下的 `open_id`（配置在 Worker 侧，不在本仓库）
2. 该成员需要在飞书应用的**可用范围**内，否则发送会失败

`open_id` 是**按飞书应用隔离**的——同一个人在不同应用下值不同，因此不能从别处复制。它由 `slax-notify-bridge` 仓库的维护者维护。

## 这个功能的规格与实现记录在哪

本仓库**不保存**该通知服务的规格与规划产物。它们随实现一起放在
[`slax-notify-bridge`](https://github.com/slax-lab/slax-notify-bridge) 的 `openspec/` 下，
因为后续变更都属于那个仓库 —— 两份副本必然漂移，所以这里只留这份说明。

## 排查

通知没到时的检查顺序：

1. 确认 PR 事件本身符合上表（外部贡献者的 PR、草稿、自己操作自己的 PR 都不会发）
2. 去仓库 **Settings → Webhooks** 看 Recent Deliveries —— 投递失败会在这里显示为非 2xx
3. Worker 侧日志（`wrangler tail slax-notify-bridge`）—— 只有这里有详细原因

⚠️ 该端点的响应依赖 GitHub 的 HMAC 签名，**手工用 curl 调试时必须带 `User-Agent: GitHub-Hookshot/...`**，否则会被 Cloudflare 的机器人防护拦下并返回 `error code: 1010`——那看起来像服务故障，但其实是 UA 被拦。
