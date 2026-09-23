# Slax Reader Web

基于 Nuxt 4 / Vue 3 的 Web 阅读器，来自固定的源码快照。

[English](README.md)

[开发与参与指南](../../docs/web/development_CN.md)

## 开始开发

在仓库根执行（Node.js 22.22.2+、24.15.0+ 或 26+，使用仓库固定的 pnpm 11.25.0）：

```sh
pnpm install --frozen-lockfile
pnpm --filter @apps/slax-reader-dweb type
pnpm web -- dev
```

开发服务器需要 API 的本地公开配置和公开前端配置。先阅读
[配置与验证说明](../../docs/web/development_CN.md)。首次联调请运行 `pnpm api -- config:init`；
本阶段没有无需后端的演示模式。不要把旧仓库的环境文件复制进来。

首次配置请从 deploy 示例开始：

```sh
cp deploy/local_web/.env.example deploy/local_web/.env
```

## 常用命令

```sh
pnpm web -- typecheck
pnpm web -- test
pnpm web -- build
```

`dev`、`test`、`build` 会先构建划线引擎 `@slax-reader/selection`。
共享引擎修改后可单独运行 `pnpm --filter @slax-reader/selection build`。
包名暂保留 `@apps/slax-reader-dweb`，文件位置是 `apps/web`。

## 从哪里修改

- 页面与交互：`app/pages`、`app/components`、`app/composables`
- 翻译：`i18n/locales`
- Web 服务端渲染：`server`（属于 Web，API 业务代码在 `apps/api`）
- 应用配置：`config`、`nuxt.config.ts`、`uno.config.ts`
- 自动测试：`tests`
- 详细架构：[Web 架构](../../docs/web/architecture.md)
- 许可证：[LICENSE](../../LICENSE) · [NOTICE](../../NOTICE)

扩展位于 [`apps/extension`](../extension/README.md)。Web 现有的 `/x/ext-bridge` 协议保留，
真实 API 联调留到所有迁移阶段完成后的最终验收。
