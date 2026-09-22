<div align="center">
<img src="https://r-beta.slax.com/icon.png" />
<h1> <a href="https://slax.com/slax-reader.html">Slax Reader API </a> </h1>
<h1>Simple tools for a relaxed life</h1>

[![GitHub pull requests](https://img.shields.io/github/issues-pr/slax-lab/slax-reader-api?style=flat)](https://github.com/slax-lab/slax-reader-api/pulls) [![GitHub closed pull requests](https://img.shields.io/github/issues-pr-closed/slax-lab/slax-reader-api?style=flat)](https://github.com/slax-lab/slax-reader-api/pulls?q=is%3Apr+is%3Aclosed) [![GitHub issues](https://img.shields.io/github/issues/slax-lab/slax-reader-api?style=flat)](https://github.com/slax-lab/slax-reader-api/issues) [![GitHub closed issues](https://img.shields.io/github/issues-closed/slax-lab/slax-reader-api?style=flat)](https://github.com/slax-lab/slax-reader-api/issues?q=is%3Aissue+is%3Aclosed) ![Stars](https://img.shields.io/github/stars/slax-lab/slax-reader-api?style=flat) ![Forks](https://img.shields.io/github/forks/slax-lab/slax-reader-api?style=flat)

简体中文 | [English](../../README.md) | [Japanese](./README_JP.md)

</div>

<div align="center">
    <a href="https://slax.com/slax-reader.html">Home Page</a> |
    <a href="https://t.me/slax_app">Channel</a> |
    <a href="https://r.slax.com">Live Site</a>
</div>
</br>

这是基于 Cloudflare Workers 开发的 Slax Reader API 服务，后端源码、Prisma、生成器和测试已迁入本仓库的 [`apps/api/`](../../apps/api/)。目前仅后端完成迁入，Web、扩展和 CLI 仍待迁移；[旧 Web 仓库](https://github.com/slax-lab/slax-reader-web) 暂时仍是前端源码来源。根目录命令与迁移状态见[仓库说明](../../README.md)，后端开发见[开发指南](DEVELOPMENT-DOCUMENT-CN.md)。本文为部署、开发教程，如需直接使用 Slax Reader，请移步 [Slax Reader](https://r.slax.com) 或 [Slax Reader Bot](https://t.me/slax_reader_bot)。

<div align="center">

</div>
</br>

# ✨ Get Slax Reader

- [Chrome Web Store](https://chromewebstore.google.com/detail/slax-reader/gdnhaajlomjkhahnmiijphnodkcfikfd)
- [Slax Reader](https://r.slax.com)
- [Slax Reader Bot](https://t.me/slax_reader_bot)
- ~~Slax Reader APP~~ (WIP)
- ~~Slax Reader Desktop~~ (WIP)

# 🚀 Self Deploy

[Cloudflare Deploy](./CLOUDFLARE-DEPLOY-CN.md)

[Vercel Deploy](./VERCEL-DEPLOY-CN.md)

[Self-Hosting](./SELF-HOSTING-CN.md)

# 🎉 Feature List

- [x] 支持通过 URL / 插件 / Telegram 进行网页收藏
- [x] 支持服务端 Fetch / Puppeteer / ApiFY 进行网站解析
- [x] 支持多语言错误、消息提示
- [x] 支持对收藏内容划线、评论、回复、分享、加星标、归档
- [x] 支持对收藏进行AI对话、AI总结、划线对话、AI标签生成
- [x] 支持对收藏进行全文搜索+向量搜索的混合搜索
- [x] AI功能支持多服务商、降级处理、Function Call
- [x] 支持从omnivore导入收藏
- [x] 针对`微信公众号` / `X` / `Medium` / `Youtube` 以及系列Readability过度精简的内容进行优化
- [x] 支持 Websocket / Browser Push 进行消息推送
- [x] 支持收藏的图片代理、异步懒保存

### TODO List

- [ ] 支持通过 Telegram 进行消息推送
- [ ] 支持 Nodejs / Deno 等运行环境，可以脱离 Cloudflare Worker 运行
- [ ] 彻底重构项目外部数据源，适配更多数据源（e.g. MySQL...）
- [ ] 支持一键部署到Docker、Cloudflare、Kubernetes等平台
- [ ] 原生支持更多AI服务商（目前仅支持openai兼容的API接入）
- [ ] 彻底重构项目代码，支持Typescript-style ESLINT
- [ ] 支持一键部署Cloudflare脚本

# 🤝 How to Contribution

你可以通过了解我们的开发、部署、基础规范来进行代码的贡献，让产品做得更好。[文档](./HOW-TO-CONTRIBUTION-CN.md)

# 💖 Contributors

💖 [感谢每一位贡献者，让Slax Reader变得更好](https://github.com/slax-lab/slax-reader-api/graphs/contributors) 💖

<img src="https://contrib.rocks/image?repo=slax-lab/slax-reader-api" alt="contributors">

# 🙏 鸣谢

在开发 Slax Reader API 的过程中，我们使用了许多优秀的开源项目和工具。在此对这些项目的贡献者表示由衷的感谢：

- 🚀 [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- 🗄️ [Prisma](https://www.prisma.io/)
- 🔄 [itty-router](https://github.com/kwhitley/itty-router)
- 📖 [readability](https://github.com/mozilla/readability)
- 🤖 [grammy](https://gram.dev/)
- 📝 [TypeScript](https://www.typescriptlang.org/)
- 🔍 [ESLint](https://eslint.org/)
- ✨ [Prettier](https://prettier.io/)
- ✂️ [jieba-rs](https://github.com/messense/jieba-rs)
- ✂️ [jieba-wasm](https://github.com/fengkx/jieba-wasm)
- 💬 [cf-webpush](https://github.com/aynh/cf-webpush)

# 📝 License

`Slax Reader` is licensed under the [Apache License 2.0](../../apps/api/LICENSE). The community version is completely free, open-source, and will remain so forever.
