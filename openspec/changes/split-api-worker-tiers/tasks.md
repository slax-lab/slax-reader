## 1. Proposal Review

- [x] 1.1 Obtain the change requester's direction on the topology (plan A: stateless Durable Objects in a new Objects Worker, search routes in AI, MCP removed) in the conversation before editing runtime code.

## 2. MCP removal

- [x] 2.1 Delete `McpServerController`, `src/domain/orchestrator/mcp.ts`, `BookmarkService.getUserBookmarkSummaryByMCP`, the `MCP_OBJECT` binding and env type, the `mcp:tool` script, and the `agents`, `@modelcontextprotocol/sdk` and `@modelcontextprotocol/inspector` dependencies; remove MCP mocks from tests and the MCP row from the development documents. Verify with `pnpm api -- gen:all`, typecheck, and a router test showing `/v1/mcp/sse` returns the existing not-found response.

## 3. Per-tier registration

- [x] 3.1 Add `AI_ROUTES` in `src/const/routes.ts` and make `gen-routers.ts` emit `src/di/generated/core/readerRouter.ts` and `src/di/generated/ai/aiRouter.ts`. Verify with a test that every route previously generated appears in exactly one tier with unchanged method, middleware order and handler.
- [x] 3.2 Make `gen-di.ts` emit `src/di/generated/{core,ai}/dependency.ts` from the D3 roots and closure rules, and move `gen-consumer.ts` / `gen-cron.ts` output under `core/`. Verify with a generator test that each tier contains its roots and excludes known foreign classes (AI excludes `CrawlService`, `NewsletterService`; Core excludes `AigcService` when only AI routes use it).
- [x] 3.3 Remove `src/di/generated/**` imports from shared layers (`contentHandler.ts`, Workflow bodies) by moving Workflows under `src/entry/core/workflows/` and passing the initialized scope into `contentHandler`. Verify with `pnpm api -- test test/script/layerArchitecture.test.ts` and a new rule that only `src/entry/<tier>/**` imports `src/di/generated/<tier>/**`.
- [x] 3.4 Add a test that boots each tier container with synthetic bindings and resolves every route controller, consumer, cron job and Core entry root. Verify it fails when a provider is removed.

## 4. Worker entries

- [x] 4.1 Rewrite `src/entry/edge/index.ts` to the D4 module set (fetch and `ContentEntry` only, stubs exported). Verify with the existing Edge, content-entry, security-boundary and cacheable-route tests.
- [x] 4.2 Export the six Workflows and the `queue`, `scheduled` and `email` handlers from the Core entry using the Core registry, with stubs for the retired classes and `VectorPreferenceObject` live. Verify with the Workflow, queue, cron and newsletter tests.
- [x] 4.3 Rewrite `src/entry/ai/index.ts` to serve the AI router and `AiEntry` from the AI registry without importing Core. Verify with the AI entry, AIGC, search, recommendation and vector RPC tests.
- [x] 4.4 Create `src/entry/objects/index.ts` exporting `SlaxJieba`, `ScreenshotBrowser` (moved from `entry/core`) and `SlaxWebSocketServer`, with a not-found `fetch`, and `src/entry/retired.ts` with the stubs. Verify with the screenshot, jieba and WebSocket tests and a stub test returning 410.
- [x] 4.5 Convert every non-owner runtime import of a Durable Object class into `import type`. Verify with typecheck and 5.1.

## 4A. Narrow AI services and startup cost

- [x] 4A.1 Move the AI routes into `BookmarkAiController` and `CollectionVectorController`, extract `BookmarkReadService`, `UserProfileService` and `BookmarkAiOrchestrator`, and keep `BookmarkService` / `UserService` delegating. Verify the generated routers equal `origin/dev`'s routes minus MCP (148 = 135 Core + 13 AI, same order) and that the AI registry holds no capture, Passkey, Telegram, Stripe, Redis or queue classes.
- [x] 4A.2 Make `gen-routers.ts` reject a controller with both AI and Core routes. Verify with a generator test.
- [x] 4A.3 Lazy-load `defuddle`, `@zone-eu/mailsplit` and `ContentParser` in the AI chat tool; keep the Readability fallback. Verify with the parser-selection tests including a rejected Defuddle parse.
- [x] 4A.4 Replace `moment-timezone` with `parsePublishedTime` and `date-fns`, and `zod` with the attribution parser; remove both dependencies. Verify with equivalence runs against the old libraries and unit tests.
- [x] 4A.5 Record per-Worker upload size and median startup CPU against `origin/dev` in `validation.md`.

## 5. Bundle isolation

- [x] 5.1 Emit per-target metafiles from `build.ts` and add `test/script/workerTopology.test.ts` enforcing D8, printing each target's `Total Upload`. Verify it passes and fails when Edge imports the Core entry.

## 6. Deployment configuration

- [x] 6.1 Add the `objects` target (`services.OBJECTS.service`, distinct-name validation), per-target bindings, Durable Object binding targets, stubs, triggers and consumers per D1, D4 and D6. Verify with `deployPaths.test.ts` cases per target and rejection of a missing or duplicate Objects identity.
- [x] 6.2 Add `DATABASE_REGION` placement for Core, AI and Objects (remote only) and reject private `placement`. Verify with tests per target, local mode and both rejection locations.
- [x] 6.3 Generate migrations per D2 and D6: Core keeps the operator history and appends `retire-mcp-v1` when that history created `SlaxMcpServer`; Objects uses `objects-v1`; Edge emits only `retire-mcp-v1`, in transition step 4. Verify with generated-configuration tests per phase and a Wrangler dry run of each phase.
- [x] 6.4 Update `deploy.ts` order (browser → objects → ai → core → edge), bootstrap order, dev ports (Objects 8790), `dev-local.ts`, `setup-api.ts`, `parseArgs` and the topology marker check. Verify with `devLocal`, `devPortGuard`, `setupApi`, `rootDeployment`, `rootCommands` and a marker test against a stubbed API.
- [x] 6.5 Implement `topology:transition` per D9 with `--dry-run`, deleting the MCP namespaces in step 4 (Edge, then Core) and treating a remaining namespace as an incomplete transition. Verify each step's plan and failure handling against a stubbed Cloudflare API.
- [x] 6.6 Update `deploy/cloudflare/api.toml.example`, `.github/workflows/api-deploy.yml` identity assertions and `tooling/preflight.mjs` where they enumerate Workers. Verify with `node --test tooling/*.test.mjs` and the Web backend-binding test.

## 7. Documentation

- [x] 7.1 Update `docs/api/CLOUDFLARE-DEPLOY-*.md`, `DEV-AND-CI-*.md` and `DEVELOPMENT-DOCUMENT-*.md` (EN, CN, JP) with the five-Worker topology, placement ownership, local ports, MCP removal and the transition runbook with rollback.

## 8. Verification

- [x] 8.1 Run `pnpm api -- gen:all`, API lint, typecheck, the full API test suite, `layerArchitecture`, the tooling tests and `openspec validate --all --strict`. Record results and per-target bundle sizes in `validation.md`.
- [ ] 8.2 Run the local five-Worker session and exercise an authenticated Reader route, an AI route, an API-key route, the image proxy, Web `ContentEntry`, `/v1/mcp/sse` (not found), a queue message, a cron tick, a newsletter email, a crawl Workflow, a screenshot, a jieba-backed search and a preference refresh. Record evidence in `validation.md`.
- [ ] 8.3 With operator authorization, run the transition on the test account, repeat 8.2 against it, confirm Workflow counts and progress, queue consumers and the deleted MCP namespaces, and compare per-colo Core wall time before and after. Record evidence in `validation.md`.
- [ ] 8.4 Complete the three-pass local review in `REVIEW.md`, then ask the change requester whether to increment affected application versions before opening the task pull request.
