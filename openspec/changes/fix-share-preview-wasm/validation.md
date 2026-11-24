## 2026-11-24

Built the full Web application with the production profile and synthetic public configuration from an isolated checkout of `origin/dev`. The Pages smoke harness staged the actual `dist` output and ran its Worker modules with the pinned Wrangler workerd runtime. The content service supplied a public article with an empty cover and R2 supplied its text-only HTML body.

- Before the fix, the real `/b/` route returned HTTP 200 with the fixture content and an `og:image` URL under `/_og/d/`. Fetching that URL returned HTTP 500. The runtime logged `Top-level await in module is unsettled` at the Satori initialization chunk.
- After the fix, the full build emitted a static import of the packaged Yoga WASM module. The same smoke scenario returned HTTP 200 with `Content-Type: image/png` and passed the PNG signature check. The root page and bookmarks shell also rendered in the same runtime.
- `SLAX_TEST_PAGES_BUILD=1 node --test tooling/web-pages-deploy.test.mjs tooling/web-pages-workflow.test.mjs` passed all 39 tests.
- `SLAX_TEST_PAGES_BUILD=1 pnpm test:preflight` passed all 153 tests, including staging and running the Pages output.
- `pnpm web -- typecheck` and the contracts and selection type checks passed.
- `pnpm web -- test` exited successfully with 3,377 passing tests and 3 skipped.
- `pnpm exec openspec validate --all --strict` passed all 173 items.

The smoke run used local workerd and synthetic service bindings. Cloudflare publication and live social crawler behavior are pending deployment. The Worker continues to render the existing share-card template.

### Pull request verification

Rebuilt the production and preview profiles through `node tooling/web-pages-deploy.mjs build`, with synthetic release settings for `main` and `dev`. Both compiled Workers statically imported Yoga WASM and passed all 39 Pages deployment and workflow tests, including the text-only article and PNG requests. The opt-in preflight suite passed all 153 tests against the preview build. The local Bugs, Security, and Compliance review found no Important issues.
