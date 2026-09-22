# Slax Reader

Open-source, AI-powered read-it-later — save web pages, highlight, and discuss.

![Slax Reader web app](docs/assets/web-inbox.jpeg)

## Get Slax Reader

- **Website**: [slax.com/reader](https://slax.com/reader/)
- **Web**: [r.slax.com](https://r.slax.com/)
- **iOS**: [App Store](https://apps.apple.com/us/app/slax-reader-ai-read-later/id6596730998)
- **Android**: [Google Play](https://play.google.com/store/apps/details?id=com.slax.reader)
- **Chrome Extension**: [Chrome Web Store](https://chromewebstore.google.com/detail/slax-reader/gdnhaajlomjkhahnmiijphnodkcfikfd) (works on Edge too)

Follow [@SlaxReader](https://x.com/SlaxReader) on X for updates.

## What it does

- **Permanent snapshots** — saved pages stay readable even after the original link dies.
- **AI reading aids** — outlines, summaries, and in-context answers while you read.
- **Highlight and discuss** — annotate any passage, then share the page; anyone with the link can join the discussion.

## Repository structure

This monorepo hosts all non-mobile Slax Reader code:

| Path | Description |
| --- | --- |
| `apps/web` | Web frontend ([r.slax.com](https://r.slax.com/)) |
| `apps/extension` | Browser extension (Chrome/Edge) |
| `apps/api` | API server (Cloudflare Workers) |
| `apps/cli` | Command-line client |
| `packages/contracts` | Shared API contracts and types |
| `deploy/` | Public Cloudflare Worker template and local infrastructure |

> Code is currently being migrated in from the legacy per-app repositories — expect directories to fill in over the coming days.

## Development and self-deployment

This monorepo is being consolidated from the legacy repositories. **Only the backend has migrated so far**: its source, Prisma schemas, generators and tests are in [`apps/api/`](apps/api/). Web, browser extension and CLI migration is still pending; the `apps/` directories are not yet a complete runnable product checkout. The [legacy web repository](https://github.com/slax-lab/slax-reader-web) remains the frontend source until its migration.

The API uses four Cloudflare Workers: Core, Edge, AI and Browser. Its commands and tool configurations belong to [`apps/api/`](apps/api/), including Prisma configs under `prisma/` and deployment code under `script/deploy/`. The root manifest exposes one dispatcher:

```bash
pnpm install --frozen-lockfile
pnpm api -- setup:api
pnpm api -- dev
```

The single public template is [`deploy/cloudflare/api.toml.example`](deploy/cloudflare/api.toml.example). `config:init` copies it to ignored `deploy/local/api.toml` without overwriting an existing file. Dev, build, deploy and runtime type generation read this actual configuration. Secrets belong in ignored `deploy/local/.dev.vars` or Cloudflare Worker secrets. Local infrastructure under `deploy/local/` provides PostgreSQL and PowerSync; it is not a standalone Docker API runtime.

Validation: `pnpm api -- gen:all`, `pnpm api -- lint`, `pnpm api -- typecheck`, `pnpm api -- test`, and `pnpm api -- build`. Prisma automatically reads `HYPERDRIVE_DATABASE_URL` and `LOGS_DATABASE_URL` from ignored `deploy/local/.env`; placeholders suffice only for client generation. Optional `test:http` and `test:integration:local` use disposable Docker resources and are separate from the default unit suite.

See the [development guide](docs/api/DEVELOPMENT-DOCUMENT-EN.md) ([中文](docs/api/DEVELOPMENT-DOCUMENT-CN.md), [日本語](docs/api/DEVELOPMENT-DOCUMENT-JP.md)) and [Cloudflare deployment guide](docs/api/CLOUDFLARE-DEPLOY-EN.md) ([中文](docs/api/CLOUDFLARE-DEPLOY-CN.md), [日本語](docs/api/CLOUDFLARE-DEPLOY-JP.md)). Configure your resources, public origin and provider credentials before deploying. `build` bundles offline; `deploy --dry-run` generates config only. Remote deployment and migrations are separate explicit operations.

`pnpm api -- setup:api` validates operator-provided native Wrangler configuration and keys, runs Wrangler login once, starts dependencies, runs migrations/generators, waits for PowerSync health and exits; start Workers separately with `pnpm api -- dev` (`--check` checks prerequisites). All deployment tools accept `SLAX_API_CONFIG` for configuration checked out from another repository. See [development and CI setup](docs/api/DEV-AND-CI-CN.md) and [Docker adapter feasibility](docs/api/DOCKER-ADAPTER-RESEARCH-CN.md).

共享 HTTP 类型位于 [`packages/contracts`](packages/contracts/README.md)，API 已通过 `@slax-reader/contracts` workspace 依赖使用。Web、扩展和 CLI 接入时从该包导入，不引用 API 服务端类型。

## Contributing

Bug reports, features, and docs are all welcome. Open an issue, or pick one labeled `good first issue`. Please follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[Apache License 2.0](LICENSE). Copyright is held by The Slax Reader Contributors — see [NOTICE](NOTICE) for details.
