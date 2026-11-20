## Why

Production API latency is dominated by two deployment-shape problems measured on the live Workers.

- **Database round trips cross oceans.** `reader-core` and `reader-ai` publish no placement, so they run beside the user while PostgreSQL (through Hyperdrive) lives in Singapore. Over 24 hours Core's median Worker wall time was 123 ms in SIN but 590–800 ms in LAX, FRA, SJC, SEA, LHR and IAD with equal CPU time. Smart Placement was intended but never published, and it cannot measure Hyperdrive's TCP traffic anyway.
- **Every Worker loads the whole backend.** The public Edge Worker, Core and AI each ship about 22 MiB of JavaScript plus 7 MB of WebAssembly, because each imports the complete dependency registration (133 classes and every heavy library), all Workflow classes, all Durable Object classes and the jieba tokenizer. Edge only authenticates and forwards, yet occasional requests wait an extra 1.3–1.8 s in front of a 0–7 ms Worker execution, which matches a cold start. A fetch-only Edge bundle measures 131 KiB with no WebAssembly.

## What Changes

- **Tiers that each bundle only their own code**:
  - **Edge** (public, near the user): CORS, JWT authentication, rate limiting, image proxy, cacheable responses, `ContentEntry`, and forwarding to Core or AI. No dependency registry, Prisma, Workflow, queue, cron, email or Durable Object code, and no WebAssembly.
  - **Core** (pinned near the primary database): the Reader HTTP API except AI routes, queue consumers, cron triggers, inbound email, all six Workflows (moved from Edge), and the stateful `VectorPreferenceObject` Durable Object.
  - **AI** (pinned near the primary database): AIGC, search, recommendation and vector/preference refresh routes plus the `AiEntry` vector RPC, with its own registry and without importing Core.
- **A new Objects Worker** hosts the stateless Durable Objects `SlaxJieba`, `ScreenshotBrowser` and `SlaxWebSocketServer`, so the jieba WebAssembly and puppeteer leave every other Worker. These classes are created fresh in Objects; their old Core namespaces are retained, not deleted, so no data transfer is needed.
- **Remove the deprecated MCP server**: `/v1/mcp/*`, `McpServerController`, the `SlaxMcpServer` Durable Object, its MCP-only domain method, and the `agents`, `@modelcontextprotocol/sdk` and `@modelcontextprotocol/inspector` dependencies are deleted. The live `SlaxMcpServer` namespaces received no requests in the seven days before this proposal. Their namespaces and stored sessions are deleted in the final transition step (`retire-mcp-v1`), which is irreversible; steps 1 to 3 delete nothing, and Core and Edge keep exporting an inert stub until then.
- **Per-tier registration**: the DI, router, consumer and cron generators emit one module set per tier containing only the classes that tier reaches. One route list decides which routes belong to AI, and a controller may not mix AI and Core routes.
- **Narrow AI services**: AI routes move to `BookmarkAiController` and `CollectionVectorController`, and call `BookmarkReadService`, `UserProfileService` and `BookmarkAiOrchestrator` instead of the full `BookmarkService` and `UserService` graphs. The full services delegate to the narrow ones, so each behavior has one implementation.
- **Startup-cost reductions**: the article extractor (`defuddle`) and newsletter MIME splitter (`@zone-eu/mailsplit`) load on first use; `moment-timezone` is replaced by `date-fns` and `zod` by a dependency-free attribution parser, both with unchanged results.
- **Fixed placement owned by the deployment script**: one constant (`aws:ap-southeast-1`) applies to Core, AI and Objects. Edge and Browser never receive placement. Placement in private configuration is rejected before any remote operation.
- **BREAKING (operators)**: each environment needs a new Worker identity `services.OBJECTS.service`, and existing installations run a one-time, documented transition that moves Workflow, queue, cron and email ownership from Edge to Core before normal releases resume.

Out of scope: moving search reads off PostgreSQL, D1 read-replica sessions for `DB_FULLTEXT`, server-side PDF parsing, transferring `VectorPreferenceObject`, and any HTTP contract change other than removing `/v1/mcp/*`.

## Capabilities

### New Capabilities

- `api-worker-topology`: Worker responsibilities, route ownership, per-tier bundle isolation, fixed execution locations, and the ownership transition rules that preserve Workflow instances, queue messages and Durable Object data.

### Modified Capabilities

- `api-command-interface`: the single deployment configuration gains the Objects Worker identity and per-tier generated configuration.
- `api-runtime-configuration`: runtime values are published to all five Workers instead of four.
- `api-release-deployment`: preserved identities include the Objects Worker, and no existing Durable Object namespace is deleted.
- `bookmark-ai-outline`: the pass-through requirement no longer lists the removed MCP bookmark-summary resource.

## Impact

- API entry points `apps/api/src/entry/{edge,core,ai}` and a new `apps/api/src/entry/objects`; Workflow classes move from `entry/edge/workflows` to `entry/core/workflows`; `screenshotBrowser.ts` moves to `entry/objects`.
- Generators `apps/api/script/gen-di.ts`, `gen-routers.ts`, `gen-consumer.ts`, `gen-cron.ts` and their output under `apps/api/src/di/generated/`.
- Deployment scripts `apps/api/script/deploy/{config,deploy,build,dev-local,setup-api}.ts`, `deploy/cloudflare/api.toml.example`, local dev ports, the API deploy workflow checks, and their tests.
- `apps/web` keeps its service binding on Edge's `ContentEntry`.
- API documentation under `docs/api/` (EN, CN, JP).
- Live environments: test, beta and production each gain an Objects Worker and run the transition once. State at risk: in-flight Workflow instances and queued messages during the consumer handover. MCP session data is deleted in the final transition step, which is irreversible; earlier steps delete nothing.
