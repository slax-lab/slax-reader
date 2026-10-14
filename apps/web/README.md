# Slax Reader Web

The Nuxt 4 / Vue 3 web reader imported from the pinned source snapshot.

[Development and contribution guide](../../docs/web/development.md) · [Chinese](README_CN.md)

## Start developing

Copy the Web environment example first, then run these commands from the
repository root. Use Node.js 22.22.2+, 24.15.0+ or 26+, and the pnpm 11.25.0
version pinned by the repository:

```sh
cp deploy/local/.env.web.example deploy/local/.env.web
pnpm install --frozen-lockfile
pnpm preflight --app web
pnpm web -- setup
pnpm web -- dev
```

For a complete repository initialization, use `pnpm setup:all`. Rerun
`pnpm web -- setup` after removing `.nuxt/` or local generated Web state.

The development server needs the local public API configuration and frontend public configuration. Read the [configuration and verification guide](../../docs/web/development.md) first. For the first backend integration, run `pnpm api -- config:init`. This stage does not provide a backend-free demo. Do not copy environment files from the old repository.

## Common commands

```sh
pnpm web -- typecheck
pnpm web -- test
pnpm web -- build
```

`dev`, `test`, and `build` build the `@slax-reader/selection` annotation engine first. After changing that shared engine, you can build it directly with `pnpm --filter @slax-reader/selection build`.
The package name remains `@apps/slax-reader-dweb`; its files live in `apps/web`.

## Where to make changes

- Pages and interactions: `app/pages`, `app/components`, `app/composables`
- Translations: `i18n/locales`
- Web server rendering: `server` (Web-owned; API business code is in `apps/api`)
- Application configuration: `config`, `nuxt.config.ts`, `uno.config.ts`
- Automated tests: `tests`
- Detailed architecture: [Web architecture](../../docs/web/architecture.md)
- License: [LICENSE](../../LICENSE) · [NOTICE](../../NOTICE)

The extension lives in [`apps/extension`](../extension/README.md). The existing Web `/x/ext-bridge` protocol is preserved. Real API integration is part of the final acceptance after all migration work is complete.
