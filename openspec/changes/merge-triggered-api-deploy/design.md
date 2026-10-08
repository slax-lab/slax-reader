# Design

## Context

See `proposal.md` for motivation and scope. The current `.github/workflows/api-deploy.yml` accepts manual/reusable configuration inputs, checks out source without a fixed release revision, uses generation-only database URLs, and publishes Workers after offline validation. It has no database migration, Tunnel, or firewall lifecycle. It prints the configuration commit SHA and forwards tool output directly. These output behaviors are incompatible with the requested confidentiality boundary for a fully open-source repository with public CI. No in-repository workflow currently calls it.

The legacy `.github/workflows/deploy_prod.yaml` in `../slax_reader_backend` publishes on pushes to `develop`, `beta`, and `master`. It establishes temporary firewall access and a Cloudflare Tunnel, migrates PostgreSQL/logs, and publishes Workers. Its D1 commands use `--local`, its startup does not verify database readiness, and cleanup does not validate Cloudflare API results.

Current API commands already expose all four migration operations and normal deployment through `pnpm api -- <command>`. Configuration supports an operator-selected file and native Wrangler environments. The remote preflight requires real HTTPS/resource IDs and `RUN_ENV = "prod"`, including remote test installations. The test Edge name requires an explicit `EDGE` service because the existing name fallback can select the production Edge identity. Existing `release-branching` requirements and `REVIEW.md` already govern promotion merges and production-compatible migrations.

## Goals / Non-Goals

**Goals:** Make the release boundary explicit, retain operator ownership of existing resources, keep private configuration out of public source and CI output, and make failure/confidentiality behavior verifiable offline.

**Non-Goals:** Modify API business code, automatically provision or migrate cloud configuration, merge promotion PRs, or perform a live release during implementation. No agent reads local secret files or legacy private configuration to populate GitHub settings.

## Decisions

### 1. Use a merged-PR entry point with a guarded reusable executor

Add `.github/workflows/api-deploy-on-merge.yml` with `pull_request_target`, `types: [closed]`, and target branches `dev`, `beta`, and `main`. Gate its job on a boolean merged flag and a pull request belonging to this repository. It calls the existing executor with only the derived GitHub Environment and merged source SHA. Declare/pass only the named secrets needed by the executor, resolving environment-scoped values in its environment-bound job; do not inherit an unrestricted secret collection.

Remove the executor's manual trigger and routine-bootstrap option. Its job independently verifies the qualifying event, base branch/environment mapping, repository identity, and equality between `code-ref` and the resulting merge SHA before checkout or secret-bearing work. Source checkout uses that SHA with persisted Git credentials disabled. Never checkout `head.sha` or build unmerged fork code.

`pull_request_target` uses the repository's default-branch workflow context, so neither source checkout nor environment selection may rely on `github.ref`, `github.sha`, or the default checkout. Selecting this event supports merged fork PRs without requiring their pre-merge CI to receive secrets. A `push` trigger was rejected because it does not itself prove a PR merged; an ordinary `pull_request` deployment trigger was rejected because fork secret restrictions can block merged contributions.

Keep the automatic trigger free of file-path filters initially: like the legacy release process, every eligible merged PR validates/releases its target branch. API CI must cover the new workflow and its policy tests without receiving release credentials.

### 2. Fetch all real deployment settings privately and inject Actions Secrets

Use `dev`, `beta`, and `prod`, with `main` mapped to `prod`. The executor's environment-bound job obtains `API_CONFIG_REPOSITORY` and optional `API_CONFIG_MANIFEST_PATH` from Actions Secrets, with `CONFIG_REPO_TOKEN` scoped read-only to the configuration repository. Verify private repository identity, read its default branch, and resolve that branch once to a full immutable commit SHA. Fetch both manifest and native TOML at that exact SHA; a later branch advance cannot change files within the attempt. There is no configuration-ref input or Secret to maintain. Reject missing/invalid default branches or resolved revisions before fetching files. Neither private branch nor revision is printed. No private selector is a public workflow input or ordinary Actions Variable.

Use the conventional private layout `api/dev.toml`, `api/beta.toml`, `api/prod.toml`, and `api/releases.json`. The manifest selects the corresponding native file. `API_CONFIG_MANIFEST_PATH` is optional when this conventional manifest path is used; an explicitly configured alternative still comes from Actions Secrets. The generic default path exposes no installation metadata. Maintain real configuration in an independent private checkout, never inside the public source repository, and do not invent missing account, zone, or Tunnel settings when adapting legacy files.

Fetch a declarative release manifest and native Wrangler configuration into protected runner temporary storage. The manifest selects the configuration path, optional Wrangler environment, Tunnel hostname/listener, firewall zone, and expected account/installation metadata for the logical environment. Actual hosts, resource IDs, Worker identities, routes, configuration paths, and configuration revisions belong in this private data, not public YAML or documentation. The operator preserves existing test infrastructure for `dev`, production infrastructure for `beta`/`prod`, and their distinct Worker configurations. Public schemas/templates use synthetic values only.

Credential values come exclusively from environment-scoped Actions Secrets: `CLOUDFLARE_API_TOKEN`, `HYPERDRIVE_DATABASE_URL`, `LOGS_DATABASE_URL`, `CLOUDFLARE_TUNNEL_CLIENT_ID`, `CLOUDFLARE_TUNNEL_TOKEN`, and `CLOUDFLARE_FIREWALL_API_TOKEN`, in addition to the private checkout token. Account/resource identity is selected from the private configuration/manifest and checked for consistency. Document generic mappings from the legacy secret names without actual values. The manifest/configuration must reject embedded credential material, arbitrary commands, and executable hooks; do not download .env, .dev.vars, keys, or credential files. Existing Worker runtime secrets remain separately provisioned and are not downloaded into this pipeline.

Keep private metadata within the same job and pass it through protected temporary files or scoped subprocess environments rather than cross-job outputs. Disable persisted Git credentials and command tracing. Fetch only the declared manifest/native TOML through the authenticated GitHub Contents API after verifying private status and the immutable commit; this avoids cloning unrelated files or creating a credential helper. Keep API diagnostics, URLs, refs, response bodies and commit subjects out of public output. A generic failure identifies the stage or schema field, never the supplied value.

Preserve config-path containment and reject line breaks, malformed Tunnel hostnames, invalid account selection, and missing prerequisites before remote access. Resolve `SLAX_API_CONFIG` to the fetched file and set `SLAX_API_ENV` only from the private manifest's explicit optional Wrangler environment. Require explicit test `EDGE` identity in the private configuration; public instructions show only placeholder identity values.

GitHub Environments must permit the actual `pull_request_target` default-branch workflow context (`dev`); the executor's guard validates the requested base branch. Document this so a production environment restricted only to the event ref `main` does not unexpectedly block promotions. Public summaries identify the public PR/source SHA, logical environment, and stage results. Validate configuration pinning silently; never print the private repository, revision, file path, or a raw private checkout response.

### 3. Validate offline before opening database access

Keep root dependency installation, `pnpm api -- gen:all`, lint, typecheck, test, and build before the remote phase. Install dependencies without injecting release credentials, preferably before the private fetch. Generation retains its placeholder URLs and no Worker runtime secrets are exported as tool environment bindings. Ordinary PR CI uses the public generic template and synthetic fixtures; only a qualifying merged release obtains the private configuration needed for configured release validation. Capture output from every stage that sees private configuration under decision 6.

After validation and the final stale-release check, install/select a supported cloudflared version, resolve/validate the runner's public IP, and create or reuse a zone access rule. Validate both HTTP and Cloudflare API success. Record ownership immediately when a new rule is created. An existing rule is not owned by the run and must survive cleanup. Use metadata that identifies the repository/run without including secrets.

Start only the selected Tunnel process, track its PID, and wait a bounded period for both PostgreSQL and logs connections using non-mutating connection checks. Do not use a fixed sleep or assume a listening TCP port means database authentication succeeded. The supplied URLs must route through the configured Tunnel listener; never silently rewrite their database/account targets. Avoid debug logging or connection strings in diagnostics.

Run sequentially with environment-selected credentials:

1. `pnpm api -- migration:deploy:pgsql`
2. `pnpm api -- migration:deploy:logs`
3. `pnpm api -- migration:remote:d1`
4. `pnpm api -- migration:remote:fulltext`
5. `pnpm api -- deploy`

Reuse the existing normal Browser → AI → Core → Edge order. A failure stops later commands. The workflow does not run setup, resource provisioning, bootstrap, or Worker secret uploads. Beta continues to require expand/contract-compatible migrations under the existing review policy.

### 4. Lock shared release resources and reject superseded runs

Use executor-owned concurrency groups: one test group and one shared production-infrastructure group for beta/prod, with `cancel-in-progress: false`. Do not give caller and callee the same concurrency group, which can self-block a reusable invocation. Keeping the full executor job under the lock is simpler and ensures validation, readiness, migrations, and publication form one serialized release attempt.

Check that the target branch still points to the merged source SHA at the start and again immediately before the first remote mutation. A mismatched SHA produces a visible superseded result and no remote operations; inability to verify the branch is a failure. This prevents delayed runs and old retries from replacing a newer release on the same branch. It does not impose a global source-SHA comparison between beta and main, whose histories differ.

GitHub concurrency is not a promise that every intermediate queued run will execute in order. The design deploys eligible current tips without cancelling an executing migration. Each attempt resolves the configuration default branch once and validates that immutable commit without publishing it. A retry resolves the then-current default branch again and can use newer reviewed configuration; each individual attempt still uses one fixed revision. Public summaries report configuration-validation status only.

### 5. Make cleanup and policy behavior testable without remote operations

Add small repository workflow-policy helpers/tests under `tooling/` for release eligibility, branch mapping, selector validation, superseded outcomes, and remote-phase process/state handling. Helpers are internal orchestration; API operations continue through the existing root abstraction. Use injected command/network substitutes to verify migration ordering, bounded readiness, stop-on-failure, and cleanup ownership.

Use an always-running cleanup path that stops the owned Tunnel PID and deletes only the run-owned firewall rule. Validate deletion results and report cleanup failure while preserving any earlier failure. Keep all cleanup identifiers out of unrelated global process termination such as `pkill cloudflared`.

Check workflow syntax and the placement of guards, fixed checkout revisions, shared concurrency, and cleanup. Run focused policy tests in PR CI with synthetic metadata and fake command execution. Preserve existing deployment-config tests and verify the new docs' root command examples. Private release files and captured output have their own always-attempted cleanup alongside firewall/Tunnel cleanup.

### 6. Restrict public output and persistence across the complete release

Treat public workflow logs, annotations, summaries, cross-job outputs, caches, and artifacts as public surfaces. Remove the current configuration-SHA echo and do not stream private checkout, configuration parsing, Wrangler, Prisma, cloudflared, HTTP, or cleanup diagnostics directly to those surfaces. Capture child stdout/stderr and exceptions in bounded temporary storage or memory; emit only predefined stage names, safe error categories, exit statuses, and public source identifiers. Captured output must not be uploaded as a debugging artifact. This also prevents raw child output from introducing workflow annotations or commands.

Register bootstrap selectors and private values/derived representations through runner-consumed masking commands before any eligible exposure as defense in depth. These internal commands are not public diagnostics. Masking is not the primary filter: values read from files, transformed strings, response bodies, command arguments, and exceptions must remain absent even if a masker misses them. Never dump environment variables, use shell tracing, display configuration, or interpolate private values into executable shell text or public workflow outputs. GitHub's [Secrets guidance](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets) requires explicitly masking sensitive information that is not an Actions Secret; the [workflow-command reference](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#masking-a-value-in-a-log) documents masking commands.

Use dependency-cache scopes that exclude the private checkout, credential helpers, generated Worker configurations, private manifests, captured logs, and configuration-derived build/deployment outputs. Do not upload those files or move them into cross-job outputs. Remove private checkout/helper data and configuration-derived temporary/generated files on success, failure, or ordinary cancellation. Inject each credential only into stages/processes that need it, through supported scoped environment/stdin interfaces rather than generating plaintext secret configuration files.

Use synthetic sentinel values for private repository/ref/path, infrastructure settings, credentials, and transformed/encoded variants. Offline tests must verify absence from public-facing stdout/stderr, summaries, annotations, outputs, and artifact/cache selections on success and on checkout, parse, readiness, migration, deployment, and cleanup failures. Missing or unverified privacy handling fails before remote publication.

## Risks / Trade-offs

The independent configuration repository also needs agent instructions and a required PR check. Its canonical `AGENTS.md` forbids credential files, tokens, passwords, private keys and credential URLs even in a private repository; the requested `Agent.MD` points to that policy. PR CI uses a pinned Gitleaks CLI and an additional credential-file/configuration guard over every introduced commit, including credentials removed by a later commit. It runs with read-only repository permissions and no deployment Secrets, captures/redacts diagnostics, and uploads no reports. Branch protection must require the `Secret scan` check and review changes to the scan policy; CI alone does not prevent an administrator bypass or a direct push.

- Beta mutates production PostgreSQL/logs and the shared Browser Worker before main promotion → Preserve the requested topology, serialize both releases, and retain the existing production-compatibility review requirement.
- Stale configuration or missing GitHub settings can block the first release → Fail before remote access and document the private manifest schema, protected bootstrap selectors, Actions Secrets, and branch-policy prerequisites using placeholders.
- PostgreSQL, logs, D1, and Worker publication are not one transaction → Stop on the first failure, report completed stages, and retry idempotent migrations/publication; never perform automatic destructive schema rollback.
- A runner can terminate before cleanup finishes → Use identifiable run-owned rules and document manual removal of an abandoned rule; ordinary failure/cancellation must execute cleanup.
- Configuration and source metadata must cross a privileged event boundary → Restrict the event/caller, pin committed source, pass values as data, validate selectors, and never execute unmerged heads.
- Tool failures and generated configs can disclose private data even when tokens are masked → Capture raw output, emit predefined public diagnostics, isolate private storage, and test sentinel absence across every persistence/output surface.

## Migration Plan

1. Obtain human review of these artifacts before implementation.
2. Implement and verify the workflows, helpers/tests, and English operator documentation on `ci/merge-triggered-api-deploy`.
3. Document the private manifest/native-config schema and Actions Secrets migration using placeholders only. Add an English counterpart to the existing CI guide and cross-link obsolete manual-deployment guidance.
4. Operators complete and review the private configuration repository's default branch and prepare GitHub Actions Secrets before the PR merges into `dev`; missing settings must prevent the first remote operation. Configuration changes on that branch are picked up automatically by the next eligible release attempt. Private values and resource IDs are never copied into public examples.
5. Run OpenSpec strict validation and the local review from `REVIEW.md`, then publish a PR targeting `dev` with `OpenSpec: merge-triggered-api-deploy`.
6. The implementation PR's merge can initiate the first test release. Promote the reviewed workflow through beta and main using the repository's human-managed merge-commit promotion process.
7. A release failure is retried from its existing run if its source remains current. Recovery requiring code/schema changes uses a new PR; revert code only when compatible with applied migrations. Disabling automation, if needed, is an operator action.
