# Slax Reader CLI 安装指南

以下步骤面向 AI Agent，部分步骤需要用户在浏览器中配合完成。

## 环境要求

开始安装之前，请确保环境中已安装 Node.js `^22.22.2 || ^24.15.0 || >=26.0.0`（npm/npx）。

## 第 1 步：安装

```bash
npx @slax-lab/reader-cli@latest install
```

此命令会全局安装 `reader-cli` 并自动安装 AI Agent skill。

## 第 2 步：登录

向用户索要 API Key，可在 [Slax Reader → 设置 → API Keys](https://reader.slax.com) 获取。

```bash
reader-cli login --api-key <用户提供的密钥>
```

## 第 3 步：验证

```bash
reader-cli whoami --json
```

若返回 `ok: true`，安装配置完成，告知用户一切就绪。

---

更多命令和能力指南，可参考 [Slax Reader CLI：让 AI Agent 帮你收藏一切](slax-reader-cli-agent-capability-guide.zh.md)。
