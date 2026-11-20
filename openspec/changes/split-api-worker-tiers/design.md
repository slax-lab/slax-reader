## Context

See proposal.md for the measurements. Current state that constrains the design (verified against `origin/dev` and the live accounts):

- **Four Workers before this change**: Edge (public route `api-reader.slax.com`; legacy names `slax-read-backend`, `slax-read-backend-beta`, `reader-backend`), Core (`reader-core`), AI (`reader-ai`) and Browser (`browser-backend`, shared by beta and production). All are generated from one `api.toml` by `apps/api/script/deploy/config.ts`. Normal release order is browser → ai → core → edge.
- **Edge owns** the routes, `ContentEntry`, every queue consumer (18 production queues list `slax-read-backend` as consumer), cron triggers, inbound email and the six Workflow classes. `src/entry/edge/index.ts` imports the queue, cron and email handlers from `../core` and re-exports every Durable Object class, so Edge bundles the whole backend.
- **Durable Object namespaces exist in both Core and Edge.** In every environment, Core owns `SlaxJieba`, `SlaxWebSocketServer`, `ScreenshotBrowser` (key-value storage), `SlaxMcpServer` and `VectorPreferenceObject` (SQLite). Edge also owns older `SlaxJieba`, `SlaxWebSocketServer`, `ScreenshotBrowser` and `SlaxMcpServer` namespaces that no binding uses. Live migration tags differ: Core `vector-preference-v1`; Edge `v2` (production), `v3` (beta), `v4` (test). Over seven days, production Core `SlaxJieba` served 2,592 requests, `SlaxWebSocketServer` 3,368, `ScreenshotBrowser` 1,374 and `VectorPreferenceObject` 127,277; the `SlaxMcpServer` namespaces served none.
- **Durable Object storage**: `SlaxJieba` stores nothing; `SlaxWebSocketServer` keeps only socket attachments; `ScreenshotBrowser` uses only an alarm; `VectorPreferenceObject` reads legacy SQLite tables and moves them into D1.
- **Live Workflows** belong to the Edge script in each account; production `vector-v5-maintenance-workflow` had 8 running and 1 queued instance at inspection.
- **One DI module** `src/di/generated/dependency.ts` statically imports 133 classes. `initializeCore()` alone bundles to 17.9 MiB plus 3.4 MB of Prisma query compilers. Measured bundles: fetch-only Edge 131 KiB; `SlaxWebSocketServer` 260 KiB; `ScreenshotBrowser` 741 KiB; `SlaxJieba` 3.6 MiB (WebAssembly).
- **Data locations**: PostgreSQL (primary and logs) in Singapore through a Tunnel hostname; D1 `DB` in APAC; D1 `DB_FULLTEXT` primary in ENAM.
- Wrangler `^4.127.1`. Wrangler publishes queue consumers on deploy by `POST`ing a consumer for each configured queue, or `PUT`ting it when the same script already consumes it; it never removes another script's consumer.

## Goals / Non-Goals

**Goals:**
- Each Worker bundles only its own reachable modules, enforced by a test (spec: *Each Worker bundles only its own code*).
- Core, AI and Objects run beside PostgreSQL; Edge and Browser run beside the user.
- No loss of Workflow instances, queue messages or preference data, and no change to any live Durable Object migration history in Core or Edge.

**Non-Goals:**
- Changing HTTP contracts other than removing `/v1/mcp/*`, auth semantics, queue payloads or Workflow step logic.
- Moving search off PostgreSQL, D1 replica sessions, or PDF parsing changes.
- Transferring Durable Object namespaces between Workers, or upgrading Wrangler.
- Replacing the DI container.

## Decisions

### D1. Five Workers with fixed ownership

| Worker | Entry | Owns | Placement |
|---|---|---|---|
| Edge | `src/entry/edge/index.ts` | routes, `fetch` (CORS, JWT, rate limit, image proxy, cacheable), `ContentEntry` | none |
| Core | `src/entry/core/index.ts` | Reader HTTP router (non-AI), `queue`, `scheduled`, `email`, six Workflow classes, `VectorPreferenceObject` | `aws:ap-southeast-1` |
| AI | `src/entry/ai/index.ts` | AI router, `AiEntry` RPC | `aws:ap-southeast-1` |
| Objects | `src/entry/objects/index.ts` (new) | `SlaxJieba`, `ScreenshotBrowser`, `SlaxWebSocketServer` | `aws:ap-southeast-1` |
| Browser | `src/entry/browser/index.ts` | `SlaxBrowser` | none |

Queue, cron, email and Workflows go to Core because their bodies resolve the same domain services Core already loads and they talk to the database. A separate jobs Worker would duplicate most of Core's graph; it can be split later once per-tier sizes are measured.

The AI route list (`AI_ROUTES` in `src/const/routes.ts`) is the single source for Edge forwarding and router generation: `/v1/aigc/summaries`, `/v1/aigc/chat`, `/v1/bookmark/overview`, `/v1/bookmark/outline`, `/v1/bookmark/search`, `/v1/search`, `/v1/recommendations/articles`, `/v1/recommendations/collections`, `/v1/recommendations/feedback`, `/v1/bookmark/vector/refresh`, `/v1/bookmark/preference/refresh`, `/v1/collection/vector/refresh` and `/v1/collection/preference/refresh`.

### D2. Remove the MCP server

Delete `McpServerController`, `src/domain/orchestrator/mcp.ts`, `BookmarkService.getUserBookmarkSummaryByMCP`, the `MCP_OBJECT` binding, the `mcp:tool` script, the `agents`, `@modelcontextprotocol/sdk` and `@modelcontextprotocol/inspector` dependencies, MCP test mocks and the MCP row in the development documents. `zod` is removed later with the attribution parsers (D11).

The `SlaxMcpServer` namespaces are deleted with their stored sessions. Live state (read-only, 2026-11-20): six namespaces, on production `slax-read-backend`, `slax-read-backend-beta`, `reader-core`, `reader-core-beta` and test `reader-backend`, `reader-core`; beta and test Edge still bind `MCP_OBJECT` to Core. Cloudflare deletes a namespace only when the class is no longer exported and no other Worker binds it, so the deletion runs in transition step 4, after the slim Edge (no MCP binding) is live, Edge first and then Core.

The deletion tag is `retire-mcp-v1` with `deleted_classes = ["SlaxMcpServer"]`. Core's generated configuration appends it whenever the operator history creates the class and does not already delete it; Wrangler 4.127 applies only steps after the live tag (`vector-preference-v1`). Edge's legacy history (`v2`/`v3`/`v4`) is not in configuration, so Edge carries the single tag only in step 4: when the live tag is not listed, Wrangler applies every listed step, which here is only the deletion. Steps 2 and 3 publish wrapper entries (`src/entry/transition/{core,edge}.ts`) that still export the stub, so those steps stay reversible; normal entries no longer export `SlaxMcpServer`.

### D3. Per-tier generated registration

The generators emit per-tier modules:

- `src/di/generated/core/`: `dependency.ts`, `readerRouter.ts`, `consumer.ts`, `cronjob.ts`.
- `src/di/generated/ai/`: `dependency.ts`, `aiRouter.ts`.

`gen-routers.ts` splits routes by `AI_ROUTES`; a controller whose routes are split appears in both routers. `gen-di.ts` computes each tier's closure from roots and emits only those registrations and imports:

- **Core roots**: controllers with at least one non-AI route, every `@Consumer` and `@Scheduled` class, and classes named in `resolve(...)` calls inside `src/entry/core/**` (Workflows, email, content handler, preference object).
- **AI roots**: controllers with at least one AI route, and classes resolved inside `src/entry/ai/**`.

The closure follows constructor dependencies, including lazy ones and injection tokens. A token is mapped to its registry: `DatabaseRegistry` is included only when a closure class injects one of its tokens. Classes reached through `resolve(...)` inside shared files (`domain`, `utils`) are also followed. Objects needs no registry.

Shared layers MUST NOT import `src/di/generated/**`. `contentHandler.ts` and the Workflow bodies currently import `initializeInfrastructure`; they move under `src/entry/core` (Workflows) or receive the initialized scope from the entry (`contentHandler`). `VectorPreferenceObject` moves its registry import to the Core tier module, which it may import because it lives under `src/entry/core`.

*Alternative considered*: keep one registry and convert heavy libraries to dynamic `import()`. Rejected as the main mechanism: Wrangler uploads all chunks to every Worker regardless, and the rule depends on every contributor remembering it. Dynamic import stays allowed for rarely used libraries.

### D4. Edge without the DI graph

Edge keeps today's behavior with modules that do not import the registry: `cors`, `authToken`, `isWhitelisted`, `rateLimit`, `matchCacheableRequest`, `applyCacheHeaders`, `handleImageProxy`, `ContentEntry` and `forward`. API-key requests are already forwarded in `apikey` mode before any container use. Edge loses `queue`, `scheduled`, `email`, Workflow exports, Durable Object re-exports and the WebAssembly rule. Its generated configuration lists only the bindings this module set uses (`CORE`, `AIGC`, `OSS`, `BOOKMARK_ADD_RATE_LIMITER`, the event Pipeline) plus the retired Durable Object stubs described in D6.

### D5. Durable Object references by type only

`notification.ts`, `normalizer.ts`, `userController.ts` and `screenshotBrowser` callers keep `DurableObjectStub<T>` typing through `import type`. Objects' `fetch` returns not found; its classes are reached only through namespace bindings with `script_name = <objects>`.

### D6. Retired namespaces kept behind stubs

Cloudflare rejects a deploy that stops exporting a class whose namespace still exists unless the class is deleted, renamed or transferred. Deleting the jieba, WebSocket and screenshot namespaces would also discard live objects mid-request during the rollout. Instead, the Worker that owns a retired namespace exports a stub class of the same name (`src/entry/retired.ts`), a `DurableObject` subclass whose `fetch` returns 410 and which defines no other behavior. Stubs carry no imports beyond `cloudflare:workers`.

| Worker | Live classes | Stub classes | Deleted |
|---|---|---|---|
| Core | `VectorPreferenceObject` | `SlaxJieba`, `SlaxWebSocketServer`, `ScreenshotBrowser` (and `SlaxMcpServer` during steps 2–3) | `SlaxMcpServer` (step 4) |
| Edge | none | `SlaxJieba`, `SlaxWebSocketServer`, `ScreenshotBrowser` (and `SlaxMcpServer` during step 3) | `SlaxMcpServer` (step 4) |
| Objects | `SlaxJieba`, `SlaxWebSocketServer`, `ScreenshotBrowser` | none | none |

Migration ownership per Worker:

- **Core** keeps the operator's top-level `migrations` history and appends only `retire-mcp-v1` (D2).
- **Edge** generates no migrations, as today, except `retire-mcp-v1` in transition step 4.
- **Objects** gets its history from a constant in `config.ts`: `{ tag = "objects-v1", new_sqlite_classes = ["SlaxJieba", "SlaxWebSocketServer", "ScreenshotBrowser"] }`. SQLite-backed objects support the alarm and WebSocket hibernation these classes use, and no existing data needs a key-value backend.

Stubs are exported by both Core and Edge in every environment. In a fresh installation an exported class without a namespace has no effect.

### D7. Placement owned by the deployment script

`config.ts` defines `DATABASE_REGION = 'aws:ap-southeast-1'` and sets `placement = { region: DATABASE_REGION }` for core, ai and objects in remote output. Edge, browser and local output carry no placement. `validateConfig` rejects `placement` in the selected configuration before any remote operation. A region hint is used instead of `host` because production Hyperdrive reaches PostgreSQL through a Tunnel hostname, so a TCP probe would measure Cloudflare's edge, not the database. Smart Placement is not used because it measures only fetch subrequests.

### D8. Bundle isolation check

`build.ts` writes a Wrangler metafile per target (`--metafile`). `test/script/workerTopology.test.ts` reads them and asserts: Edge has no `.wasm`, no `@prisma/*`, no `src/di/generated/**`, no Workflow, no Durable Object implementation and no `src/entry/{core,ai,objects}/**`; Core and AI contain no `jieba`, `@cloudflare/puppeteer`, `agents` or `@modelcontextprotocol` module and no Objects entry module; AI contains no `src/di/generated/core/**`; Objects contains no `src/di/generated/**`. When metafiles are absent the test builds them first. Build output prints each target's `Total Upload`.

### D9. Transition for existing installations

`pnpm api -- topology:transition --step <1..4> [--dry-run]` runs per environment with the same configuration selection as `deploy`. Each step verifies the remote state it expects, is idempotent, and prints what it changed.

1. **Objects**: deploy the Objects Worker. Verify its three namespaces exist.
2. **Core and AI**: deploy AI, then Core with Durable Object bindings pointing at Objects, the stub classes, the six Workflows, queue consumers, cron triggers and the `email` handler. Before Core's deploy, the command removes each queue's Edge consumer and clears Edge's cron schedules through the Cloudflare API, then deploys Core immediately; the gap is the duration of one deploy and messages wait in the queue. Generated Edge configuration carries `triggers.crons = []` so later releases keep Edge's schedules empty. Wrangler's Workflow upsert reassigns each Workflow name to Core. Verify every queue's only consumer is Core, every Workflow's `script_name` is Core with unchanged instance counts, and running instances keep progressing.
3. **Edge**: deploy the slim Edge with stubs. The operator repoints the newsletter Email Routing rule from Edge to Core (the command prints the rule and target, and verifies after confirmation).
4. **Retire MCP and verify**: after checks of routes, `ContentEntry`, image proxy, an AI route, WebSocket upgrade, one queue round trip and one Workflow creation, require every ownership check to pass, publish Edge and then Core with `retire-mcp-v1`, and verify no `SlaxMcpServer` namespace remains. This is the only irreversible step.

Normal `deploy` checks the marker (Objects Worker exists; every Workflow and queue consumer belongs to Core) and stops with the transition instruction if it is missing. New installations deploy directly through `--bootstrap`.

*Alternative considered*: fold the transition into normal releases. Rejected: the queue handover and email-rule change need an attended run and verification between steps.

## Risks / Trade-offs

- **Workflow reassignment** → Workflows are account-scoped resources with a mutable `script_name`; Wrangler's deploy upserts them. Step 2 runs on the test account first and checks instance counts and progress before continuing. If reassignment is rejected, the fallback (keep Workflow ownership on the Edge script name in a dedicated Worker) requires a design update before beta.
- **Queue delivery pause in step 2** → bounded by one Core deploy; messages are retained.
- **Stub classes receive traffic during rollout** → between Core's and Edge's deploys an older Worker version could address a stub. Every caller is deployed with bindings to Objects before any stub replaces a live implementation in the same Worker, and stubs return 410 so a stale caller fails loudly rather than silently.
- **`DB_FULLTEXT` in ENAM** → search queries from Singapore cross the Pacific once per fulltext query; measured before and after, handled in a later change.
- **Generator misses a lookup** → a test boots each tier container and resolves every route controller, consumer, cron job and Core entry root; a missing provider fails it.

## Migration Plan

1. Merge with the topology marker check, so releases to untransitioned environments stop with instructions.
2. Run the transition on the test account, then the acceptance checks.
3. Repeat on beta, then production, in low-traffic windows.

**Rollback**: before step 2, delete nothing; redeploy previous versions with `wrangler rollback`. After step 2, roll back by re-adding Edge's queue consumers and cron triggers and redeploying the previous Edge with its Workflow bindings, in reverse order. No Durable Object namespace is deleted, so rollback never loses object data.

## Open Questions

- Objects Worker names default to `reader-objects`, `reader-objects-beta` and `reader-objects-dev`, and are set through `services.OBJECTS.service` in each private configuration.

## Addendum: narrow AI services and startup-cost reductions

Measured after the tier split, the AI bundle still carried most of Core's graph, because the AI routes lived in `BookmarkController` (37 routes, 12 injected services) and `CollectionController`, and called through `BookmarkService` (15 dependencies) and `UserService` (13 dependencies). Tracing every AI route to its repository calls showed they need only bookmark reads, R2 content, tags, Gemini and the user profile.

### D10. Narrow AI controllers and services

- `BookmarkAiController` (`/v1/bookmark`: search, overview, outline, vector refresh, preference refresh) and `CollectionVectorController` (`/v1/collection`: vector and preference refresh) take the AI routes with method bodies unchanged.
- `BookmarkReadService` holds the read and AI-artifact methods (read access, ID resolution, content, title/content, summary, outline, overview, batch tasks). `UserProfileService` holds `getUserInfo`, `getUserSubscriptionInfo` and `userSubscriptionInfo`. `BookmarkAiOrchestrator` holds the overview and outline streams.
- `BookmarkService` and `UserService` keep their public methods and delegate to the narrow services, so callers, tests and behavior are unchanged and there is one implementation of each method.
- `gen-routers.ts` fails when a controller has both AI and Core routes, because the generator can only split at class boundaries.

*Alternative considered*: route-level lazy resolution in the generated router. Rejected: it changes instantiation for every class and the measured gain overlaps with D11.

### D11. Startup-cost reductions

Startup CPU, measured with `wrangler check startup` (Wrangler 4.165) on minified bundles, median of 7 runs on one machine (absolute values differ on Cloudflare; comparisons hold):

| Worker | `origin/dev` | After this change | Upload |
|---|---|---|---|
| Edge | 262 ms | 24 ms | 16 MiB → 89 KiB |
| Core | 233 ms | 96 ms | 16 MiB → 9.9 MiB |
| AI | 272 ms | 68 ms | 16 MiB → 5.9 MiB |
| Objects | n/a | 23 ms | 4.0 MiB |

These are the final-code measurements recorded in `validation.md`; earlier intermediate runs are superseded.

- `defuddle` (16 ms of Core startup on its own) is imported inside `defuddleParse`; `slaxReadability` becomes async so a Defuddle rejection still falls back to Readability. `ContentParser` is imported inside `AigcService.chatToolBrowser`.
- `@zone-eu/mailsplit` (with iconv-lite and encoding-japanese, about 0.7 MB) is imported inside `readNewsletterMime`.
- `moment-timezone` (716 KB, three call sites) is replaced by `parsePublishedTime` (`date-fns` `parseISO`, then the platform parser) and `date-fns` `format`. The two were compared on 27 inputs in three time zones with no difference.
- `zod` (333 KB, one schema set) is replaced by `parseWebAuthAttribution` / `parseAppleAuthAttribution`, compared with the zod schemas on 31 inputs, including unknown-key stripping and first-match order, with no difference.
- `unpdf` stays a dynamic import inside `utils/pdf.ts`; it costs upload size but no startup time. Moving PDF parsing out of Core is a separate change.
