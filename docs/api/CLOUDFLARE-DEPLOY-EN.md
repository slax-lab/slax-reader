# Cloudflare API deployment

Maintain one public template: `deploy/cloudflare/api.toml.example`. Run `pnpm api -- config:init` at the root to create ignored `api.toml`. Dev, build, deploy and runtime types use that actual file and fail if missing. Separate installations can explicitly select their own ignored file with `build/deploy --config <root-relative-path>`; use distinct resource names.

1. Install dependencies, configure api.toml, set both Prisma URLs and Cloudflare tool credentials in deploy/local/.env (automatically loaded) and run `pnpm api -- gen:all`. Placeholder URLs are only suitable for generation.
2. Use native Wrangler name, services and [env.*], without custom [workers.*] tables. Core uses the selected name; AI and Browser use AIGC/VECTOR and SlaxBrowser service names. An optional EDGE service selects the public Worker name. Set environment-specific API/frontend/image/PowerSync URLs; remote API origin must be real HTTPS. Only Edge exposes HTTP.
3. Provision D1, KV, R2, queues, five 1024-dimensional cosine Vectorize indexes, PostgreSQL/Hyperdrive and PowerSync. `resources` is a local plan; `--apply` creates missing resources with your account/token and reports IDs. It does not provision Hyperdrive, databases or external services. Deploy or supply the template's external `fxembed` service (`SlaxTwitterFxembed`). Your account needs access to these products, including Browser Rendering.
4. Keep logical binding names while customizing physical names. Queue roles use native producer bindings and the IMPORT_OTHER consumer dead_letter_queue relationship. Source configuration is never rewritten. Isolate queue and Workflow names between environments.
5. Existing installations must preserve their Worker identities, resource IDs and DO migration tags/classes. Never replace production history with the example. Apply remote D1/fulltext and PostgreSQL/logs migrations separately after checking database targets; commands are listed in the development guide.
6. Use Worker secrets, or ignored `deploy/local/.dev.vars` locally. Edge/Core/AI share the same EDGE_SHARED_SECRET. Configure JWT, Hashids, payment, OAuth, model and PowerSync credentials as required by `apps/api/worker-configuration.d.ts`; never put secrets in TOML. Set provider callback URLs to your own origin.

```bash
pnpm api -- build
pnpm api -- deploy --dry-run
pnpm api -- resources                 # plan only
pnpm api -- resources --apply         # creates remote resources
pnpm api -- deploy --bootstrap        # NEW installation only
pnpm api -- deploy                    # subsequent updates
pnpm api -- deploy edge               # update one existing Worker
pnpm api -- wrangler edge secret put EDGE_SHARED_SECRET
```

`build` bundles all four Workers offline with temporary config and an empty env file, leaving active generated configs intact. `deploy --dry-run` only generates `.generated/` files and never contacts Cloudflare. Do not maintain generated files manually.

For a new installation, bootstrap deploys Browser → Core without service/Workflow bindings → AI → Edge with Workflows → Core with complete bindings. Retry bootstrap after an interrupted first deployment. Existing installations use normal deploy; bootstrap is not a normal update procedure. Deployment, secrets, resource creation and remote migrations are real cloud operations requiring explicit authorization when performed by agents.

This is a Cloudflare Workers runtime, not a Docker-hosted Node API. Offline builds and local tests do not verify cloud resource permissions, secrets or third-party integrations. Validate authentication, bookmarks, queues, provider callbacks and sync after deployment.

The configured frontend origin also controls credentialed events CORS, image Referer checks and share shortcuts. Screenshots use IMAGE_PREFIX and notification icons use FRONT_END_URL. End the image prefix with `/` and point it to your image service. Remote deployment requires `RUN_ENV = "prod"` to disable development endpoints and enable production checks; `RUN_TYPE = "prod"` selects live payments, while beta/dev selects sandbox behavior.

## Full development startup and external CI configuration

After preparing development resources and environment files, run `pnpm api -- setup:api`; `setup:api --check` performs local prerequisite checks only. Setup performs Wrangler login, initializes dependencies, applies migrations and generates code, then exits. Run `pnpm api -- dev` separately to start Workers. Vectorize/AI still require cloud resources. All tools honor `SLAX_API_CONFIG` (absolute or repository-root relative); types also accepts `--config`. The manual/reusable `.github/workflows/api-deploy.yml` checks out a separate configuration repository and deploys after validation. See the [setup and CI guide (Chinese)](DEV-AND-CI-CN.md) and [Docker adapter research (Chinese)](DOCKER-ADAPTER-RESEARCH-CN.md).
