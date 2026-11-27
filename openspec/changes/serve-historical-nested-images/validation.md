# Verification

## Proposal-stage evidence

- Base: `origin/dev` at `de3803c3`, isolated branch `fix/serve-historical-nested-images`. `pnpm exec openspec validate --all --strict`: 195 passed, 0 failed. `openspec status --change serve-historical-nested-images`: 4/4 planning artifacts complete. These results validate the plan, not the endpoint.
- The earlier `optimize-public-article-lcp/validation.md` documents 11 double-wrapped images in one captured X article, including a direct inner 200 with the Reader Referer, inner 403 with the X Referer, and outer 302. The change requester reported 160 matching upstream 403 log lines for November 20–27, 2026. No production request or log query was issued for this proposal. The RSS signer exists; production double-wrapped RSS data has not been established.
- Source trace: `apps/api/src/entry/edge/index.ts:35` calls the image handler before applying cache headers. `apps/api/src/middleware/cacheHeaders.ts:4` skips non-200s. The failure branch at `apps/api/src/handler/http/imageProxy.ts:115` neither writes R2 nor calls `cache.put`. Its 302 uses `apps/api/src/utils/responseUtils.ts:42`, which applies `apps/api/src/middleware/cors.ts:14` (`public, max-age=31536000`). An external cache can retain this response even though the Worker cache did not store it. Detailed targeted invalidation guidance is in `design.md`; no external cache state was inspected or changed.
- Android `SlaxImageRegistry.kt:174` and iOS `SlaxImageRegistry.swift:197` validate each redirect via `imageOriginal`. Fixing the original response avoids a new client hop.

## Implementation verification

- Red first: `pnpm api -- test test/handler/http/imageProxy.test.ts -t 'historical nested image proxy'` before the handler edit: both expected 200 cases failed (ordinary 302, RSS 502); 12 controls passed. After the edit, all 64 handler tests passed. A synthetic upstream only returned the expected bytes for the original source and its inner signed Referer.
- `pnpm api -- test test/handler/http/imageProxy.test.ts test/handler/http/imageProxy.runtime.test.ts test/utils/imageProxyReuse.test.ts test/script/layerArchitecture.test.ts`: 125 tests passed in four files.
- Running environment: Miniflare started real workerd with local R2, the native Cache API and the production image handler/cache middleware. Through its HTTP listener, independently signed direct and double-wrapped GETs (redirect following disabled) returned identical fixture bytes `native-r2-image`, status 200, `image/png`, no Location, and `public, max-age=2592000, immutable` in both ordinary and RSS modes. This exercises the Worker, not a production CDN, a native client, or a live X image. The production salt and stored bookmarks were not accessed.
- `pnpm api -- typecheck` passed after `pnpm api -- gen:model` with inert PostgreSQL fixture URLs. `pnpm api -- lint`: 0 errors, 317 warnings. `pnpm api -- build --config <worktree>/deploy/cloudflare/api.toml.example`: all six Worker dry-run bundles passed. `pnpm exec openspec validate --all --strict`: 195 passed, 0 failed.

- Full API suite: after Prisma generation, the default parallel run had six failing non-proxy suites (four hook timeouts and two assertion failures). With no source changes or test exclusions, `pnpm api -- test --maxWorkers=2` passed: 4,602 passed, 166 skipped, 0 failures across 309 files (259.35 seconds).

## Local pre-push review

- **Bugs:** Checked the one-layer bound, inner cache and R2 identity, source encoding and upstream Referer; the existing failure, MIME and range paths remain in use.
- **Security:** Outer admission precedes cache reads. The inner checks require an exact configured origin/path, mode, signed fields, digest and public final target. No new network client, dependency, secret, redirect or allowlist exception.
- **Compliance:** Change `serve-historical-nested-images` modifies only endpoint delivery, not generation, stored HTML or client policies. The code stays in the existing handler and calls the original storage/fetch pipeline. No Important findings. No deployment, production purge or R2 rewrite was performed.
