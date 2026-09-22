# Slax Reader 浏览器扩展

基于 WXT 0.21 / Vue 3 的 Chrome、Edge 扩展，沿用固定源码快照的 Manifest V3 和功能。

[参与指南](../../docs/contributing/README.md) · [Developer setup in English](../../docs/contributing/development.en.md) · [文档导航](../../docs/README.md)

## 开始开发

在仓库根执行，使用 Node.js 22.22.2+、24.15.0+ 或 26+，以及仓库固定的 pnpm 11.25.0：

```sh
pnpm install --frozen-lockfile
pnpm extension -- dev
```

先按[配置与验证说明](../../docs/apps/extension/development.md)设置本地公开配置。
登录、收藏同步及划线评论需要 Web 和 backend；扩展能构建并加载，不代表这些业务已联调通过。

首次配置可以从 `.env.example` 开始：

```sh
cp apps/extension/.env.example apps/extension/.env
```

## 常用命令

```sh
pnpm extension -- typecheck
pnpm extension -- test
pnpm extension -- build
pnpm extension -- zip
```

命令自动构建共享划线引擎；类型检查和测试也会先生成 WXT 类型。
开发命令自动预打包 vendor，`build` 和 `zip` 延续原项目的普通打包或已有 vendor 逻辑。
包名暂保留 `@apps/slax-reader-extensions`，目录为 `apps/extension`。

构建后，在 Chrome 的 `chrome://extensions` 或 Edge 的 `edge://extensions` 开启开发者模式，
选择“加载已解压的扩展程序”，载入 `apps/extension/build/chrome-mv3`。
开发服务器使用 `build/chrome-mv3-dev`；不要混淆两个目录。

## 从哪里修改

- 扩展界面：`src/components`
- 翻译文案：`src/locales/en.json`、`src/locales/zh_CN.json`
- 后台、网页注入和 Web 连接：`src/entrypoints`、`src/bridge`
- manifest 与构建：`wxt.config.ts`、`config`、`plugins`
- 自动测试：`tests`
- [架构说明](../../docs/apps/extension/architecture.md)
- [来源与迁移记录](../../docs/migrations/slax-reader-web-extension.md)
- [原始 Apache-2.0 许可](../../docs/migrations/source-license.txt)
