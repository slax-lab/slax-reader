# apps/extension

The Slax Reader browser extension: one-click saving, page archiving, and the in-page reading sidebar for Chrome and Edge, built on Manifest V3 with WXT and Vue 3.

## What belongs here

- The extension itself — background service worker, content scripts, in-page sidebar, popup, and options pages.
- Extension-local assets: icons, locales, and manifest configuration.
- Unit tests, kept next to the code they test.

## What does not belong here

- Code shared with another app or package (the selection and highlight engine, content parsing, utilities) — it goes in `packages/`.
- Cross-app end-to-end and integration tests — they go in `tests/e2e/`.

## Migration source

[`slax-lab/slax-reader-web`](https://github.com/slax-lab/slax-reader-web) — the extension currently lives at `apps/slax-reader-extensions` in that repository. There is no standalone extension repository today, so the extension and the web app will migrate out of the same source repository.

## Interim owner

@boxcounter — interim owner until a dedicated code owner is assigned. See `.github/CODEOWNERS`.
