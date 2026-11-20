# Cloudflare API deployment

Maintain one public template: `deploy/cloudflare/api.toml.example`. Run `pnpm api -- config:init` at the root to create ignored `api.toml`. Dev, build, deploy and runtime types use that actual file and fail if missing. Separate installations can explicitly select their own ignored file with `build/deploy --config <root-relative-path>`; use distinct resource names.

1. Install dependencies, configure api.toml, set both Prisma URLs and Cloudflare tool credentials in deploy/local/.env (automatically loaded) and run `pnpm api -- gen:all`. Placeholder URLs are only suitable for generation.
2. Use native Wrangler name, services and [env.*], without custom [workers.*] tables. Core uses the selected name; AI and Browser use AIGC/VECTOR and SlaxBrowser service names. An optional EDGE service selects the public Worker name and an optional OBJECTS service selects the Objects Worker name (default: the Core name with `reader-core` replaced by `reader-objects`). Set environment-specific API/frontend/image/PowerSync URLs; remote API origin must be real HTTPS. Only Edge exposes HTTP.
3. Provision D1, KV, R2, queues, five 1024-dimensional cosine Vectorize indexes, PostgreSQL/Hyperdrive and PowerSync. `resources` is a local plan; `--apply` creates missing resources with your account/token and reports IDs. It does not provision Hyperdrive, databases or external services. Deploy or supply the template's external `fxembed` service (`SlaxTwitterFxembed`). Your account needs access to these products, including Browser Rendering.
4. Keep logical binding names while customizing physical names. Queue roles use native producer bindings and the IMPORT_OTHER consumer dead_letter_queue relationship. Source configuration is never rewritten. Isolate queue and Workflow names between environments.
5. Existing installations must preserve their Worker identities, resource IDs and DO migration tags/classes. Never replace production history with the example. Apply remote D1/fulltext and PostgreSQL/logs migrations separately after checking database targets; commands are listed in the development guide.
6. For merged releases, maintain runtime values and credentials in `[vars]` of the private environment TOML. All five Workers receive those values during normal deployment; Edge/Core/AI share the same EDGE_SHARED_SECRET. Configure JWT, Hashids, payment, OAuth, model and PowerSync credentials as required by `apps/api/worker-configuration.d.ts`. Local development can continue using ignored `deploy/local/.dev.vars`. Real credentials must never enter the public template or source repository. Set provider callback URLs to your own origin.

```bash
pnpm api -- build
pnpm api -- deploy --dry-run
pnpm api -- resources                 # plan only
pnpm api -- resources --apply         # creates remote resources
pnpm api -- deploy --bootstrap        # NEW installation only
pnpm api -- deploy                    # subsequent updates
pnpm api -- deploy edge               # update one existing Worker
pnpm api -- topology:transition --step 1 --dry-run   # once per existing installation, see below
```

`build` bundles all five Workers offline (minified) with temporary config and an empty env file, leaving active generated configs intact, and writes a `bundle-<worker>.meta.json` metafile per Worker. `deploy --dry-run` only generates `.generated/` files and never contacts Cloudflare. Do not maintain generated files manually.

For a new installation, bootstrap deploys Browser → Objects → Core without service/Workflow bindings → AI → Edge → Core with complete bindings, Workflows, queue consumers and cron triggers. Normal releases publish Browser → Objects → AI → Core → Edge. Retry bootstrap after an interrupted first deployment. Existing installations use normal deploy; bootstrap is not a normal update procedure. Deployment, secrets, resource creation and remote migrations are real cloud operations requiring explicit authorization when performed by agents.

## Worker topology

| Worker | Placement | Owns |
|---|---|---|
| Edge (public) | none, runs near the user | HTTP entry: CORS, cache, image proxy, authentication and forwarding to Core or AI; `ContentEntry` |
| Core | `aws:ap-southeast-1` | Reader routes outside `AI_ROUTES`, queue consumers, cron triggers, newsletter email, the six Workflows and `VectorPreferenceObject` |
| AI | `aws:ap-southeast-1` | the routes listed in `apps/api/src/const/routes.ts` (`AI_ROUTES`: AIGC, overview/outline, search, recommendations, vector refresh) and the `AiEntry` vector RPC |
| Objects | `aws:ap-southeast-1` | the `SlaxJieba`, `SlaxWebSocketServer` and `ScreenshotBrowser` Durable Objects; no HTTP |
| Browser | none | `SlaxBrowser` (unchanged) |

`apps/api/script/deploy/config.ts` owns placement through `DATABASE_REGION`, the region nearest the primary PostgreSQL database. A `[placement]` table in the private configuration is rejected before any remote operation. Core and Edge keep their old `SlaxJieba`, `SlaxWebSocketServer` and `ScreenshotBrowser` namespaces behind stub classes that answer 410 (`apps/api/src/entry/retired.ts`), so that data is never deleted. The MCP Server was removed and its `SlaxMcpServer` namespaces are deleted with their stored sessions: Core's generated configuration appends `retire-mcp-v1` (`deleted_classes = ["SlaxMcpServer"]`) whenever the private migration history created that class, and transition step 4 applies it to Edge and Core. Objects declares its own migration tag `objects-v1`.

## Five-Worker transition (existing installations)

Normal `deploy` reads the account (Workers, Workflows, queues, cron schedules, Durable Object namespaces) and stops before publishing when Objects, AI or Core is missing, a Workflow or queue consumer still belongs to Edge, Edge still has cron schedules, or a `SlaxMcpServer` namespace remains. Run the transition once per installation, test account first, then beta, then production in a low-traffic window. It uses `CLOUDFLARE_API_TOKEN` (Workers Scripts, Queues, Workflows and Durable Objects edit) or the `wrangler login` token, and the same `--config`/`--env` selection as `deploy`. Every step reads state first, can be repeated, and supports `--dry-run`. Steps 1 to 3 delete nothing; Core and Edge keep exporting the MCP stub (`src/entry/transition/`) until step 4.

Values move with the code. Deploys use `--keep-vars`, so a secret set with `wrangler secret put` stays only on the script that had it. `apps/api/script/deploy/runtimeKeys.ts` lists the string variables and secrets each Worker's code reads (a test re-derives it from the bundles). Before steps 1 to 3 publish, and before every normal release, the command lists by name any key a Worker reads that another API Worker of the installation holds but neither that Worker nor the selected `[vars]` provides, and stops. Cloudflare never returns a secret's value, so it cannot be copied from the old Edge; supply the values in a file you hold (a password-manager export or the original `.env`, outside the repository or under the ignored `deploy/local/`) and run the commands below. The file is either `.env` or JSON: `{"KEY": "value"}` or `[{"name": "KEY", "value": "value"}]` (`key` is accepted too); numbers and booleans upload as strings, and content starting with `{` or `[` is read as JSON. A file that cannot be read is reported by position, key names and value types, never by value:

```bash
pnpm api -- secrets:sync --from ~/slax-secrets/prod.env --dry-run   # lists Worker and key names only
pnpm api -- secrets:sync --from ~/slax-secrets/prod.env             # uploads with wrangler secret bulk
```

It uploads to each Worker only the keys its code reads that another API Worker holds but it lacks, never overwrites an existing secret, passes values to Wrangler on stdin (never on a command line, in a file or in logs), skips Workers not deployed yet, and fails while a needed key is absent from the file. Run it before step 1 for Core and AI, and again after step 1 for Objects. Values may instead go to `[vars]` of the private configuration. A read-only check on 2026-11-20 found `DEEPSEEK_API_KEY` only on the old Edge in production and beta (read by the YouTube article and podcast Workflows, which move to Core, and by AI), and 17 Core and 5 AI keys only on the old Edge in the test account. Keys no Worker holds are unconfigured optional features and are not reported.

1. `--step 1` publishes Browser and Objects. Verify the three Objects namespaces exist.
2. `--step 2` publishes AI, removes each queue's Edge consumer, clears Edge's cron schedules, then publishes Core with the Workflows, consumers, cron triggers and Durable Object bindings to Objects. Messages wait in their queues for the length of one deploy. It fails unless every Workflow and queue consumer belongs to Core afterwards, and prints Workflow ownership before and after. Check running instances keep progressing.
3. `--step 3` publishes the slim Edge. Then repoint the newsletter Email Routing rule from Edge to Core in the dashboard.
4. Check routes, `ContentEntry`, the image proxy, an AI route, a WebSocket upgrade, one queue round trip and one Workflow creation on the slim Edge. Then `--step 4` requires every ownership check to pass, publishes Edge and then Core with `retire-mcp-v1`, and verifies no `SlaxMcpServer` namespace remains. This step is irreversible: it permanently deletes the stored MCP sessions. Edge goes first because Cloudflare refuses to delete Core's namespace while a Worker still binds to it. If the private Core history does not record the `SlaxMcpServer` class, add it as the tag Cloudflare reports (for example `{ tag = "v2", new_sqlite_classes = ["SlaxMcpServer"] }`) before step 4, so Wrangler appends only the deletion.

Rollback: before step 2, redeploy previous versions with `wrangler rollback`. After step 2 and before step 4, re-add Edge's queue consumers and cron triggers, redeploy the previous Edge (which still declares the Workflows) and then the previous Core, and point Email Routing back to Edge; no namespace has been deleted, so no object data is lost. After step 4 the MCP namespaces are gone and Wrangler refuses to roll back past that deploy; the other topology changes can still be reversed as above with versions that do not export `SlaxMcpServer`.

This is a Cloudflare Workers runtime, not a Docker-hosted Node API. Offline builds and local tests do not verify cloud resource permissions, secrets or third-party integrations. Validate authentication, bookmarks, queues, provider callbacks and sync after deployment.

The configured frontend origin also controls credentialed events CORS, image Referer checks and share shortcuts. Screenshots use IMAGE_PREFIX and notification icons use FRONT_END_URL. End the image prefix with `/` and point it to your image service. Remote deployment requires `RUN_ENV = "prod"` to disable development endpoints and enable production checks; `RUN_TYPE` identifies dev/beta/prod. Stripe credentials select test or live API mode; configure the Stripe key and its matching webhook signing secret. Signed callbacks are processed in either mode without a separate mode environment variable.

## Full development startup and external CI configuration

After preparing development resources and environment files, run `pnpm api -- setup`; `setup --check` performs local prerequisite checks only. Setup performs Wrangler login, initializes dependencies, applies migrations and generates code, then exits. Run `pnpm api -- dev` separately to start Workers. Vectorize/AI still require cloud resources. All tools honor `SLAX_API_CONFIG` (absolute or repository-root relative); types also accepts `--config`.

Merged PRs targeting `dev`, `beta`, and `main` with API-related changes trigger the single `.github/workflows/api-deploy.yml` workflow. Dev retains the legacy test installation; beta and production retain their shared production databases and Browser Worker. Real configuration and runtime credentials come from the selected private TOML at a resolved revision; deployment access credentials use environment-scoped Actions Secrets, and private tool output is captured. Routine CI applies PostgreSQL/logs and remote D1/fulltext migrations before normal Worker publication, with shared production locking and owned-access cleanup. There is no manual deployment trigger or routine bootstrap input. See the [merged-release and private CI configuration guide](DEV-AND-CI-EN.md) for prerequisites, schemas, confidentiality, retry and recovery, and [Docker adapter research (Chinese)](DOCKER-ADAPTER-RESEARCH-CN.md) for background.
