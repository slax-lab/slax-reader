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

> Code is currently being migrated in from the legacy per-app repositories — expect directories to fill in over the coming days.

## Contributing

Bug reports, features, and docs are all welcome. Open an issue, or pick one labeled `good first issue`. Please follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[Apache License 2.0](LICENSE). Copyright is held by The Slax Reader Contributors — see [NOTICE](NOTICE) for details.
