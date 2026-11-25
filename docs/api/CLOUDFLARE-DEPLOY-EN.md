# Cloudflare API deployment

Maintain one public template: `deploy/cloudflare/api.toml.example`. Run `pnpm api -- config:init` at the root to create ignored `api.toml`. Dev, build, deploy and runtime types use that actual file and fail if missing. Separate installations can explicitly select their own ignored file with `build/deploy --config <root-relative-path>`; use distinct resource names.

1. Install dependencies, configure api.toml, set both Prisma URLs and Cloudflare tool credentials in deploy/local/.env (automatically loaded) and run `pnpm api -- gen:all`. Placeholder URLs are only suitable for generation.
2. Use native Wrangler name, services and [env.*], without custom [workers.*] tables. Core uses the selected name; AI and Browser use AIGC/VECTOR and SlaxBrowser service names. An optional EDGE service selects the public Worker name and an optional OBJECTS service selects the Objects Worker name (default: the Core name with `reader-core` replaced by `reader-objects`). Set environment-specific API/frontend/image/PowerSync URLs; remote API origin must be real HTTPS. Only Edge exposes HTTP.
3. Provision D1, KV, R2, queues, five 1024-dimensional cosine Vectorize indexes, PostgreSQL/Hyperdrive and PowerSync. `resources` is a local plan; `--apply` creates missing resources with your account/token and reports IDs. It does not provision Hyperdrive, databases or external services. Deploy or supply the template's external `fxembed` service (`SlaxTwitterFxembed`). Your account needs access to these products, including Browser Rendering.
4. Keep logical binding names while customizing physical names. Queue roles use native producer bindings and the IMPORT_OTHER consumer dead_letter_queue relationship. Source configuration is never rewritten. Isolate queue and Workflow names between environments.
5. Existing installations must preserve their Worker identities, resource IDs and DO migration tags/classes. Never replace production history with the example. Apply remote D1/fulltext and PostgreSQL/logs migrations separately after checking database targets; commands are listed in the development guide.
6. For merged releases, maintain runtime values and credentials in `[vars]` of the private environment TOML. All six Workers receive those values during normal deployment; Edge, Core, AI and Vector share the same EDGE_SHARED_SECRET. Configure JWT, Hashids, payment, OAuth, model and PowerSync credentials as required by `apps/api/worker-configuration.d.ts`. Local development can continue using ignored `deploy/local/.dev.vars`. Real credentials must never enter the public template or source repository. Set provider callback URLs to your own origin.

```bash
pnpm api -- build
pnpm api -- deploy --dry-run
pnpm api -- resources                 # plan only
pnpm api -- resources --apply         # creates remote resources
pnpm api -- deploy --bootstrap        # NEW installation only
pnpm api -- deploy                    # subsequent updates
pnpm api -- deploy edge               # update one existing Worker
pnpm api -- secrets:sync --from ~/slax-secrets/prod.env --dry-run   # before a release that adds a Worker, see below
```

`build` bundles all six Workers offline (minified) with temporary config and an empty env file, leaving active generated configs intact, and writes a `bundle-<worker>.meta.json` metafile per Worker. `deploy --dry-run` only generates `.generated/` files and never contacts Cloudflare. Do not maintain generated files manually.

For a new installation, bootstrap deploys Browser → Objects → Vector → AI → Edge with a Core stripped of service/Workflow bindings published before AI, then Core with complete bindings and Workflows. Normal releases publish Browser → Objects → Vector → Core → AI → Edge. Retry bootstrap after an interrupted first deployment. Existing installations use normal deploy; bootstrap is not a normal update procedure. Deployment, secrets, resource creation and remote migrations are real cloud operations requiring explicit authorization when performed by agents.

## Worker topology

| Worker | Placement | Owns |
|---|---|---|
| Edge (public) | none, runs near the user | HTTP entry: CORS, cache, image proxy, authentication and forwarding to Core or AI; `ContentEntry`; the queue consumers, cron triggers and Email Routing target, each forwarded unchanged to Core's internal `jobs.internal` host |
| Core | `aws:ap-southeast-1` | Reader routes outside `AI_ROUTES`; the queue, cron and newsletter email handlers, run through the internal `jobs.internal` host; the six Workflows and `VectorPreferenceObject` |
| AI | `aws:ap-southeast-1` | the routes listed in `apps/api/src/const/routes.ts` (`AI_ROUTES`: AIGC, overview/outline, search, recommendations, vector refresh) and the `AiEntry` vector RPC |
| Objects | `aws:ap-southeast-1` | the `SlaxJieba`, `SlaxWebSocketServer` and `ScreenshotBrowser` Durable Objects; no HTTP |
| Vector | `aws:us-east-1` | the semantic step of untagged `/v1/bookmark/search` (query embedding, one V5 article query with values, mean-centered scores), served on the internal `vector.internal/search` host to AI's `VECTOR_SEARCH` binding; binds only `VECTOR_V5_ARTICLE`, no route |
| Browser | none | `SlaxBrowser` (unchanged) |

`apps/api/script/deploy/config.ts` owns placement through `DATABASE_REGION`, the region nearest the primary PostgreSQL database. A `[placement]` table in the private configuration is rejected before any remote operation. Core and Edge keep their old `SlaxJieba`, `SlaxWebSocketServer` and `ScreenshotBrowser` namespaces behind stub classes that answer 410 (`apps/api/src/entry/retired.ts`), so that data is never deleted. The MCP Server was removed and its `SlaxMcpServer` namespaces are deleted with their stored sessions: the release adds `retire-mcp-v1` (`deleted_classes = ["SlaxMcpServer"]`) to Edge and Core while the account still has such a namespace (see below), so the private migration history needs no change. Objects declares its own migration tag `objects-v1`.

Vector is named after Core (`reader-core` → `reader-vector`, `reader-core-beta` → `reader-vector-beta`, otherwise `<core>-vector`) unless `services.VECTOR_SEARCH.service` names it, and is placed by `VECTOR_REGION` (`aws:us-east-1`), beside the query encoder and the Vectorize index. AI calls it with a `fetch` over the service binding, not RPC, because placement applies only to `fetch` handlers; the request carries `EDGE_SHARED_SECRET`. Without the binding (isolated local runs) AI runs the same step itself. Before the first release that contains Vector, create it and give it its values once per account:

```bash
pnpm api -- deploy --target vector
pnpm api -- secrets:sync --from ~/slax-secrets/prod.env   # uploads JINA_API_KEY and EDGE_SHARED_SECRET to Vector
```

Only `deploy --target vector` may publish a Worker that does not exist yet without its values; every other release stops while Vector lacks either value and names that command.

## First release after the Worker split (existing installations)

Edge keeps the queue consumers, cron triggers and Email Routing target it already has, and forwards each event to Core with a `fetch` over the existing `CORE` service binding to the internal host `jobs.internal`, authenticated with `EDGE_SHARED_SECRET`. A fetch, unlike an RPC call, honors Core's placement, so the jobs run in Singapore beside the database; a service-binding fetch is billed like an RPC call (no extra request, only CPU time). So no trigger, consumer or email rule moves, and the first release after the split is an ordinary `deploy` (CI or `pnpm api -- deploy`). An installation that already runs the split and gains Vector first runs the two Vector commands above; its next full release then stops only if Vector still lacks a value. Before its first publication a remote release reads the account and:

- stops while any Worker lacks a value its code reads (below), naming the Worker and key;
- picks the order. While an `SlaxMcpServer` namespace remains it publishes Browser → Objects → Core (still exporting the MCP stub, since the old Edge binds Core's namespace) → AI → Edge (deleting Edge's namespace) → Core (deleting Core's). Wrangler moves the Workflows to Core on its first publication. Later releases find no namespace and publish Browser → Objects → Core → AI → Edge.

Values move with the code. Deploys use `--keep-vars`, so a secret set with `wrangler secret put` stays only on the script that had it. `apps/api/script/deploy/runtimeKeys.ts` lists the string variables and secrets each Worker's code reads (a test re-derives it from the bundles). A release lists by name any key a Worker reads that another API Worker of the installation holds but neither that Worker nor the selected `[vars]` provides, and stops. Cloudflare never returns a secret's value, so it cannot be copied from the old Edge; supply the values in a file you hold (a password-manager export or the original `.env`, outside the repository or under the ignored `deploy/local/`) and run the commands below. The file is `.env`, JSON (`{"KEY": "value"}` or `[{"name": "KEY", "value": "value"}]`, `key` accepted too) or a `.toml` file of top-level `KEY = "value"` lines; numbers and booleans upload as strings, and other content starting with `{` or `[` is read as JSON. A file that cannot be read is reported by position, key names and value types, never by value:

```bash
pnpm api -- secrets:sync --from ~/slax-secrets/prod.env --dry-run   # lists Worker and key names only
pnpm api -- secrets:sync --from ~/slax-secrets/prod.env             # uploads with wrangler secret bulk
```

It uploads to each Worker only the keys its code reads that another API Worker holds but it lacks, never overwrites an existing secret, passes values to Wrangler on stdin (never on a command line, in a file or in logs), skips Workers not deployed yet, and fails while a needed key is absent from the file. Run it before the first release for Core and AI. Objects is new and cannot hold secrets before it exists, so the values it reads (only `FRONT_END_URL` today) must be in `[vars]`; the release stops otherwise. Values may instead go to `[vars]` of the private configuration. A read-only check on 2026-11-23 found `DEEPSEEK_API_KEY` missing from Core and AI in production and beta; the test account was complete. Keys no Worker holds are unconfigured optional features and are not reported.

During the first release, for about the time of the publications: AI routes can fail while AI's Workflow bindings wait for the new Core; search tokenization fails between Core's and AI's publications, because the old AI still reaches Core's retired jieba namespace; and old Edge jobs that call Core's retired Durable Objects fail and are retried by their queue. Run it in a low-traffic window, test account first, then beta, then production.

Rollback: before the MCP namespaces are deleted (the release's last two publications), `wrangler rollback` each Worker to its previous version. After that, Wrangler refuses to roll Edge or Core back past the deletion; the other changes can be reversed by deploying versions that do not export `SlaxMcpServer`.

This is a Cloudflare Workers runtime, not a Docker-hosted Node API. Offline builds and local tests do not verify cloud resource permissions, secrets or third-party integrations. Validate authentication, bookmarks, queues, provider callbacks and sync after deployment.

The configured frontend origin also controls credentialed events CORS, image Referer checks and share shortcuts. Screenshots use IMAGE_PREFIX and notification icons use FRONT_END_URL. End the image prefix with `/` and point it to your image service. Remote deployment requires `RUN_ENV = "prod"` to disable development endpoints and enable production checks; `RUN_TYPE` identifies dev/beta/prod. Stripe credentials select test or live API mode; configure the Stripe key and its matching webhook signing secret. Signed callbacks are processed in either mode without a separate mode environment variable.

## Full development startup and external CI configuration

After preparing development resources and environment files, run `pnpm api -- setup`; `setup --check` performs local prerequisite checks only. Setup performs Wrangler login, initializes dependencies, applies migrations and generates code, then exits. Run `pnpm api -- dev` separately to start Workers. Vectorize/AI still require cloud resources. All tools honor `SLAX_API_CONFIG` (absolute or repository-root relative); types also accepts `--config`.

Merged PRs targeting `dev`, `beta`, and `main` with API-related changes trigger the single `.github/workflows/api-deploy.yml` workflow. Dev retains the legacy test installation; beta and production retain their shared production databases and Browser Worker. Real configuration and runtime credentials come from the selected private TOML at a resolved revision; deployment access credentials use environment-scoped Actions Secrets, and private tool output is captured. Routine CI applies PostgreSQL/logs and remote D1/fulltext migrations before normal Worker publication, with shared production locking and owned-access cleanup. There is no manual deployment trigger or routine bootstrap input. See the [merged-release and private CI configuration guide](DEV-AND-CI-EN.md) for prerequisites, schemas, confidentiality, retry and recovery, and [Docker adapter research (Chinese)](DOCKER-ADAPTER-RESEARCH-CN.md) for background.
