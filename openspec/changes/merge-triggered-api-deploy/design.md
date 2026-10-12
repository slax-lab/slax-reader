# Design

## Scope

Migrate the previous backend release steps into one API deployment workflow. Keep the existing three private native TOMLs and existing cloud/database resources. The requested differences are merged-PR eligibility, private configuration loading and Actions Secrets, and suppression of private CI output. Do not introduce a release manifest, configurable ref/path, separate release framework, custom deployment scripts or a duplicate Worker/account inventory.

## Workflow

Use only `.github/workflows/api-deploy.yml`, triggered by `pull_request_target: closed` for dev, beta and main. The job requires merged == true and this repository's base identity before any secret-bearing work. Checkout the resulting merge SHA with credentials disabled. The logical environment is dev, beta or prod (main maps to prod); the event runs under the default-branch context, so GitHub Environments must permit dev. Remove arbitrary manual/reusable release calls.

Use native workflow path filters for `apps/api/**`, `packages/contracts/**`, the root API/pnpm command wrappers, the public API template, the API CI/deploy workflows and root package/lock/workspace manifests. Repository docs, Web/Extension source and frontend-only shared packages do not initiate an API release. Root dependency manifest changes conservatively affect all applications. Document the separate Web and Extension application/frontend-shared scopes for their future workflows without creating placeholder jobs.

Use one test concurrency group and one shared beta/prod group, with cancel-in-progress false. Check target branch currency once, immediately before opening database access. When the branch tip differs from the merged SHA, fetch that public commit without persisted credentials and compare only the same API-related paths; skip when those contents differ. Later frontend/documentation-only commits do not supersede an API release. Comparison/fetch errors fail safely. Beta and prod retain the same production account, databases and Browser Worker. Migration compatibility with the currently serving production code remains required by REVIEW.md.

## Configuration and credentials

An inline Python step uses GitHub's authenticated API to verify the selected repository is private, resolve its default branch once, and fetch only api/dev.toml, api/beta.toml or api/prod.toml at that revision. Files live in protected runner temporary storage. No private branch, revision, values or raw API diagnostics are printed. Existing native file format, Worker names, explicit Edge identity, routes, bindings and migration history remain authoritative. Do not add deployment vars. Validate remote mode and any native account against the selected account Secret before mutation.

Use environment-scoped Actions Secrets for API_CONFIG_REPOSITORY, CONFIG_REPO_TOKEN and the previous deployment inputs: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, CF_ZONE_ID, CLOUDFLARE_FIREWALL_API_TOKEN, CLOUDFLARE_TUNNEL_HOSTNAME, CLOUDFLARE_TUNNEL_CLIENT_ID, CLOUDFLARE_TUNNEL_TOKEN, HYPERDRIVE_DATABASE_URL and LOGS_DATABASE_URL. Generic account/zone/token names map from the old test/production names; beta/prod use the same existing production values. Derive the loopback Tunnel port from matching authenticated PostgreSQL URL Secrets, with default 5432. Native account_id may be omitted when the account Secret supplies it. Credentials never enter TOML; Worker runtime secrets remain separately provisioned.

## Existing commands and access lifecycle

Install dependencies before private loading. Keep lint, type checking and tests in the existing PR CI. Release runs the existing configuration validator, gen:all and build commands with generation-only database placeholders before opening access. Capture configured command output in temporary logs and emit only fixed stage names/results. Use the workflow's fail-fast Bash shell and simple error traps rather than nested conditional subshells. Do not add a release:check command or orchestration module. No dependency/private-data caches or artifact uploads exist in the release workflow.

Inline workflow steps preserve the old firewall and cloudflared operations. Validate the zone's account, reuse pre-existing IP allow rules, record creation intent and validate the creation response, and start one owned Tunnel process. A short Node expression selects the matching loopback database port. Wait at most 30 seconds for the local Tunnel listener; the existing migration commands then establish each real database connection. There is no separate database-probing program. A primary migration can succeed before the logs database is found unavailable, as in the legacy sequential workflow; the failure stops later migrations and publication.

Apply existing root PostgreSQL, logs, remote D1 and remote fulltext migration commands, then normal Browser -> AI -> Core -> Edge deployment. Stop later operations on failure. Secrets are scoped to the required steps; offline commands receive only placeholders. Do not run setup, bootstrap, provisioning or Worker-secret uploads.

An always() cleanup step stops only the owned Tunnel process after checking process identity, removes only the run-created firewall rule (including recovery by unique run notes after a lost POST response), and removes private configs, generated bundles/types and captured logs. Cleanup errors fail the job without hiding an earlier failure. A forcibly killed runner can require operator cleanup by the public run/attempt note.

## Private repository contributions

Keep AGENTS.md and the requested Agent.MD with strict credential prohibition. Use one PR workflow that calls pinned Gitleaks directly with default rules plus declarative credential/URL rules and a short inline credential-path check. Inspect every introduced commit, including credentials later removed; ignore PR allowlists, capture/redact diagnostics, fail on findings or scanner errors, and upload no reports. No custom scanner scripts or test framework are maintained. Require the exact Secret scan status through branch protection and human review of policy/workflow changes.

## Verification and release

Check workflow YAML, inline shell/Python/Node syntax, event gates, fixed-file selection, snapshot pinning, private output suppression, ordered commands, credential scope and cleanup with temporary synthetic fixtures and command substitutes. Keep existing API deployment-config regressions. Run OpenSpec strict validation and Bugs/Security/Compliance review before publication. Offline verification does not access real credentials or mutate live cloud/database resources. Prepare Secrets and reviewed private native configuration before the source PR merges; retry a failed release whose API-related contents remain current through its existing Actions run.
