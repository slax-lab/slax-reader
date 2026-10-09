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

CI verifies that the configuration repository is private, resolves its default branch once and fetches only the selected TOML at that revision into protected temporary storage. There is no ref/path Secret to maintain. A configuration-only update is picked up by the next source release or current-run retry. Native account_id, if present, must match the selected account Secret; otherwise Wrangler uses the account Secret. Remote mode uses RUN_ENV=prod and RUN_TYPE=dev/beta/prod, with no implicit local env.dev.

Release files must use the declarative subset enforced by the CI loader:

- At any nesting depth, keys named `localConnectionString`, `build`, `assets`, `site`, `define`, `unsafe` or `containers` are forbidden.
- Keys matching `secret|password|private.?key|api.?key|auth.?key|token|credential|command` are forbidden. This is a case-insensitive substring match at any nesting depth.
- String values containing `PRIVATE KEY-----`, `postgres://`, `postgresql://` or HTTP(S) URLs with user information (`https?://...@`) are forbidden, also case-insensitively and at any nesting depth.
- Non-empty top-level `env` and `dev` tables are forbidden. Each release file must supply the selected environment's settings at the top level.

When adapting `deploy/cloudflare/api.toml.example` for release, remove `localConnectionString` from both Hyperdrive entries, move the selected environment's settings to the top level and remove the `env`/`dev` tables. Supply real database URLs through Actions Secrets. A file can pass Wrangler validation and still fail these release checks. Violations deliberately report only `Private configuration unavailable or invalid; values are withheld`; check the constraints above without printing private file contents in CI.

## Actions Secrets

Set these in the public source repository's dev, beta and prod GitHub Environments. Actual values never belong in public YAML, ordinary Actions Variables, configuration files or logs.

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

Use the same production inputs for beta and prod. Both authenticated PostgreSQL URLs must address 127.0.0.1 at the same port; CI reads that port directly, defaulting to 5432. The hostname Secret is DNS only, without scheme, port or path; verify the previous test path-based selector's existing TCP routing. Worker runtime secrets remain in Cloudflare and are not fetched or uploaded. Public dependencies need no NPM_TOKEN.

Prepare Secrets and merge reviewed private configuration before merging the implementation PR, since that source merge can initiate the first test release. `pull_request_target` runs under the default branch context: all three Environment branch policies must permit dev, including prod. The job separately derives the actual environment from the merged PR target.

## Release steps

Only a merged PR into dev, beta or main deploys. Open/unmerged PRs, direct pushes and manual/reusable calls do not trigger deployment. Source checkout uses the resulting merge SHA. Test has an independent lock; beta/prod share a production lock and do not cancel executing releases. Current-tip checks skip superseded source revisions before private loading and before remote access.

After installation, the workflow runs the existing gen:all, lint, typecheck, test and build commands with generation-only database placeholders. It then opens temporary firewall/Tunnel access, checks both database connections, and runs the existing commands sequentially:

```sh
pnpm api -- migration:deploy:pgsql
pnpm api -- migration:deploy:logs
pnpm api -- migration:remote:d1
pnpm api -- migration:remote:fulltext
pnpm api -- deploy
```

D1 migrations use --remote. Normal publication keeps Browser -> AI -> Core -> Edge. A failure stops later commands. Routine releases never provision resources, bootstrap or upload Worker secrets. Beta migrations must remain compatible with currently serving production code.

Configured command output and private API responses are captured in temporary files; public messages contain only fixed stage results. No private configuration, IDs, endpoints, raw diagnostics, logs or generated bundles are uploaded or cached. An always() cleanup step stops only the owned Tunnel process, deletes only run-created firewall rules and removes private/generated files. Existing allow rules survive. Cleanup errors also fail the job. A forcibly killed runner may require operator cleanup of the rule with notes api-release:<run-id>:<attempt>.

Retry through the existing Actions run while its merged source remains the target branch tip. The retry reads the latest reviewed configuration default branch again. Database migrations and Worker publication are not one transaction: inspect safe completed-stage results and retry forward; do not roll back schemas automatically.

## Configuration PR checks

The private repository carries strict AGENTS.md/Agent.MD credential rules. One PR workflow directly runs pinned Gitleaks and an inline credential-file check over every introduced commit, including credentials later removed. Findings and scanner errors fail the Secret scan status without printing values or uploading reports. Require that exact status through branch protection and review workflow/policy changes. No custom scanner scripts or additional deployment files are maintained.

Offline validation uses synthetic configuration and command substitutes. It never accesses live credentials, databases or cloud mutations. Existing API deployment regressions and `pnpm exec openspec validate --all --strict` remain applicable; actual permissions, Tunnel routing and GitHub Environment policies are verified by the first authorized merged release.
