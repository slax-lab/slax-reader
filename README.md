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
| `apps/backend` | API server (Cloudflare Workers) |
| `apps/cli` | Command-line client |
| `packages/contracts` | Shared API contracts and types |
| `packages/frontend-types` | Shared Web/Extension implementation types |
| `packages/frontend-utils` | Shared frontend utilities |
| `packages/selection` | Shared highlighting and annotation engine |

Shared libraries belong in `packages` when at least two apps use them. See the
[repository map](docs/architecture/frontend.md) for the current application and package boundaries.

## Development and self-hosting

Web and Extension source now live in this repository. Start with the
[developer setup guide](docs/contributing/development.en.md) or [中文开发指南](docs/contributing/development.md).
After installing dependencies, run `pnpm run setup:check` to check the local runtime, workspace links, and required frontend environment variables.
The backend remains external during this migration; local business flows require its development configuration.
See [migration status and remaining verification](docs/migrations/final-verification.md) before planning deployment.

## Contributing

Bug reports, features, and docs are all welcome. You can contribute without a development environment through
[参与指南（中文）](docs/contributing/README.md) or [Contributing](docs/contributing/README.en.md).
Please follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[Apache License 2.0](LICENSE). Copyright is held by The Slax Reader Contributors — see [NOTICE](NOTICE) for details.
