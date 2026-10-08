# API development and merged releases

Local setup is described in [LOCAL-SETUP](../LOCAL-SETUP.md). Run `pnpm api -- setup --check` for read-only prerequisite checks, `pnpm api -- setup` for authorized local setup, and `pnpm api -- dev` separately to start Workers. Local operator files remain ignored under `deploy/local/`. The public template is `deploy/cloudflare/api.toml.example`; never commit real deployment configuration or credential values.

## Release eligibility and environments

`api-deploy-on-merge.yml` handles only merged `pull_request_target: closed` events targeting `dev`, `beta`, or `main`. The reusable `api-deploy.yml` independently checks the event, repository, target environment, and resulting merge SHA. Open PRs, unmerged closures, pushes, and manual dispatches cannot deploy. Merged fork contributions are eligible. The source checkout uses the resulting merge commit, not the contributor's head or the event's default-branch SHA. Every eligible merge runs release validation, including documentation-only merges.

| Target | GitHub Environment | Legacy branch | Installation |
| --- | --- | --- | --- |
| `dev` | `dev` | `develop` | Existing test account and databases |
| `beta` | `beta` | `beta` | Existing beta Workers; production account/databases |
| `main` | `prod` | `master` | Existing production Workers and databases |

The executor owns one test lock and one shared beta/production lock; running releases are never cancelled by newer releases. GitHub may replace intermediate pending runs. The target branch must still equal the release SHA at startup and immediately before opening remote access. Older runs and retries are reported as superseded. Beta and main have independent histories; the currency check compares each source only with its own target branch.

`pull_request_target` executes in the default-branch workflow context. Configure all three GitHub Environments to permit that context (`dev` in this repository), including production. Environment protection restricted only to the event ref `main` would block production promotion. The explicit merged-event guard selects the actual target. Optional environment approval rules may remain in place.

## Operator prerequisites

Prepare these settings **before merging the implementation PR**: its merge into `dev` can start the first test release. Use environment-scoped Actions Secrets. The names below are public; every actual value remains private. Do not use Actions Variables for private selectors or infrastructure metadata.

| Actions Secret | Purpose / legacy mapping |
| --- | --- |
| `API_CONFIG_REPOSITORY` | Private `owner/repository` selector |
| `API_CONFIG_MANIFEST_PATH` | Optional relative `.json` manifest path; defaults to `api/releases.json` |
| `CONFIG_REPO_TOKEN` | Fine-grained token: read-only Contents and Metadata for only the configuration repository |
| `CLOUDFLARE_API_TOKEN` | `CLOUDFLARE_TEST_API_TOKEN` for dev; `CLOUDFLARE_PROD_API_TOKEN` for beta/prod |
| `CLOUDFLARE_FIREWALL_API_TOKEN` | Legacy `CF_API_TOKEN`; zone-read and IP Access rule permissions for the selected zone |
| `CLOUDFLARE_TUNNEL_CLIENT_ID` | `CLOUDFLARE_TUNNEL_CLIENT_ID_TEST` or `_PROD`; Access service-token ID |
| `CLOUDFLARE_TUNNEL_TOKEN` | `CLOUDFLARE_TUNNEL_TOKEN_TEST` or `_PROD`; Access service-token secret |
| `HYPERDRIVE_DATABASE_URL` | `HYPERDRIVE_DATABASE_URL_DEV` or `_PROD`; primary migration connection |
| `LOGS_DATABASE_URL` | `LOGS_DATABASE_URL_DEV` or `_PROD`; logs migration connection |

The old account/zone Secrets (`CLOUDFLARE_TEST_ACCOUNT_ID`, `CLOUDFLARE_PROD_ACCOUNT_ID`, `CF_ZONE_TEST_ID`, `CF_ZONE_PROD_ID`) become declarative metadata in the private manifest/native TOML. The release does not need the old `NPM_TOKEN`: install uses the public workspace dependencies. Provision existing Worker runtime secrets separately through Cloudflare; routine CI never downloads or uploads them.

Both database Secrets must use PostgreSQL URLs with authentication, database names, and the selected local Tunnel listener (`127.0.0.1:<manifest port>`). Preserve the original database targets; the pipeline rejects mismatched listeners and never rewrites URLs. Beta and prod must use the same production primary/logs credentials and database targets. The Tunnel hostname must select the existing PostgreSQL service and accept the environment's Access service token; it is a hostname without scheme, port, or path.

## Private configuration contract

Maintain the configuration repository in its own local checkout, separate from the public monorepo. Its conventional layout is:

```text
api/
  dev.toml
  beta.toml
  prod.toml
  releases.json
```

The manifest maps `dev` to `api/dev.toml`, `beta` to `api/beta.toml`, and `prod` to `api/prod.toml`. Merge the completed, reviewed configuration into that private repository's default branch. At the start of configuration loading, each release verifies private repository identity and resolves the default branch once to a full immutable SHA, then fetches every file at that SHA. No configuration-ref Secret is required. A configuration-only update does not itself deploy; the next eligible source release or current-run retry resolves the latest reviewed default-branch tip automatically. Never copy real TOML, manifests, generated files or credential files into the public monorepo.

When adapting legacy files, remove local `env`/`dev` sections, preserve the existing installation bindings and resource identities, add the explicit Edge service, and transfer Edge routes from the legacy deployment overrides. Complete missing production account IDs, both firewall zone IDs and a valid test Tunnel hostname in the private files; do not substitute example IDs or guess a hostname from a path-based legacy selector. Review any differences between legacy per-Worker compatibility overrides and the monorepo's shared native configuration before the first release. Keep the legacy source files intact until the private migration is reviewed.

The configuration repository must be private. Before fetching content, the pipeline verifies authenticated private status and resolves the default branch to an immutable commit. It fetches only the manifest and selected native TOML through GitHub's Contents API; it does not clone scripts, create a Git credential helper, or persist a token. No credential files, submodules, or symlinks are accepted. Paths are relative, contained, and free of traversal or line breaks.

The following **synthetic** manifest illustrates the schema. All real metadata belongs exclusively in the private repository. For beta/prod, include both environment entries with the same account, firewall zone, Tunnel listener/hostname, and Browser identity. Other Worker identities and configuration files remain environment-specific. A dev-only manifest may contain just dev.

```json
{
  "version": 1,
  "environments": {
    "dev": {
      "config": "api/dev.toml",
      "accountId": "11111111111111111111111111111111",
      "firewallZoneId": "22222222222222222222222222222222",
      "tunnel": { "hostname": "database.example.com", "port": 15432 },
      "workers": {
        "core": "synthetic-test-core",
        "edge": "synthetic-test-edge",
        "ai": "synthetic-test-ai",
        "browser": "synthetic-test-browser"
      }
    }
  }
}
```

Optional `wranglerEnvironment` explicitly selects a named native `[env.<name>]` section; omit it for top-level configuration. The release never implicitly selects the local `env.dev`. The selected native configuration must declare `account_id` matching `accountId`, and Worker names matching `workers`. Preserve existing routes, bindings, resource IDs, and Durable Object migration history. Require an explicit `EDGE` service, especially for the legacy test installation: a Core name alone can infer a different Edge identity. This example shows only a binding shape:

```toml
[[services]]
binding = "EDGE"
service = "synthetic-test-edge"
```

Keep native `name`, `services`, bindings, compatibility settings and historical migrations. For all remote environments, set `vars.RUN_ENV = "prod"`; set `vars.RUN_TYPE` to `dev`, `beta`, or `prod` respectively. Use real HTTPS API origins and existing non-placeholder resource IDs. Entrypoints, TypeScript configuration and D1 migration paths are supplied by the source tooling. Omit local Hyperdrive `localConnectionString` fields. Embedded credentials, private keys, credential URLs, build commands/hooks, custom assets/sites/containers, and unsafe configuration are rejected. Configuration files are declarative data, not executable deployment extensions.

## Execution, confidentiality and cleanup

Dependency installation and synthetic policy tests run before loading private data, without release credentials. Configured `release:check`, generation, lint, typecheck, tests and four-Worker bundling then run before database access, using placeholder generation URLs. Missing settings or failed validation stop remote operations.

After a second currency check, the pipeline verifies the runner's public IPv4 address, validates the firewall zone's account, creates or reuses an IP allow rule, and starts a single owned cloudflared client. It waits at most 60 seconds for authenticated `SELECT 1` checks against **both** databases. It then runs these existing root commands sequentially:

```bash
pnpm api -- migration:deploy:pgsql
pnpm api -- migration:deploy:logs
pnpm api -- migration:remote:d1
pnpm api -- migration:remote:fulltext
pnpm api -- deploy
```

D1 operations explicitly use `--remote`. Normal publication retains Browser → AI → Core → Edge. No setup, provisioning, bootstrap, or Worker-secret upload occurs. Beta migrates production databases before main promotion, so migrations must follow expand/contract compatibility with the production code currently serving users.

Private selectors, manifest/TOML contents, configuration revisions, hosts, IDs, database URLs and raw tool diagnostics never become public stage messages, summaries, annotations, or outputs. Child stdout/stderr are drained into bounded memory and discarded; exceptions are replaced with fixed stage/error categories and exit status. Private strings and encoded forms are registered with the runner's internal masking mechanism as defense in depth; raw masking commands are consumed by the runner, not used as public diagnostics. Public provenance contains only the PR number, logical environment and source SHA.

Private files and generated Wrangler configs/bundles/logs use protected runner temporary storage (directory mode 0700, fetched files 0600). The generated runtime type file is also removed after release. Deployment jobs have no cache, artifact uploads, or cross-job outputs. Release credentials are scoped to their required child processes: configuration token for authenticated API fetch, Access credentials for cloudflared, database URLs for readiness/Prisma, and Worker token/account for remote D1/publication. Offline children receive only placeholder URLs.

Cleanup runs in `finally` and is retried by an `always()` step. It stops only the owned Tunnel process after checking its process identity, removes only exact run-owned firewall rules, and deletes private/generated files. A pre-existing rule survives. The run's unique rule notes are `api-release:<run id>:<attempt>`; creation intent is stored before POST so cleanup can recover a lost response. Cleanup failures fail the job while preserving earlier failed-stage messages. Private files are removed even when remote cleanup fails; minimal cleanup metadata survives only until the final retry.

## Retry and verification

Rerun a failed release from its existing GitHub Actions run while that merged source remains the target branch tip. Each new attempt resolves the current private default-branch tip again, remains pinned to that SHA for its complete attempt, and never prints the branch or revision. Migration/publication stages are not a single transaction: inspect safe completed-stage results and retry forward; do not perform destructive schema rollback automatically.

If a runner is killed before cleanup, an authorized operator should find the exact rule by its public run/attempt notes in the **private** Cloudflare dashboard and remove only that rule. Check both migration state and published Workers before recovery. Correct code/schema through a new PR; promotions and sync-back PRs still require human merge-commit handling.

Offline acceptance requires no actual private repository, configuration, credentials, or remote operations:

```bash
node --test tooling/api-release.test.mjs
pnpm api -- test test/script/deployPaths.test.ts
pnpm exec openspec validate --all --strict
```

Ordinary PR API CI uses the public generic template and synthetic fixtures and receives no deployment Secrets. Offline tests cover rejected events, fork merges, environment/ref selection, private repository/configuration validation, stale runs, readiness, migration ordering, credential scope, failure/cancellation cleanup, YAML contracts, and private/encoded sentinel exclusion from public output. The first authorized live release remains the check of actual cloud permissions, GitHub Environment policies, Tunnel routing, and provider integrations.

## Configuration-repository contribution checks

Keep agent instructions in the independent private checkout that prohibit credential files and embedded credentials, including tokens, passwords, private keys and connection URLs. Use its Secret scan PR check over every introduced commit, so removing a credential in a later commit does not hide the earlier addition. Require this check through branch protection and review scanner/policy changes. The check runs with read-only repository permissions and no deployment Secrets, captures/redacts diagnostics, fails on findings or scanner errors, and uploads no reports. Ordinary infrastructure identities remain valid declarative data in that private repository.
