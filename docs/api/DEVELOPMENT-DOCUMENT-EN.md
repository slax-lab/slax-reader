# API development

Use Node.js >= 22.13.0 and the root-pinned pnpm version. Run commands at the repository root. The root manifest owns only the generic `api` dispatcher; concrete scripts and dependencies live in `apps/api/package.json` and run in that workspace. API-only TypeScript, Vitest, ESLint, Prettier and EditorConfig files live in `apps/api/`. Prisma configs live beside schemas and migrations in `apps/api/prisma/`; their schema/migration paths resolve relative to the config, independently of command cwd.

```bash
pnpm install --frozen-lockfile
pnpm api -- setup
pnpm api -- dev
```

```bash
pnpm api -- gen:all
pnpm api -- lint
pnpm api -- typecheck
pnpm api -- test
pnpm api -- build
```

`setup` validates operator-provided native Wrangler configuration and keys, runs Wrangler login once, initializes PostgreSQL, runs migrations/codegen, waits for PowerSync health and exits; start Workers separately with `pnpm api -- dev`. No separate database startup command is needed. Missing configuration is reported; setup never writes configuration or keys. Local files live in `deploy/local/`; the public template remains `deploy/cloudflare/api.toml.example`. Existing values are preserved and failures stop startup. `setup --check` is read-only; cloud resources and provider credentials still require operator configuration. See [setup details](DEV-AND-CI-CN.md).

Prisma automatically loads `HYPERDRIVE_DATABASE_URL` and `LOGS_DATABASE_URL` from `deploy/local/.env`; no manual export is needed. Placeholder URLs work only for generation. `migration:local` excludes logs; invoke its separate command. `gen:pull` requires pgsql/logs and can rewrite schema. D1 diff resolves input from repository root and refuses to overwrite migrations. Never rewrite historical SQL when moving tooling.

`types` extracts compatibility date/flags from api.toml and generates runtime declarations in an isolated directory with minimal config and an empty env file, preserving the manually maintained Env contract. Do not run Wrangler types directly. New bindings require updates to the example, `script/deploy/config.ts` and Env; register HTTP controllers in `script/gen-routers.ts`.

Optional smoke tests require pre-cached `postgres:17-alpine`, plus `redis:7-alpine` for integration; containers use `--pull=never`. HTTP needs port 8787 free. Integration additionally reserves `slax-payment-review` on port 6543 and never reuses an existing resource. Some database tests truncate data: use disposable databases only. Logs/results stay in isolated `.tmp-root-tooling-http-*` workspaces. `dev:local` requires all four paths under such a workspace, an empty env file, dev runtime, loopback PostgreSQL and local Edge→Core binding; remote resources are rejected.

See [deployment](CLOUDFLARE-DEPLOY-EN.md) for explicitly authorized cloud operations. `backfill:device-alias` retains read-only transactions, count-only default and root-relative exclusive SQL output; SQL is not applied automatically. Apple certificate generation needs networking; Stripe CLI must be installed separately. No seed operation is provided. `keys:powersync` generates keys only for PowerSync and is unrelated to browser Web Push.

| Task / 操作 | Command |
| --- | --- |
| Discover commands | `pnpm api -- --help` |
| Initialize config (exclusive copy) | `pnpm api -- config:init` |
| Prisma clients | `pnpm api -- gen:model` |
| Runtime Worker types | `pnpm api -- types` |
| DI / router / cron / consumer | `pnpm api -- gen:di` / `gen:router` / `gen:cron` / `gen:consumer` |
| Introspect selected DB | `pnpm api -- gen:pull pgsql` / `logs` |
| D1 diff | `pnpm api -- gen:diff:d1 <root-relative-sqlite-file> <migration-name>` |
| PostgreSQL / logs diff | `pnpm api -- gen:diff:pgsql` / `gen:diff:logs` |
| Local D1 + PostgreSQL + fulltext | `pnpm api -- migration:local` |
| Local logs migrations | `pnpm api -- migration:local:logs` |
| Deploy PostgreSQL / logs migrations | `pnpm api -- migration:deploy:pgsql` / `migration:deploy:logs` |
| Remote D1 / fulltext migrations | `pnpm api -- migration:remote:d1` / `migration:remote:fulltext` |
| Offline bundle | `pnpm api -- build [core\|edge\|ai\|browser]` |
| Config generation only | `pnpm api -- deploy --dry-run` |
| Dev with explicit isolated configs | `pnpm api -- dev:local --edge-config <file> --core-config <file> --state <dir> --env-file <empty-file>` |
| Real HTTP / database integration | `pnpm api -- test:http` / `test:integration:local` |
| Resource plan / create | `pnpm api -- resources` / `resources --apply` |
| Wrangler command with actual config | `pnpm api -- wrangler edge <command> [args...]` |
| Edge logs | `pnpm api -- tail` |
| Complete local API setup | `pnpm api -- setup` |
| Maintenance | `pnpm api -- gen:apple-certs` / `backfill:device-alias` |
| Diagnostics | `pnpm api -- debug:hashids` / `debug:hash-article` |
| Optional CLI tools | `pnpm api -- stripe:webhook` / `mcp:tool` / `update:cli` |

## Environment file locations

- `deploy/local/api.toml`: actual non-secret deployment configuration; the sole public template is `deploy/cloudflare/api.toml.example`.
- `deploy/local/.dev.vars`: local Worker secrets, explicitly loaded by dev with `--env-file`. Do not duplicate it at the root or in apps/api. Production uses Worker secrets.
- `deploy/local/powersync-local/compose.env`: PowerSync public-key parameters for Docker Compose, generated by `pnpm api -- keys:powersync`.
- `deploy/local/.env`: Prisma database URLs and Cloudflare tool credentials (such as `CLOUDFLARE_API_TOKEN`) for D1/Wrangler, dev, deploy and resources --apply. Loaded automatically; D1 bindings still come from api.toml. Existing shell/CI values take precedence, including the local URLs pinned by setup. A missing default file allows CI variables or Wrangler login.
- The tool environment file is fixed at deploy/local/.env, independent of the working directory. Unreadable files fail; a missing file allows CI to supply process variables. The root .env is not discovered. Build, types, deploy --dry-run and resource plans do not load tool environment files.
- `.vars` and `.vars.temp` are not supported operator configuration files. Never commit actual environment files or keys.

## Full development startup and external CI configuration

After preparing development resources and environment files, run `pnpm api -- setup`; `setup --check` performs local prerequisite checks only. Setup performs Wrangler login, initializes dependencies, applies migrations and generates code, then exits. Run `pnpm api -- dev` separately to start Workers. Vectorize/AI still require cloud resources. All tools honor `SLAX_API_CONFIG` (absolute or repository-root relative); types also accepts `--config`. The manual/reusable `.github/workflows/api-deploy.yml` checks out a separate configuration repository and deploys after validation. See the [setup and CI guide (Chinese)](DEV-AND-CI-CN.md) and [Docker adapter research (Chinese)](DOCKER-ADAPTER-RESEARCH-CN.md).
