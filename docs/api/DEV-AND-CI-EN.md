# API development and deployment

Local development uses the existing [setup runbook](../LOCAL-SETUP.md) and root `pnpm api -- <command>` entry. Deployment reuses the previous backend pipeline's steps in one file: `.github/workflows/api-deploy.yml`. There is no extra release framework, custom deployment script or configuration manifest.

## Configuration

Keep only the three native Wrangler files in the independent private repository:

| Merged target | GitHub Environment | Private configuration |
| --- | --- | --- |
| dev | dev | api/dev.toml |
| beta | beta | api/beta.toml |
| main | prod | api/prod.toml |

Dev uses the previous test installation. Beta/prod retain their existing production account, PostgreSQL/logs databases and shared Browser Worker. Keep existing Worker names, routes, resource bindings, compatibility settings and Durable Object migration history. The converted files retain explicit Edge identities/routes from the previous deployment overrides. They require no additional deployment fields. Review legacy per-Worker compatibility overrides against the shared native configuration before the first release.

CI verifies that the configuration repository is private, resolves its default branch once and fetches only the selected TOML at that revision into protected temporary storage. There is no ref/path Secret to maintain. A configuration-only update is picked up by the next source release or current-run retry. Native account_id, if present, must match the selected account Secret; otherwise Wrangler uses the account Secret. Remote mode uses RUN_ENV=prod and RUN_TYPE=dev/beta/prod, with no implicit local env.dev. `SLAX_API_ENV` is deliberately empty: it selects a named table inside one TOML, whereas release already selects a complete environment-specific file through `DEPLOY_ENVIRONMENT`.

Release files must use the declarative subset enforced by the CI loader:

- The top-level `[vars]` table accepts strings, including runtime tokens, private keys, salts, webhook URLs and allowlists. Maintain their real values only in these private TOMLs; multiline strings use native TOML syntax. All four Workers receive the selected environment's runtime values through normal publication.
- Outside that `[vars]` table, keys named `localConnectionString`, `build`, `assets`, `site`, `define`, `unsafe` or `containers` are forbidden at any nesting depth.
- Outside `[vars]`, keys matching `secret|password|private.?key|api.?key|auth.?key|token|credential|command` and strings containing `PRIVATE KEY-----`, `postgres://`, `postgresql://` or HTTP(S) URLs with user information (`https?://...@`) are forbidden. These matches are case-insensitive.
- Non-empty top-level `env` and `dev` tables are forbidden. Each release file must supply the selected environment's settings at the top level.

When adapting `deploy/cloudflare/api.toml.example` for release, remove `localConnectionString` from both Hyperdrive entries, move the selected environment's settings to the top level and remove the `env`/`dev` tables. Supply real database URLs through Actions Secrets. A file can pass Wrangler validation and still fail these release checks. Violations deliberately report only `Private configuration unavailable or invalid; values are withheld`; check the constraints above without printing private file contents in CI.

## Actions Secrets

Set these deployment access credentials in the public source repository's dev, beta and prod GitHub Environments. Their actual values never belong in public YAML, ordinary Actions Variables, configuration files or logs. Runtime credentials belong in the private TOML's `[vars]` instead.

| Secret | Existing input / purpose |
| --- | --- |
| API_CONFIG_REPOSITORY | Private owner/repository |
| CONFIG_REPO_TOKEN | Read-only Contents/Metadata token for that repository |
| CLOUDFLARE_ACCOUNT_ID | CLOUDFLARE_TEST_ACCOUNT_ID for dev; CLOUDFLARE_PROD_ACCOUNT_ID for beta/prod |
| CLOUDFLARE_API_TOKEN | CLOUDFLARE_TEST_API_TOKEN for dev; CLOUDFLARE_PROD_API_TOKEN for beta/prod |
| CF_ZONE_ID | CF_ZONE_TEST_ID for dev; CF_ZONE_PROD_ID for beta/prod |
| CLOUDFLARE_FIREWALL_API_TOKEN | Existing CF_API_TOKEN with zone read and IP access-rule permissions |
| CLOUDFLARE_TUNNEL_HOSTNAME | Existing TCP Access/Tunnel DNS hostname, moved out of public YAML |
| CLOUDFLARE_TUNNEL_CLIENT_ID | Existing test/production Access service-token ID |
| CLOUDFLARE_TUNNEL_TOKEN | Existing test/production Access service-token secret |
| HYPERDRIVE_DATABASE_URL | Existing dev/production primary migration URL |
| LOGS_DATABASE_URL | Existing dev/production logs migration URL |

Use the same production inputs for beta and prod. Both authenticated PostgreSQL URLs must address 127.0.0.1 at the same port; CI reads that port directly, defaulting to 5432. The hostname Secret is DNS only, without scheme, port or path; verify the previous test path-based selector's existing TCP routing. Runtime values are published from private TOML as native Wrangler variables; no separate Secret upload is required. Remote deploy uses `--keep-vars` to retain existing variables and Secrets whose original values have not yet been recovered. An explicit TOML value replaces a same-name remote binding, including a Secret. Do not uncomment empty placeholders: supply the original value first. Removing a TOML entry alone does not delete the existing remote binding. Public dependencies need no NPM_TOKEN.

Prepare Secrets and merge reviewed private configuration before merging the implementation PR, since that source merge can initiate the first test release. `pull_request_target` runs under the default branch context: all three Environment branch policies must permit dev, including prod. The job separately derives the actual environment from the merged PR target.

## Release steps

Only a merged PR into dev, beta or main with API-related changes deploys the API. The workflow filters API source, shared contracts, API command/workflow/template files and root package/lock/workspace manifests. Changes confined to Web, Extension, frontend-only shared packages or the repository docs directory do not initiate API deployment. Open/unmerged PRs, direct pushes and manual/reusable calls do not trigger deployment.

The application scopes are reserved for separate release workflows in this repository:

| Application | Application/shared source paths | Release action |
| --- | --- | --- |
| API | `apps/api/**`, `packages/contracts/**` | Existing API deployment |
| Web | `apps/web/**`, `packages/contracts/**`, `packages/frontend-types/**`, `packages/frontend-utils/**`, `packages/selection/**` | Web deployment, to be added later |
| Extension | `apps/extension/**`, `packages/contracts/**`, `packages/frontend-types/**`, `packages/frontend-utils/**`, `packages/selection/**` | ZIP packaging with `pnpm extension -- package`, to be added later |

Each application's command/configuration and workflow files also belong to its scope. Root `package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml` changes conservatively affect every application. Future Web/Extension release workflows should retain the merged-PR prerequisite and their own path filters.

Source checkout uses the resulting merge SHA. Test has an independent lock; beta/prod share a production lock and do not cancel executing releases. Immediately before remote access, the workflow compares the merged source with the current branch tip once over the same API-related paths. Newer API changes supersede the run; unrelated frontend/documentation commits leave it eligible. Fetch or comparison errors stop the release.

Lint, type checking and tests run in the existing PR CI. After installation, release validates the real configuration and runs only gen:all and build with generation-only database placeholders. It then opens temporary firewall/Tunnel access, waits up to 30 seconds for the local Tunnel listener and runs the existing commands sequentially:

```sh
pnpm api -- migration:deploy:pgsql
pnpm api -- migration:deploy:logs
pnpm api -- migration:remote:d1
pnpm api -- migration:remote:fulltext
pnpm api -- deploy
```

D1 migrations use --remote. Normal publication keeps Browser -> AI -> Core -> Edge, including the selected TOML's runtime values. Each migration checks its database connection; a failure stops later commands. As in the legacy pipeline, a primary migration may already be applied when the subsequent logs migration fails. Routine releases never provision resources or bootstrap. Beta migrations must remain compatible with currently serving production code.

Private configuration stays in `$RUNNER_TEMP/slax-api-release/api.toml`; the effective Core configuration is generated at `$RUNNER_TEMP/slax-api-release/generated/core.toml`. The generator rewrites D1 migration directories to the checked-out API's Prisma migration folders. Wrangler resolves those paths relative to the generated configuration file. Before opening database access, CI checks that `DB` resolves to `apps/api/prisma/d1_migrations` and `DB_FULLTEXT` to its `fulltext` directory, and that both contain SQL files. A failed migration reports its exit status, recognized error category and numeric Cloudflare error codes when available; raw diagnostics remain withheld.

Configured command output and private API responses are captured in temporary files; public messages contain only fixed stage results. Firewall HTTP failures identify the request stage, HTTP status and curl exit code, without printing URLs, IDs, tokens or response bodies. No private configuration, IDs, endpoints, raw diagnostics, logs or generated bundles are uploaded or cached. An always() cleanup step stops only the owned Tunnel process, deletes only run-created firewall rules and removes private/generated files. Existing allow rules survive. Cleanup errors also fail the job. A forcibly killed runner may require operator cleanup of the rule with notes api-release:<run-id>:<attempt>.

Retry through the existing Actions run while its API-related contents still match the target branch tip. The retry reads the latest reviewed configuration default branch again. Database migrations and Worker publication are not one transaction: inspect safe completed-stage results and retry forward; do not roll back schemas automatically.

## Configuration confidentiality

Runtime credentials in the independent private repository's environment TOMLs are an intentional operator-approved exception to the previous credential-free policy. Keep that repository private and restrict access. Other credential files and deployment access credentials remain excluded. The public source repository's credential checks still apply to every public contribution; private TOMLs must never be copied into it. Generated Worker TOMLs have owner-only permissions and remain within release temporary storage.

Offline validation uses synthetic configuration and command substitutes. It never accesses live credentials, databases or cloud mutations. Existing API deployment regressions and `pnpm exec openspec validate --all --strict` remain applicable; actual permissions, Tunnel routing and GitHub Environment policies are verified by the first authorized merged release.
