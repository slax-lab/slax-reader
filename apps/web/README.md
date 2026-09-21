# Slax Reader Web

基于 Nuxt 4 / Vue 3 的 Web 阅读器，来自迁移记录中固定的源码快照。

## 开始开发

在仓库根执行（Node.js 22.22.2+、24.15.0+ 或 26+，使用仓库固定的 pnpm 11.25.0）：

```sh
pnpm install --frozen-lockfile
pnpm --filter @apps/slax-reader-dweb type
pnpm dev:web
```

开发服务器需要独立的本地 backend 和公开前端配置。先阅读
[配置与验证说明](../../docs/apps/web/development.md)。缺少 `SLAX_BACKEND_DIR` 时会明确报错；
本阶段没有无需后端的演示模式。不要把旧仓库的环境文件复制进来。

## 常用命令

```sh
pnpm typecheck:web
pnpm test:web
pnpm build:web
```

`dev`、`test`、`build` 会先构建划线引擎 `@slax-reader/selection`。
共享引擎修改后可单独运行 `pnpm --filter @slax-reader/selection build`。
包名暂保留 `@apps/slax-reader-dweb`，文件位置是 `apps/web`。

## 从哪里修改

- 页面与交互：`app/pages`、`app/components`、`app/composables`
- 翻译：`i18n/locales`
- Web 服务端渲染：`server`（属于 Web，独立 backend 不在此处）
- 应用配置：`config`、`nuxt.config.ts`、`uno.config.ts`
- 自动测试：`tests`
- 详细架构：[Web 架构](../../docs/apps/web/architecture.md)
- 来源和许可证：[迁移记录](../../docs/migrations/slax-reader-web-extension.md)

扩展位于 [`apps/extension`](../extension/README.md)。Web 现有的 `/x/ext-bridge` 协议保留，
真实 backend 联调留到所有迁移阶段完成后的最终验收。
