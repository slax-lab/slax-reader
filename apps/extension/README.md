# Slax Reader Browser Extension

The Chrome and Edge extension built with WXT 0.21 and Vue 3. It preserves the pinned Manifest V3 source snapshot and its existing capabilities.

[Development and contribution guide](../../docs/web/development.md) · [Chinese](README_CN.md)

## Start developing

Run these commands from the repository root. Use Node.js 22.22.2+, 24.15.0+ or 26+, and the pnpm 11.25.0 version pinned by the repository:

```sh
pnpm install --frozen-lockfile
pnpm extension -- dev
```

Set the public local configuration using the [configuration and verification guide](../../docs/extension/development.md). Login, bookmark synchronization, highlights and comments need a working Web and backend environment; a successful build or extension load does not prove those flows are integrated.

Start with the deploy template:

```sh
cp deploy/local_extension/.env.example deploy/local_extension/.env
```

## Common commands

```sh
pnpm extension -- typecheck
pnpm extension -- test
pnpm extension -- build
pnpm extension -- zip
```

The commands build the shared selection engine automatically; type checks and tests also generate WXT types. The development command pre-bundles vendor assets, while `build` and `zip` preserve the existing normal and vendor-aware packaging paths.
The package name remains `@apps/slax-reader-extensions`; its files live in `apps/extension`.

After a build, enable developer mode at `chrome://extensions` or `edge://extensions`, choose “Load unpacked”, and select `apps/extension/build/chrome-mv3`. The development server uses `build/chrome-mv3-dev`; keep these directories separate.

## Where to make changes

- Extension UI: `src/components`
- Translations: `src/locales/en.json`, `src/locales/zh_CN.json`
- Background scripts, page injection and Web integration: `src/entrypoints`, `src/bridge`
- Manifest and build configuration: `wxt.config.ts`, `config`, `plugins`
- Automated tests: `tests`
- [Architecture](../../docs/extension/architecture.md)
- [License](../../LICENSE) · [NOTICE](../../NOTICE)
