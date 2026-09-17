# apps/web

The Slax Reader web application: the Nuxt app served at [r.slax.com](https://r.slax.com).

## What belongs here

- The Nuxt application itself — pages, components, composables, layers, and static assets.
- App-local configuration that only this app needs (`nuxt.config.ts`, and this app's UnoCSS / ESLint / TypeScript overrides).
- Unit tests, kept next to the code they test.

## What does not belong here

- Code shared with another app or package — it goes in `packages/`.
- Cross-app end-to-end and integration tests — they go in `tests/e2e/`.

## Migration source

[`slax-lab/slax-reader-web`](https://github.com/slax-lab/slax-reader-web) — the web app currently lives at `apps/slax-reader-dweb` in that repository, next to the browser extension.

## Interim owner

@boxcounter — interim owner until a dedicated code owner is assigned. See `.github/CODEOWNERS`.
